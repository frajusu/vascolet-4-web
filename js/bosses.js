// Later boss controllers. The state names and constants come from the
// symbolized native state machines in analysis/states2-behavior.txt and
// analysis/states3-behavior.txt. Timing that could not be recovered exactly is
// calibrated and marked in docs/native-boss-evidence.md.
const TAU = Math.PI * 2;
const DEFAULT_DT = 1 / 60;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const sign = v => (v < 0 ? -1 : 1);

export const BOSS_KINDS = new Set([
  "TopoNinja", "BigBird", "FurryCritter", "BigUglyDragon", "GiantDragonfly",
  "BigAnguila", "BigPirana", "BigBat", "BigGhost", "BigSpider", "Malmark2",
]);

export const BOSS_MINIONS = Object.freeze({
  TopoNinja: "TopoNinjaStar",
  BigBird: null,
  FurryCritter: "FurryCritterChild",
  BigUglyDragon: null,
  GiantDragonfly: null,
  BigAnguila: "Anguila",
  BigPirana: "BigPiranaBlowFish",
  BigBat: "Bat",
  BigGhost: null,
  BigSpider: "LittleSpider",
  Malmark2: "Bat",
});

const CONFIG = Object.freeze({
  TopoNinja: { hp: 30, w: 80, h: 100, gravity: 1800, speed: 120, fly: false, initial: "stand" },
  BigBird: { hp: 25, w: 80, h: 40, gravity: 0, speed: 320, fly: true, initial: "normal" },
  FurryCritter: { hp: 100, w: 124, h: 80, gravity: 0, speed: 60, fly: false, initial: "normal" },
  BigUglyDragon: { hp: 30, w: 120, h: 56, gravity: 0, speed: 120, fly: true, initial: "normal" },
  GiantDragonfly: { hp: 25, w: 120, h: 56, gravity: 0, speed: 240, fly: true, initial: "normal" },
  BigAnguila: { hp: 50, w: 128, h: 32, gravity: 0, speed: 60, fly: true, initial: "normal" },
  BigPirana: { hp: 30, w: 92, h: 96, gravity: 0, speed: 60, fly: true, initial: "normal" },
  BigBat: { hp: 30, w: 90, h: 42, gravity: 0, speed: 100, fly: true, initial: "normal" },
  BigGhost: { hp: 30, w: 62, h: 64, gravity: 0, speed: 60, fly: true, initial: "normal" },
  BigSpider: { hp: 70, w: 92, h: 108, gravity: 0, speed: 60, fly: false, initial: "normal" },
  Malmark2: { hp: 100, w: 30, h: 120, gravity: 0, speed: 60, fly: false, initial: "normal" },
});

const THINK = Object.freeze({
  TopoNinja: [0.1, 1.4], BigBird: [0.8, 1.8], FurryCritter: [2.5, 3.5],
  BigUglyDragon: [1.0, 2.0], GiantDragonfly: [0.8, 1.5], BigAnguila: [1.0, 2.0],
  BigPirana: [1.5, 2.5], BigBat: [2.4, 3.6], BigGhost: [2.5, 3.0],
  BigSpider: [0.8, 1.2], Malmark2: [2.0, 3.0],
});

const ANIMATION = Object.freeze({
  TopoNinja: {
    waiting: "stand", stand: "stand", normal: "stand", prepareJump: "stand",
    jump: "roll", kick: "kick", attack: "shot",
  },
  BigBird: { waiting: "normal", normal: "normal", attack: "normal" },
  FurryCritter: {
    waiting: "normal", normal: "normal", seek: "moving", attack: "attack", smash: "smash",
  },
  BigUglyDragon: { waiting: "normal", normal: "normal", attack: "attack" },
  GiantDragonfly: { waiting: "normal", normal: "normal", attack: "normal" },
  BigAnguila: { waiting: "normal", normal: "normal", attack: "attack" },
  BigPirana: { waiting: "normal", normal: "normal", attack: "normal" },
  BigBat: { waiting: "normal", normal: "normal", seek: "normal" },
  BigGhost: { waiting: "normal", normal: "normal", attack: "normal" },
  BigSpider: {
    waiting: "normal", normal: "normal", down: "normal", attack: "shooting", up: "normal",
  },
  Malmark2: {
    waiting: "normal", normal: "normal", teleport: "normal",
    attack1: "attack1", attack2: "attack2",
  },
});

function random(e) {
  let x = (e.seed >>> 0) || 0x9e3779b9;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  e.seed = x >>> 0 || 0x9e3779b9;
  return e.seed / 4294967296;
}

function between(e, lo, hi) { return lo + (hi - lo) * random(e); }
function chance(e, p) { return random(e) < p; }
function targetOf(e, player) {
  return player && Number.isFinite(player.x) && Number.isFinite(player.y)
    ? player : { x: e.homeX, y: e.homeY };
}

function hasAnimation(e, name) {
  return !!name && typeof e.anim?.has === "function" && e.anim.has(name);
}

function play(e, names, restart = false) {
  if (!e.anim || typeof e.anim.set !== "function") return null;
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    if (!hasAnimation(e, name)) continue;
    if (restart || e.anim.cur?.name !== name) e.anim.set(name, { restart });
    e.animName = name;
    e.cur = e.anim.frame;
    return name;
  }
  return null;
}

function playState(e, state = e.state, restart = false) {
  if ((e.hurtT || 0) > 0) return null;
  const names = ANIMATION[e.kind] || {};
  return play(e, names[state] || names.normal || "normal", restart);
}

function enter(e, state, restartAnimation = true) {
  if (e.state !== state || e.stateTime > 0) e.stateTime = 0;
  e.state = state;
  e.fired = 0;
  e.actionDone = false;
  if (restartAnimation) playState(e, state, true);
}

function resumeAnimation(e) {
  if ((e.hurtT || 0) > 0 || e.state === "dying" || e.state === "defeated") return;
  playState(e);
}

function animation(e, dt) {
  if (!e.anim || typeof e.anim.update !== "function") return;
  e.anim.update(dt);
  e.cur = e.anim.frame;
  if (typeof e.anim.drainEvents === "function") e.anim.drainEvents();
}

function move(e, dt, api, gravity = 0) {
  if (typeof api.moveBody === "function") {
    api.moveBody(e, dt, gravity);
    return;
  }
  const previousY = e.y;
  e.vy += gravity * dt;
  e.x += e.vx * dt;
  e.y += e.vy * dt;
  e.ground = false;
  // Tests and small embedders may omit the shared collision engine. Snap to
  // the spawn plane so grounded bosses cannot fall forever through empty maps.
  if (gravity > 0 && e.vy >= 0 && previousY <= e.homeY + 1 && e.y >= e.homeY) {
    e.y = e.homeY; e.vy = 0; e.ground = true;
  }
}

function normalizeBounds(value) {
  if (!value) return null;
  if (Array.isArray(value) && value.length >= 4) {
    return { minX: value[0], minY: value[1], maxX: value[2], maxY: value[3] };
  }
  if (Number.isFinite(value.x) && Number.isFinite(value.w)) {
    return {
      minX: value.x, minY: value.y,
      maxX: value.x + value.w, maxY: value.y + value.h,
    };
  }
  const minX = value.minX ?? value.left ?? -Infinity;
  const maxX = value.maxX ?? value.right ?? Infinity;
  const minY = value.minY ?? value.top ?? -Infinity;
  const maxY = value.maxY ?? value.bottom ?? Infinity;
  if (![minX, maxX, minY, maxY].some(Number.isFinite)) return null;
  return { minX, maxX, minY, maxY };
}

function arena(e, api) {
  let custom = null;
  try {
    custom = typeof api.bounds === "function" ? api.bounds(e) : api.bounds;
  } catch { custom = null; }
  const normalized = normalizeBounds(custom);
  if (normalized) return normalized;
  if (!CONFIG[e.kind]?.fly) return null;
  return {
    minX: e.homeX - 640, maxX: e.homeX + 640,
    minY: e.homeY - 260, maxY: e.homeY + 260,
  };
}

function contain(e, api) {
  const b = arena(e, api);
  if (!b) return;
  if (e.x < b.minX) { e.x = b.minX; if (e.vx < 0) e.vx = 0; }
  else if (e.x > b.maxX) { e.x = b.maxX; if (e.vx > 0) e.vx = 0; }
  if (e.y < b.minY) { e.y = b.minY; if (e.vy < 0) e.vy = 0; }
  else if (e.y > b.maxY) { e.y = b.maxY; if (e.vy > 0) e.vy = 0; }
}

function face(e, player) {
  const p = targetOf(e, player);
  if (Math.abs(p.x - e.x) > 2) e.dir = sign(p.x - e.x);
}

function seek(e, player, speed, bothAxes = false) {
  const p = targetOf(e, player);
  const dx = p.x - e.x, dy = p.y - e.y;
  if (bothAxes) {
    const length = Math.hypot(dx, dy);
    if (length > 8) {
      e.vx = dx / length * speed;
      e.vy = dy / length * speed;
    } else { e.vx = 0; e.vy = 0; }
  } else {
    e.vx = Math.abs(dx) > 8 ? sign(dx) * speed : 0;
    e.vy = 0;
  }
  if (Math.abs(dx) > 2) e.dir = sign(dx);
}

function away(e, player, speed) {
  const p = targetOf(e, player);
  const dx = p.x - e.x;
  e.vx = Math.abs(dx) > 2 ? -sign(dx) * speed : e.dir * speed;
}

function shoot(e, api, options = {}) {
  if (typeof api.shoot === "function") api.shoot(e, options);
}

function spawn(e, api, kind, x, y, dir = e.dir) {
  if (!kind) return;
  if (typeof api.spawn === "function") api.spawn(kind, x, y, dir, e);
}

function nearby(e, api, kind) {
  if (typeof api.nearby !== "function") return 0;
  const value = api.nearby(kind, e);
  if (Array.isArray(value)) return value.length;
  return Math.max(0, finite(value, 0));
}

function inCamera(e, api) {
  if (typeof api.inCamera !== "function") return true;
  return !!api.inCamera(e);
}

function init(e) {
  if (e.bossInitialized) return false;
  const config = CONFIG[e.kind] || CONFIG.TopoNinja;
  e.bossInitialized = true;
  e.isBoss = true;
  e.boss = true;
  e.t = finite(e.t, 0);
  e.stateTime = 0;
  e.hurtT = 0;
  e.invulnerableT = finite(e.invulnerableT, 0);
  e.hp = finite(e.hp, finite(e.maxhp, config.hp));
  e.maxhp = finite(e.maxhp, Math.max(e.hp, config.hp));
  e.w = finite(e.w, config.w);
  e.h = finite(e.h, config.h);
  e.gravity = finite(e.gravity, config.gravity);
  e.homeX = finite(e.homeX, finite(e.x, 0));
  e.homeY = finite(e.homeY, finite(e.y, 0));
  e.x = finite(e.x, e.homeX);
  e.y = finite(e.y, e.homeY);
  e.vx = finite(e.vx, 0);
  e.vy = finite(e.vy, 0);
  e.dir = e.dir === 1 || e.dir === -1 ? e.dir : -1;
  e.seed = (e.seed >>> 0) || 0x9e3779b9;
  e.fight = e.fight === true;
  e.defeated = e.defeated === true;
  e.bossStarted = false;
  e.bossDefeatedSent = false;
  e.hurtAnimation = false;
  e.animName = e.anim?.cur?.name || null;
  e.cur = e.anim?.frame ?? e.cur ?? null;
  e.state = e.state === "dying" || e.state === "defeated" ? e.state
    : e.fight ? (config.initial || "normal") : "waiting";
  const [thinkLo, thinkHi] = THINK[e.kind] || [0.4, 1.2];
  e.thinkT = between(e, thinkLo, thinkHi);
  e.actionT = between(e, 0.5, 1.5);
  e.shootT = between(e, 0.4, 0.9);
  e.spawnT = e.kind === "BigBat" ? 5 : 1.5;
  e.nextSpot = 0;
  playState(e, e.state, true);
  return true;
}

function beginFight(e, player, api) {
  e.fight = true;
  const initial = CONFIG[e.kind]?.initial || "normal";
  enter(e, initial);
  if (!e.bossStarted) {
    e.bossStarted = true;
    api.bossStart?.(e);
  }
  face(e, player);
}

function beginDeath(e) {
  e.hp = 0;
  e.state = "dying";
  e.stateTime = 0;
  e.vx = e.vy = 0;
  e.gravity = 0;
  e.contact = false;
  e.hurtT = 0;
  e.invulnerableT = Infinity;
  e.deathBoomT = 0;
  e.defeated = false;
  e.bossDefeatedSent = false;
  play(e, ["dead", "normal"], true);
}

function updateDeath(e, dt, api) {
  e.vx = e.vy = 0;
  e.gravity = 0;
  const regular = Math.min(30, Math.floor(Math.min(e.stateTime, 3) / 0.1 + 1e-9));
  while (e.deathBoomT < regular) {
    e.deathBoomT++;
    api.explosion?.(e);
  }
  if (e.stateTime >= 4 && !e.bossDefeatedSent) {
    for (let i = 0; i < 5; i++) api.explosion?.(e);
    api.shake?.(0.2);
    e.state = "defeated";
    e.defeated = true;
    e.contact = false;
    e.bossDefeatedSent = true;
    api.bossDefeated?.(e);
  }
}

export function damageBoss(e, direction = 1, damage = 1) {
  if (!e || !BOSS_KINDS.has(e.kind) || e.hp <= 0 || e.defeated ||
    e.state === "dying" || e.state === "defeated") return false;
  if (e.fight !== true) return false;
  if (e.state === "waiting") return false;
  if (e.vulnerable === false) return false;
  if ((e.hurtT || 0) > 0 || (e.invulnerableT || 0) > 0) return false;
  const amount = Number.isFinite(damage) && damage > 0 ? damage : 1;
  e.hp = Math.max(0, finite(e.hp, 1) - amount);
  e.hurtT = Math.max(finite(e.hurtT, 0), 0.25);
  e.lastHitDirection = direction;
  if (e.hp <= 0) beginDeath(e);
  else if (hasAnimation(e, "damage")) {
    e.hurtAnimation = true;
    play(e, "damage", true);
  }
  return true;
}

function updateCommon(e, dt, api) {
  e.stateTime += dt;
  e.fight = true;
  if (e.hp <= 0) {
    if (e.state !== "dying") beginDeath(e);
    updateDeath(e, dt, api);
    return "death";
  }
  if (e.state === "defeated") return "death";
  if (e.hurtT > 0) {
    e.hurtT = Math.max(0, e.hurtT - dt);
    if (e.hurtT === 0 && e.hurtAnimation) {
      e.hurtAnimation = false;
      resumeAnimation(e);
    }
  }
  return null;
}

function topo(e, player, dt, api) {
  face(e, player);
  if (e.state === "stand") {
    e.vx = 0;
    if (e.stateTime >= e.thinkT) {
      const roll = random(e);
      if (roll < 0.34) enter(e, "kick");
      else if (roll < 0.67) enter(e, "prepareJump");
      else enter(e, "attack");
    }
  } else if (e.state === "prepareJump") {
    e.vx = 0;
    if (e.stateTime >= 0.24) {
      enter(e, "jump");
      e.vy = -960;
      e.vx = e.dir * between(e, 120, 220);
      e.ground = false;
    }
  } else if (e.state === "jump") {
    move(e, dt, api, Math.max(e.gravity, 1800));
    if (e.ground && e.stateTime > 0.08) {
      enter(e, "stand");
      e.thinkT = between(e, 0.1, 1.4);
    }
  } else if (e.state === "kick") {
    e.vx = e.stateTime < 0.18 ? e.dir * 180 : 0;
    move(e, dt, api, e.gravity);
    if (e.stateTime >= 0.58) {
      enter(e, "stand");
      e.thinkT = between(e, 0.1, 1.4);
    }
  } else if (e.state === "attack") {
    e.vx = 0;
    const shots = [0.14, 0.4, 0.66];
    for (let i = 0; i < shots.length; i++) {
      if (!(e.fired & (1 << i)) && e.stateTime >= shots[i]) {
        e.fired |= 1 << i;
        shoot(e, api, { aim: true, angle: (i - 1) * 0.22, library:"TopoNinja", animation:"star", endAnimation:"starDead", terrain:true });
      }
    }
    if (e.stateTime >= 1.05) {
      enter(e, "stand");
      e.thinkT = between(e, 0.1, 1.4);
    }
  } else if (e.state === "normal") {
    enter(e, "stand");
  }
}

function bigBird(e, player, dt, api) {
  face(e, player);
  if (e.state === "attack") {
    e.vx = e.dir * 320;
    e.vy = clamp((targetOf(e, player).y - e.y) * 0.8, -120, 120);
    move(e, dt, api, 0);
    contain(e, api);
    if (e.stateTime >= 1.15) {
      enter(e, "normal");
      e.thinkT = between(e, 0.8, 1.8);
      e.dir *= -1;
    }
  } else {
    e.vx = 0; e.vy = 0;
    e.y = e.homeY + Math.sin(e.t * 2.5) * 5;
    if (e.stateTime >= e.thinkT) {
      enter(e, "attack");
      e.dir = sign(targetOf(e, player).x - e.x) || e.dir;
    }
  }
}

function furry(e, player, dt, api) {
  face(e, player);
  const dx = targetOf(e, player).x - e.x;
  if (e.state === "normal") {
    e.vx = 0;
    if (e.stateTime >= e.thinkT || Math.abs(dx) < 180) {
      enter(e, "seek");
      e.thinkT = between(e, 0.7, 1.1);
    }
  } else if (e.state === "seek") {
    e.vx = Math.abs(dx) > 24 ? sign(dx) * 60 : 0;
    move(e, dt, api, 0);
    contain(e, api);
    if (e.stateTime >= e.thinkT || Math.abs(dx) < 160) {
      if (chance(e, 0.55)) enter(e, "attack");
      else enter(e, "smash");
      e.thinkT = between(e, 0.7, 1.1);
    }
  } else if (e.state === "attack") {
    e.vx = 0;
    if (!(e.fired & 1) && e.stateTime >= 0.5) {
      e.fired |= 1;
      shoot(e, api, { fireball: true, aim: true });
    }
    if (e.stateTime >= 1.65) enter(e, "normal");
  } else if (e.state === "smash") {
    e.vx = e.stateTime < 0.3 ? e.dir * 60 : 0;
    move(e, dt, api, 0);
    for (const [bit, at] of [[1, 0.32], [2, 0.58]]) {
      if (!(e.fired & bit) && e.stateTime >= at && nearby(e, api, "FurryCritterChild") < 2) {
        e.fired |= bit;
        spawn(e, api, "FurryCritterChild", e.x - e.dir * 30 + bit * 20, e.y, e.dir);
        api.shake?.(0.2);
      }
    }
    if (e.stateTime >= 1.45) enter(e, "normal");
  }
}

function uglyDragon(e, player, dt, api) {
  face(e, player);
  if (e.state === "attack") {
    e.vx = e.vy = 0;
    for (const [bit, at] of [[1, 0.08], [2, 0.36], [4, 0.64]]) {
      if (!(e.fired & bit) && e.stateTime >= at) {
        e.fired |= bit;
        shoot(e, api, { fireball: true, aim: true });
      }
    }
    if (e.stateTime >= 1.05) {
      enter(e, "normal");
      e.thinkT = between(e, 1.0, 2.0);
    }
  } else {
    seek(e, player, 120, true);
    move(e, dt, api, 0);
    contain(e, api);
    if (e.stateTime >= e.thinkT) enter(e, "attack");
  }
}

function dragonfly(e, player, dt, api) {
  face(e, player);
  const dx = targetOf(e, player).x - e.x;
  if (e.state === "attack") {
    e.vx = e.dir * 240;
    e.vy = clamp((targetOf(e, player).y - e.y) * 1.5, -120, 120);
    move(e, dt, api, 0);
    contain(e, api);
    for (const [bit, at] of [[1, 0.08], [2, 0.32], [4, 0.58]]) {
      if (!(e.fired & bit) && e.stateTime >= at) {
        e.fired |= bit;
        shoot(e, api, { aim: true, angle: (bit - 3) * 0.18 });
      }
    }
    if (e.stateTime >= 0.95) {
      enter(e, "normal");
      e.thinkT = between(e, 0.8, 1.5);
    }
  } else {
    if (Math.abs(dx) < 180) away(e, player, 320);
    else seek(e, player, 120, true);
    move(e, dt, api, 0);
    contain(e, api);
    if (e.stateTime >= e.thinkT) enter(e, "attack");
  }
}

function anguila(e, player, dt, api) {
  face(e, player);
  if (e.state === "attack") {
    e.vx = e.vy = 0;
    for (const [bit, at, vy] of [[1, 0.08, -50], [2, 0.28, 50]]) {
      if (!(e.fired & bit) && e.stateTime >= at) {
        e.fired |= bit;
        shoot(e, api, { vx: e.dir * 240, vy });
      }
    }
    if (e.stateTime >= 1.0) {
      enter(e, "normal");
      e.thinkT = between(e, 1.0, 2.0);
    }
  } else {
    const p = targetOf(e, player);
    e.vx = Math.abs(p.x - e.x) > 8 ? sign(p.x - e.x) * 60 : 0;
    e.vy = clamp((p.y - e.y) * 1.2, -60, 60);
    move(e, dt, api, 0);
    contain(e, api);
    if (nearby(e, api, "Anguila") < 2 && (e.spawnT -= dt) <= 0) {
      spawn(e, api, "Anguila", e.x - e.dir * 80, e.y + 8, e.dir);
      e.spawnT = 3.5;
    }
    if (e.stateTime >= e.thinkT) enter(e, "attack");
  }
}

function pirana(e, player, dt, api) {
  face(e, player);
  if (e.state === "attack") {
    if (!(e.fired & 1) && e.stateTime >= 0.18) {
      e.fired |= 1;
      const available = Math.max(0, 5 - nearby(e, api, "BigPiranaBlowFish"));
      for (let i = -2; i <= 2 && i + 2 < available; i++) {
        spawn(e, api, "BigPiranaBlowFish",
          e.x + e.dir * 24 + i * 18, e.y - 16 + Math.abs(i) * 12, sign(i || e.dir));
      }
    }
    e.vx = e.stateTime > 0.45 ? e.dir * 100 : 0;
    move(e, dt, api, 0);
    contain(e, api);
    if (e.stateTime >= 1.25) {
      enter(e, "normal");
      e.thinkT = between(e, 1.3, 2.3);
    }
  } else {
    seek(e, player, 60, true);
    move(e, dt, api, 0);
    contain(e, api);
    if (e.stateTime >= e.thinkT) enter(e, "attack");
  }
}

function bigBat(e, player, dt, api) {
  const p = targetOf(e, player);
  if (e.state === "seek") {
    face(e, player);
    seek(e, player, 60, true);
    move(e, dt, api, 0);
    contain(e, api);
    if (e.stateTime >= 1.0) {
      enter(e, "normal");
      e.thinkT = between(e, 2.4, 3.6);
    }
  } else {
    e.vx = e.dir * 100;
    e.vy = Math.cos(e.t * 3.2) * 24;
    move(e, dt, api, 0);
    contain(e, api);
    e.spawnT -= dt;
    if (e.spawnT <= 0 && nearby(e, api, "Bat") < 3) {
      spawn(e, api, "Bat", e.x, e.y + 12, chance(e, 0.5) ? 1 : -1);
      e.spawnT = 5;
    }
    if (e.stateTime >= e.thinkT) {
      enter(e, "seek");
      e.dir = sign(p.x - e.x) || e.dir;
    }
  }
}

function ghost(e, player, dt, api) {
  face(e, player);
  const p = targetOf(e, player);
  const distance = Math.hypot(p.x - e.x, p.y - e.y);
  if (e.state === "attack") {
    if (e.stateTime < 0.35) {
      e.vx = -e.dir * 120;
      e.vy = 0;
    } else {
      e.vx = e.dir * 240;
      e.vy = clamp((p.y - e.y) * 1.2, -120, 120);
    }
    move(e, dt, api, 0);
    contain(e, api);
    for (const [bit, at] of [[1, 0.2], [2, 0.58]]) {
      if (!(e.fired & bit) && e.stateTime >= at) {
        e.fired |= bit;
        shoot(e, api, { aim: true });
      }
    }
    if (e.stateTime >= 1.0) {
      enter(e, "normal");
      e.shootT = between(e, 0.5, 1.0);
    }
  } else {
    if (distance < 200) away(e, player, 60);
    else seek(e, player, 120, true);
    move(e, dt, api, 0);
    contain(e, api);
    e.shootT -= dt;
    if (e.shootT <= 0) {
      shoot(e, api, { aim: true });
      e.shootT = between(e, 0.5, 1.0);
    }
    if (e.stateTime >= 3.0) enter(e, "attack");
  }
}

function spider(e, player, dt, api) {
  face(e, player);
  if (e.state === "normal") {
    e.vx = e.vy = 0;
    if (e.stateTime >= 1.0) enter(e, "down");
  } else if (e.state === "down") {
    e.vy = 240;
    e.vx = 0;
    move(e, dt, api, 0);
    if (e.y >= e.homeY + 192 || e.stateTime >= 1.2) {
      if (e.y > e.homeY + 192) e.y = e.homeY + 192;
      enter(e, "attack");
      e.shootT = between(e, 0.2, 0.5);
    }
  } else if (e.state === "attack") {
    e.vx = e.vy = 0;
    e.shootT -= dt;
    if (e.shootT <= 0) {
      shoot(e, api, { aim: true });
      e.shootT = between(e, 0.2, 0.5);
    }
    if (!(e.fired & 1) && e.stateTime >= 0.2 && nearby(e, api, "LittleSpider") < 1) {
      e.fired |= 1;
      spawn(e, api, "LittleSpider", e.x, e.y + 24, e.dir);
    }
    if (e.stateTime >= 2.4) enter(e, "up");
  } else if (e.state === "up") {
    e.vx = 0;
    e.vy = -60;
    move(e, dt, api, 0);
    if (e.y <= e.homeY) {
      e.y = e.homeY;
      enter(e, "normal");
    }
  }
}

function markerList(e, api) {
  let value = api.markers;
  if (typeof value === "function") value = value(e);
  return Array.isArray(value) ? value.filter(marker => Number.isFinite(marker?.x) && Number.isFinite(marker?.y)) : [];
}

function markerPoint(marker) {
  const width = Number.isFinite(marker.w) ? marker.w : Number.isFinite(marker.width) ? marker.width : 0;
  const height = Number.isFinite(marker.h) ? marker.h : Number.isFinite(marker.height) ? marker.height : 0;
  return {
    x: marker.x + (width ? width / 2 : (marker.props ? 16 : 0)),
    y: marker.y + (height ? height - 2 : (marker.props ? 30 : 0)),
  };
}

function malmark(e, player, dt, api) {
  face(e, player);
  if (e.state === "normal") {
    e.vx = e.vy = 0;
    if (!(e.fired & 1) && e.stateTime >= 0.85) {
      e.fired |= 1;
      shoot(e, api, { fireball: true, aim: true });
    }
    if (e.stateTime >= e.thinkT) enter(e, "teleport");
  } else if (e.state === "teleport") {
    e.vx = e.vy = 0;
    if (!e.actionDone && e.stateTime >= 0.2) {
      e.actionDone = true;
      const spots = markerList(e, api);
      if (spots.length) {
        const index = e.nextSpot % spots.length;
        e.nextSpot = (e.nextSpot + 1) % spots.length;
        const point = markerPoint(spots[index]);
        e.x = point.x; e.y = point.y;
        contain(e, api);
        e.prevX = e.x; e.prevY = e.y;
      }
      const kinds = ["Bat", "DragonFly", "Bee"];
      if (nearby(e, api, kinds[e.nextSpot % kinds.length]) < 3) {
        spawn(e, api, kinds[e.nextSpot % kinds.length], e.x + 40, e.y - 30,
          chance(e, 0.5) ? 1 : -1);
      }
      api.explosion?.(e);
    }
    if (e.stateTime >= 0.5) enter(e, "attack1");
  } else if (e.state === "attack1") {
    e.vx = e.vy = 0;
    if (!(e.fired & 1) && e.stateTime >= 0.15) {
      e.fired |= 1;
      shoot(e, api, { fireball: true, aim: true });
    }
    if (e.stateTime >= 0.9) enter(e, "attack2");
  } else if (e.state === "attack2") {
    e.vx = e.vy = 0;
    if (!(e.fired & 1) && e.stateTime >= 0.15) {
      e.fired |= 1;
      shoot(e, api, { fireball: true, aim: true, angle: -0.2 });
      shoot(e, api, { fireball: true, aim: true, angle: 0.2 });
    }
    if (e.stateTime >= 1.1) {
      enter(e, "normal");
      e.thinkT = between(e, 2.0, 3.0);
    }
  }
}

const CONTROLLERS = Object.freeze({
  TopoNinja: topo,
  BigBird: bigBird,
  FurryCritter: furry,
  BigUglyDragon: uglyDragon,
  GiantDragonfly: dragonfly,
  BigAnguila: anguila,
  BigPirana: pirana,
  BigBat: bigBat,
  BigGhost: ghost,
  BigSpider: spider,
  Malmark2: malmark,
});

export function updateBoss(e, player, dt, api = {}) {
  if (!e || !BOSS_KINDS.has(e.kind)) return false;
  init(e);
  const step = Number.isFinite(dt) && dt >= 0 ? dt : DEFAULT_DT;
  e.t += step;
  e.invulnerableT = Math.max(0, finite(e.invulnerableT, 0) - step);
  if (e.state === "defeated") {
    animation(e, step);
    return true;
  }
  if (e.state === "dying") {
    e.stateTime += step;
    updateDeath(e, step, api);
    animation(e, step);
    return true;
  }
  if (!e.fight) {
    if (!inCamera(e, api)) {
      animation(e, step);
      return true;
    }
    beginFight(e, player, api);
  } else if (!e.bossStarted) {
    e.bossStarted = true;
    api.bossStart?.(e);
  }
  const death = updateCommon(e, step, api);
  if (death) {
    animation(e, step);
    return true;
  }
  const controller = CONTROLLERS[e.kind];
  controller(e, player, step, api);
  animation(e, step);
  return true;
}
