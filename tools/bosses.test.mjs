import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { parseAnims } from "../js/tmx.js";
import { AnimPlayer } from "../js/sprite.js";
import { createEnemy, updateEnemy, enemySpriteFlip } from "../js/enemies.js";
import { createEnemyShot, updateEnemyShot } from "../js/enemy-projectiles.js";
import {
  BOSS_KINDS, BOSS_MINIONS, updateBoss, damageBoss,
} from "../js/bosses.js";

const DOM = new JSDOM("", { url: "https://bosses.test/" });
const TMPL = new DOM.window.DOMParser();

const ANIM_FILES = {
  TopoNinja: "assets/characters/topo-ninja/animData/TopoNinja.xml",
  BigBird: "assets/characters/big-bird/animData/Big-bird.xml",
  FurryCritter: "assets/characters/furry-critter/animData/Furry-critter.xml",
  BigUglyDragon: "assets/characters/ugly-dragon/animData/Ugly-dragon.xml",
  GiantDragonfly: "assets/characters/giant-dragonfly/animData/Giant-dragonfly.xml",
  BigAnguila: "assets/characters/anguila2/animData/Anguila2.xml",
  BigPirana: "assets/characters/big-pirana/animData/Big-pirana.xml",
  BigBat: "assets/characters/big-bat/animData/Big-bat.xml",
  BigGhost: "assets/characters/ghost2/animData/Ghost2.xml",
  BigSpider: "assets/characters/big-spider/animData/Big-spider.xml",
  Malmark2: "assets/characters/malmark2/animdata/Malmark2.xml",
};

const EXPECTED_STATE_ANIMS = {
  TopoNinja: ["stand", "roll", "kick", "shot"],
  BigBird: ["normal"],
  FurryCritter: ["normal", "moving", "attack", "smash"],
  BigUglyDragon: ["normal", "attack"],
  GiantDragonfly: ["normal"],
  BigAnguila: ["normal", "attack"],
  BigPirana: ["normalSkinned", "normal"],
  BigBat: ["normal"],
  BigGhost: ["normal"],
  BigSpider: ["normal", "shooting"],
  Malmark2: ["normal", "attack1", "attack2"],
};

const anims = new Map();
for (const [kind, path] of Object.entries(ANIM_FILES)) {
  const text = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  anims.set(kind, parseAnims(TMPL.parseFromString(text, "text/xml")));
}

function boss(kind, options = {}) {
  const e = createEnemy({ name: kind, x: options.x ?? 1000, y: options.y ?? 600 });
  e.anim = new AnimPlayer(anims.get(kind));
  e.seed = options.seed ?? 0x12345678;
  Object.assign(e, options);
  return e;
}

function api(e, overrides = {}) {
  const calls = { shoot: [], spawn: [], explosion: [], bossStart: 0, bossDefeated: 0, shake: 0 };
  const value = {
    inCamera: () => true,
    shoot: (owner, options) => calls.shoot.push({ owner, options }),
    spawn: (kind, x, y, direction, owner) => calls.spawn.push({ kind, x, y, direction, owner }),
    explosion: owner => calls.explosion.push(owner),
    bossStart: () => calls.bossStart++,
    bossDefeated: () => calls.bossDefeated++,
    shake: () => calls.shake++,
    nearby: () => 0,
    markers: [],
    ...overrides,
  };
  return { api: value, calls };
}

function step(e, player, dt, context, frames) {
  const seen = new Set();
  for (let i = 0; i < frames; i++) {
    updateBoss(e, player, dt, context);
    seen.add(e.state);
    assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), `${e.kind} position must stay finite`);
    assert.ok(Number.isFinite(e.vx) && Number.isFinite(e.vy), `${e.kind} velocity must stay finite`);
  }
  return seen;
}

test("exports all recovered bosses without duplicating BigScorpion", () => {
  assert.equal(BOSS_KINDS.size, 11);
  assert.equal(BOSS_KINDS.has("BigScorpion"), false);
  assert.deepEqual(new Set(Object.keys(BOSS_MINIONS)), BOSS_KINDS);
  for (const kind of BOSS_KINDS) assert.equal(typeof kind, "string");
});

test("every controller uses animation names present in its shipped XML", () => {
  for (const kind of BOSS_KINDS) {
    const available = new Set(anims.get(kind).map(animation => animation.name));
    for (const name of EXPECTED_STATE_ANIMS[kind]) {
      assert.ok(available.has(name), `${kind}: missing ${name}`);
    }
    assert.ok(available.has("dead") || available.has("normal"), `${kind}: missing death pose`);
  }
});

test("camera wait starts each boss once, initializes its animation, and remains finite", () => {
  const player = { x: 1180, y: 600, w: 8, h: 60 };
  for (const kind of BOSS_KINDS) {
    const e = boss(kind);
    const context = api(e);
    updateBoss(e, player, 1 / 60, { ...context.api, inCamera: () => false });
    assert.equal(e.state, "waiting", kind);
    assert.equal(context.calls.bossStart, 0, kind);
    assert.equal(damageBoss(e), false, `${kind} cannot be hit before the fight`);

    const seen = step(e, player, 1 / 60, context.api, 900);
    assert.equal(e.fight, true, kind);
    assert.equal(context.calls.bossStart, 1, kind);
    assert.ok(seen.size > 1 || ["BigBird", "BigUglyDragon", "GiantDragonfly", "BigBat"].includes(kind),
      `${kind} should leave its initial state`);
    assert.ok(e.animName && e.anim.has(e.animName), `${kind}: ${e.animName}`);
    assert.ok(e.anim.cur?.frames?.length, `${kind}: current frame`);
    assert.ok(e.state !== "waiting" && e.state !== "defeated", kind);
  }
});

test("custom arena bounds contain solid-body flyers and swimmers", () => {
  const player = { x: 1300, y: 620, w: 8, h: 60 };
  const flyers = ["BigUglyDragon", "BigAnguila", "BigPirana", "BigBat"];
  for (const kind of flyers) {
    const e = boss(kind);
    const bounds = { x: 700, y: 400, w: 600, h: 300 };
    const context = api(e, { bounds: () => bounds });
    step(e, player, 1 / 60, context.api, 1800);
    assert.ok(e.x >= 700 - 1e-9 && e.x <= 1300 + 1e-9, `${kind} x=${e.x}`);
    assert.ok(e.y >= 400 - 1e-9 && e.y <= 700 + 1e-9, `${kind} y=${e.y}`);
  }
});

test("damage respects cooldown and invulnerability without replacing a living pose with corpse art", () => {
  const player = { x: 1080, y: 600 };
  const e = boss("BigBird");
  const context = api(e);
  assert.equal(damageBoss(e), false);
  updateBoss(e, player, 1 / 60, context.api);
  const hp = e.hp;
  assert.equal(damageBoss(e, 1, 2), true);
  assert.equal(e.hp, hp - 2);
  assert.equal(e.hurtT, 0.25);
  assert.equal(e.anim.cur.name, "normal");
  assert.equal(damageBoss(e), false);
  e.vulnerable = false;
  step(e, player, 0.3, context.api, 1);
  assert.equal(damageBoss(e), false);
  e.vulnerable = true;
  assert.equal(damageBoss(e), true);
  assert.equal(e.anim.cur.name, "normal");
  step(e, player, 0.3, context.api, 1);
  assert.notEqual(e.anim.cur.name, "damage");

  const furry = boss("FurryCritter");
  const furryContext = api(furry);
  updateBoss(furry, { x: 1100, y: 600 }, 1 / 60, furryContext.api);
  assert.equal(damageBoss(furry), true);
  updateBoss(furry, { x: 1100, y: 600 }, 1 / 60, furryContext.api);
  updateBoss(furry, { x: 1100, y: 600 }, 1 / 60, furryContext.api);
  assert.equal(furry.state, "normal", "native normal wait lasts three seconds near the player");
  assert.equal(furry.anim.cur.name, "normal");
});

test("generic death lasts four seconds, explodes, freezes, and notifies exactly once", () => {
  const player = { x: 1080, y: 600 };
  const e = boss("TopoNinja");
  const context = api(e);
  updateBoss(e, player, 1 / 60, context.api);
  assert.equal(damageBoss(e, -1, 999), true);
  assert.equal(e.state, "dying");
  assert.equal(e.hp, 0);
  assert.equal(e.gravity, 0);
  assert.equal(e.vx, 0);
  assert.equal(e.vy, 0);
  assert.equal(e.anim.cur.name, "dead");

  for (let i = 0; i < 181; i++) updateBoss(e, player, 1 / 60, context.api);
  assert.equal(e.state, "dying");
  assert.equal(e.defeated, false);
  assert.equal(context.calls.bossDefeated, 0);
  assert.ok(context.calls.explosion.length >= 20);
  assert.equal(e.vx, 0);
  assert.equal(e.vy, 0);

  updateBoss(e, player, 1, context.api);
  assert.equal(e.state, "defeated");
  assert.equal(e.defeated, true);
  assert.equal(context.calls.bossDefeated, 1);
  assert.equal(context.calls.shake, 1);
  updateBoss(e, player, 10, context.api);
  assert.equal(context.calls.bossDefeated, 1);
});

test("a single large death tick still completes the four-second sequence", () => {
  const e = boss("BigSpider");
  const context = api(e);
  updateBoss(e, { x: 1000, y: 600 }, 1 / 60, context.api);
  assert.equal(damageBoss(e, 1, 999), true);
  updateBoss(e, { x: 1000, y: 600 }, 4.1, context.api);
  assert.equal(e.state, "defeated");
  assert.equal(context.calls.bossDefeated, 1);
  assert.ok(context.calls.explosion.length >= 34 && context.calls.explosion.length <= 35);
});

test("TopoNinja alternates stand, kick, jump, and three-star attacks", () => {
  const e = boss("TopoNinja", { x: 1100, y: 600, seed: 0xc0ffee });
  const context = api(e);
  const seen = step(e, { x: 1250, y: 600 }, 1 / 60, context.api, 3600);
  for (const state of ["stand", "kick", "prepareJump", "jump", "attack"]) {
    assert.ok(seen.has(state), `missing Topo state ${state}`);
  }
  assert.ok(context.calls.shoot.length >= 12);
  assert.ok(context.calls.shoot.every(call => call.options.aim === true));
  assert.ok(e.y <= e.homeY, "Topo never falls below its support plane");
});

test("BigBird performs horizontal passes and always keeps a visible death pose", () => {
  const e = boss("BigBird", { x: 1000, y: 500 });
  const context = api(e);
  const seen = step(e, { x: 1150, y: 500 }, 1 / 60, context.api, 2400);
  assert.ok(seen.has("normal"));
  assert.ok(seen.has("attack"));
  assert.ok(context.calls.shoot.length === 0);
});

test("FurryCritter stops, seeks, shoots fire, and smashes out children", () => {
  const e = boss("FurryCritter", { x: 1000, y: 600, seed: 77 });
  const context = api(e);
  const seen = step(e, { x: 1180, y: 600 }, 1 / 60, context.api, 4200);
  for (const state of ["normal", "seek", "attack", "smash"]) assert.ok(seen.has(state), state);
  assert.ok(context.calls.shoot.some(call => call.options.fireball));
  assert.ok(context.calls.spawn.filter(call => call.kind === "FurryCritterChild").length >= 2);
});

test("aerial bosses seek or pass, and their attack phases emit projectiles", () => {
  for (const kind of ["BigUglyDragon", "GiantDragonfly", "BigGhost"]) {
    const e = boss(kind, { seed: 0x98765432 });
    const context = api(e);
    step(e, { x: 1180, y: 620 }, 1 / 60, context.api, 1800);
    assert.ok(context.calls.shoot.length > 0, `${kind}: no shots`);
    assert.ok(e.anim.cur?.frames?.length, kind);
  }
});

test("BigAnguila spawns eel children and fires a vertical two-way fan", () => {
  const e = boss("BigAnguila", { seed: 123 });
  const context = api(e);
  step(e, { x: 1180, y: 620 }, 1 / 60, context.api, 1800);
  const children = context.calls.spawn.filter(call => call.kind === "Anguila");
  assert.ok(children.length >= 1);
  const shots = context.calls.shoot.filter(call => call.options.vx !== undefined);
  assert.ok(shots.some(call => call.options.vy < 0));
  assert.ok(shots.some(call => call.options.vy > 0));
});

test("BigPirana releases exactly five blowfish in each charge attack", () => {
  const e = boss("BigPirana", { seed: 2468 });
  const context = api(e);
  const seen = step(e, { x: 1180, y: 620 }, 1 / 60, context.api, 1200);
  assert.ok(seen.has("attack"));
  const fish = context.calls.spawn.filter(call => call.kind === "BigPiranaBlowFish");
  assert.equal(fish.length % 5, 0);
  assert.ok(fish.length >= 5);
});

test("BigBat steers continuously with native acceleration and periodically spawns bats", () => {
  const e = boss("BigBat", { seed: 13579 });
  const context = api(e);
  step(e, { x: 1180, y: 620 }, 1 / 60, context.api, 1);
  assert.equal(e.state, "normal");
  assert.ok(Math.abs(Math.abs(e.vx) - 100) <= 48 / 60 + 1e-9);
  const seen = step(e, { x: 1180, y: 620 }, 1 / 60, context.api, 3600);
  assert.deepEqual([...seen], ["normal"], "native has no invented one-second seek phase");
  assert.ok(context.calls.spawn.filter(call => call.kind === "Bat").length >= 1);
});

test("BigSpider descends 192 pixels, shoots from its thread, spawns a spider, then climbs", () => {
  const e = boss("BigSpider", { y: 500, seed: 8642 });
  const context = api(e);
  const seen = step(e, { x: 1180, y: 620 }, 1 / 60, context.api, 2400);
  for (const state of ["normal", "down", "attack", "up"]) assert.ok(seen.has(state), state);
  assert.ok(context.calls.shoot.length >= 5);
  assert.ok(context.calls.spawn.some(call => call.kind === "LittleSpider"));
});

test("Malmark2 cycles through Spot markers, summons minions, and alternates attacks", () => {
  const e = boss("Malmark2", { seed: 424242 });
  const markers = [
    { x: 1100, y: 600 }, { x: 1200, y: 620 }, { x: 1000, y: 580 },
    { x: 1150, y: 640 }, { x: 1050, y: 600 },
  ];
  const context = api(e, { markers });
  const seen = step(e, { x: 1180, y: 620 }, 1 / 60, context.api, 4800);
  assert.ok(seen.has("travel"));
  assert.ok(seen.has("attack1"));
  assert.ok(seen.has("attack2"));
  assert.ok(context.calls.spawn.every(call => markers.some(marker =>
    Math.hypot(call.x-marker.x, call.y+156-marker.y) <= 33)), "summons occur at the destination, within native 32px stop distance");
  assert.ok(context.calls.spawn.some(call => ["Bat", "DragonFly", "Bee"].includes(call.kind)));
  assert.ok(context.calls.shoot.length >= 1);
});

test("every boss remains safe with no optional API, no animation, and no player", () => {
  for (const kind of BOSS_KINDS) {
    const e = createEnemy({ name: kind, x: 200, y: 300 });
    const seen = step(e, null, NaN, {}, 300);
    assert.ok(e.fight, kind);
    assert.ok(seen.has("waiting") || e.state !== "waiting", kind);
    assert.ok(Number.isFinite(e.hp), kind);
  }
});

test("setState animation names are stable across repeated updates", () => {
  for (const kind of BOSS_KINDS) {
    const e = boss(kind);
    const context = api(e);
    updateBoss(e, { x: 2000, y: 600 }, 1 / 60, context.api);
    const first = e.animName;
    updateBoss(e, { x: 2000, y: 600 }, 1 / 60, context.api);
    assert.equal(e.animName, first, kind);
  }
});

test("Topo stars follow the three Custom frames of the ORIGINAL shot animation", () => {
  const e=boss("TopoNinja"),p={x:1180,y:630},context=api(e);
  updateBoss(e,p,0,context.api);
  e.state="attack";e.stateTime=0;e.anim.restart("shot");e.flags=[];
  const times=[];
  context.api.shoot=(_,options)=>{times.push(e.stateTime);assert.equal(options.homingSpeed,320);assert.equal(options.offsetY,-70);};
  for(let i=0;i<115;i++)updateBoss(e,p,1/60,context.api);
  assert.equal(times.length,3);
  for(const [i,at]of [11/12,13/12,15/12].entries())assert.ok(Math.abs(times[i]-at)<=1/60+1e-8);
  assert.equal(e.state,"attack","shot pose lasts 23/12 s, not the old 1.05 s");
  step(e,p,1/60,context.api,3);assert.equal(e.state,"stand");
});

test("Topo preparation launches on PhysicEvent and preserves the native -960 impulse", () => {
  const e=boss("TopoNinja"),p={x:1500,y:630},context=api(e);
  updateBoss(e,p,0,context.api);e.state="prepareJump";e.stateTime=0;e.anim.restart("roll");e.flags=[];
  for(let i=0;i<20;i++)updateBoss(e,p,1/60,context.api);
  assert.equal(e.state,"prepareJump");
  updateBoss(e,p,1/60,context.api);assert.equal(e.state,"jump");assert.equal(e.vy,-960);
  updateBoss(e,p,1/60,context.api);assert.equal(e.vy,-930);assert.equal(e.vx,8);
});

test("three birds share the native attack turn and each pursues for 5–8 seconds", () => {
  const birds=[1,2,3].map(seed=>boss("BigBird",{seed})),p={x:1180,y:630},attacked=new Set();
  const durations=[];let previous=null,started=0;
  for(let i=0;i<3600;i++){
    for(const e of birds)updateBoss(e,p,1/60,{
      inCamera:()=>true,claimBird:b=>!birds.some(o=>o!==b&&o.state==="attack"&&o.hp>0),
    });
    const active=birds.filter(e=>e.state==="attack");assert.ok(active.length<=1);
    if(previous&&active[0]!==previous)durations.push((i-started)/60);
    if(active[0]!==previous){previous=active[0];started=i;}
    if(active[0])attacked.add(active[0]);
  }
  assert.equal(attacked.size,3);assert.ok(durations.length>=6);
  assert.ok(durations.every(t=>t>=5&&t<=8+1/60));
});

test("Pirana sheds its protective skin for ten seconds and releases five helpers at native offsets", () => {
  const e=boss("BigPirana"),p={x:1180,y:630},context=api(e);
  updateBoss(e,p,0,context.api);assert.equal(e.animName,"normalSkinned");assert.equal(damageBoss(e),false);
  assert.ok(e.thinkT>=8&&e.thinkT<=10);
  while(e.state==="normal")updateBoss(e,p,1/60,context.api);
  assert.equal(e.animName,"normal");assert.equal(damageBoss(e),true);
  assert.equal(context.calls.spawn.length,5);
  assert.deepEqual(context.calls.spawn.map(c=>[Math.round((c.x-e.x)*e.dir)||0,Math.round(c.y-e.y)]),[[0,-40],[30,0],[-30,0],[30,-80],[-30,-80]]);
  const x=e.x,y=e.y;step(e,p,1/60,context.api,599);
  assert.equal(e.state,"attack");assert.equal(e.x,x);assert.equal(e.y,y);
  step(e,p,1/60,context.api,2);assert.equal(e.state,"normal");assert.equal(damageBoss(e),false);
});

test("Furry smash emits one falling child on EACH MakeEffect, rather than two arbitrary timers", () => {
  const e=boss("FurryCritter"),p={x:1180,y:630},context=api(e);
  updateBoss(e,p,0,context.api);e.state="smash";e.stateTime=0;e.anim.restart("smash");e.flags=[];
  step(e,p,1/60,context.api,66);
  assert.equal(context.calls.spawn.length,3);assert.equal(context.calls.shake,3);
  assert.ok(context.calls.spawn.every(c=>c.y===e.y-300));
});

test("UglyDragon keeps steering while emitting the short native flame stream", () => {
  const e=boss("BigUglyDragon"),p={x:1500,y:800},context=api(e);
  updateBoss(e,p,0,context.api);e.state="attack";e.stateTime=0;e.shootT=0;e.anim.restart("attack");
  const x=e.x;step(e,p,1/60,context.api,12);
  assert.ok(e.x>x);assert.equal(context.calls.shoot.length,12);
  assert.ok(context.calls.shoot.every(c=>c.options.offsetX===32&&c.options.aim!==true));
});

test("Malmark flies at 180 px/s to a random Spot; attack2 changes pose without restarting the two-second state", () => {
  const e=boss("Malmark2"),p={x:1100,y:630},context=api(e,{markers:[{x:1800,y:600}]});
  updateBoss(e,p,0,context.api);e.thinkT=0;
  updateBoss(e,p,1/60,context.api);assert.equal(e.state,"travel");
  let previous={x:e.x,y:e.y};
  while(e.state==="travel"){
    updateBoss(e,p,1/60,context.api);
    const displacement=Math.hypot(e.x-previous.x,e.y-previous.y);
    assert.ok(displacement<=3+1e-8,"no teleport or snapping");previous={x:e.x,y:e.y};
  }
  assert.equal(e.state,"attack1");
  step(e,p,1/60,context.api,61);assert.equal(e.state,"attack2");assert.ok(e.stateTime>=1);
  step(e,p,1/60,context.api,60);assert.equal(e.state,"normal");
});

test("level-9 dragonfly can retreat beyond the map edge and return in an attacking pass", () => {
  const e=boss("GiantDragonfly",{x:3856,y:702,homeX:3856,homeY:702}),p={x:3736,y:702};
  const context=api(e,{bounds:{left:0,right:4096,top:0,bottom:1024},inCamera:b=>b.x>=3480&&b.x<=3992});
  let outside=false,passed=false;const states=new Set();
  for(let i=0;i<1200;i++){
    updateBoss(e,p,1/60,context.api);outside||=e.x>4096;states.add(e.state);
    if(e.state==="attack"&&e.x<p.x)passed=true;
  }
  assert.ok(outside);assert.ok(passed);assert.ok(states.has("normal")&&states.has("attack"));
});

test("retreating bosses face their target rather than flipping with backward velocity", () => {
  assert.equal(enemySpriteFlip({kind:"BigGhost",boss:true,dir:1,vx:-120}),false);
  assert.equal(enemySpriteFlip({kind:"GiantDragonfly",boss:true,dir:-1,vx:320}),true);
});

test("Topo homing stars steer at 320 and use their original one-second stick effect", () => {
  const target={x:600,y:200,w:8,h:60},e={x:300,y:200,dir:1};
  const shot=createEnemyShot(e,null,{library:"TopoNinja",aim:true,target,speed:320,homingSpeed:320,targetOffsetY:-8,endLife:1,terrain:true});
  const context={tileAt:()=>0,camera:{x:0,y:0},hurtPlayer:()=>{}};
  updateEnemyShot(shot,target,1/60,context);assert.ok(Math.abs(Math.hypot(shot.vx,shot.vy)-320)<1e-8);
  target.x=10;target.y=350;updateEnemyShot(shot,target,1/60,context);assert.ok(shot.vx<0&&shot.vy>0);
  shot.ending=true;shot.anim={update(){},finished:false};
  updateEnemyShot(shot,target,.75,context);assert.equal(shot.removed,false);
  updateEnemyShot(shot,target,.26,context);assert.equal(shot.removed,true);
});

test("Malmark randomly summons the three native species OR the Fireball2 homing projectile", () => {
  const e=boss("Malmark2",{seed:424242}),context=api(e,{markers:[{x:1000,y:600}]});
  step(e,{x:1180,y:620},1/60,context.api,12000);
  assert.deepEqual(new Set(context.calls.spawn.map(c=>c.kind)),new Set(["Bat","DragonFly","Bee"]));
  assert.ok(context.calls.shoot.length>0);
  assert.ok(context.calls.shoot.every(c=>c.options.library==="fireball2"&&c.options.homingAfter===1&&c.options.homingUntil===6));
});

test("boss-owned blowfish wait 0.25 seconds, aim at speed 100, then periodically retarget", () => {
  const e=createEnemy({name:"BigPiranaBlowFish",x:300,y:200});e.owner={kind:"BigPirana"};
  const p={x:600,y:230},context={moveBody:(b,dt)=>{b.x+=b.vx*dt;b.y+=b.vy*dt;},waterAt:()=>true};
  for(let i=0;i<14;i++)updateEnemy(e,p,1/60,context);
  assert.equal(e.vx,0);assert.equal(e.vy,0);
  for(let i=0;i<3;i++)updateEnemy(e,p,1/60,context);
  assert.ok(e.vx>0);assert.ok(Math.abs(Math.hypot(e.vx,e.vy)-100)<1e-8);
  p.x=0;for(let i=0;i<120;i++)updateEnemy(e,p,1/60,context);assert.ok(e.vx<0);
});

test("GameD friction is braking, not fake gravity, for birds and ghosts", () => {
  for(const [kind,friction,offset]of [["BigBird",100,0],["BigGhost",60,64]]){
    const e=boss(kind),context=api(e),p={x:e.x+500,y:e.y+offset};
    updateBoss(e,p,0,context.api);e.vx=120;e.vy=0;const y=e.y;
    updateBoss(e,p,1/60,context.api);
    assert.ok(Math.abs(e.vx-(120-friction/60))<1e-8);assert.equal(e.y,y);assert.equal(e.vy,0);
  }
});

test("native BigBat wall collisions reflect half the horizontal velocity", () => {
  const e=boss("BigBat"),p={x:e.x+500,y:e.y+120},context=api(e);
  updateBoss(e,p,0,context.api);e.vx=120;e.vy=0;
  updateBoss(e,p,1/60,{...context.api,moveBody:b=>{b.hitWall=true;b.vx=0;}});
  assert.ok(Math.abs(e.vx-(-120.8*.5))<1e-8);
});

test("damage-driven boss bars follow the most recently hit bird; Topo and Bat request theirs on entry", () => {
  const birds=[boss("BigBird"),boss("BigBird")];
  for(const e of birds){updateBoss(e,{x:1200,y:600},0,api(e).api);assert.equal(e.bossBarRequested,false);}
  for(const e of birds){assert.equal(damageBoss(e),true);assert.equal(e.bossBarRequested,true);}
  assert.ok(birds[1].bossBarOrder>birds[0].bossBarOrder);
  for(const kind of ["TopoNinja","BigBat"]){const e=boss(kind);updateBoss(e,{x:1200,y:600},0,api(e).api);assert.equal(e.bossBarRequested,true);}
});
