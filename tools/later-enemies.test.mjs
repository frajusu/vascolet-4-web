import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { parseAnims } from "../js/tmx.js";
import { AnimPlayer } from "../js/sprite.js";
import { createEnemy } from "../js/enemies.js";
import { ENEMY_PROFILES } from "../js/enemy-profiles.js";
import { updateLaterEnemy, canDamageLaterEnemy } from "../js/later-enemies.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const dom = new JSDOM("");
const parser = new dom.window.DOMParser();
const cache = new Map();
const DT = 1 / 60;
test.after(() => dom.window.close());

function animations(kind) {
  if (cache.has(kind)) return cache.get(kind);
  const asset = ENEMY_PROFILES[kind].asset;
  const dir = path.join(root, "assets", "characters", asset, "animData");
  const file = fs.readdirSync(dir).find(name => name.toLowerCase().endsWith(".xml"));
  const doc = parser.parseFromString(fs.readFileSync(path.join(dir, file), "utf8"), "text/xml");
  const anims = parseAnims(doc);
  cache.set(kind, anims);
  return anims;
}

function make(kind, { x = 200, y = 300, dir = -1 } = {}) {
  const e = createEnemy({ name: kind, x: 0, y: 0, type: dir > 0 ? "forward" : "" });
  e.x = x; e.y = y; e.homeX = x; e.homeY = y; e.prevX = x; e.prevY = y;
  e.anim = new AnimPlayer(animations(kind));
  const normal = ["normal", "flying", "walk", "stand", "idle"].find(name => e.anim.has(name));
  if (normal) e.anim.set(normal);
  return e;
}

// Mirrors updateEnemy()'s order: timers and animation update happen around the
// later-enemy controller; animation events are drained after it returns.
function tick(e, player, api, dt = DT, parent = true) {
  e.t += dt; e.stateTime += dt; e.hurtT = Math.max(0, e.hurtT - dt); e.cooldown -= dt;
  const handled = updateLaterEnemy(e, player, dt, api);
  if (parent && e.state === "normal" && e.hurtT <= 0) {
    const normal = [e.pose, "normal", "flying", "walk", "fly", "stand", "idle"].find(name => name && e.anim?.has(name));
    if (normal) e.anim.set(normal);
  }
  e.anim?.update(dt);
  e.cur = e.anim?.frame ?? null;
  e.anim?.drainEvents();
  return handled;
}

function services(options = {}) {
  const calls = { shots: [], spawns: [], gravity: [], moves: 0, nearby: [] };
  const api = {
    tileAt: options.tileAt || (() => 0),
    waterAt: options.waterAt || (() => true),
    inCamera: options.inCamera || (() => true),
    shoot: (e, shot = {}) => calls.shots.push(shot),
    spawn: (...args) => calls.spawns.push(args),
    nearby: (kind, owner) => { calls.nearby.push([kind, owner]); return options.nearby ? options.nearby(kind, owner) : 0; },
    moveBody: (e, dt, gravity = 0) => {
      calls.moves++; calls.gravity.push(gravity);
      if (options.moveBody) options.moveBody(e, dt, gravity);
      else { e.vy += gravity * dt; e.x += e.vx * dt; e.y += e.vy * dt; e.ground = false; e.hitWall = false; }
    },
  };
  return { api, calls };
}

function run(e, player, api, seconds, dt = DT, each) {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) {
    tick(e, player, api, dt);
    if (each && each(i) === true) break;
  }
}

test("every recovered later family is handled while unknown and pending bosses are not", () => {
  const kinds = ["Panal", "Mosquito", "DragonFly", "Bat", "LittleSpider", "Mouse",
    "VolcanoFlower", "BigSnake", "SideColumn", "FrontColumn", "Axe", "Fork", "Knife",
    "Fish", "Piranha", "Pirana2", "Blowfish", "BigPiranaBlowFish", "Shell"];
  for (const kind of kinds) {
    const e = make(kind), { api } = services();
    assert.equal(updateLaterEnemy(e, { x: e.x + 300, y: e.y }, DT, api), true, kind);
    assert.equal(canDamageLaterEnemy(e), kind !== "Shell", `${kind} damage gate`);
  }
  const boss = make("BigBird");
  boss.vx = 99; boss.vy = -99;
  assert.equal(updateLaterEnemy(boss, { x: boss.x + 10, y: boss.y }, DT, services().api), false,
    "bosses are now dispatched to their own complete controller module");
  const unknown = createEnemy({ name: "Beetle", x: 0, y: 0 });
  assert.equal(updateLaterEnemy(unknown, { x: 0, y: 0 }, DT, services().api), false);
});

test("shell opens on the first PhysicEvent, emits three bubbles plus one aimed shot, then closes", () => {
  const e = make("Shell", { dir: 1 }), player = { x: e.x + 60, y: e.y };
  const { api, calls } = services();
  const gates = [];
  let previous = canDamageLaterEnemy(e);
  for (let i = 0; i < Math.ceil(4 / DT); i++) {
    tick(e, player, api);
    const now = canDamageLaterEnemy(e);
    if (now !== previous) gates.push(now);
    previous = now;
  }
  assert.deepEqual(gates, [true, false], "open then close exactly once in the first 4s");
  const bubbles = calls.shots.filter(shot => !shot.aim);
  const aimed = calls.shots.filter(shot => shot.aim);
  assert.equal(bubbles.length, 3);
  assert.deepEqual(bubbles.map(shot => [shot.vx, shot.vy, shot.gravity]), [[10, -20, -40], [8, -30, -40], [0, -16, -40]]);
  assert.equal(aimed.length, 1, "Custom must fire once per opening");
  assert.equal(e.shellOpen, false);
  assert.equal(e.vulnerable, false);
});

test("axe, fork and knife remain hidden, appear in range, fall, and finish their finite lifecycle", () => {
  for (const kind of ["Axe", "Fork", "Knife"]) {
    const e = make(kind, { x: 200, y: 180 }), player = { x: 800, y: 620 };
    const { api } = services();
    tick(e, player, api);
    assert.equal(e.visible, false, kind);
    assert.equal(e.state, "stale");
    player.x = e.x + 200; player.y = e.y;
    tick(e, player, api);
    assert.equal(e.visible, true, kind);
    assert.equal(e.state, "appear");
    let fallingStarted = false, minimumY = e.y;
    for (let i = 0; i < Math.ceil(12 / DT); i++) {
      tick(e, player, api);
      if (e.state === "falling") fallingStarted = true;
      minimumY = Math.max(minimumY, e.y);
      if (e.removed) break;
    }
    assert.equal(fallingStarted, true, `${kind} falls`);
    assert.ok(minimumY > 180, `${kind} gains downward speed`);
    assert.equal(e.removed, true, `${kind} is removed`);
    assert.equal(e.hp, 0);
    assert.equal(e.visible, false);
  }
});

test("piranha and pirana2 patrol in water and switch to a gravity-driven water-out state", () => {
  for (const kind of ["Piranha", "Pirana2"]) {
    const e = make(kind, { x: 300, y: 300, dir: 1 }), player = { x: 340, y: 300 };
    let wet = true;
    const floor = 500;
    const { api, calls } = services({
      waterAt: () => wet,
      moveBody: (b, dt, gravity) => {
        b.vy += gravity * dt; b.x += b.vx * dt; b.y += b.vy * dt;
        if (b.y >= floor) { b.y = floor; b.vy = 0; b.ground = true; } else b.ground = false;
        b.hitWall = false;
      },
    });
    const startY = e.y;
    run(e, player, api, 0.5);
    assert.ok(e.x > 300, `${kind} swims horizontally`);
    assert.equal(e.y, startY, `${kind} has no land gravity while swimming`);
    let attacked = false, openingVx = null;
    run(e, player, api, 1.2, DT, () => {
      if (e.state === "attack") {
        attacked = true;
        if (openingVx === null) openingVx = e.vx;
      }
    });
    assert.equal(attacked, true, `${kind} attacks a nearby player after one second`);
    assert.equal(openingVx, -30 * e.dir, `${kind} recoils at the recovered -30 before seeking`);
    assert.equal(calls.gravity.length, 0, `${kind} does not call land physics in water`);
    wet = false;
    tick(e, player, api);
    assert.equal(e.state, "waterOut", kind);
    tick(e, player, api);
    assert.ok(calls.gravity.includes(400), `${kind} uses the 400 water-out gravity`);
    wet = true;
    tick(e, player, api);
    assert.equal(e.state, "normal", `${kind} returns to the water state`);
  }
});

test("blowfish waits, activates within 200px, chases, then sleeps and settles after 250px", () => {
  const e = make("Blowfish", { x: 200, y: 300, dir: 1 }), player = { x: 700, y: 300 };
  const { api, calls } = services();
  run(e, player, api, 0.5);
  assert.equal(e.state, "normal");
  assert.equal(e.x, 200);
  assert.equal(calls.gravity.length, 0);
  player.x = 350;
  tick(e, player, api);
  assert.equal(e.state, "activated");
  run(e, player, api, 0.5);
  assert.ok(e.x > 200, "activated blowfish seeks the player");
  player.x = 800;
  tick(e, player, api);
  assert.equal(e.state, "deactivated");
  run(e, player, api, 1.1);
  assert.ok(calls.gravity.includes(400), "deactivation applies the recovered 400 gravity");
  assert.equal(e.state, "normal");
});

test("bat, dragonfly and mosquito steer without land gravity; mosquito shoots on its timer", () => {
  for (const kind of ["Bat", "DragonFly", "Mosquito"]) {
    const e = make(kind, { x: 200, y: 300 }), player = { x: 400, y: 200 };
    const { api, calls } = services();
    tick(e, player, api);
    assert.equal(e.dir, 1, `${kind} faces the player`);
    run(e, player, api, 2.9);
    assert.ok(calls.gravity.every(value => value === 0), `${kind} never applies land gravity`);
    assert.ok(e.x > 200, `${kind} moves toward the player horizontally`);
    assert.ok(e.y < 300, `${kind} moves toward the player vertically`);
    if (kind === "Mosquito") {
      assert.equal(calls.shots.length, 1, "two-second opening shot");
      assert.equal(calls.shots[0].aim, true);
    } else assert.equal(calls.shots.length, 0);
  }
  for (const kind of ["Bat", "DragonFly", "Mosquito"]) {
    const e = make(kind), player = { x: 250, y: e.y };
    const { api } = services({ tileAt: () => 1 });
    tick(e, player, api);
    const expected = kind === "Bat" ? -200 : -60;
    assert.equal(e.vy, expected, `${kind} unsnaps from the floor`);
  }
});

test("fish and the large blowfish patrol at constant height and turn at solid tiles", () => {
  for (const kind of ["Fish", "BigPiranaBlowFish"]) {
    let blocked = true;
    const e = make(kind, { x: 200, y: 300, dir: 1 }), player = { x: 900, y: 300 };
    const { api, calls } = services({ tileAt: tx => blocked && tx >= 7 ? 1 : 0 });
    run(e, player, api, 0.5);
    assert.ok(e.x < 200, `${kind} turns at the wall`);
    assert.equal(e.dir, -1);
    assert.equal(e.y, 300);
    assert.equal(calls.moves, 0, `${kind} patrols without land physics`);
    blocked = false;
    const before = e.x;
    run(e, player, api, 0.5);
    assert.ok(e.x < before, `${kind} keeps swimming after the wall`);
  }
});

test("little spider jumps on its one-second timer and lands back in normal", () => {
  const e = make("LittleSpider", { x: 200, y: 300, dir: 1 }), player = { x: 900, y: 300 };
  const floor = 300, gravity = [];
  const { api } = services({
    moveBody: (b, dt, g) => {
      gravity.push(g); b.x += b.vx * dt; b.vy += g * dt; b.y += b.vy * dt;
      if (b.y >= floor) { b.y = floor; b.vy = 0; b.ground = true; } else b.ground = false;
      b.hitWall = false;
    },
  });
  let jumped = false, landed = false;
  run(e, player, api, 2.5, DT, () => {
    if (e.state === "jump" && e.vy < 0) jumped = true;
    if (jumped && e.state === "normal" && e.ground) landed = true;
  });
  assert.equal(jumped, true);
  assert.equal(landed, true);
  assert.ok(gravity.every(g => g === 900));
});

test("mouse jumps off walls with its recovered jump speed and returns to normal on landing", () => {
  const e = make("Mouse", { x: 200, y: 300, dir: 1 }), player = { x: 260, y: 300 };
  const floor = 300;
  let hits = 1;
  const { api } = services({
    moveBody: (b, dt, g) => {
      b.x += b.vx * dt; b.vy += g * dt; b.y += b.vy * dt;
      if (b.y >= floor) { b.y = floor; b.vy = 0; b.ground = true; } else b.ground = false;
      b.hitWall = hits-- > 0;
    },
  });
  tick(e, player, api);
  assert.equal(e.state, "jump");
  assert.equal(e.vy, -360);
  assert.equal(e.anim.cur.name, "jump");
  let landed = false;
  run(e, player, api, 2, DT, () => { if (e.state === "normal" && e.ground) landed = true; });
  assert.equal(landed, true);
});

test("volcano flower walks, then throws exactly three fireballs when the attack starts", () => {
  const e = make("VolcanoFlower", { x: 200, y: 300, dir: 1 }), player = { x: 900, y: 300 };
  const gravity = [];
  const { api, calls } = services({
    moveBody: (b, dt, g) => {
      gravity.push(g); b.x += b.vx * dt; b.y += b.vy * dt; b.ground = true; b.hitWall = false;
    },
  });
  e.cooldown = 10;
  run(e, player, api, 0.25);
  assert.ok(e.x > 200, "walks forward");
  assert.equal(e.vx, 30);
  assert.equal(calls.shots.length, 0);
  e.cooldown = 0;
  tick(e, player, api);
  assert.equal(e.state, "attack");
  assert.equal(calls.shots.length, 3);
  assert.deepEqual(calls.shots.map(shot => shot.vx), [-120, 0, 120]);
  assert.ok(calls.shots.every(shot => shot.fireball && shot.vy === -240 && shot.gravity === 960));
  run(e, player, api, 1);
  assert.equal(calls.shots.length, 3, "the burst fires once, not every frame");
  run(e, player, api, 1);
  assert.equal(e.state, "normal");
  assert.equal(calls.shots.length, 3);
});

test("big snake waits hidden, emerges on proximity, stops, and fires on its cooldown", () => {
  const e = make("BigSnake", { x: 300, y: 300 }), player = { x: 700, y: 300 };
  const { api, calls } = services();
  run(e, player, api, 0.5);
  assert.equal(e.state, "wait");
  assert.equal(e.visible, false);
  assert.equal(e.y, 300);
  assert.equal(calls.shots.length, 0);
  player.x = 360;
  tick(e, player, api);
  assert.equal(e.visible, true);
  const startY = e.y;
  run(e, player, api, 0.4);
  assert.ok(e.y < startY - 100, "emerges upward");
  run(e, player, api, 0.3);
  const stoppedY = e.y;
  run(e, player, api, 0.5);
  assert.equal(e.y, stoppedY, "stops after the emergence timer");
  run(e, player, api, 3);
  assert.ok(calls.shots.length >= 1 && calls.shots.length <= 3, `shot count ${calls.shots.length}`);
  assert.ok(calls.shots.every(shot => shot.aim === true));
});

test("side column waits for its 3-4s timer, requires the player in front, and fires one fireball per attack", () => {
  const e = make("SideColumn", { x: 400, y: 300, dir: -1 }), player = { x: 200, y: 300 };
  const { api, calls } = services();
  let attacked = false;
  run(e, player, api, 4.2, DT, () => { if (e.state === "attack") attacked = true; });
  assert.equal(attacked, true);
  assert.equal(calls.shots.length, 1);
  assert.equal(calls.shots[0].fireball, true);
  assert.equal(calls.shots[0].aim, undefined);
  run(e, player, api, 0.5);
  assert.equal(calls.shots.length, 1, "Custom fires once");
  const behind = make("SideColumn", { x: 400, y: 300, dir: 1 }), behindCalls = services();
  run(behind, player, behindCalls.api, 4.5);
  assert.equal(behindCalls.calls.shots.length, 0, "does not fire behind itself");
});

test("front column volleys three aimed bullets up, centre and down only once per attack", () => {
  const e = make("FrontColumn", { x: 400, y: 300 }), player = { x: 200, y: 300 };
  const { api, calls } = services();
  run(e, player, api, 4, DT, () => calls.shots.length >= 3);
  assert.equal(calls.shots.length, 3);
  assert.deepEqual(calls.shots.map(shot => shot.angle), [-0.35, 0, 0.35]);
  assert.ok(calls.shots.every(shot => shot.aim === true));
  run(e, player, api, 0.5);
  assert.equal(calls.shots.length, 3, "the Custom flag fires a single volley");
});

test("hive spawns at most four owned bees and resets a 2-3 second timer", () => {
  const e = make("Panal"), player = { x: e.x + 80, y: e.y };
  let active = 3;
  const { api, calls } = services({ nearby: () => active });
  e.cooldown = 0;
  tick(e, player, api);
  assert.equal(calls.spawns.length, 1);
  assert.equal(calls.spawns[0][0], "Bee");
  assert.equal(calls.spawns[0][4], e);
  assert.ok(e.cooldown >= 2 && e.cooldown <= 3, `cooldown ${e.cooldown}`);
  active = 4;
  e.cooldown = 0;
  tick(e, player, api);
  assert.equal(calls.spawns.length, 1, "cap is four live bees");
  assert.ok(e.cooldown >= 2 && e.cooldown <= 3);
});
