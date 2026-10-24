// Exhaustive runtime fixtures on all 18 ORIGINAL maps. Controlled placement,
// isolated pickup/mechanic checks and protected boss-state combat are explicit;
// this is not an unaided end-to-end playthrough or a Windows-equivalence proof.
import assert from "node:assert/strict";
import { mkdir,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "./serve.mjs";
import { startNewGame,pauseGame } from "./browser-session.mjs";
const output=path.join(os.tmpdir(),"opencode",`vascolet-campaign-${Date.now()}`);
await mkdir(output,{recursive:true});const {server,url}=await startServer();
const report={output,scope:"18 original-map runtime fixtures; controlled placements, temporary player protection for AI/boss checks; no enemy HP overrides",levels:[],errors:[]};
let browser,page;
try{
  browser=await chromium.launch({headless:true,args:["--mute-audio"],executablePath:process.env.BROWSER_EXECUTABLE||
    path.join(process.env.LOCALAPPDATA,"ms-playwright/chromium-1243/chrome-win64/chrome.exe")});
  page=await browser.newPage({viewport:{width:1100,height:850}});
  page.on("pageerror",e=>report.errors.push(e.message));
  page.on("response",r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(url);await page.locator("#boot").waitFor({state:"detached"});await startNewGame(page);await pauseGame(page);
  await page.evaluate(async()=>{(await import("/js/save.js")).Save.clear();});
  for(let level=1;level<=18;level++){
    const result=await page.evaluate(async level=>{
      const {Game:g,loadLevel,gameUpdate,gameDraw,tileAt}=await import("/js/game.js");
      const {Input}=await import("/js/input.js"),{Save}=await import("/js/save.js"),{Audio2}=await import("/js/audio.js");
      const {updateCamera}=await import("/js/camera.js"),{hitEnemy}=await import("/js/enemies.js");
      const result={level,checks:[],mechanics:{},bosses:[]};
      await loadLevel(level,false);Input.reset();
      const beforeLives=g.lives;result.startLives=beforeLives;result.mode=g.player.mode;
      result.normalMusic=Audio2._musicPath;
      const expectedMusic=`assets/audio/music/win/${g.map.props["music,normal"]}`;
      if(result.normalMusic!==expectedMusic)throw Error(`level ${level}: wrong normal track ${result.normalMusic}`);
      if(g.enemies.some(e=>["unverified","boss-pending"].includes(e.behavior)))throw Error(`level ${level}: placeholder controller`);
      if(g.enemies.some(e=>!g.charCache.get(e.kind)?.img||!e.anim?.frame))throw Error(`level ${level}: missing enemy art`);
      result.species=[...new Set(g.enemies.map(e=>e.kind))];
      result.checks.push("map, player mode, original species/art and music");
      const tick=(n=1)=>{for(let i=0;i<n;i++){gameUpdate(1/60);Input.endStep();}};
      const place=(x,y)=>{
        Object.assign(g.player,{x,y,vx:0,vy:0,damage:null,attack:null,inv:1e6,ground:false,platformId:null});
        g.inputFrames=[];Input.reset();
        if(g.autoCamera){g.autoCamera.x=x;g.autoCamera.y=y;}
        else updateCamera(g,0,true);
      };
      const enemies=g.enemies;g.enemies=[];let extra=0;
      result.pickups=[];
      for(const item of g.items){
        if(!item.definition||!item.anim?.frame)throw Error(`level ${level}: unimplemented item ${item.kind}`);
        if(item.taken)continue;place(item.x,item.y+16);tick();
        if(!item.taken)throw Error(`level ${level}: item not collectible ${item.kind}`);
        result.pickups.push(item.kind);if(item.kind==="ExtraLive")extra++;
      }
      result.abilities={...g.abilities};result.items=Save.read()?.items||[];
      result.checks.push("every item has art and is collectible; persistent inventory/powers");
      const abilitiesExpected={sustainJump:true,jumpAttack:true,doubleJump:level>=4,swim:level>=7,run:level>=13};
      for(const [power,value]of Object.entries(abilitiesExpected))if(g.abilities[power]!==value)throw Error(`level ${level}: wrong ${power}`);
      const expectedHearts=level<4?7:level<13?8:level<16?9:10;
      const expectedFruits=level<4?2:level<7?3:level<10?4:5;
      if(g.maxHearts!==expectedHearts||g.abilities.fruits!==expectedFruits)throw Error(`level ${level}: wrong progression`);
      if(g.water.length){
        const water=g.water[0];let spot=null;
        for(let y=water.y+80;y<water.y+water.h-16&&!spot;y+=32)for(let x=water.x+48;x<water.x+water.w-16;x+=32){
          if([0,1,2].every(i=>!(tileAt(Math.floor(x/32),Math.floor((y-i*28)/32))&1))){spot={x,y};break;}
        }
        if(!spot)throw Error(`level ${level}: no open swim region`);
        place(spot.x,spot.y);Input.pressed.add("z");Input.held.add("z");tick(3);
        if(!g.player.swimming||g.player.vy>=0)throw Error(`level ${level}: swimming stroke failed`);
        result.mechanics.water={pose:g.player.animName,vy:g.player.vy};result.checks.push("underwater movement/stroke/pose");
      }
      if(level===4||level===13){
        place(g.start.x,g.start.y);tick(10);Input.pressed.add("z");Input.held.add("z");tick(10);
        Input.reset();tick(3);Input.pressed.add("z");Input.held.add("z");tick(3);
        if(!g.player.doubleUsed||g.player.vy>=0)throw Error(`level ${level}: double jump failed`);
        result.mechanics.doubleJump=true;
        if(level===13){
          place(g.start.x,g.start.y);tick(10);Input.pressed.add("right");Input.held.add("right");tick(4);
          Input.reset();tick(3);Input.pressed.add("right");Input.held.add("right");tick(8);
          if(!g.player.run)throw Error("Run power failed");result.mechanics.run={enabled:true,speed:g.player.vx};
        }
      }
      if(g.platforms.length){
        const p=g.platforms[4];place(p.x,p.y-p.h-2);g.player.platformId=p.id;g.player.ground=true;
        tick(30);if(g.player.platformId!==p.id||Math.abs(g.player.y+2-(p.y-p.h))>.01)throw Error("Moving-platform carry failed");
        result.mechanics.platforms={count:g.platforms.length,carried:true};
        Input.held.add("down");Input.pressed.add("z");tick(3);if(g.player.platformId!==null)throw Error("Platform drop failed");
        result.mechanics.platforms.drop=true;
      }
      Input.reset();g.enemies=enemies;
      for(const boss of enemies.filter(e=>e.boss)){
        place(boss.homeX-100,boss.homeY);updateCamera(g,0,true);
        let accepted=0,steps=0;const states=new Set();
        for(;steps<Math.max(3000,boss.maxhp*40)&&!boss.defeated;steps++){
          const p=g.player;
          // Protected, controlled state-machine combat: damage still goes through
          // hitEnemy and its phase/cooldown rules, never by overwriting boss HP.
          if(steps%60===0||p.y>boss.y+160||p.y<boss.y-220)place(boss.x-100,boss.y);
          tick();states.add(boss.state);
          if(steps%120===0)for(const shot of g.shots)for(const sprite of shot.anim?.frame?.sprites||[])
            if(sprite.img&&!g.charCache.get(shot.kind)?.atlas[sprite.img])throw Error(`level ${level}: projectile art mismatch ${shot.kind}/${sprite.img}`);
          if(!Number.isFinite(boss.x)||!Number.isFinite(boss.y))throw Error(`nonfinite ${boss.kind}`);
          if(hitEnemy(boss,1,1))accepted++;
          if(g.death||g.gameover)throw Error(`level ${level}: fixture player died near ${boss.kind}`);
        }
        if(!boss.defeated)throw Error(`level ${level}: ${boss.kind} never finished (${boss.state}, hp${boss.hp}, fight${boss.fight})`);
        result.bosses.push({kind:boss.kind,hp:boss.maxhp,accepted,steps,states:[...states],defeated:true});
      }
      if(g.win.kind==="exit"){
        const exit=g.exits[0];if(!exit)throw Error(`level ${level}: missing exit`);
        place(exit.x+exit.w/2,exit.y+exit.h);tick();result.checks.push("real rectangular Exit");
      }
      if(!g.won)throw Error(`level ${level}: victory condition not reached`);
      tick(365);if(!g.events.some(e=>e.type==="win")||!g.winSent)throw Error(`level ${level}: missing delayed win event`);
      result.winAction=g.winAction;result.endLives=g.lives;result.extraLives=extra;
      if(g.lives!==beforeLives+extra)throw Error(`level ${level}: life/progression mismatch`);
      if(!Save.read().completed.includes(level))throw Error(`level ${level}: completion not saved`);
      result.unlocked=Save.unlocked();result.checks.push("death-capable boss/exit, win delay, saved unlock and preserved lives");
      gameDraw(document.querySelector("#game").getContext("2d"),1);
      result.png=document.querySelector("#game").toDataURL().split(",")[1];return result;
    },level);
    await writeFile(path.join(output,`level-${String(level).padStart(2,"0")}.png`),Buffer.from(result.png,"base64"));delete result.png;
    report.levels.push(result);console.log(`Level ${level}: ${result.checks.length} groups passed; bosses ${result.bosses.map(b=>b.kind).join(",")||"exit"}`);
  }
  report.progress=await page.evaluate(async()=>{const {Save}=await import("/js/save.js");return Save.read();});
  assert.equal(report.progress.items.length,20);assert.equal(report.progress.completed.length,18);assert.equal(report.progress.unlocked,18);
  // Let the live runtime consume the real final win event and show video19.
  await page.keyboard.press("Escape",{delay:50});
  await page.waitForFunction(()=>Boolean(document.querySelector('video[src$="video19.mp4"]')));
  await page.keyboard.press("Enter",{delay:50});await page.waitForFunction(()=>window.__scene()==="victory");
  report.ending=true;assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;process.exitCode=1;}
finally{
  if(page&&!page.isClosed()&&!report.ok)await page.locator("#game").screenshot({path:path.join(output,"failure.png")}).catch(()=>{});
  await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  await writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,levels:report.levels.map(l=>({level:l.level,bosses:l.bosses.map(b=>b.kind),checks:l.checks.length,items:l.items.length}))},null,2));
}
