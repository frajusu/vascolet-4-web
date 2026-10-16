import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";

const output = path.join(os.tmpdir(), "opencode", `vascolet-menus-${Date.now()}`);
await mkdir(output, { recursive: true });
const { server, url } = await startServer();
const report = { output, errors: [], checks: [], screenshots: [] };
let browser, page;
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const key = async key => { await page.keyboard.press(key, { delay: 50 }); await settle(); };
const click = async (x, y) => { await page.locator("#game").click({ position: { x: x * 800 / 512, y: y * 600 / 384 } }); await settle(); };
const drawn = suffix => page.waitForFunction(s => [...window.__menuDraws].some(url => url.endsWith(s)), suffix);
const clear = () => page.evaluate(() => { window.__menuDraws.clear(); window.__cards.clear(); });
const shot = async name => {
  const file = path.join(output, name + ".png"); await page.locator("#game").screenshot({ path: file }); report.screenshots.push(file);
};
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ||
    path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1243/chrome-win64/chrome.exe") });
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("pageerror", e => report.errors.push(e.message));
  page.on("console", m => { if (["error", "warning"].includes(m.type())) report.errors.push(m.text()); });
  page.on("response", r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(() => {
    localStorage.setItem("vascolet4-save-v1", JSON.stringify({ unlocked: 3 }));
    window.__menuDraws = new Set(); window.__cards = new Set();
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(image, ...rect) {
      if (this.canvas.id === "game" && image.src) {
        window.__menuDraws.add(image.src);
        if (/area0\d.jpg$/.test(image.src)) window.__chapterBackground = image.src;
        if (image.src.endsWith("trofeos.png")) window.__cards.add(JSON.stringify(rect));
        if (image.src.endsWith("/level.png") && rect[0] === 48 && rect[1] === 48) window.__selectedPosition = rect.slice(4, 6);
      }
      return draw.call(this, image, ...rect);
    };
  });
  await page.goto(url); await page.locator("#boot").waitFor({ state: "detached" });
  await page.locator("#game").evaluate(c => { c.style.width = "800px"; c.style.height = "600px"; });
  await click(450, 130); await drawn("/level.png"); await settle();
  await shot("selector-3");
  assert.deepEqual(await page.evaluate(() => window.__selectedPosition), [48, 292]);
  assert.ok((await page.evaluate(() => window.__chapterBackground)).endsWith("area01.jpg"));
  report.checks.push("Posiciones e iconos del capítulo 1-3 y fondo sin relleno blanco");

  await clear(); await click(448, 24); await drawn("/trofeos.png"); await settle();
  assert.equal(await page.evaluate(() => window.__cards.size), 20);
  await page.mouse.move(790, 590); await settle(); await shot("trophies-locked");
  await key("ArrowRight"); assert.equal(await page.locator("#boot").count(), 0);
  await clear(); await click(100, 100); await settle(); await drawn("/trofeos.png");
  await click(256, 340); await drawn("/level.png");
  assert.deepEqual(await page.evaluate(() => window.__selectedPosition), [48, 292]);
  report.checks.push("20 trofeos grises, click externo no sale, Volver conserva el capítulo seleccionado");

  await page.evaluate(async () => (await import("/js/save.js")).Save.unlock(6));
  await key("Escape"); await clear(); await click(450, 130); await drawn("/level.png");
  assert.ok((await page.evaluate(() => window.__chapterBackground)).endsWith("area02.jpg"));
  const bg = await page.evaluate(() => window.__chapterBackground);
  await page.mouse.move(790, 590);
  for (let i = 0; i < 5; i++) await key("ArrowLeft");
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => window.__chapterBackground), bg);
  assert.deepEqual(await page.evaluate(() => window.__selectedPosition), [8, 224]);
  await shot("selector-progress6-selected1");
  // The red locked stage 18 is mouse-inert.
  await click(384, 72); assert.deepEqual(await page.evaluate(() => window.__selectedPosition), [8, 224]);
  report.checks.push("Fondo por progreso estable al cruzar áreas y niveles bloqueados no seleccionables");

  await page.evaluate(async () => {
    const { Save } = await import("/js/save.js"); Save.collectItem("&B-Item1"); Save.write({ level: 1, x: 300, y: 384 });
  });
  await clear(); await click(448, 24); await drawn("/trofeos.png"); await settle();
  const cards = await page.evaluate(() => [...window.__cards].map(s => JSON.parse(s)));
  assert.ok(cards.some(r => r[0] === 56 && r[1] === 119), "saved apple should use enabled crop");
  await page.mouse.move(790, 590); await shot("trophies-one-collected");
  report.checks.push("Trofeo coloreado desde guardado, conservado después de checkpoint");
  assert.deepEqual(report.errors, []); assert.equal(await page.locator("#err").textContent(), "");
  report.ok = true;
} catch (error) { report.ok = false; report.failure = error.stack; process.exitCode = 1; }
finally {
  if (page && !page.isClosed() && !report.ok) await shot("failure").catch(() => {});
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
}
