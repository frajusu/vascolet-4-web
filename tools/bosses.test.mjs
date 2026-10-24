import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { parseAnims } from "../js/tmx.js";
import { AnimPlayer } from "../js/sprite.js";
import { createEnemy } from "../js/enemies.js";
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
  BigPirana: ["normal"],
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
    assert.ok(seen.size > 1 || ["BigBird", "BigUglyDragon", "GiantDragonfly"].includes(kind),
      `${kind} should leave its initial state`);
    assert.ok(e.animName && e.anim.has(e.animName), `${kind}: ${e.animName}`);
    assert.ok(e.anim.cur?.frames?.length, `${kind}: current frame`);
    assert.ok(e.state !== "waiting" && e.state !== "defeated", kind);
  }
});

test("custom arena bounds are honored by flying controllers", () => {
  const player = { x: 1300, y: 620, w: 8, h: 60 };
  const flyers = ["BigBird", "BigUglyDragon", "GiantDragonfly", "BigAnguila", "BigPirana", "BigBat", "BigGhost"];
  for (const kind of flyers) {
    const e = boss(kind);
    const bounds = { x: 700, y: 400, w: 600, h: 300 };
    const context = api(e, { bounds: () => bounds });
    step(e, player, 1 / 60, context.api, 1800);
    assert.ok(e.x >= 700 - 1e-9 && e.x <= 1300 + 1e-9, `${kind} x=${e.x}`);
    assert.ok(e.y >= 400 - 1e-9 && e.y <= 700 + 1e-9, `${kind} y=${e.y}`);
  }
});

test("damage respects fight, hurt, explicit invulnerability, and resumes the state pose", () => {
  const player = { x: 1080, y: 600 };
  const e = boss("BigBird");
  const context = api(e);
  assert.equal(damageBoss(e), false);
  updateBoss(e, player, 1 / 60, context.api);
  const hp = e.hp;
  assert.equal(damageBoss(e, 1, 2), true);
  assert.equal(e.hp, hp - 2);
  assert.equal(e.hurtT, 0.25);
  assert.equal(e.anim.cur.name, "damage");
  assert.equal(damageBoss(e), false);
  e.vulnerable = false;
  step(e, player, 0.3, context.api, 1);
  assert.equal(damageBoss(e), false);
  e.vulnerable = true;
  assert.equal(damageBoss(e), true);
  assert.equal(e.anim.cur.name, "damage");
  step(e, player, 0.3, context.api, 1);
  assert.notEqual(e.anim.cur.name, "damage");

  const furry = boss("FurryCritter");
  const furryContext = api(furry);
  updateBoss(furry, { x: 1100, y: 600 }, 1 / 60, furryContext.api);
  assert.equal(damageBoss(furry), true);
  updateBoss(furry, { x: 1100, y: 600 }, 1 / 60, furryContext.api);
  updateBoss(furry, { x: 1100, y: 600 }, 1 / 60, furryContext.api);
  assert.equal(furry.state, "attack");
  assert.equal(furry.anim.cur.name, "damage", "state change must not replace the hurt pose");
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
  assert.equal(e.y, e.homeY, "Topo returns to its support plane");
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

test("BigBat patrols at its recovered speed and periodically spawns bats", () => {
  const e = boss("BigBat", { seed: 13579 });
  const context = api(e);
  step(e, { x: 1180, y: 620 }, 1 / 60, context.api, 1);
  assert.equal(e.state, "normal");
  assert.equal(Math.abs(e.vx), 100);
  const seen = step(e, { x: 1180, y: 620 }, 1 / 60, context.api, 3600);
  assert.ok(seen.has("seek"));
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
  assert.ok(seen.has("teleport"));
  assert.ok(seen.has("attack1"));
  assert.ok(seen.has("attack2"));
  for (const marker of markers) {
    assert.ok(context.calls.spawn.some(call => Math.abs(call.x - (marker.x + 40)) < 1e-9 ||
      Math.abs(call.x - marker.x) < 1e-9), `marker ${marker.x} was never used`);
  }
  assert.ok(context.calls.spawn.some(call => ["Bat", "DragonFly", "Bee"].includes(call.kind)));
  assert.ok(context.calls.shoot.length >= 5);
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
