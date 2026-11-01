// Direct arena fixtures, not full-level playthroughs. The player is protected
// and repositioned; boss HP is NEVER assigned and damage uses real boomerangs.
import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {chromium} from "playwright-core";
import {startServer} from "./serve.mjs";
import {startNewGame,pauseGame} from "./browser-session.mjs";
const output=path.join(os.tmpdir(),"opencode",`vascolet-bosses-${Date.now()}`);
await mkdir(output,{recursive:true});const {server,url}=await startServer();
const report={output,scope:"14 direct boss encounters on 12 original maps; protected/repositioned player; real boomerangs, no boss HP overrides",bosses:[],errors:[]};
let browser,page;
try{
  browser=await chromium.launch({headless:true,args:["--mute-audio"],executablePath:process.env.BROWSER_EXECUTABLE||path.join(process.env.LOCALAPPDATA,"ms-playwright/chromium-1243/chrome-win64/chrome.exe")});
  page=await browser.newPage({viewport:{width:1100,height:850}});
  page.on("pageerror",e=>report.errors.push(e.message));page.on("response",r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(url);await page.locator("#boot").waitFor({state:"detached"});await startNewGame(page);await pauseGame(page);
  const levels=process.argv.slice(2).map(Number);if(!levels.length)levels.push(1,3,4,6,7,9,10,12,13,15,16,18);
  for(const level of levels){
    const result=await page.evaluate(async level=>{
      const {Game:g,loadLevel,gameUpdate,gameDraw,tileAt}=await import("/js/game.js");
      const {Input}=await import("/js/input.js"),{updateCamera}=await import("/js/camera.js");
      const {Save}=await import("/js/save.js");
      Save.clear();
      for(let i=1;i<=(level<4?2:level<7?3:level<10?4:5);i++)Save.collectItem(`&B-Item${i}`);
      if(level>=7)Save.collectItem("&P-Swim");
      await loadLevel(level,false);Input.reset();g.inputFrames=[];g.dlg=null;
      const bosses=g.enemies.filter(e=>e.boss),entry={level,bosses:[],screens:[]};
      const tick=()=>{gameUpdate(1/60);Input.endStep();};
      const place=(x,y)=>{
        Object.assign(g.player,{x,y,prevX:x,prevY:y,vx:0,vy:0,inv:1e6,damage:null,hurt:false});
        updateCamera(g,0,true);
      };
      const snap=name=>{gameDraw(document.querySelector("#game").getContext("2d"),1);entry.screens.push({name,png:document.querySelector("#game").toDataURL().split(",")[1]});};
      const first=bosses[0],anchor={x:first.homeX-120,y:first.homeY};
      place(anchor.x,anchor.y);
      const seen=new Map(bosses.map(b=>[b,new Set()])),ranges=new Map(bosses.map(b=>[b,{minX:b.x,maxX:b.x,minY:b.y,maxY:b.y} ]));
      // Observe without attacking long enough to include the complete Pirana
      // protected/vulnerable cycle and the multi-bird shared turn.
      let maxBirdsAttacking=0;
      for(let i=0;i<1800;i++){
        place(anchor.x,anchor.y);tick();
        maxBirdsAttacking=Math.max(maxBirdsAttacking,bosses.filter(b=>b.kind==="BigBird"&&b.state==="attack").length);
        for(const b of bosses){seen.get(b).add(b.state);const r=ranges.get(b);r.minX=Math.min(r.minX,b.x);r.maxX=Math.max(r.maxX,b.x);r.minY=Math.min(r.minY,b.y);r.maxY=Math.max(r.maxY,b.y);}
        if([60,480,900].includes(i))snap(`observe-${i}`);
      }
      if(maxBirdsAttacking>1)throw Error("Birds attacked simultaneously");
      for(const b of bosses){
        if(!b.fight)throw Error(`${b.kind}: never activated`);
        const hpBefore=b.hp;let emitted=0;
        // Keep the throw lane near the moving boss. This is a combat fixture,
        // not a claim that this movement can be performed in ordinary play.
        for(let i=0;i<18000&&!b.defeated;i++){
          let side=-1,y=b.y-b.h/2;
          const clear=(side,y)=>{for(let d=b.w/2+8;d<b.w/2+65;d+=8)if(tileAt(Math.floor((b.x+side*d)/32),Math.floor(y/32))&1)return false;return true;};
          lanes:for(const candidate of [y,b.y-8,b.y+8,b.y-b.h+8])for(const direction of [-1,1])if(clear(direction,candidate)){side=direction;y=candidate;break lanes;}
          if(b.kind==="GiantDragonfly"){
            // Let this boss retreat 600px and make its committed pass. Chasing
            // its tail continuously prevents its native attack from starting.
            place(anchor.x,b.state==="attack"?y+30:anchor.y);g.player.face=Math.sign(b.x-g.player.x)||1;
          }else if(["BigGhost","BigBird"].includes(b.kind)){
            // A fixed target lets the retreat/approach cycle finish; a target
            // teleported alongside a fleeing boss creates an endless chase.
            place(anchor.x,anchor.y);g.player.face=Math.sign(b.x-g.player.x)||1;
          }else if(b.kind==="BigPirana"&&b.state==="normal"){
            place(anchor.x,anchor.y);g.player.face=Math.sign(b.x-g.player.x)||1;
          }else {place(b.x+side*(b.w/2+62),y+30);g.player.face=-side;}
          if(i%20===0){Input.pressed.add("x");emitted++;}
          tick();seen.get(b).add(b.state);
          if(!Number.isFinite(b.x)||!Number.isFinite(b.y))throw Error(`${b.kind}: invalid position`);
          if(g.gameover||g.death)throw Error(`${b.kind}: protected fixture player died`);
        }
        snap(`${b.kind}-defeated`);
        const summary={kind:b.kind,maxHP:b.maxhp,hpAtCombatStart:hpBefore,remainingHP:b.hp,defeated:b.defeated,states:[...seen.get(b)],range:ranges.get(b),throwInputs:emitted};
        entry.bosses.push(summary);
        if(!b.defeated)throw Error(`${b.kind}: boomerang fight did not finish ${JSON.stringify({...summary,position:[b.x,b.y],player:[g.player.x,g.player.y],helpers:g.enemies.filter(e=>e.owner===b&&e.hp>0).length})}`);
      }
      if(!g.won)throw Error(`level ${level}: boss victory not registered`);
      entry.maxBirdsAttacking=maxBirdsAttacking;return entry;
    },level);
    for(const {name,png}of result.screens)await writeFile(path.join(output,`${level}-${name}.png`),Buffer.from(png,"base64"));delete result.screens;
    report.bosses.push(result);console.log(JSON.stringify(result));
  }
  assert.deepEqual(report.errors,[]);report.ok=true;
}catch(error){report.ok=false;report.failure=error.stack;process.exitCode=1;}
finally{
  if(page&&!page.isClosed()&&!report.ok)await page.locator("#game").screenshot({path:path.join(output,"failure.png")}).catch(()=>{});
  await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));
  await writeFile(path.join(output,"report.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
