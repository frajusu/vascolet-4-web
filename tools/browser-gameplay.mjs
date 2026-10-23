// Real keyboard playthrough + clearly labeled controlled combat checks in Chromium.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";

const output = path.join(os.tmpdir(), "opencode", `vascolet-gameplay-${Date.now()}`);
await mkdir(output, { recursive: true });
const { server, url } = await startServer();
const errors = [], report = { output, checks: [], screenshots: [], errors };
let browser, page;
const key = async value => { await page.keyboard.press(value, { delay: 60 }); await page.waitForTimeout(80); };
const shot = async name => {
  const file = path.join(output, name + ".png");
  await page.locator("#game").screenshot({ path: file }); report.screenshots.push(file);
};
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ||
    path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1243/chrome-win64/chrome.exe") });
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (["error", "warning"].includes(m.type())) errors.push(m.text()); });
  page.on("response", r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(() => {
    window.__drawnText = new Set();
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...rest) {
      window.__drawnText.add(text); return original.call(this, text, ...rest);
    };
  });
  await page.goto(url); await page.locator("#boot").waitFor({ state: "detached" });
  await page.evaluate(async()=>{window.__game=(await import("/js/game.js")).Game;});
  for (const [name, steps] of [["help", 2], ["credits", 1]]) {
    for (let i = 0; i < steps; i++) await key("ArrowDown");
    await page.evaluate(() => window.__drawnText.clear());
    await key("Enter"); await page.waitForTimeout(150);
    assert.ok(!(await page.evaluate(() => [...window.__drawnText])).some(t => /cualquier tecla/i.test(t)));
    await shot(name); await key("Escape");
  }
  report.checks.push("Ayuda y Créditos sin texto agregado");
  for (let i = 0; i < 3; i++) await key("ArrowUp");
  await key("Enter"); await key("Enter"); await key("Enter");
  await page.waitForFunction(() => Boolean(window.__game.player?.anim&&window.__game.time>0));
  await shot("level1-camera");
  const state = () => page.evaluate(async () => {
    const { Game: g } = await import("/js/game.js");
    return { x: g.player.x, y: g.player.y, energy: g.energy, lives: g.lives, cameraBottom: g.camY + 384,
      active: g.enemies.filter(e => e.active).map(e => ({ kind: e.kind, hp: e.hp, state: e.state })), booms: g.booms.length };
  });
  report.walkStart = await state();
  await page.keyboard.down("ArrowRight");
  for (let i = 0; i < 14; i++) {
    await page.keyboard.down("z"); await page.waitForTimeout(280); await page.keyboard.up("z");
    await key("x"); await page.waitForTimeout(300);
  }
  await page.keyboard.up("ArrowRight");
  report.walkEnd = await state();
  assert.ok(report.walkEnd.x > report.walkStart.x + 500, "keyboard playthrough did not progress");
  assert.ok(report.walkEnd.cameraBottom <= 480.001);
  await shot("keyboard-playthrough"); report.checks.push("Recorrido con teclado, saltos y ataques sobre el nivel real");

  // Pause before loading a known original-map location for a repeatable free throw.
  await key("Escape");
  await page.evaluate(async () => { await (await import("/js/game.js")).loadLevel(3); });
  await key("Escape"); await page.waitForTimeout(300);
  await page.evaluate(async () => {
    const { Game: g } = await import("/js/game.js");
    window.__boomSamples = []; window.__sampleStart = g.time;
    window.__sampler = setInterval(() => window.__boomSamples.push({ t: g.time - window.__sampleStart,
      player: { x: g.player.x, y: g.player.y }, booms: g.booms.map(b => ({ x: b.x, y: b.y, state: b.state })) }), 20);
  });
  await key("x"); await page.waitForTimeout(320); await shot("boomerang-out");
  await page.waitForTimeout(400); await shot("boomerang-return");
  await page.waitForTimeout(850);
  report.throw = await page.evaluate(() => { clearInterval(window.__sampler); return window.__boomSamples; });
  const travel = report.throw.flatMap(s => s.booms.map(b => b.x - s.player.x));
  assert.ok(Math.max(...travel) > 130 && Math.max(...travel) < 165, "new-game range, without the two-fruit upgrade from the older reference");
  assert.ok(report.throw.some(s => s.booms.some(b => b.state === "return")));
  assert.equal((await state()).booms, 0);
  report.checks.push("Lanzamiento y retorno reales en navegador, capturas y telemetría");

  // Controlled placement isolates hit/contact logic; it is NOT a natural encounter.
  await key("Escape");
  await page.evaluate(async () => {
    const { Game: g, loadLevel } = await import("/js/game.js"); await loadLevel(1);
    const e = g.enemies.find(e => e.kind === "Fly");
    g.enemies = [e]; g.win = null; e.x = g.player.x + 130; e.y = g.player.y - 8;
    e.homeX = e.x; e.homeY = e.y; e.active = true;
    g.infos = []; g.dlg = null;
  });
  await key("Escape"); await key("x"); await page.waitForTimeout(500);
  const killed = await page.evaluate(async () => (await import("/js/game.js")).Game.enemies[0].hp === 0);
  assert.ok(killed, "boomerang must kill the controlled fly encounter");
  await shot("controlled-fly-hit"); report.checks.push("Encuentro controlado: impacto y muerte de mosca");
  await key("Escape");
  await page.evaluate(async () => {
    const { Game: g, loadLevel } = await import("/js/game.js"); await loadLevel(1); g.infos = []; g.dlg = null;
  });
  await key("Escape"); await key("x");
  await page.waitForFunction(() => window.__game.booms.length === 1);
  await page.evaluate(async () => {
    const { Game:g }=await import("/js/game.js"); window.__movingBoom=g.booms[0]; window.__movingSamples=[];
    window.__movingTimer=setInterval(()=>{const b=window.__movingBoom,p=g.player;
      window.__movingSamples.push({t:b.t,x:b.x,y:b.y,vx:b.vx,vy:b.vy,state:b.state,life:b.life,caught:b.caught,player:{x:p.x,y:p.y}});},20);
  });
  await page.keyboard.down("ArrowRight"); await page.keyboard.down("z");
  await page.waitForTimeout(250); await shot("moving-boomerang-out");
  await page.keyboard.up("ArrowRight"); await page.keyboard.up("z"); await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(300); await page.keyboard.up("ArrowLeft");
  await shot("moving-boomerang-turn");
  await page.waitForFunction(()=>window.__movingBoom.life<=0,{},{timeout:6000});
  report.movingThrow = await page.evaluate(() => ({ caught: window.__movingBoom.caught, t: window.__movingBoom.t,
    launchX: window.__movingBoom.launchX, launchY: window.__movingBoom.launchY }));
  report.movingSamples=await page.evaluate(()=>{clearInterval(window.__movingTimer);return window.__movingSamples;});
  assert.equal(report.movingThrow.caught, true, "moving throw must be caught rather than expire or trail the player");
  report.checks.push("Lanzamiento con salto y cambio de dirección: retorno y recogida reales");
  await key("Escape");
  report.recoil = await page.evaluate(async () => {
    const { Game: g, loadLevel } = await import("/js/game.js"); await loadLevel(1);
    g.player.y = 382; g.player.ground = true; g.player.face = 1; g.player.inv = 0;
    const fly = g.enemies.find(e => e.kind === "Fly");
    Object.assign(fly, { x: g.player.x + 5, y: 382, homeX: g.player.x + 5, homeY: 382, active: true, vx: 0, vy: 0 });
    g.enemies = [fly]; g.win = null; g.infos = []; g.dlg = null;
    window.__recoilSamples = [];
    window.__recoilTimer = setInterval(() => {
      const p = g.player;
      if (window.__recoilSamples.length < 180) window.__recoilSamples.push({ t:g.time, x:p.x, y:p.y, phase:p.damage?.phase ?? null });
    }, 16);
    return { start: { x: g.player.x, y: g.player.y } };
  });
  await key("Escape");
  await page.waitForFunction(() => Boolean(window.__game.player.damage));
  await page.evaluate(async () => { (await import("/js/game.js")).Game.enemies = []; });
  await page.waitForTimeout(80); await shot("player-recoil");
  await page.waitForTimeout(1000);
  const recoilSamples = await page.evaluate(() => { clearInterval(window.__recoilTimer); return window.__recoilSamples; });
  // Check the recorded trajectory, not a transient pose after screenshot latency.
  report.recoil.sampleCount = recoilSamples.length;
  report.recoil.minX = Math.min(...recoilSamples.map(s => s.x)); report.recoil.minY = Math.min(...recoilSamples.map(s => s.y));
  report.recoil.apex = recoilSamples.reduce((best,s) => s.y < best.y ? s : best, recoilSamples[0]);
  assert.ok(report.recoil.minX < report.recoil.start.x - 4 && report.recoil.minY < report.recoil.start.y - 10);
  assert.equal(await page.evaluate(async () => (await import("/js/game.js")).Game.player.damage), null);
  report.checks.push("Daño real por contacto: retroceso, salto y recuperación del jugador");
  assert.deepEqual(errors, []); assert.equal(await page.locator("#err").textContent(), "");
  report.ok = true;
} catch (e) { report.ok = false; report.failure = e.stack; process.exitCode = 1; }
finally {
  if (page && !page.isClosed() && !report.ok) await shot("failure").catch(() => {});
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, throw: report.throw ? `${report.throw.length} samples in report.json` : null,
    movingSamples:report.movingSamples?`${report.movingSamples.length} samples in report.json`:null }, null, 2));
}
