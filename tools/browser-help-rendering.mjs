import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";
const output = path.join(os.tmpdir(), "opencode", `vascolet-help-rendering-${Date.now()}`);
await mkdir(output, { recursive: true });
const { server, url } = await startServer();
const report = { output, checks: [], screenshots: [], errors: [] };
let browser, page;
const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
async function key(k) { await page.keyboard.press(k, { delay: 50 }); await settle(); }
async function click(x, y) { const b = await page.locator("#game").boundingBox(); await page.mouse.click(b.x+x*b.width/512,b.y+y*b.height/384); await settle(); }
async function shot(name) { const file = path.join(output, `${name}.png`); await page.locator("#game").screenshot({ path: file }); report.screenshots.push(file); }
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_EXECUTABLE ||
    path.join(process.env.LOCALAPPDATA, "ms-playwright/chromium-1243/chrome-win64/chrome.exe") });
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on("pageerror", e => report.errors.push(e.message));
  page.on("console", m => { if (["error", "warning"].includes(m.type())) report.errors.push(m.text()); });
  page.on("response", r => { if (r.status() >= 400) report.errors.push(`${r.status()} ${r.url()}`); });
  await page.addInitScript(() => {
    window.__uiRects = {}; window.__tileSamples = []; window.__lastFlyFlip = null;
    const draw = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) {
      const result = draw.call(this,image,...args);
      if (this.canvas.id !== "game" || args.length !== 8) return result;
      const src = image.src || "", [sx,sy,sw,sh,x,y,w,h] = args, m = this.getTransform();
      if (src.endsWith("/fly.png")) window.__lastFlyFlip = m.a < 0;
      if (src.includes("/tilesets/") && window.__tileSamples.length < 200) window.__tileSamples.push({ smoothing: this.imageSmoothingEnabled, sw, sh });
      if (src.includes("/images/hud/hud.png") && ((sx === 312 && sy === 1) || (sx === 1 && sy === 102))) {
        const points = [[x,y],[x+w,y],[x,y+h],[x+w,y+h]].map(([x,y]) => ({ x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f }));
        window.__uiRects[sx === 312 ? "portrait" : "dialog"] = { left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),
          top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y)) };
      }
      return result;
    };
  });
  await page.goto(url); await page.locator("#boot").waitFor({ state: "detached" });
  await page.locator("#game").evaluate(c => { c.style.width="800px";c.style.height="600px"; });
  await key("Enter"); await key("Enter"); await key("Enter");
  await page.waitForFunction(async () => Boolean((await import("/js/game.js")).Game.helper));
  await page.waitForTimeout(1000); await shot("help-first-native-layout");
  report.first = await page.evaluate(async () => {
    const g = (await import("/js/game.js")).Game;
    return { sign:g.infos[0], player:{x:g.player.x,y:g.player.y}, helper:{x:g.helper.x,y:g.helper.y,phase:g.helper.phase},
      text:g.dlg.text,pages:g.dlg.pages,rects:window.__uiRects };
  });
  assert.equal(report.first.sign.y,382); assert.equal(report.first.player.y,382);
  for (const r of Object.values(report.first.rects)) assert.ok(r.left>=0&&r.top>=0&&r.right<=512&&r.bottom<=384);
  assert.ok(report.first.helper.y > 100 && report.first.helper.y < 384);
  report.checks.push("Cartel al suelo, retrato y banner completos, texto bitmap y Lampi animado entrando desde arriba");
  const generation = await page.evaluate(async () => (await import("/js/game.js")).Game.helperSerial);
  await page.keyboard.down("ArrowRight"); await page.waitForTimeout(1000); await page.keyboard.up("ArrowRight");
  await page.waitForTimeout(3000);
  await page.keyboard.down("ArrowLeft"); await page.waitForTimeout(1000); await page.keyboard.up("ArrowLeft");
  await page.waitForTimeout(850);
  const reentry = await page.evaluate(async () => {
    const g = (await import("/js/game.js")).Game; return { generation:g.helperSerial, helper:!!g.helper, text:g.dlg?.text };
  });
  assert.ok(reentry.generation>generation&&reentry.helper&&reentry.text===report.first.text);
  await shot("help-reentry"); report.checks.push("Al alejarse y volver al cartel, Lampi y el diálogo se activan otra vez");
  // A controlled long message checks wrapping/paging without hiding any text.
  await page.evaluate(async () => {
    const g = (await import("/js/game.js")).Game;
    g.texts[g.infos[0].key] = ("Texto de prueba largo para comprobar que no se corte ninguna palabra ni el retrato. ").repeat(6);
    g.dlg=null;
  });
  await page.waitForTimeout(150);
  assert.ok(await page.evaluate(async () => (await import("/js/game.js")).Game.dlg.pages.length>1));
  await key("Enter"); await shot("long-dialog-controlled-fixture");
  assert.equal(await page.evaluate(async () => (await import("/js/game.js")).Game.dlg.page),1);
  report.checks.push("Mensaje largo controlado: líneas y páginas completas dentro del banner");

  await key("Escape");
  await page.evaluate(async () => {
    const { Game:g,loadLevel }=await import("/js/game.js"); await loadLevel(1);
    const e=g.enemies.find(e=>e.kind==="Fly"); Object.assign(e,{x:g.player.x+100,y:360,homeX:g.player.x+100,homeY:360,vx:120,vy:0,dir:1,active:true});
    g.enemies=[e];g.win=null;g.infos=[];g.dlg=null;g.helper=null;
  });
  await key("Escape"); await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>window.__lastFlyFlip),false); await shot("fly-facing-right");
  await page.evaluate(async()=>{const e=(await import("/js/game.js")).Game.enemies[0];e.vx=-120;e.dir=-1;e.homeX=e.x;});
  await page.waitForTimeout(80); assert.equal(await page.evaluate(()=>window.__lastFlyFlip),true); await shot("fly-facing-left");
  report.checks.push("Mosca comprobada visualmente en ambos sentidos de movimiento");

  await key("Escape"); await shot("pause-native-layout");
  await click(256,320); await shot("pause-quit-native-layout"); await key("Escape");
  await click(256,260); await page.waitForTimeout(150); await shot("options-filter-row-on");
  await click(326,306);
  assert.equal(await page.evaluate(async()=>(await import("/js/save.js")).Save.settings().filterTextures),false);
  await shot("options-filter-row-off");
  await key("Escape"); await key("Escape");
  await page.evaluate(()=>{window.__tileSamples=[];}); await page.waitForTimeout(100);
  const nearest=await page.evaluate(()=>window.__tileSamples);
  assert.ok(nearest.length>0&&nearest.every(d=>!d.smoothing&&d.sw===32&&d.sh===32));
  assert.equal(await page.locator("#game").evaluate(c=>c.style.imageRendering),"pixelated");
  await shot("world-nearest-unfiltered");
  await page.reload(); await page.locator("#boot").waitFor({state:"detached"});
  assert.equal(await page.locator("#game").evaluate(c=>c.style.imageRendering),"pixelated");
  await click(450,170); await page.waitForTimeout(100);
  await click(326,306);
  assert.equal(await page.evaluate(async()=>(await import("/js/save.js")).Save.settings().filterTextures),true);
  assert.equal(await page.locator("#game").evaluate(c=>c.style.imageRendering),"auto");
  report.checks.push("Check de filtrado: muestreo nearest real, recortes exactos, CSS pixelado y persistencia tras recargar");
  assert.deepEqual(report.errors,[]);report.ok=true;
} catch(e){report.ok=false;report.failure=e.stack;process.exitCode=1;}
finally{
  if(page&&!page.isClosed()&&!report.ok)await shot("failure").catch(()=>{});
  await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  await writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
