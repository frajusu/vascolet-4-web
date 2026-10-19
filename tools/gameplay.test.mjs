import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { parseTMX, parseAnims, TILE_SOLID, TILE_UP } from "../js/tmx.js";
import { AnimPlayer } from "../js/sprite.js";
import { cameraBounds, updateCamera } from "../js/camera.js";
import { createBoomerang, updateBoomerang } from "../js/projectiles.js";
import { createEnemy, hitEnemy, updateEnemy, enemySpriteFlip } from "../js/enemies.js";
import { createEnemyShot, updateEnemyShot } from "../js/enemy-projectiles.js";
import { LEVEL_SOUNDS, levelSound } from "../js/level-sounds.js";
import { Audio2 } from "../js/audio.js";

const dom = new JSDOM();
const xml = text => new dom.window.DOMParser().parseFromString(text, "text/xml");
const asset = async name => xml(await readFile(new URL(`../assets/${name}`, import.meta.url), "utf8"));
test.after(() => dom.window.close());
const player = () => ({ x: 256, y: 320, face: 1, crouch: false });
const empty = () => 0;
const callbacks = (extra = {}) => ({ tileAt: empty, hitEnemy() {}, wallHit() {}, impact() {}, ...extra });

test("two-fruit standing throw reaches the observed ~200px and is caught within the original capture window", () => {
  const p = {...player(),boomerangLevel:2}, b = createBoomerang(p);
  let peak = b.x, elapsed = 0;
  for (; elapsed < 3 && b.life > 0; elapsed += 1 / 60) {
    updateBoomerang(b, p, [], 1 / 60, callbacks()); peak = Math.max(peak, b.x);
  }
  assert.ok(peak - p.x > 180 && peak - p.x < 240, `range ${peak - p.x}`);
  assert.ok(elapsed > 1.0 && elapsed < 1.5, `catch time ${elapsed}`);
  assert.equal(b.life, 0);
  assert.equal(b.caught, true, "must be caught, not expire");
});

test("new-game throws have the native shorter range; fruits increase speed, flight time and range", () => {
  const peaks=[];
  for(const level of [0,1,2,5]) {
    const p={...player(),boomerangLevel:level},b=createBoomerang(p);let peak=b.x;
    for(let i=0;i<180&&b.life>0;i++){updateBoomerang(b,p,[],1/60,callbacks());peak=Math.max(peak,b.x);}
    peaks.push(peak-p.x);assert.equal(b.caught,true);
  }
  assert.ok(peaks[0]>130&&peaks[0]<160,JSON.stringify(peaks));
  assert.ok(peaks[2]>180&&peaks[2]<220,JSON.stringify(peaks));
  assert.ok(peaks.every((p,i)=>!i||p>peaks[i-1]));
});

test("return catches a player who has changed height and keeps moving", () => {
  const p = player(), b = createBoomerang(p);
  for (let i = 0; i < 360 && b.life > 0; i++) {
    p.x += 100 / 60; p.y = i < 40 ? 260 : 320;
    updateBoomerang(b, p, [], 1 / 60, callbacks());
  }
  assert.equal(b.life, 0);
  assert.equal(b.state, "return");
  assert.equal(b.caught, true);
});

test("outbound world trajectory is independent of running, jumping, facing and crouching after release", () => {
  const still = player(), moving = player(), a = createBoomerang(still), b = createBoomerang(moving);
  for (let i = 0; i < 32 && a.state === "out"; i++) {
    moving.x += 5; moving.y -= 4; moving.face *= -1; moving.crouch = i % 2 === 0;
    updateBoomerang(a, still, [], 1 / 60, callbacks());
    updateBoomerang(b, moving, [], 1 / 60, callbacks());
    assert.equal(a.x, b.x); assert.equal(a.y, b.y);
  }
  assert.notEqual(a.x - still.x, b.x - moving.x, "must not retain a parent-relative offset");
});

test("rapid running reversals and repeated jumps are caught instead of trailing for 4+ seconds", () => {
  const p = player(), b = createBoomerang(p);
  let i = 0;
  for (; i < 180 && b.life > 0; i++) {
    const t = i / 60;
    p.prevX = p.x; p.prevY = p.y;
    p.x += (Math.floor(t * 2) % 2 ? -300 : 300) / 60;
    p.y = 320 - 160 * Math.abs(Math.sin(t * 4));
    updateBoomerang(b, p, [], 1 / 60, callbacks());
  }
  assert.equal(b.caught, true); assert.ok(i / 60 < 2.5, `catch took ${i / 60}s`);
});

test("a one-way leaf does not destroy a horizontal throw; a solid wall knocks it down", () => {
  for (const [flags, expected] of [[TILE_UP, "out"], [TILE_SOLID, "falling"]]) {
    const p = player(), b = createBoomerang(p); let wallSounds = 0;
    updateBoomerang(b, p, [], .1, callbacks({ tileAt: x => x === 10 ? flags : 0, wallHit() { wallSounds++; } }));
    assert.equal(b.state, expected); assert.equal(wallSounds, flags === TILE_SOLID ? 1 : 0);
    if (expected === "falling") assert.ok(b.life > 0, "impact must leave a falling boomerang");
  }
});

test("swept boomerang collision hits only the nearest enemy and cannot damage through a wall", () => {
  const enemies = [createEnemy({ name: "Fly", x: 320, y: 300 }), createEnemy({ name: "Fly", x: 288, y: 300 })];
  const hits = [], b = createBoomerang(player());
  updateBoomerang(b, player(), enemies, .2, callbacks({ hitEnemy(e) { hits.push(e); } }));
  assert.deepEqual(hits, [enemies[1]]); assert.equal(b.state, "falling");assert.ok(b.life>0);
  for(let i=0;i<30;i++)updateBoomerang(b,player(),enemies,1/60,callbacks({hitEnemy(e){hits.push(e);}}));
  assert.equal(hits.length,1,"the spent boomerang cannot deal another hit while bouncing");
  const blocked = createBoomerang(player()); hits.length = 0;
  updateBoomerang(blocked, player(), [enemies[0]], .2, callbacks({ tileAt: x => x === 9 ? TILE_SOLID : 0,
    hitEnemy(e) { hits.push(e); } }));
  assert.deepEqual(hits, []); assert.equal(blocked.state, "falling");
});

test("level 1 Camera barrier caps the screen bottom at 480 and releases it in the boss pit", async () => {
  const map = parseTMX(await asset("data/maps/level1.tmx"));
  const line = map.groups.find(g => g.name === "Camera").objects[0];
  assert.equal(line.h, 0, "omitted height is a line, not a default 32px rectangle");
  const p = { x: 272, y: 416 };
  assert.equal(cameraBounds(map, p).maxY, 96);
  const g = { map, player: p, camX: 999, camY: 999 };
  for (let i = 0; i < 120; i++) { updateCamera(g, 1 / 60); assert.ok(g.camY + 384 <= 480); }
  Object.assign(p, { x: 13792, y: 1300 });
  updateCamera(g, 1 / 60, true);
  assert.ok(g.camY > 96, "boss arena below the barrier must remain reachable");
  assert.ok(g.camX >= 13056 && g.camX + 512 <= 14112);
});

test("Camera point markers in scrolling levels must not be interpreted as barriers", async () => {
  const map = parseTMX(await asset("data/maps/level2.tmx"));
  const b = cameraBounds(map, { x: 400, y: 300 });
  assert.equal(b.maxY, Math.max(0, map.h * 32 - 384));
});

const floorPhysics = (b, dt, gravity = 1500) => {
  b.vy += gravity * dt; b.x += b.vx * dt; b.y += b.vy * dt;
  b.ground = b.y >= 320;
  if (b.ground) { b.y = 320; b.vy = 0; }
};
const services = { moveBody: floorPhysics, tileAt: () => TILE_SOLID, shoot() {} };
async function enemy(kind, x = 320) {
  const e = createEnemy({ name: kind, x, y: 290 });
  const anims = parseAnims(await asset(`characters/${kind.toLowerCase()}/animData/${kind}.xml`));
  e.anim = new AnimPlayer(anims); e.anim.set("normal"); e.cur = e.anim.frame; e.ground = true;
  return e;
}

test("frog windup and fixed ballistic leap match recovered trigger/impulses; it cannot steer in midair", async () => {
  const e = await enemy("Frog"), p = player(); e.cooldown = 0;
  for (let i = 0; i < 10; i++) updateEnemy(e, p, 1 / 60, services);
  assert.equal(e.state, "windup"); assert.equal(e.y, 320);
  for (let i = 0; i < 7; i++) updateEnemy(e, p, 1 / 60, services);
  assert.equal(e.state, "jump"); assert.ok(e.vy < 0);
  const direction = e.dir, startX = e.x;
  let minY = e.y, ticks = 0;
  p.x = e.x + 500; // move behind the airborne frog
  while (e.state === "jump" && ticks++ < 100) {
    updateEnemy(e, p, 1 / 60, services); minY = Math.min(minY, e.y);
    if (e.state === "jump") assert.equal(e.dir, direction);
  }
  assert.equal(e.y, 320); assert.equal(e.state, "normal");
  assert.ok(320 - minY > 130 && 320 - minY < 145, `apex ${320 - minY}`);
  assert.ok(Math.abs(e.x - startX) > 245 && Math.abs(e.x - startX) < 280);
});

test("frog remains still beyond 128px and reacts to nearby boomerangs, not an arbitrary cooldown", async () => {
  const e = await enemy("Frog"), p = { x: 2000, y: 320 };
  for (let i = 0; i < 300; i++) updateEnemy(e, p, 1 / 60, services);
  assert.equal(e.state, "normal"); assert.equal(e.x, e.homeX);
  updateEnemy(e, p, 1 / 60, { ...services, booms: [{ x: e.x - 100, life: 1, state: "out" }] });
  assert.equal(e.state, "windup");
});

test("flower stays rooted and shoots once at the Custom attack frame", async () => {
  const e = await enemy("Flower"), x = e.x, p = player(); e.cooldown = 0;
  const shots = [];
  for (let i = 0; i < 90; i++) updateEnemy(e, p, 1 / 60, { ...services, shoot: e => shots.push(e) });
  assert.equal(e.x, x); assert.equal(e.y, 320); assert.equal(shots.length, 1);
});

test("patrols turn at walls and avoid cliffs only when the original dontFall command is set", async () => {
  assert.equal(createEnemy({ name: "Beetle", x: 0, y: 0, props: { dontFall: "" } }).dontFall, true);
  const combined = createEnemy({ name: "Beetle", x: 0, y: 0, type: "forward,dontFall" });
  assert.equal(combined.dontFall, true); assert.equal(combined.dir, 1);
  for (const kind of ["Beetle", "Snail"]) {
    const e = await enemy(kind); const before = e.dir;
    e.dontFall = true;
    updateEnemy(e, player(), 1 / 60, { ...services, tileAt: empty });
    assert.equal(e.dir, -before);
    updateEnemy(e, player(), 1 / 60, { ...services, moveBody(b) { b.hitWall = true; } });
    assert.equal(e.dir, before);
  }
});

test("fly patrol X is spawn-relative and does not pursue a player on either side", async () => {
  const e = await enemy("Fly"), other = await enemy("Fly");
  for (let i = 0; i < 1800; i++) {
    const movement = { ...services, moveBody(b, dt) { b.x += b.vx * dt; b.y += b.vy * dt; } };
    updateEnemy(e, { x: 2000, y: 320 }, 1 / 60, movement);
    updateEnemy(other, { x: -2000, y: 320 }, 1 / 60, movement);
    assert.equal(e.x, other.x); assert.ok(Math.abs(e.x - e.homeX) < 105);
  }
  assert.equal(hitEnemy(e), true); assert.equal(e.hp, 0); assert.equal(e.state, "dead");
  assert.equal(hitEnemy(e), false);
  updateEnemy(e, { x: 2000, y: 320 }, 1, services); assert.ok(e.deadT >= 1);
});

test("unstudied swimming enemies and bosses accept hits without being forced into land physics", () => {
  for (const [kind, boss] of [["Fish", false], ["BigBird", true]]) {
    const e = createEnemy({ name: kind, x: 320, y: 304 }, boss);
    assert.equal(hitEnemy(e), true); assert.equal(e.hp, e.maxhp - 1);
    updateEnemy(e, player(), 1 / 60, { ...services, moveBody() { assert.fail("unverified species must not receive patrol gravity"); } });
    assert.ok(Math.abs(e.y - e.homeY) <= 4);
  }
});

test("first-area right-facing atlases turn with movement and stationary facing", () => {
  for (const kind of ["Fly","Frog","Flower","Beetle","Snail","Scorpion","BigScorpion"]) {
    const e=createEnemy({name:kind,x:0,y:0});
    e.vx=-30;e.dir=1;assert.equal(enemySpriteFlip(e),true,kind);
    e.vx=30;e.dir=-1;assert.equal(enemySpriteFlip(e),false,kind);
    e.vx=0;assert.equal(enemySpriteFlip(e),true,kind);
  }
});

test("scorpion waits for the camera, jumps/drops minions, limits reinforcements and finishes its four-second death", async () => {
  const e=createEnemy({name:"BigScorpion",x:320,y:290},true),p=player();
  e.anim=new AnimPlayer(parseAnims(await asset("characters/big-scorpion-v02/animData/Big-scorpion-v02.xml")));
  const drops=[],shakes=[];let starts=0,defeats=0,explosions=0,inCamera=false;
  const api={...services,inCamera:()=>inCamera,minionCount:()=>drops.length,
    spawnMinion:(...position)=>drops.push(position),shake:t=>shakes.push(t),bossStart:()=>starts++,
    bossDefeated:()=>defeats++,explosion:()=>explosions++};
  assert.equal(e.hp,20);assert.equal(hitEnemy(e),false);
  for(let i=0;i<30;i++) updateEnemy(e,p,1/60,api);
  assert.equal(e.fight,false);assert.equal(e.y,320);
  inCamera=true;updateEnemy(e,p,1/60,api);assert.equal(starts,1);
  let jumped=false;
  for(let i=0;i<330;i++){updateEnemy(e,p,1/60,api);jumped ||= e.state==="jump" && e.vy<0;}
  assert.equal(jumped,true);assert.equal(drops.length,2);assert.ok(shakes.includes(.5));
  for(let i=0;i<300;i++) updateEnemy(e,p,1/60,api);
  assert.equal(drops.length,2,"two live minions prevent further drops");
  assert.equal(hitEnemy(e),true);assert.equal(hitEnemy(e),false,"freeze blocks repeated hits in a single tick");
  for(let hit=1;hit<20;hit++) { for(let i=0;i<13;i++)updateEnemy(e,p,1/60,api);assert.equal(hitEnemy(e),true); }
  assert.equal(e.state,"dying");assert.equal(e.defeated,false);
  for(let i=0;i<239;i++)updateEnemy(e,p,1/60,api);
  assert.equal(defeats,0);assert.ok(explosions>=25 && explosions<=30);
  for(let i=0;i<4;i++)updateEnemy(e,p,1/60,api);
  assert.equal(e.defeated,true);assert.equal(defeats,1);
  updateEnemy(e,p,1/60,api);assert.equal(defeats,1);
});

test("verified factory life counts require one damage unit per boomerang; living frog/snail never select death art", async () => {
  for (const [kind,hp] of [["Frog",4],["Flower",5],["Beetle",10],["Snail",10]]) {
    const e=await enemy(kind);assert.equal(e.hp,hp);
    for(let hit=1;hit<=hp;hit++) {
      e.hurtT=0;assert.equal(hitEnemy(e),true);assert.equal(e.hp,hp-hit);
      if(e.hp>0) {
        assert.notEqual(e.anim.cur.name,"damage");assert.notEqual(e.anim.cur.name,"dead");
        assert.ok(e.cur.sprites.every(s=>s.img!=="snailDamage" && s.img!=="dead"));
        updateEnemy(e,{x:2000,y:320},1/60,services);
      }
    }
  }
  const stomp=await enemy("Beetle");hitEnemy(stomp,1,2);assert.equal(stomp.hp,8);
});

test("flower death stays rooted and finishes its own animation instead of using the flying death impulse", async () => {
  const e=await enemy("Flower"),x=e.x,y=e.y;e.hp=1;hitEnemy(e);
  for(let i=0;i<240;i++)updateEnemy(e,player(),1/60,services);
  assert.equal(e.x,x);assert.equal(e.y,y);assert.equal(e.vx,0);assert.equal(e.vy,0);
  assert.equal(e.anim.cur.name,"dead");assert.equal(e.anim.finished,true);
  assert.equal(e.cur.sprites[0].img,"dead04");
});

test("fly patrol passes through solid terrain without a floor/wall physics callback", async () => {
  const e=await enemy("Fly");let furthestY=e.y;
  for(let i=0;i<600;i++) {
    updateEnemy(e,{x:2000,y:450},1/60,{...services,tileAt:()=>TILE_SOLID,
      moveBody(){assert.fail("fly must not collide with floor or platforms");}});
    furthestY=Math.max(furthestY,e.y);
  }
  assert.ok(furthestY>450);assert.ok(Math.abs(e.x-e.homeX)<105);
});

test("flower shots cross solids and survive player contact and four seconds while remaining on camera", () => {
  const shot=createEnemyShot({behavior:"flower",x:100,y:320,dir:1});
  assert.equal(shot.vx,240);let hurts=0;
  for(let i=0;i<360;i++) {
    const p={x:shot.x+4,y:320,w:8,h:60};
    updateEnemyShot(shot,p,1/60,{tileAt:()=>TILE_SOLID,camera:{x:shot.x-256,y:0},hurtPlayer(){hurts++;}});
    assert.equal(shot.removed,false);
  }
  assert.ok(hurts>0);assert.ok(shot.x>1500);
  updateEnemyShot(shot,{x:0,y:0,w:8,h:60},1/60,{tileAt:empty,camera:{x:0,y:0},hurtPlayer(){}});
  assert.equal(shot.removed,true);
});

test("snail fireballs use native speed and visible extinction frames at solids, without a lifetime cutoff", async () => {
  const anim=new AnimPlayer(parseAnims(await asset("characters/fireball/animData/Fireball.xml")));anim.set("normal");
  const shot=createEnemyShot({behavior:"snail",x:350,y:320,dir:1},anim),p={x:10000,y:0,w:8,h:60};
  assert.equal(shot.vx,480);
  const api={tileAt:x=>x===12?TILE_SOLID:0,camera:{x:0,y:0},hurtPlayer(){assert.fail("wall must shield the distant player");}};
  updateEnemyShot(shot,p,.1,api);assert.equal(shot.ending,true);assert.equal(shot.removed,false);
  assert.equal(shot.anim.cur.name,"ending");assert.ok(shot.anim.frame.sprites[0].img.startsWith("fireball0"));
  updateEnemyShot(shot,p,.1,api);assert.equal(shot.removed,false);
  updateEnemyShot(shot,p,.1,api);assert.equal(shot.removed,true);
});

test("level sound gains match the effect library and do not alter menu audio settings", () => {
  const old=Audio2.sfx,calls=[];Audio2.sfx=(...args)=>calls.push(args);
  try {levelSound("footStep1");levelSound("jumpAir");levelSound("v_death1");}
  finally {Audio2.sfx=old;}
  assert.deepEqual(calls.map(c=>c[1]),[.1,.4,.25]);
  assert.equal(LEVEL_SOUNDS.enemy_boomerang_hit,.5);assert.equal(LEVEL_SOUNDS.save,.5);
});

test("camera accumulates native 60px look-ahead and does not chase upward during a low-area jump", async () => {
  const map=parseTMX(await asset("data/maps/level1.tmx"));
  const g={map,player:{x:272,y:384,ground:true},camX:0,camY:0};updateCamera(g,0,true);
  g.player.x=360;updateCamera(g,1/60);assert.equal(g.camX,164);
  g.player.ground=false;g.player.y=300;updateCamera(g,1/60);assert.equal(g.camY,96);
  g.player.x=340;updateCamera(g,1/60);assert.equal(g.cameraTrack.leadX,40);
});
