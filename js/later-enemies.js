// Explicit behavior families for later-map actors. Descriptor/art selection is
// recovered; timer/steering approximations are listed separately in the docs.
import { enemyRandom } from "./enemy-profiles.js";

const TILE = 32;
const SOLID = 1;
const approach = (v, target, delta) => v + Math.sign(target - v) * Math.min(Math.abs(target - v), delta);
const animation = (e, name, restart = false) => {
  if (e.anim?.has(name)) { e.anim.set(name, { restart }); e.cur = e.anim.frame; }
};
const enter = (e, state, name, restart = true) => {
  e.state = state; e.stateTime = 0;
  if (name) animation(e, name, restart);
};
const face = (e, dx) => { e.dir = Math.sign(dx) || e.dir; };
const distance = (dx, dy) => Math.hypot(dx, dy);
const solid = (tileAt, x, y) => Boolean(tileAt && (tileAt(Math.floor(x / TILE), Math.floor(y / TILE)) & SOLID));
const supported = (tileAt, x, y) => Boolean(tileAt && (tileAt(Math.floor(x / TILE), Math.floor(y / TILE)) & (SOLID | 2)));
const flags = e => e.anim?.frame?.flags || [];
const inWater = (e, api) => typeof api.waterAt === "function" ? api.waterAt(e.x, e.y - e.h / 2) !== false : true;

function flyer(e, player, dt, api, dx, dy, { accel = e.acceleration || 300, targetY = player.y - 20 } = {}) {
  const tx = dx, ty = targetY - e.y;
  e.vx = approach(e.vx, Math.abs(tx) < 8 ? 0 : Math.sign(tx) * e.speed, accel * dt);
  e.vy = approach(e.vy, Math.abs(ty) < 8 ? 0 : Math.sign(ty) * e.speed, accel * dt);
  // Flying subjects keep their own motion and never enter terrestrial physics.
  e.x += e.vx * dt; e.y += e.vy * dt;
  e.hitWall = false;
  e.ground = solid(api.tileAt, e.x, e.y + 1);
}

function swimPatrol(e, dt, api) {
  e.vx = e.dir * e.speed; e.vy = 0;
  if (solid(api.tileAt, e.x + e.dir * (e.w / 2 + 2), e.y - e.h / 2)) {
    e.dir *= -1; e.vx = e.dir * e.speed;
  } else e.x += e.vx * dt;
}

function piranha(e, player, dt, api, dx, dy) {
  const wet = inWater(e, api);
  e.water = wet;
  if (!wet && e.state !== "waterOut") { enter(e, "waterOut", "pain"); return; }
  if (wet && e.state === "waterOut") { enter(e, "normal", "normal"); return; }

  if (e.state === "waterOut") {
    face(e, dx);
    e.vx = approach(e.vx, e.dir * e.speed, 240 * dt);
    api.moveBody(e, dt, 400);
    if (e.ground) e.vy = -120;
    return;
  }

  if (e.state === "attack") {
    face(e, dx);
    if (e.stateTime < 0.5) {
      e.vx = approach(e.vx, -e.dir * 30, 240 * dt);
      e.vy = approach(e.vy, 0, 240 * dt);
    } else {
      const seek = e.attackSpeed ?? 180;
      e.vx = approach(e.vx, e.dir * seek, 400 * dt);
      e.vy = approach(e.vy, Math.abs(dy) < 8 ? 0 : Math.sign(dy) * seek, 400 * dt);
    }
    const nx = e.x + e.vx * dt, ny = e.y + e.vy * dt;
    if (solid(api.tileAt, nx + Math.sign(e.vx) * e.w / 2, ny - e.h / 2)) { e.dir *= -1; e.vx *= -1; }
    else { e.x = nx; e.y = ny; }
    if (e.stateTime >= 1) enter(e, "normal", "normal");
    return;
  }

  if (e.stateTime >= 2) e.stateTime = 0;
  if (e.stateTime >= 1 && distance(dx, dy) < 128) { face(e, dx); enter(e, "attack", "attack"); e.vx = -e.dir * 30; return; }
  e.vx = e.dir * e.speed; e.vy = 0;
  const nx = e.x + e.vx * dt;
  if (solid(api.tileAt, nx + e.dir * e.w / 2, e.y - e.h / 2)) e.dir *= -1;
  else e.x = nx;
}

function blowfish(e, player, dt, api, dx, dy) {
  face(e, dx);
  if (e.state === "normal" || e.state === undefined) {
    e.vx = e.vy = 0;
    if (distance(dx, dy) < 200) enter(e, "activated", "activated");
    return;
  }
  if (e.state === "activated") {
    const seek = e.speed;
    e.vx = approach(e.vx, Math.abs(dx) < 8 ? 0 : Math.sign(dx) * seek, 50 * dt);
    e.vy = approach(e.vy, Math.abs(dy) < 8 ? 0 : Math.sign(dy) * seek, 50 * dt);
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (distance(dx, dy) > 250) {
      e.vx = e.vy = 0;
      enter(e, "deactivated", e.anim?.has("sleep") ? "sleep" : "normal");
    }
    return;
  }
  api.moveBody(e, dt, 400);
  if (e.stateTime > 1) enter(e, "normal", "normal");
}

function fallingTrap(e, player, dt, api, dx, dy) {
  if (!e.trapReady) {
    e.trapReady = true; e.state = "stale"; e.stateTime = 0;
    e.vx = e.vy = 0; e.visible = false;
  }
  if (e.state === "stale") {
    e.vx = e.vy = 0; e.visible = false;
    if (distance(dx, dy) < (e.triggerRange || 250)) {
      e.visible = true; enter(e, "appear", "appear");
    }
    return;
  }
  if (e.state === "appear") {
    e.vx = e.vy = 0;
    if (e.anim?.finished || (!e.anim?.has("appear") && e.stateTime > 0.5)) enter(e, "falling", "normal");
    return;
  }
  if (e.state === "disappear") {
    e.vx = e.vy = 0;
    if (e.anim?.finished || (!e.anim?.has("disappear") && e.stateTime > 0.5)) {
      e.visible = false; e.removed = true; e.hp = 0;
    }
    return;
  }
  if (e.stateTime > 0.5) {
    e.vy = Math.min((e.vy || 0) + 960 * dt, 900);
    e.vx = approach(e.vx, Math.sign(dx) * 180, 240 * dt);
    e.x += e.vx * dt; e.y += e.vy * dt;
  }
  if (e.stateTime > 7 || e.y > player.y + 900) enter(e, "disappear", "disappear");
}

function spider(e, dt, api) {
  if (e.state === "jump") {
    e.vx = e.dir * e.speed;
    api.moveBody(e, dt, e.gravity ?? 900);
    if (e.ground) enter(e, "normal", "normal");
    return;
  }
  e.vx = e.dir * e.speed;
  if (e.dontFall && e.ground && api.tileAt &&
    !supported(api.tileAt, e.x + e.dir * (e.w / 2 + 5), e.y + 5)) e.dir *= -1;
  api.moveBody(e, dt, e.gravity ?? 900);
  if (e.hitWall) e.dir *= -1;
  if (e.ground) {
    e.jumpT = (e.jumpT ?? 1) - dt;
    if (e.jumpT <= 0) {
      e.jumpT = 1;
      e.vy = -(e.jumpSpeed ?? 200); e.ground = false;
      enter(e, "jump", "normal");
    }
  }
}

function mouse(e, player, dt, api, dx) {
  face(e, dx);
  const accel = e.acceleration ?? 640;
  if (e.state === "jump") {
    e.vx = approach(e.vx, e.dir * e.speed, accel * dt);
    api.moveBody(e, dt, e.gravity ?? 900);
    if (e.ground) enter(e, "normal", "normal");
    return;
  }
  e.vx = approach(e.vx, e.dir * e.speed, accel * dt);
  api.moveBody(e, dt, e.gravity ?? 900);
  if (e.hitWall || (!e.ground && Math.abs(e.vx) > 120 && e.vy < 60 && player.y >= e.y - 20)) {
    e.vy = -(e.jumpSpeed ?? 360); e.ground = false;
    enter(e, "jump", "jump");
  }
}

function volcano(e, player, dt, api, dx) {
  if (e.state === "attack") {
    e.vx = 0;
    api.moveBody(e, dt, e.gravity ?? 900);
    if (e.anim?.finished || e.stateTime >= 1) enter(e, "normal", "normal");
    return;
  }
  if (e.cooldown <= 0) {
    enter(e, "attack", "attack");
    e.vx = 0;
    for (const vx of [-120, 0, 120]) api.shoot(e, { fireball: true, vx, vy: -240, gravity: 960 });
    e.cooldown = (e.attackDelay ?? 2) + enemyRandom(e) * (e.attackSpread || 1);
    return;
  }
  e.vx = e.dir * e.speed;
  if (e.dontFall && e.ground && api.tileAt &&
    !supported(api.tileAt, e.x + e.dir * (e.w / 2 + 5), e.y + 5)) e.dir *= -1;
  e.vx = e.dir * e.speed;
  api.moveBody(e, dt, e.gravity ?? 900);
  if (e.hitWall) e.dir *= -1;
}

function snake(e, player, dt, api, dx, dy) {
  if (!e.snakeReady) {
    e.snakeReady = true; e.state = "wait"; e.stateTime = 0;
    e.vx = e.vy = 0; e.visible = false;
  }
  if (e.state === "wait") {
    e.vx = e.vy = 0;
    if (distance(dx, dy) <= (e.triggerRange || 96)) {
      e.visible = true;
      enter(e, "normal", "normal");
      e.vy = -320; e.stopT = 0.5;
      e.shootT = 1 + enemyRandom(e) * 2;
    }
    return;
  }
  face(e, dx);
  if (e.state === "attack") {
    e.vx = e.vy = 0;
    if (e.anim?.finished || e.stateTime > 0.3) enter(e, "normal", "normal");
    return;
  }
  if (e.stopT > 0) {
    e.vy = -320;
    e.stopT -= dt;
    if (e.stopT <= 0) e.vy = 0;
  }
  e.shootT = (e.shootT ?? 1) - dt;
  e.x += e.vx * dt; e.y += e.vy * dt;
  if (e.stopT <= 0 && e.shootT <= 0) {
    api.shoot(e, { aim: true });
    e.shootT = 1 + enemyRandom(e) * 2;
    enter(e, "attack", "attack");
  }
}

function shell(e, player, dt, api, dx) {
  if (!e.shellReady) {
    e.shellReady = true; e.shellOpen = false; e.vulnerable = false; e.shellShot = false;
    e.state = "normal"; e.vx = e.vy = 0;
  }
  face(e, dx);
  e.vx = e.vy = 0;
  const event = flags(e);
  const frameKey = `${e.anim?.cur?.name}:${e.anim?.i}`;
  if (frameKey !== e.shellFrame) {
    e.shellFrame = frameKey;
    if (event.includes("PhysicEvent")) {
      if (!e.shellOpen) {
        e.shellOpen = true; e.vulnerable = true; e.shellShot = false;
        for (const [vx, vy] of [[10, -20], [8, -30], [0, -16]])
          api.shoot(e, { vx: e.dir * vx, vy, gravity: -40, cosmetic:true, animation:"bubble", life:2 });
      } else {
        e.shellOpen = false; e.vulnerable = false;
      }
    }
    if (event.includes("Custom") && e.shellOpen && !e.shellShot) {
      e.shellShot = true;
      api.shoot(e, { aim: true });
    }
  }
}

function hive(e, player, dt, api) {
  animation(e, "panal");
  if (e.cooldown <= 0) {
    const active = api.nearby?.("Bee", e) ?? 0;
    if (active < 4) api.spawn?.("Bee", e.x, e.y - 50, e.dir, e);
    e.cooldown = 2 + enemyRandom(e);
  }
}

function sideColumn(e, player, dt, api, dx) {
  e.vx = e.vy = 0;
  if (!Number.isFinite(e.columnT)) e.columnT = 3 + enemyRandom(e);
  if (e.state === "attack") {
    const event = flags(e);
    if (!e.shotFired && (event.includes("Custom") || !e.anim?.has("attack") || e.stateTime > 0.4)) {
      api.shoot(e, { fireball: true });
      e.shotFired = true;
    }
    if (e.anim?.finished || e.stateTime > 1.2) {
      enter(e, "normal", "normal");
      e.columnT = 3 + enemyRandom(e);
    }
    return;
  }
  e.columnT -= dt;
  const facing = dx * e.dir > 0;
  const visible = typeof api.inCamera === "function" ? api.inCamera(e) : true;
  if (e.columnT <= 0 && facing && visible) {
    enter(e, "attack", "attack");
    e.shotFired = false;
  }
}

function frontColumn(e, player, dt, api) {
  e.vx = e.vy = 0;
  if (e.state !== "attack") {
    if (e.cooldown > 0) return;
    enter(e, "attack", "attack");
    e.shotFired = false;
  }
  const event = flags(e);
  if (!e.shotFired && (event.includes("Custom") || !e.anim?.has("attack") || e.stateTime > 0.4)) {
    for (const angle of [-0.35, 0, 0.35]) api.shoot(e, { aim: true, angle });
    e.shotFired = true;
  }
  if (e.anim?.finished || e.stateTime > 1.2) {
    enter(e, "normal", "normal");
    e.cooldown = 2 + enemyRandom(e);
  }
}

// Shell keeps its native contact behavior; this predicate is for the parent's
// boomerang/stomp checks instead of disabling collision while it is closed.
export function canDamageLaterEnemy(e) {
  if (!e) return false;
  if (e.behavior === "shell") return e.shellOpen === true;
  return true;
}

export function updateLaterEnemy(e, player, dt, api) {
  const dx = player.x - e.x, dy = player.y - e.y;
  if (e.behavior === "hive") { hive(e, player, dt, api); return true; }
  if (e.behavior === "flying-seek" || e.behavior === "flying-shooter") {
    face(e, dx);
    const wasGrounded = e.floorContact === true;
    flyer(e, player, dt, api, dx, dy, { targetY: player.y - 20 });
    const contact = e.ground === true;
    e.ground = false;
    if (contact && !wasGrounded) e.vy = e.kind === "Bat" ? -(e.jumpSpeed ?? 200) : -60;
    e.floorContact = contact;
    if (e.behavior === "flying-shooter" && e.cooldown <= 0) {
      api.shoot(e, { aim: true });
      e.cooldown = (e.attackDelay ?? 2) + enemyRandom(e) * (e.attackSpread || 0);
    }
    return true;
  }
  if (e.behavior === "swim-patrol") { swimPatrol(e, dt, api); return true; }
  if (e.behavior === "piranha") { piranha(e, player, dt, api, dx, dy); return true; }
  if (e.behavior === "blowfish") { blowfish(e, player, dt, api, dx, dy); return true; }
  if (e.behavior === "falling-trap") { fallingTrap(e, player, dt, api, dx, dy); return true; }
  if (e.behavior === "spider") { spider(e, dt, api); return true; }
  if (e.behavior === "mouse") { mouse(e, player, dt, api, dx); return true; }
  if (e.behavior === "volcano") { volcano(e, player, dt, api, dx); return true; }
  if (e.behavior === "snake") { snake(e, player, dt, api, dx, dy); return true; }
  if (e.behavior === "shell") { shell(e, player, dt, api, dx); return true; }
  if (e.behavior === "side-column") { sideColumn(e, player, dt, api, dx); return true; }
  if (e.behavior === "front-column") { frontColumn(e, player, dt, api); return true; }
  return false;
}
