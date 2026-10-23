// Original maps/rendering. Initial input segments are natural; exit and hit-flash
// fixtures explicitly reposition subjects. This is not a full-stage playthrough.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";

const output=path.join(os.tmpdir(),"opencode",`vascolet-stage-modes-${Date.now()}`);
await mkdir(output,{recursive:true});
const {server,url}=await startServer();
const report={output,scope:"Natural initial segments plus controlled Exit and damage-render fixtures",stages:[],errors:[]};
let browser,page;
const capture=async(name,png)=>writeFile(path.join(output,`${name}.png`),Buffer.from(png,"base64"));
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||
    path.join(process.env.LOCALAPPDATA,"ms-playwright/chromium-1243/chrome-win64/chrome.exe")});
  page=await browser.newPage({viewport:{width:1100,height:850}});
  page.on("pageerror",e=>report.errors.push(e.message));
  page.on("response",r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(url);await page.locator("#boot").waitFor({state:"detached"});
  await page.evaluate(async()=>{window.__game=(await import("/js/game.js")).Game;});
  for(let i=0;i<3;i++){await page.keyboard.press("Enter",{delay:50});await page.waitForTimeout(250);}
  await page.waitForFunction(()=>Boolean(window.__game.player?.anim&&window.__game.time>0));
  await page.keyboard.press("Escape",{delay:50});await page.waitForTimeout(200);
  for(const level of [2,5,8,14]) {
    const result=await page.evaluate(async level=>{
      const {Game:g,loadLevel,gameUpdate,gameDraw,tileAt}=await import("/js/game.js");
      const {Input}=await import("/js/input.js");const {Save}=await import("/js/save.js");
      Save.clear();Input.reset();await loadLevel(level);
      const canvas=document.querySelector("#game"),ctx=canvas.getContext("2d");
      const png=()=>{gameDraw(ctx,1);return canvas.toDataURL().split(",")[1];};
      const before={x:g.player.x,y:g.player.y,camX:g.camX,camY:g.camY,lives:g.lives};
      const initial=png();let attacks=0,minY=g.player.y,maxY=g.player.y,lastKeys=new Set();
      for(let frame=0;frame<240;frame++) {
        const p=g.player,keys=new Set(["right"]),foot=p.y+(p.skin||0),row=Math.floor(foot/32),col=Math.floor((p.x+50)/32);
        const obstacle=(tileAt(col,row-1)&3)||!(tileAt(col,row)&3);
        if((p.mode==="ant"&&p.ground&&(p.hitWall||obstacle))||
          (p.mode==="butterfly"&&p.vy>0&&p.y>g.autoCamera.y+40))keys.add("z");
        if(frame%30===0)keys.add("x");
        Input.reset();for(const key of keys){Input.held.add(key);if(!lastKeys.has(key))Input.pressed.add(key);}
        lastKeys=keys;const count=g.booms.length;gameUpdate(1/60);Input.endStep();
        if(g.booms.length>count)attacks++;minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
      }
      const after={x:g.player.x,y:g.player.y,camX:g.camX,camY:g.camY,lives:g.lives,pose:g.player.animName};
      const segment=png();
      // Controlled exit fixture, isolated from enemies; no HP/ability overrides.
      const exit=g.exits[0];g.enemies=[];g.shots=[];g.infos=[];g.dlg=null;g.helper=null;Input.reset();g.inputFrames=[];
      g.autoCamera.x=exit.x;g.autoCamera.y=exit.y+exit.h/2;
      Object.assign(g.player,{x:exit.x+exit.w/2,y:exit.y+exit.h,vx:0,vy:0,damage:null});
      gameUpdate(1/60);Input.endStep();const won=g.won;
      for(let frame=0;frame<365;frame++){gameUpdate(1/60);Input.endStep();}
      return {level,mode:g.player.mode,before,after,attacks,minY,maxY,won,exit,winAction:g.winAction,
        winEvent:g.events.some(e=>e.type==="win"),unlocked:Save.unlocked(),initial,segment};
    },level);
    await capture(`level${level}-initial`,result.initial);await capture(`level${level}-input-segment`,result.segment);
    delete result.initial;delete result.segment;report.stages.push(result);
    assert.equal(result.mode,level<8?"ant":"butterfly");
    assert.ok(result.after.x>result.before.x+100,JSON.stringify(result));assert.equal(result.after.lives,result.before.lives);
    assert.ok(result.after.camX>result.before.camX+200);assert.ok(result.attacks>0);
    assert.equal(result.won,true);assert.equal(result.winEvent,true);assert.equal(result.unlocked,level+1);
  }
  report.flash=await page.evaluate(async()=>{
    const {Game:g,loadLevel,gameDraw}=await import("/js/game.js");const {hitEnemy}=await import("/js/enemies.js");
    const {Save}=await import("/js/save.js");Save.clear();await loadLevel(1);
    const e=g.enemies.find(e=>e.kind==="Frog");g.enemies=[e];g.infos=[];g.dlg=null;g.helper=null;
    Object.assign(e,{x:g.player.x+120,y:g.player.y});
    const render=()=>{
      const canvas=document.createElement("canvas");canvas.width=512;canvas.height=384;
      const ctx=canvas.getContext("2d",{willReadFrequently:true});gameDraw(ctx,1);
      return {png:canvas.toDataURL().split(",")[1],pixels:ctx.getImageData(0,0,512,384).data};
    };
    const before=render();hitEnemy(e);const after=render();e.hurtT=0;const recovered=render();
    let redBefore=0,redAfter=0,different=0,recoveredDifference=0;
    for(let i=0;i<before.pixels.length;i+=4){
      const red=(data)=>data[i]>100&&data[i]>data[i+1]*1.8&&data[i]>data[i+2]*1.8;
      redBefore+=Number(red(before.pixels));redAfter+=Number(red(after.pixels));
      if(before.pixels[i]!==after.pixels[i]||before.pixels[i+1]!==after.pixels[i+1])different++;
      for(let c=0;c<4;c++)if(before.pixels[i+c]!==recovered.pixels[i+c])recoveredDifference++;
    }
    return {redBefore,redAfter,different,recoveredDifference,hp:e.hp,pose:e.anim.cur.name,before:before.png,after:after.png};
  });
  await capture("enemy-before-hit",report.flash.before);await capture("enemy-red-hit",report.flash.after);
  delete report.flash.before;delete report.flash.after;
  assert.equal(report.flash.hp,3);assert.notEqual(report.flash.pose,"dead");
  assert.ok(report.flash.redAfter>report.flash.redBefore+100,JSON.stringify(report.flash));
  assert.equal(report.flash.recoveredDifference,0,"tint must preserve the atlas/alpha and restore the identical original frame");
  report.mapLoads=[];
  for(let level=1;level<=18;level++) {
    report.mapLoads.push(await page.evaluate(async level=>{
      const {Game:g,loadLevel,gameDraw,gameUpdate}=await import("/js/game.js");
      const {Input}=await import("/js/input.js");const {Save}=await import("/js/save.js");
      Save.clear();Input.reset();await loadLevel(level);for(let i=0;i<3;i++){gameUpdate(1/60);Input.endStep();}
      gameDraw(document.querySelector("#game").getContext("2d"),1);
      return {level,mode:g.player.mode,autoCamera:Boolean(g.autoCamera),
        provisionalEnemies:[...new Set(g.enemies.filter(e=>e.behavior==="unverified").map(e=>e.kind))]};
    },level));
  }
  assert.deepEqual(report.errors,[]);report.ok=true;
} catch(error){report.ok=false;report.failure=error.stack;process.exitCode=1;}
finally {
  await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  await writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,mapLoads:report.mapLoads?`${report.mapLoads.length} initial map loads; details/provisional species in report.json`:null},null,2));
}
