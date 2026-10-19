// First-area scripts reconstructed from the symbolized original; Godot remains a
// secondary reference. Bosses/other species and collision boxes are still provisional.
import { TILE_SOLID, TILE_UP } from "./tmx.js";
import { ENEMY_PROFILES, enemyRandom } from "./enemy-profiles.js";
import { damageScorpion, updateScorpion } from "./scorpion-boss.js";
import { subjectY, MAP_SKIN } from "./physics.js";
const clamp = (v, limit) => Math.max(-limit, Math.min(v, limit));

export function createEnemy(object, boss = false, seed = 0x45a91) {
  const profile = ENEMY_PROFILES[object.name] ?? { behavior: "unverified",
    hp: boss ? 100 : 10, w: boss ? 100 : 40, h: boss ? 100 : 44, speed: boss ? 30 : 45, gravity: 900 };
  const commands = new Set((object.type || "").split(/[,;\s]+/));
  const x = object.x + 16, y = subjectY(object);
  const e = { ...profile, kind: object.name, boss, fwd: commands.has("forward"),
    dontFall: commands.has("dontFall") || Object.hasOwn(object.props || {}, "dontFall"),
    x, y, homeX: x, homeY: y, prevX: x, prevY: y, vx: 0, vy: 0,
    dir: commands.has("forward") ? 1 : -1, t: 0, hp: profile.hp, maxhp: profile.hp,
    state: "normal", cooldown: 0, stateTime: 0, seed: seed >>> 0 || 1, hurtT: 0, deadT: 0, ground: false, active: false,
    anim: null, cur: null, skin: MAP_SKIN };
  if (profile.behavior === "fly") e.vx = e.dir * e.speed;
  if (profile.attackDelay) e.cooldown = profile.attackDelay + enemyRandom(e) * profile.attackSpread;
  if (profile.behavior === "scorpion-boss") { e.state = "waiting"; e.fight = false; e.defeated = false; }
  return e;
}

export function enemyAnimation(e, name, restart = false) {
  if (e.anim?.has(name)) { e.anim.set(name, { restart }); e.cur = e.anim.frame; }
}

export function enemySpriteFlip(e) {
  // Verified first-area atlases face right. Art orientation is independent of AI.
  if (ENEMY_PROFILES[e.kind]) return (Math.abs(e.vx) > 1 ? e.vx : e.dir) < 0;
  return e.dir > 0;
}

export function hitEnemy(e, direction = 1, damage = 1) {
  if (e.behavior === "scorpion-boss") return damageScorpion(e);
  if (e.hp <= 0 || e.hurtT > 0) return false;
  e.hp = Math.max(0, e.hp - damage); e.hurtT = .25;
  if (!e.hp) {
    e.state = "dead"; e.deadT = 0;
    e.vx = e.behavior === "flower" ? 0 : direction * 60;
    e.vy = e.behavior === "flower" ? 0 : -120;
    // Snail's exported damage/dead sprite has a zero-width source rectangle.
    // Native living enemies blink/shake in their current animation; damage is
    // not a request to switch to their death-looking (or empty) asset.
    if (e.kind !== "Snail") enemyAnimation(e, "dead", true);
  }
  return true;
}

export function updateEnemy(e, player, dt, { moveBody, tileAt, shoot, booms = [], ...bossApi }) {
  if (e.behavior === "scorpion-boss") { e.t += dt; updateScorpion(e, player, dt, { moveBody, ...bossApi }); return; }
  e.t += dt; e.stateTime += dt; e.hurtT = Math.max(0, e.hurtT - dt); e.cooldown -= dt;
  if (e.hp <= 0) {
    e.deadT += dt;
    if (e.behavior !== "flower") { e.vy += 560 * dt; e.x += e.vx * dt; e.y += e.vy * dt; }
    if (e.anim) { e.anim.update(dt); e.cur = e.anim.frame; e.anim.drainEvents(); }
    return;
  }
  const dx = player.x - e.x;
  if (e.behavior === "fly") {
    // X patrol is relative to spawn, NEVER to player X. Original SeekObject has
    // zero X force and 600 Y force: altitude reacts, horizontal pursuit does not.
    const towardHome = (e.homeX - e.x) * e.dir > 0;
    if (!towardHome && Math.abs(e.x - e.homeX) > e.patrolTurn) e.vx -= e.dir * e.acceleration * dt;
    if (!towardHome && e.vx * e.dir < -1) e.dir *= -1;
    if ((e.homeX - e.x) * e.dir > 0) e.vx += e.dir * e.acceleration * dt;
    e.vx = clamp(e.vx, e.speed);
    e.vy = clamp(e.vy + Math.sign(player.y - e.y) * e.verticalAcceleration * dt, e.speed);
    // FLY_BASE_STATE is a static/situable subject: tile collision must never
    // change its spawn-relative patrol, including when it crosses solid ground.
    e.x += e.vx * dt; e.y += e.vy * dt; e.hitWall = false; e.ground = false;
  } else if (e.behavior === "flower") {
    e.vx = e.vy = 0;
    if (e.state !== "attack") {
      e.dir = Math.sign(dx) || e.dir;
      if (e.cooldown <= 0) {
        e.state = "attack"; e.stateTime = 0; enemyAnimation(e, "attack", true);
      }
    }
  } else if (e.behavior === "frog") {
    const threatened = Math.abs(dx) < e.triggerRange || booms.some(b => b.life > 0 && b.state !== "falling" && Math.abs(b.x - e.x) < e.triggerRange);
    if (e.state === "normal" && e.ground && threatened) {
      e.dir = Math.sign(dx) || e.dir; e.state = "windup";
      enemyAnimation(e, "jump", true);
    }
    if (e.state === "normal" || e.state === "windup") e.dir = Math.sign(dx) || e.dir;
    if (e.state !== "jump") e.vx = 0;
    moveBody(e, dt, e.gravity);
    if (e.state === "jump" && e.ground) {
      e.state = "normal"; e.vx = 0; e.stateTime = 0;
      enemyAnimation(e, "normal");
    }
  } else if (e.behavior === "unverified") {
    // Retain placeholder movement for unstudied species rather than applying
    // land gravity/ledge rules to swimming enemies or scripted bosses.
    e.vx = Math.abs(dx) < 260 ? Math.sign(dx) * 40 : 0;
    if (e.vx) e.dir = Math.sign(e.vx);
    e.x += e.vx * dt;
    e.y = e.homeY + Math.sin(e.t * 3) * 4;
  } else {
    // Patrol the actual terrain; turn at walls and unsupported ledges.
    const footX = e.x + e.dir * (e.w / 2 + 5);
    if (e.dontFall && e.ground && !(tileAt(Math.floor(footX / 32), Math.floor((e.y + 5) / 32)) & (TILE_SOLID | TILE_UP))) e.dir *= -1;
    e.vx = e.state === "attack" ? 0 : e.dir * e.speed; moveBody(e, dt, e.gravity);
    if (e.hitWall) e.dir *= -1;
    if (e.behavior === "snail" && e.state === "normal" && e.cooldown <= 0) {
      e.state = "attack"; e.stateTime = 0; e.vx = 0; shoot(e);
    } else if (e.behavior === "snail" && e.state === "attack" && e.stateTime >= e.attackDuration) {
      e.state = "normal"; e.stateTime = 0;
      e.cooldown = e.attackDelay + enemyRandom(e) * e.attackSpread;
    }
  }
  if (e.state === "normal" && e.hurtT <= 0) {
    const normal = ["normal", "flying", "walk", "fly", "stand", "idle"].find(a => e.anim?.has(a));
    if (normal) enemyAnimation(e, normal);
  }
  if (e.anim) {
    e.anim.update(dt); e.cur = e.anim.frame;
    for (const event of e.anim.drainEvents()) {
      if (e.behavior === "frog" && e.state === "windup" && event.type === "PhysicEvent") {
        e.state = "jump"; e.stateTime = 0; e.vx = e.dir * e.speed; e.vy = -e.jumpSpeed; e.ground = false;
      }
      if (e.behavior === "flower" && e.state === "attack" && event.type === "Custom") shoot(e);
    }
    if (e.behavior === "flower" && e.state === "attack" && e.anim.finished) {
      e.state = "normal"; e.stateTime = 0;
      e.cooldown = e.attackDelay + enemyRandom(e) * e.attackSpread;
      enemyAnimation(e, "normal");
    }
  }
}
