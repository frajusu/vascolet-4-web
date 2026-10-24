import assert from "node:assert/strict";
import { mkdir,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";
import { startNewGame } from "./browser-session.mjs";
const output=path.join(os.tmpdir(),"opencode",`vascolet-fullscreen-trash-${Date.now()}`);
await mkdir(output,{recursive:true});const {server,url}=await startServer();
const report={output,checks:[],errors:[]};let browser,page;
const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
async function click(x,y){const box=await page.locator("#game").boundingBox();await page.mouse.click(box.x+x*box.width/512,box.y+y*box.height/384,{delay:50});await settle();}
const shot=async name=>page.locator("#game").screenshot({path:path.join(output,`${name}.png`)});
const full=()=>page.evaluate(()=>!!document.fullscreenElement);
async function checkbox(){return page.evaluate(async()=>{
  const {optionsInit,optionsDraw}=await import("/js/menu.js");await optionsInit();
  const canvas=document.createElement("canvas");canvas.width=512;canvas.height=384;const ctx=canvas.getContext("2d"),draw=ctx.drawImage;let checked=null;
  ctx.drawImage=function(image,...r){if(image.src?.endsWith("/options.png")&&r[4]>=314&&r[4]<=316&&r[5]>=246&&r[5]<=248)
    checked=(r[0]===514&&r[1]===120)||(r[0]===563&&r[1]===67);return draw.call(this,image,...r);};
  optionsDraw(ctx);return checked;
});}
async function enterWithGesture(){
  await page.evaluate(()=>{const b=document.createElement("button");b.id="test-fullscreen";b.textContent="Fullscreen fixture";
    b.style.cssText="position:fixed;top:0;left:0;z-index:10000";b.onclick=()=>document.documentElement.requestFullscreen();document.body.append(b);});
  await page.locator("#test-fullscreen").click();await page.waitForFunction(()=>!!document.fullscreenElement);
  await page.locator("#test-fullscreen").evaluate(b=>b.remove());
}
try{
  browser=await chromium.launch({headless:true,args:["--mute-audio"],executablePath:process.env.BROWSER_EXECUTABLE||
    path.join(process.env.LOCALAPPDATA,"ms-playwright/chromium-1243/chrome-win64/chrome.exe")});
  page=await browser.newPage({viewport:{width:1100,height:900}});
  page.on("pageerror",e=>report.errors.push(e.message));
  page.on("response",r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(url);await page.locator("#boot").waitFor({state:"detached"});
  await page.evaluate(async()=>{
    window.__scene=(await import("/js/main.js")).currentScene;
    const {Save}=await import("/js/save.js");Save.unlock(3);Save.collectItem("&P-Run");
    Save.writeSettings({...Save.settings(),music:.37,sfx:.62,filterTextures:false,fullscreen:false});
  });
  const before=await page.evaluate(async()=>(await import("/js/save.js")).Save.read());
  await click(450,348);await shot("trash-original-panel");
  // The old horizontal placement must not select Yes or close the native panel.
  await click(370,235);await click(256,329);
  assert.deepEqual(await page.evaluate(async()=>(await import("/js/save.js")).Save.read()),before);
  await click(450,348);await page.keyboard.press("Escape",{delay:50});await settle();
  assert.deepEqual(await page.evaluate(async()=>(await import("/js/save.js")).Save.read()),before);
  await click(450,348);await click(256,292);
  assert.equal(await page.evaluate(async()=>(await import("/js/save.js")).Save.read()),null);
  assert.equal(await page.evaluate(async()=>(await import("/js/save.js")).Save.settings().music),.37);
  report.checks.push("Papelera: panel nativo, No/Esc cancelan, Sí borra progreso y conserva ajustes");
  await click(450,170);await page.waitForFunction(()=>window.__scene()==="options");
  assert.equal(await checkbox(),false);
  await click(326,258);await page.waitForFunction(()=>!!document.fullscreenElement);
  assert.equal(await checkbox(),true);await shot("fullscreen-options-checked");
  const preserved=await page.evaluate(async()=>(await import("/js/save.js")).Save.settings());
  assert.equal(preserved.music,.37);assert.equal(preserved.sfx,.62);assert.equal(preserved.filterTextures,false);
  assert.equal(preserved.fullscreen,true);
  await click(256,342);await page.waitForFunction(()=>window.__scene()==="menu");
  await startNewGame(page);
  await page.keyboard.press("Escape",{delay:50});await page.waitForFunction(()=>window.__scene()==="paused");
  report.escape={pausedOnFirstPress:true,retainedFullscreen:await full(),keyboardLockSupported:await page.evaluate(()=>!!navigator.keyboard?.lock)};
  await shot("first-escape-paused");
  // Exercise the browser-reserved-key fallback with a real fullscreenchange,
  // including browsers/automation modes that do deliver normal Escape to JS.
  if(!await full())await enterWithGesture();
  await page.waitForTimeout(250);await click(256,220);await page.waitForFunction(()=>window.__scene()==="game");
  await page.evaluate(()=>document.exitFullscreen());await page.waitForFunction(()=>window.__scene()==="paused");
  const time=await page.evaluate(()=>(window.__game).time);await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>window.__game.time),time);assert.equal(await full(),false);assert.equal(await checkbox(),false);
  report.checks.push("Esc pausa con una pulsación; salir de fullscreen desde el navegador también pausa sin avanzar la simulación");
  assert.equal(await page.evaluate(async()=>(await import("/js/save.js")).Save.settings().fullscreen),true,"retain the user's fullscreen startup preference");
  await page.reload();await page.locator("#boot").waitFor({state:"detached"});
  assert.equal(await full(),false);assert.equal(await checkbox(),false,"saved preference must not draw a false fullscreen checkmark");
  await page.keyboard.press("Enter",{delay:50});await page.waitForFunction(()=>!!document.fullscreenElement);
  assert.equal(await checkbox(),true);await shot("restored-after-reopen-gesture");
  await page.evaluate(async()=>{await(await import("/js/fullscreen.js")).setFullscreen(false);});
  assert.equal(await full(),false);assert.equal(await checkbox(),false);
  const final=await page.evaluate(async()=>(await import("/js/save.js")).Save.settings());
  assert.equal(final.fullscreen,false);assert.equal(final.music,.37);assert.equal(final.filterTextures,false);
  report.checks.push("Reapertura: casilla refleja estado real, primera interacción restaura la preferencia y desactivarla conserva el resto de ajustes");
  assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;process.exitCode=1;}
finally{
  if(page&&!page.isClosed()&&!report.ok)await shot("failure").catch(()=>{});
  await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  await writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
