// Reproduce blocked module downloads, exercise recovery, and validate the same
// hashed production artifact published to Pages with all fullscreen URLs blocked.
import assert from "node:assert/strict";
import { mkdir,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";
import { buildSite } from "./build-site.mjs";
const output=path.join(os.tmpdir(),"opencode",`vascolet-startup-${Date.now()}`);
await mkdir(output,{recursive:true});
const report={output,checks:[],errors:[]},servers=[];
const live=process.argv.find(a=>a.startsWith("https://"));let browser;
const progress={unlocked:3,items:["&P-SustainJump"],run:{level:1,checkpoint:{x:272,y:382},lives:4,consumed:[]}};
const boot=page=>page.waitForFunction(()=>window.VascoletBoot?.ready===true,{},{timeout:30000});
const click=async(page,x,y)=>{const b=await page.locator("#game").boundingBox();await page.mouse.click(b.x+x*b.width/512,b.y+y*b.height/384,{delay:50});};
try {
  browser=await chromium.launch({headless:true,args:["--mute-audio"],executablePath:process.env.BROWSER_EXECUTABLE||
    path.join(process.env.LOCALAPPDATA,"ms-playwright/chromium-1243/chrome-win64/chrome.exe")});
  if(!live){
    const source=await startServer();servers.push(source.server);
    const p=await browser.newPage();
    await p.addInitScript(value=>{if(!localStorage.getItem("vascolet4-save-v1"))localStorage.setItem("vascolet4-save-v1",JSON.stringify(value));},progress);
    await p.route("**/js/fullscreen.js",r=>r.abort("blockedbyclient"));
    await p.goto(source.url);await p.locator("#boot-failure").waitFor({state:"visible"});
    assert.equal(await p.locator("#boot").count(),0);assert.equal(await p.evaluate(()=>window.VascoletBoot.failed),true);
    assert.ok((await p.locator("#boot-details").textContent()).length>0);
    await p.screenshot({path:path.join(output,"blocked-source-error.png")});
    await p.unroute("**/js/fullscreen.js");await p.locator("#boot-retry").click();await boot(p);
    assert.equal(await p.locator("#boot-failure").isVisible(),false);
    assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem("vascolet4-save-v1"))),progress);
    report.checks.push("Blocked fullscreen source request shows a recoverable error instead of infinite Cargando; retry preserves save");
    await p.close();
  }
  let url=live;
  if(!url){const site=await buildSite();report.build=site;const served=await startServer({root:site.destination});servers.push(served.server);url=served.url;}
  const page=await browser.newPage({viewport:{width:1100,height:900}}),jsRequests=[],blocked=[];
  page.on("pageerror",e=>report.errors.push(e.message));
  page.on("request",r=>{if(new URL(r.url()).pathname.endsWith(".js"))jsRequests.push(r.url());});
  await page.route(/fullscreen/i,r=>{blocked.push(r.request().url());return r.abort("blockedbyclient");});
  await page.goto(url,{waitUntil:"domcontentloaded"});await boot(page);
  report.entry=await page.evaluate(()=>window.VascoletBoot.entry);
  assert.match(report.entry,/\/js\/app-[\w-]+\.js$/);assert.equal(blocked.length,0);
  assert.equal(jsRequests.length,1,"published game must request only its single versioned module");
  await page.evaluate(async()=>{window.__app=await import(window.VascoletBoot.entry);});
  await page.screenshot({path:path.join(output,"published-menu.png")});
  await click(page,450,170);await page.waitForFunction(()=>window.__app.currentScene()==="options");
  await click(page,326,258);await page.waitForFunction(()=>!!document.fullscreenElement);
  await click(page,256,342);await page.waitForFunction(()=>window.__app.currentScene()==="menu");
  await click(page,451,130);await page.waitForFunction(()=>window.__app.currentScene()==="chapters");
  await page.mouse.move(0,0);await page.keyboard.press("Enter",{delay:50});
  await page.waitForFunction(()=>["video","game"].includes(window.__app.currentScene()));
  if(await page.evaluate(()=>window.__app.currentScene()==="video"))await page.keyboard.press("Enter",{delay:50});
  await page.waitForFunction(()=>window.__app.currentScene()==="game");
  await page.keyboard.press("Escape",{delay:50});await page.waitForFunction(()=>window.__app.currentScene()==="paused");
  await page.screenshot({path:path.join(output,"published-level-paused.png")});
  assert.equal(await page.locator("#err").textContent(),"");assert.deepEqual(report.errors,[]);
  report.checks.push("Production artifact boots, opens Options/fullscreen, starts level1 and pauses with fullscreen URL filter active");
  report.jsRequests=jsRequests;
  if(!live){
    const failure=await browser.newPage();
    await failure.route("**/assets/gui/menu/menu.png",r=>r.abort("blockedbyclient"));
    await failure.goto(url);await failure.locator("#boot-failure").waitFor({state:"visible"});
    assert.equal(await failure.locator("#boot").count(),0);
    await failure.close();report.checks.push("Menu asset failure is also surfaced through the startup promise");
  }
  report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;process.exitCode=1;}
finally{
  await browser?.close();for(const server of servers){server.closeAllConnections();await new Promise(r=>server.close(r));}
  await writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
