// Browser/pixel regressions for menu placement, seamless layers, death and music.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";
const output=path.join(os.tmpdir(),"opencode",`vascolet-presentation-${Date.now()}`);
await mkdir(output,{recursive:true});const {server,url}=await startServer();
const report={output,checks:[],errors:[]};let browser,page;
const shot=async name=>{
  const png=await page.evaluate(async menu=>{
    const canvas=document.querySelector("#game"),ctx=canvas.getContext("2d");
    if(menu)(await import("/js/menu.js")).menuDraw(ctx);
    else (await import("/js/game.js")).gameDraw(ctx,1);
    return canvas.toDataURL().split(",")[1];
  },name.startsWith("main-menu"));
  await writeFile(path.join(output,`${name}.png`),Buffer.from(png,"base64"));
};
try {
  browser=await chromium.launch({headless:true,args:["--mute-audio"],executablePath:process.env.BROWSER_EXECUTABLE||
    path.join(process.env.LOCALAPPDATA,"ms-playwright/chromium-1243/chrome-win64/chrome.exe")});
  page=await browser.newPage({viewport:{width:1100,height:850}});
  page.on("pageerror",e=>report.errors.push(e.message));
  page.on("response",r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(url);await page.locator("#boot").waitFor({state:"detached"});
  report.menu=await page.evaluate(async()=>{
    const {Save}=await import("/js/save.js");Save.unlock(1);
    const {menuDraw,TRASH}=await import("/js/menu.js");const canvas=document.querySelector("#game"),ctx=canvas.getContext("2d");
    const draw=ctx.drawImage,rects=[];ctx.drawImage=function(image,...args){
      if(image.src?.endsWith("winnie14-ob.png"))rects.push(args);return draw.call(this,image,...args);};
    try{menuDraw(ctx);}finally{ctx.drawImage=draw;}
    window.__game=(await import("/js/game.js")).Game;window.__audio=(await import("/js/audio.js")).Audio2;
    return {trash:TRASH,left:Math.min(...rects.map(r=>r[4])),right:Math.max(...rects.map(r=>r[4]+r[6])),top:rects[0][5]};
  });
  await shot("main-menu-native-footer");
  assert.deepEqual(report.menu.trash,{x:434,y:332,w:32,h:32});
  assert.equal((report.menu.left+report.menu.right)/2,449);assert.equal(report.menu.top,364);
  report.checks.push("Versión bitmap centrada y papelera en la ubicación contrastada con Windows");
  for(let i=0;i<3;i++){await page.keyboard.press("Enter",{delay:50});await page.waitForTimeout(250);}
  await page.waitForFunction(()=>Boolean(window.__game.player?.anim&&window.__game.time>0));
  await page.keyboard.press("Escape",{delay:50});await page.waitForTimeout(150);
  await page.evaluate(async()=>{await(await import("/js/game.js")).loadLevel(2);});
  await page.waitForFunction(()=>window.__audio.musicEl?.currentTime>.2);
  report.music=await page.evaluate(async()=>{
    const {Audio2}=await import("/js/audio.js"),{Game:g}=await import("/js/game.js");
    window.__track=Audio2.musicEl;const before=window.__track.currentTime;
    await Audio2.music("assets/audio/music/win/autoscroll.ogg");
    return {before,after:Audio2.musicEl.currentTime,same:Audio2.musicEl===window.__track,path:Audio2._musicPath,loop:Audio2.musicEl.loop,
      species:Object.fromEntries([...new Set(g.enemies.map(e=>e.kind))].map(kind=>[kind,g.enemies.filter(e=>e.kind===kind).length]))};
  });
  assert.equal(report.music.same,true);assert.ok(report.music.after>=report.music.before);assert.equal(report.music.loop,true);
  assert.deepEqual(report.music.species,{Fly:23,Beetle:3,Frog:8,Flower:5});
  report.checks.push("Nivel 2: autoscroll.ogg y las cuatro especies originales; misma pista conserva su reproducción");
  report.death=await page.evaluate(async()=>{
    const {Game:g,gameUpdate,gameDraw}=await import("/js/game.js");const {Input}=await import("/js/input.js");
    const p=g.player;Object.assign(p,{x:g.start.x+100,y:g.start.y,vx:0,vy:0});Input.reset();g.energy=0;
    gameUpdate(1/60);Input.endStep();const start={x:p.x,checkpoint:g.checkpoint.x,lives:g.lives,phase:g.death.phase};
    Input.held.add("right");for(let i=0;i<30;i++){gameUpdate(1/60);Input.endStep();}
    gameDraw(document.querySelector("#game").getContext("2d"),1);Input.reset();return {...start,afterHalfSecond:p.x,phaseAfter:g.death.phase};
  });
  await shot("death-before-checkpoint");
  assert.notEqual(report.death.x,report.death.checkpoint);assert.equal(report.death.afterHalfSecond,report.death.x);
  assert.equal(report.death.lives,4);assert.equal(report.death.phaseAfter,"out");
  report.respawn=await page.evaluate(async()=>{
    const {Game:g,gameUpdate,gameDraw}=await import("/js/game.js"),{Input}=await import("/js/input.js");
    for(let i=0;i<150&&g.death?.phase==="out";i++){gameUpdate(1/60);Input.endStep();}
    const phase=g.death?.phase;for(let i=0;i<10;i++){gameUpdate(1/60);Input.endStep();}
    gameDraw(document.querySelector("#game").getContext("2d"),1);
    return {phase,x:g.player.x,checkpoint:g.checkpoint.x,lives:g.lives,sameTrack:window.__audio.musicEl===window.__track,time:window.__track.currentTime};
  });
  await shot("checkpoint-fade-in");assert.equal(report.respawn.phase,"in");assert.equal(report.respawn.x,report.respawn.checkpoint);
  assert.equal(report.respawn.sameTrack,true);assert.ok(report.respawn.time>=report.music.after);
  report.checks.push("Muerte visible de dos segundos, controles congelados, fade/reaparición y música sin reinicio");
  report.seams=await page.evaluate(async()=>{
    const {Game:g,gameDraw}=await import("/js/game.js");
    const image=document.createElement("canvas");image.width=image.height=32;
    const paint=image.getContext("2d");paint.fillStyle="#fff";paint.fillRect(0,0,32,32);
    const tilesets=[{firstgid:1,image,tsx:{tileW:32,tileH:32,imgW:32,imgH:32,margin:0,spacing:0}}];
    const canvas=document.createElement("canvas");canvas.width=512;canvas.height=384;
    const ctx=canvas.getContext("2d",{willReadFrequently:true});
    Object.assign(g,{player:null,enemies:[],items:[],infos:[],saves:[],booms:[],shots:[],parts:[],effects:[],dlg:null,helper:null,death:null,tipT:0,shakeT:0});
    const results=[];
    for(const repeat of [true,false]) {
      const layer={name:"Tiles",x:0,y:0,offsetX:0,offsetY:0,w:64,h:12,data:Array(64*12).fill(1),visible:true,opacity:.5,hScale:1,vScale:0};
      g.map={layers:repeat?[]:[layer]};g.bgs=repeat?[{tilesets,layers:[layer]}]:[];g.tsx=tilesets;
      let variation=0;
      for(const offset of [.125,.5,31.875,512.125]) {
        g.camX=g.prevCamX=offset;g.camY=g.prevCamY=repeat?0:31.5;gameDraw(ctx,1);
        const pixels=ctx.getImageData(0,50,512,270).data;
        for(let i=0;i<pixels.length;i+=4)for(let c=0;c<3;c++)variation=Math.max(variation,Math.abs(pixels[i+c]-pixels[c]));
      }
      results.push({layer:repeat?"parallax":"world",variation});
    }
    return results;
  });
  assert.ok(report.seams.every(r=>r.variation<=1),JSON.stringify(report.seams));
  report.checks.push("Sin líneas oscuras entre tiles semitransparentes al desplazar cámara fraccionalmente en X/Y");
  assert.deepEqual(report.errors,[]);report.ok=true;
} catch(error){report.ok=false;report.failure=error.stack;process.exitCode=1;}
finally {
  await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  await writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
