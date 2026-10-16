import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const STEP_TIMEOUT = 10_000;
const RUN_TIMEOUT = 90_000;
const args = process.argv.slice(2);
const report = {
  ok: false, startedAt: new Date().toISOString(), browser: null, server: null,
  steps: [], skipped: [], screenshots: [], failures: [],
  diagnostics: { console: [], pageErrors: [], unhandledRejections: [], requestFailed: [], httpErrors: [], serverOutput: [] },
  counts: { consoleIssues: 0 },
  scope: "Keyboard/browser smoke validation only; no visual fidelity comparison.",
};
let browser, context, page, child, watchdog, interrupted = false;
let output, activeStep = "setup";

function record(kind, value) {
  report.counts[kind] = (report.counts[kind] || 0) + 1;
  if (report.diagnostics[kind].length < 200) report.diagnostics[kind].push(value);
}
function failure(step, error) {
  report.failures.push({ step, message: error.message || String(error), stack: error.stack });
}
async function step(name, action) {
  activeStep = name;
  const start = Date.now();
  try {
    await action();
    report.steps.push({ name, ok: true, durationMs: Date.now() - start });
    return true;
  } catch (error) {
    failure(name, error);
    report.steps.push({ name, ok: false, durationMs: Date.now() - start });
    return false;
  }
}
async function existingBrowser(override) {
  if (override) { await access(override); return path.resolve(override); }
  const candidates = [];
  for (const base of [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean)) {
    candidates.push(path.join(base, "Microsoft/Edge/Application/msedge.exe"), path.join(base, "Google/Chrome/Application/chrome.exe"));
  }
  // Reuse already cached Chromium only; never install or download a browser.
  for (const cache of [process.env.PLAYWRIGHT_BROWSERS_PATH, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright")].filter(Boolean)) {
    const dirs = await readdir(cache).catch(() => []);
    for (const dir of dirs.filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
      for (const suffix of ["chrome-win64/chrome.exe", "chrome-win/chrome.exe", "chrome-linux/chrome", "chrome-linux64/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        candidates.push(path.join(cache, dir, suffix));
      }
    }
  }
  if (process.platform !== "win32") candidates.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* Try the next existing installation. */ }
  }
  throw new Error("No installed Edge/Chrome or cached Chromium found. Set BROWSER_EXECUTABLE or pass --browser <existing executable>. No browser was downloaded.");
}
async function startChild() {
  child = fork(path.join(ROOT, "tools/serve.mjs"), ["--port", "0"], {
    cwd: ROOT, silent: true, windowsHide: true, execArgv: [],
  });
  for (const [stream, source] of [[child.stdout, "stdout"], [child.stderr, "stderr"]]) {
    stream.on("data", data => record("serverOutput", { source, text: data.toString().slice(0, 4000) }));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Local server did not become ready within 10s")), STEP_TIMEOUT);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Local server exited before ready: ${code}`)); });
    child.on("message", message => {
      if (message?.type === "ready") { clearTimeout(timer); resolve(message); }
    });
  });
}
async function stopChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => { child.kill(); resolve(); }, 2000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
    if (child.connected) child.send({ type: "stop" }, () => {});
    else child.kill();
  });
}
async function screenshot(name) {
  const file = path.join(output, `${name}.png`);
  await page.screenshot({ path: file, timeout: STEP_TIMEOUT });
  report.screenshots.push({ name, path: file });
}
async function resetDraws() { await page.evaluate(() => window.__browserSmoke.draws.clear()); }
async function drawn(asset) {
  await page.waitForFunction(asset => [...window.__browserSmoke.draws].some(url => url.endsWith(asset)), asset, { timeout: STEP_TIMEOUT });
  assert.equal(await page.locator("#err").textContent(), "", "In-page error overlay is not empty");
  assert.ok(await page.locator("#game").evaluate(canvas => {
    const data = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 4; i < data.length; i += 4) {
      if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) return true;
    }
    return false;
  }), "Canvas is blank or a single flat color");
}
async function key(key) {
  await page.keyboard.press(key, { delay: 65 });
  // Let a released key be consumed before sending the next edge.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function returnToMenu() {
  await resetDraws();
  await key("Escape");
  await drawn("/assets/gui/menu/menu.png");
}
async function navigate() {
  if (!await step("menu", async () => {
    await page.goto(report.server.url, { waitUntil: "load", timeout: 20_000 });
    await page.locator("#boot").waitFor({ state: "detached", timeout: 20_000 });
    await page.locator("#game").waitFor({ state: "visible" });
    assert.deepEqual(await page.evaluate(() => window.__browserSmoke.initialStorage), { local: 0, session: 0 });
    await drawn("/assets/gui/menu/menu.png");
    await screenshot("menu");
  })) return;
  if (!await step("options", async () => {
    await resetDraws();
    await key("ArrowDown"); await key("Enter");
    await drawn("/assets/gui/options/options.png");
    const volume = () => page.evaluate(async () => (await import("/js/save.js")).Save.settings().volume ?? 0.8);
    const before = await volume();
    await key("ArrowLeft");
    assert.ok((await volume()) < before, "Options ArrowLeft did not lower saved volume");
    await key("ArrowRight");
    assert.ok(Math.abs((await volume()) - before) < 0.001, "Options ArrowRight did not restore volume");
    await screenshot("options");
    await returnToMenu();
  })) return;
  for (const [name, asset] of [["help", "/assets/gui/help/help.jpg"], ["credits", "/assets/gui/credits/credits.jpg"]]) {
    if (!await step(name, async () => {
      await resetDraws();
      await key("ArrowDown"); await key("Enter");
      await drawn(asset);
      await screenshot(name);
      await returnToMenu();
    })) return;
  }
  await step("level", async () => {
    await resetDraws();
    for (let i = 0; i < 3; i++) await key("ArrowUp");
    await key("Enter"); // jugar -> capítulos
    await drawn("/assets/gui/level/level.png");
    await key("Enter"); // capítulo 1 -> video de entrada
    await key("Enter"); // saltear video
    await drawn("/assets/images/hud/hud.png");
    const player = () => page.evaluate(async () => {
      const { Game } = await import("/js/game.js");
      return { level: Game.level, x: Game.player?.x, y: Game.player?.y, map: Boolean(Game.map) };
    });
    const before = await player();
    assert.equal(before.level, 1, "Cleared storage should start level 1");
    assert.ok(before.map && Number.isFinite(before.x) && Number.isFinite(before.y), "Level/player state is invalid");
    await page.keyboard.down("ArrowRight");
    try { await page.waitForTimeout(350); } finally { await page.keyboard.up("ArrowRight"); }
    const after = await player();
    assert.ok(after.x > before.x, `ArrowRight did not move the player: ${before.x} -> ${after.x}`);
    await screenshot("level");
  });
}

try {
  let override = process.env.BROWSER_EXECUTABLE;
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i + 1] || !["--browser", "--output"].includes(args[i])) throw new Error("Usage: node tools/browser-smoke.mjs [--browser <executable>] [--output <directory>]");
    if (args[i] === "--browser") override = args[i + 1];
    else output = path.resolve(args[i + 1]);
  }
  output ||= path.join(os.tmpdir(), "opencode", `vascolet-browser-smoke-${Date.now()}`);
  await mkdir(output, { recursive: true });
  report.output = output;
  watchdog = setTimeout(() => {
    interrupted = true;
    failure(activeStep, new Error(`Overall browser smoke deadline exceeded (${RUN_TIMEOUT}ms)`));
    void browser?.close();
    child?.kill();
  }, RUN_TIMEOUT);
  const executablePath = await existingBrowser(override);
  report.browser = { executablePath };
  report.server = await startChild();
  browser = await chromium.launch({ executablePath, headless: true, timeout: 15_000 });
  report.browser.version = browser.version();
  context = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 1, serviceWorkers: "block" });
  await context.clearCookies();
  await context.addInitScript(() => {
    localStorage.clear(); sessionStorage.clear();
    const smoke = window.__browserSmoke = {
      initialStorage: { local: localStorage.length, session: sessionStorage.length }, draws: new Set(), rejections: [],
    };
    addEventListener("unhandledrejection", event => {
      if (smoke.rejections.length < 200) smoke.rejections.push(String(event.reason?.stack || event.reason));
    });
    const drawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function (image, ...rest) {
      const result = drawImage.call(this, image, ...rest);
      if (this.canvas.id === "game" && image?.src) smoke.draws.add(image.src);
      return result;
    };
  });
  page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT);
  page.on("console", message => {
    if (["error", "warning", "assert"].includes(message.type())) report.counts.consoleIssues++;
    record("console", { type: message.type(), text: message.text(), location: message.location() });
  });
  page.on("pageerror", error => record("pageErrors", { message: error.message, stack: error.stack }));
  page.on("requestfailed", request => record("requestFailed", { url: request.url(), method: request.method(), error: request.failure()?.errorText }));
  page.on("response", response => {
    if (response.status() >= 400) record("httpErrors", { url: response.url(), status: response.status(), statusText: response.statusText() });
  });
  await navigate();
  if (!interrupted) await page.waitForTimeout(300);
} catch (error) {
  failure(activeStep, error);
} finally {
  if (page && !page.isClosed()) {
    try {
      report.lastPageState = await page.evaluate(() => ({
        url: location.href, boot: document.querySelector("#boot")?.textContent ?? null,
        errorOverlay: document.querySelector("#err")?.textContent ?? null,
        drawnAssets: [...(window.__browserSmoke?.draws || [])],
      }));
      for (const text of await page.evaluate(() => window.__browserSmoke?.rejections || [])) record("unhandledRejections", { text });
      if (report.failures.length) await screenshot("failure");
    } catch (error) { failure("final-diagnostics", error); }
  }
  try { await context?.close(); } catch (error) { failure("context-cleanup", error); }
  try { await browser?.close(); } catch (error) { failure("browser-cleanup", error); }
  await stopChild();
  clearTimeout(watchdog);
  await step("browser-diagnostics", async () => {
    const errors = report.diagnostics.console.filter(message => ["error", "warning", "assert"].includes(message.type));
    assert.equal(report.counts.consoleIssues, 0, `Console errors/warnings/assertions (first 200 console events retained): ${JSON.stringify(errors)}`);
  });
  for (const kind of ["pageErrors", "unhandledRejections", "requestFailed", "httpErrors"]) {
    await step(`no-${kind}`, async () => assert.equal(report.counts[kind] || 0, 0, `${kind}: ${JSON.stringify(report.diagnostics[kind])}`));
  }
  report.skipped = ["menu", "options", "help", "credits", "level"].filter(name => !report.steps.some(step => step.name === name));
  report.ok = report.failures.length === 0 && report.skipped.length === 0;
  report.finishedAt = new Date().toISOString();
  if (output) {
    report.reportPath = path.join(output, "report.json");
    try { await writeFile(report.reportPath, JSON.stringify(report, null, 2) + "\n"); }
    catch (error) { failure("write-report", error); report.ok = false; }
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.ok ? 0 : 1;
}
