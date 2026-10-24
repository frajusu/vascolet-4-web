import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { parseTMX } from "../js/tmx.js";
import { waterZones, waterAt, updateSwimming } from "../js/water.js";
import { createPlatforms, updatePlatforms, carryPlatform, landOnPlatform } from "../js/platforms.js";
const dom=new JSDOM();
const map=async n=>parseTMX(new dom.window.DOMParser().parseFromString(await readFile(new URL(`../assets/data/maps/level${n}.tmx`,import.meta.url),"utf8"),"text/xml"));
const controls=(held=[],pressed=[])=>({held:new Set(held),pressed:new Set(pressed)});
const physics=(p,dt,g)=>{p.x+=(p.stepX??p.vx*dt);delete p.stepX;p.y+=p.vy*dt+.5*g*dt*dt;p.vy=Math.max(-p.maxFall,Math.min(p.maxFall,p.vy+g*dt));p.ground=false;};
test.after(()=>dom.window.close());

test("water rectangles come from the four real aquatic maps, not inferred tile colors",async()=>{
  for(const n of [7,10,11,12]){const zones=waterZones(await map(n));assert.equal(zones.length,1);const z=zones[0];assert.equal(waterAt(zones,z.x+1,z.y+1),z);assert.equal(waterAt(zones,z.x-1,z.y),null);}
  assert.equal(waterZones(await map(1)).length,0);
});
test("snorkel enables repeatable strokes and diving; unpowered swimming returns to the surface",()=>{
  const zones=[{x:0,y:100,w:1000,h:600}],p={x:200,y:300,h:60,w:8,vx:0,vy:0,face:1,mode:"normal"},api={moveBody:physics};
  updateSwimming(p,{swim:false},zones,controls(),1/60,api);assert.ok(p.vy<0);assert.equal(p.swimming,true);
  const q={...p,y:300,vx:0,vy:50,swimming:true,swimFastT:0};
  updateSwimming(q,{swim:true},zones,controls(["z"],["z"]),1/60,api);const first=q.vy;
  for(let i=0;i<5;i++)updateSwimming(q,{swim:true},zones,controls(),1/60,api);
  updateSwimming(q,{swim:true},zones,controls(["z"],["z"]),1/60,api);assert.ok(q.vy<first,"second quick stroke uses fastSwim");
  for(let i=0;i<50;i++)updateSwimming(q,{swim:true},zones,controls(["down"]),1/60,api);
  assert.ok(q.vy>0,"snorkel diver can descend instead of being clamped at the surface");
});
test("surface stroke launches onto the bank, and leaving water restores normal fall limits",()=>{
  const zones=[{x:0,y:100,w:1000,h:600}],p={x:200,y:145,h:60,w:8,vx:0,vy:0,face:1,swimming:true};
  updateSwimming(p,{swim:true},zones,controls(["z"],["z"]),1/60,{moveBody:physics});
  assert.equal(p.swimming,false);assert.ok(p.vy<-350);assert.ok(p.waterExitT>0);
  p.x=1200;assert.equal(updateSwimming(p,{swim:true},zones,controls(),1/60,{moveBody:physics}),false);assert.equal(p.maxFall,500);
});
test("level18 produces four counter-rotating ellipse platforms and two vertical paths with zero horizontal amplitude",async()=>{
  const platforms=createPlatforms(await map(18));assert.equal(platforms.length,6);
  assert.equal(platforms.filter(p=>p.ellipse).length,4);assert.ok(platforms.slice(4).every(p=>p.rx===0));
  const before=platforms.map(p=>({x:p.x,y:p.y}));updatePlatforms(platforms,.5);
  assert.ok(platforms.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
  assert.ok(platforms.slice(4).every((p,i)=>p.x===before[i+4].x&&p.y!==before[i+4].y));
  assert.ok(Math.abs(platforms[0].x+platforms[1].x-2*platforms[0].homeX)<1e-8);
});
test("moving-platform support carries a standing rider, catches only downward crossings, and permits drop-through",async()=>{
  const platforms=createPlatforms(await map(18)),p=platforms[4];
  const rider={x:p.x,y:p.y-p.h-2,w:8,h:60,skin:2,vy:0,ground:true,platformId:p.id};
  updatePlatforms(platforms,1/60);carryPlatform(rider,platforms);
  assert.ok(Math.abs(rider.y-(p.y-p.h-2))<1e-8);assert.equal(rider.x,p.x);
  rider.platformId=null;rider.vy=60;rider.y=p.y-p.h+10;
  landOnPlatform(rider,p.prevY-p.h-10,platforms);assert.equal(rider.platformId,p.id);assert.equal(rider.ground,true);
  rider.dropT=.2;landOnPlatform(rider,p.y-p.h-10,platforms);assert.equal(rider.platformId,null);
  rider.dropT=0;rider.vy=-100;landOnPlatform(rider,p.y-p.h-10,platforms);assert.equal(rider.platformId,null);
});
