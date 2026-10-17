import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";
const output = path.join(os.tmpdir(), "opencode", `vascolet-options-video-${Date.now()}`);
await mkdir(output, { recursive: true });
const { server, url } = await startServer();
const report = { output, errors: [], checks: [], bounds: [], screenshots: [] };
let browser, page;
const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
async function point(x, y) { const b = await page.locator("#game").boundingBox(); return { x: b.x+x*b.width/512, y: b.y+y*b.height/384 }; }
async function click(x, y) { const p = await point(x, y); await page.mouse.click(p.x, p.y); await settle(); }
async function key(k) { await page.keyboard.press(k, { delay: 60 }); await settle(); }
async function shot(name) { const file = path.join(output, `${name}.png`); await page.screenshot({ path: file }); report.screenshots.push(file); }
async function settings() { return page.evaluate(async () => (await import("/js/save.js")).Save.settings()); }
async function aligned(label, video = true) {
  await settle(); const canvas = await page.locator("#game").boundingBox(), viewport = page.viewportSize();
  assert.ok(Math.abs(canvas.x - (viewport.width-canvas.width)/2) < 1);
  assert.ok(Math.abs(canvas.y - (viewport.height-canvas.height)/2) < 1, `${label}: canvas is not vertically centered`);
  const bounds = { label, canvas };
  if (video) {
    const movie = await page.locator("video").boundingBox(); bounds.video = movie;
    for (const k of ["x", "y", "width", "height"]) assert.ok(Math.abs(movie[k]-canvas[k]) < 1, `${label}: video ${k} differs from canvas`);
  }
  report.bounds.push(bounds);
}
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ||
    path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1243/chrome-win64/chrome.exe") });
  page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  page.on("pageerror", e => report.errors.push(e.message));
  page.on("console", m => { if (["error", "warning"].includes(m.type())) report.errors.push(m.text()); });
  page.on("response", r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(url); await page.locator("#boot").waitFor({ state: "detached" });
  await click(450, 170); await page.waitForTimeout(150); await shot("options-native-layout");
  const before = await settings(); await click(90, 174); assert.equal((await settings()).music, before.music);
  await click(331, 145); assert.equal((await settings()).musicMute, true);
  assert.equal(await page.evaluate(async () => (await import("/js/audio.js")).Audio2.musicVolume), 0);
  await click(331, 145); assert.equal((await settings()).musicMute, false);
  await click(258, 174); assert.equal((await settings()).music, .5);
  const start = await point(258, 174), end = await point(358, 174);
  await page.mouse.move(start.x,start.y); await page.mouse.down(); await page.mouse.move(end.x,end.y,{ steps: 10 });
  await settle(); await page.mouse.up(); await settle(); assert.equal((await settings()).music, 1);
  await click(158, 239); assert.equal((await settings()).sfx, 0);
  await click(327, 294); assert.equal((await settings()).stretch, false);
  await click(327, 270); assert.equal((await settings()).fullscreen, true);
  await page.waitForTimeout(150); await click(327, 270); assert.equal((await settings()).fullscreen, false);
  await page.mouse.move(10,10); await shot("options-after-interaction");
  report.checks.push("Layout, outside clicks, music mute/unmute, continuous drag, independent SFX and both display checks");
  await click(256, 330); await click(450, 130); await page.waitForTimeout(150);
  await aligned("selector", false); await key("Enter");
  await page.locator("video").waitFor({ state: "visible" });
  // Wait until play() has fulfilled; pausing a pending play promise aborts it and
  // legitimately invokes the game's fallback-to-level handler.
  await page.waitForFunction(() => { const v = document.querySelector("video"); return v && !v.paused && v.readyState >= 2; });
  await settle(); await page.locator("video").evaluate(v => v.pause());
  await aligned("video-start"); await shot("video-centered");
  await page.setViewportSize({ width: 900, height: 740 }); await page.waitForTimeout(100); await aligned("video-resize");
  await page.setViewportSize({ width: 1200, height: 900 }); await page.waitForTimeout(100); await aligned("video-resize-again");
  await key("Enter"); await page.locator("video").waitFor({ state: "detached" });
  await page.waitForFunction(async () => Boolean((await import("/js/game.js")).Game.player));
  await aligned("gameplay-after-video", false); await shot("gameplay-centered");
  assert.equal(await page.locator("#wrap").evaluate(w => getComputedStyle(w).position), "fixed");
  report.checks.push("Canvas/video centered before, during, after video and two viewport resizes");
  assert.deepEqual(report.errors, []); report.ok = true;
} catch (e) { report.ok = false; report.failure = e.stack; process.exitCode = 1; }
finally {
  if (page && !page.isClosed() && !report.ok) await shot("failure").catch(() => {});
  await browser?.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
  await writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
}
