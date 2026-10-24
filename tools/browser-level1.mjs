// Real renderer/runtime, with explicitly controlled item/checkpoint/arena placement.
// This is a regression fixture, not proof of an unaided full-level playthrough.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";
import { startNewGame,pauseGame } from "./browser-session.mjs";

const output=path.join(os.tmpdir(),"opencode",`vascolet-level1-${Date.now()}`);
await mkdir(output,{recursive:true});
const {server,url}=await startServer();
const report={output,scope:"Controlled placement on the unmodified level-1 map",checks:[],screenshots:[],errors:[]};
let browser,page;
const shot=async name=>{
  const file=path.join(output,`${name}.png`);
  // Export synchronously with the game draw: the live paused menu must not repaint
  // over the fixture while Playwright waits for screenshot animation stability.
  const png=await page.evaluate(async()=>{
    const canvas=document.querySelector("canvas"),ctx=canvas.getContext("2d");
    (await import("/js/game.js")).gameDraw(ctx,1);
    const capture=document.createElement("canvas");capture.width=800;capture.height=600;
    capture.getContext("2d").drawImage(canvas,0,0,800,600);
    return capture.toDataURL("image/png").split(",")[1];
  });
  await writeFile(file,Buffer.from(png,"base64"));report.screenshots.push(file);
};
const key=async value=>{await page.keyboard.press(value,{delay:40});await page.waitForTimeout(100);};
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||path.join(process.env.LOCALAPPDATA,"ms-playwright/chromium-1243/chrome-win64/chrome.exe")});
  page=await browser.newPage({viewport:{width:1100,height:850}});
  page.on("pageerror",e=>report.errors.push(e.message));
  page.on("console",m=>{if(["error","warning"].includes(m.type()))report.errors.push(m.text());});
  page.on("response",r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(url);await page.locator("#boot").waitFor({state:"detached"});
  await startNewGame(page);await pauseGame(page);
  report.initial=await page.evaluate(async()=>{
    const {Game:g,gameDraw}=await import("/js/game.js");
    gameDraw(document.querySelector("canvas").getContext("2d"));
    return {abilities:g.abilities,hearts:g.maxHearts,items:g.items.length,animated:g.items.every(i=>Boolean(i.anim))};
  });
  assert.equal(report.initial.abilities.run,false);assert.equal(report.initial.hearts,5);assert.equal(report.initial.animated,true);
  await shot("new-game");
  report.progress=await page.evaluate(async()=>{
    const {Game:g,gameUpdate,gameDraw,loadLevel}=await import("/js/game.js");
    const {Input}=await import("/js/input.js");const {Save}=await import("/js/save.js");Input.reset();
    for(const item of g.items){
      Object.assign(g.player,{x:item.x,y:item.y+16,vx:0,vy:0,damage:null});
      gameUpdate(1/60);Input.endStep();
    }
    const collected=g.items.filter(i=>i.taken).map(i=>i.kind);
    const checkpoint=g.saves.at(-1);
    Object.assign(g.player,{x:checkpoint.x,y:checkpoint.y,vx:0,vy:0,damage:null});gameUpdate(1/60);Input.endStep();
    g.energy=0;gameUpdate(1/60);Input.endStep();
    for(let i=0;i<160&&g.death;i++){gameUpdate(1/60);Input.endStep();}
    await loadLevel(1);gameDraw(document.querySelector("canvas").getContext("2d"));
    return {collected,abilities:g.abilities,hearts:g.maxHearts,lives:g.lives,position:{x:g.player.x,y:g.player.y},checkpoint:{x:checkpoint.x,y:checkpoint.y},run:Save.run()};
  });
  assert.equal(report.progress.collected.length,13);assert.equal(report.progress.hearts,7);assert.equal(report.progress.lives,4);
  assert.deepEqual(report.progress.position,report.progress.checkpoint);assert.equal(report.progress.abilities.run,false);
  await shot("checkpoint-resumed");report.checks.push("All 13 map items; real art; checkpoint/death/reload with seven hearts and no Run");
  await page.evaluate(async()=>{
    const {Game:g,gameUpdate,gameDraw}=await import("/js/game.js");const {Input}=await import("/js/input.js");Input.reset();
    Object.assign(g.player,{x:13520,y:1392,vx:0,vy:0,damage:null,inv:0});
    for(let i=0;i<70;i++){gameUpdate(1/60);Input.endStep();}
    gameDraw(document.querySelector("canvas").getContext("2d"));
    window.__bossTrace=[];window.__bossTick=0;
  });
  await shot("arena-start");
  for(let batch=0;batch<60;batch++) {
    const result=await page.evaluate(async()=>{
      const {Game:g,gameUpdate,gameDraw}=await import("/js/game.js");const {Input}=await import("/js/input.js");
      for(let i=0;i<120;i++){
        const p=g.player,b=g.enemies.find(e=>e.kind==="BigScorpion");
        if(g.won||g.lives<4)break;
        Input.reset();const dx=b.x-p.x,face=Math.sign(dx)||1;
        const distance=Math.abs(dx),toward=distance>165?face:distance<100?-face:0;
        if(toward)Input.held.add(toward>0?"right":"left");
        else if(p.face!==face)Input.held.add(face>0?"right":"left");
        if(p.hitWall&&p.ground){Input.pressed.add("z");window.__jumpUntil=window.__bossTick+30;}
        if(window.__bossTick<(window.__jumpUntil||0))Input.held.add("z");
        if(window.__bossTick%30===0&&distance<195&&p.face===face)Input.pressed.add("x");
        gameUpdate(1/60);Input.endStep();window.__bossTick++;
        if(window.__bossTick%6===0)window.__bossTrace.push({t:g.time,x:p.x,y:p.y,energy:g.energy,lives:g.lives,bossX:b.x,bossY:b.y,hp:b.hp,state:b.state,minions:g.enemies.filter(e=>e.minion&&e.hp>0).length});
      }
      gameDraw(document.querySelector("canvas").getContext("2d"));
      const b=g.enemies.find(e=>e.kind==="BigScorpion");
      return {won:g.won,lives:g.lives,hp:b.hp,state:b.state,x:g.player.x,y:g.player.y,bossX:b.x,bossY:b.y};
    });
    if(batch===2||batch===6)await shot(`fight-${batch}`);
    if(result.won||result.lives<4){report.fight=result;break;}
    if(batch===59)report.fight=result;
  }
  report.trace=await page.evaluate(()=>window.__bossTrace);
  assert.ok(report.trace.some(s=>s.state==="jump"),"boss must exercise its jump phase");
  assert.ok(report.trace.some(s=>s.minions>=2),"landing must create real minions on the map");
  assert.ok(report.trace.some(s=>s.state==="dying"),"zero HP must enter the death sequence before victory");
  await shot("fight-result");assert.equal(report.fight.won,true,JSON.stringify(report.fight));assert.equal(report.fight.lives,4);
  report.checks.push("Arena fight: real inputs, collisions, boomerangs and damage; no HP/invulnerability overrides");
  await page.evaluate(async()=>{
    const {gameUpdate}=await import("/js/game.js");const {Input}=await import("/js/input.js");Input.reset();
    for(let i=0;i<365;i++){gameUpdate(1/60);Input.endStep();}
  });
  await key("Escape");await page.waitForTimeout(150);await key("Enter");
  await page.waitForFunction(()=>window.__game.level===2&&Boolean(window.__game.player?.anim));
  report.next=await page.evaluate(async()=>{const {Game:g}=await import("/js/game.js");const {Save}=await import("/js/save.js");return {level:g.level,lives:g.lives,unlocked:Save.unlocked(),completed:Save.read().completed,abilities:g.abilities};});
  assert.equal(report.next.lives,4);assert.equal(report.next.unlocked,2);assert.ok(report.next.completed.includes(1));
  await shot("level2-unlocked");report.checks.push("Defeated sequence, six-second win effect, native goto:level2 action and persistent unlock");
  assert.deepEqual(report.errors,[]);report.ok=true;
} catch(e){report.ok=false;report.failure=e.stack;process.exitCode=1;if(page)await shot("failure").catch(()=>{});}
finally {
  await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  await writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,trace:report.trace?`${report.trace.length} samples in report.json`:null},null,2));
}
