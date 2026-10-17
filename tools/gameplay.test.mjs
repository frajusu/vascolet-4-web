import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { parseTMX, parseAnims, TILE_SOLID, TILE_UP } from "../js/tmx.js";
import { AnimPlayer } from "../js/sprite.js";
import { cameraBounds, updateCamera } from "../js/camera.js";
import { createBoomerang, updateBoomerang } from "../js/projectiles.js";
import { createEnemy, hitEnemy, updateEnemy, enemySpriteFlip } from "../js/enemies.js";

const dom = new JSDOM();
const xml = text => new dom.window.DOMParser().parseFromString(text, "text/xml");
const asset = async name => xml(await readFile(new URL(`../assets/${name}`, import.meta.url), "utf8"));
test.after(() => dom.window.close());
const player = () => ({ x: 256, y: 320, face: 1, crouch: false });
const empty = () => 0;
const callbacks = (extra = {}) => ({ tileAt: empty, hitEnemy() {}, wallHit() {}, impact() {}, ...extra });

test("standing throw decelerates, reverses around 200 logical pixels and is caught within the observed time window", () => {
  const p = player(), b = createBoomerang(p);
  let peak = b.x, elapsed = 0;
  for (; elapsed < 3 && b.life > 0; elapsed += 1 / 60) {
    updateBoomerang(b, p, [], 1 / 60, callbacks()); peak = Math.max(peak, b.x);
  }
  assert.ok(peak - p.x > 180 && peak - p.x < 240, `range ${peak - p.x}`);
  assert.ok(elapsed > 1.0 && elapsed < 1.5, `catch time ${elapsed}`);
  assert.equal(b.life, 0);
  assert.equal(b.caught, true, "must be caught, not expire");
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
  for (let i = 0; i < 32; i++) {
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
  assert.deepEqual(hits, [enemies[1]]); assert.equal(b.life, 0);
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
  const e = createEnemy({ name: kind, x, y: kind === "Flower" ? 288 : 304 });
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
  const e=createEnemy({name:"BigScorpion",x:320,y:304},true),p=player();
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
