// First-area behaviors informed by the user's Godot 3 project (Vascolet_4.5).
// HP: fly 1, frog/snail 7, flower 6, beetle 10. Speeds/AI ranges are port tuning.
// Bosses and other species still use a conservative fallback, not recovered AI.
import { TILE_SOLID, TILE_UP } from "./tmx.js";

const profiles = {
  Fly: { behavior: "fly", hp: 1, w: 28, h: 34, speed: 125 },
  Frog: { behavior: "frog", hp: 7, w: 54, h: 46, speed: 230 },
  Flower: { behavior: "flower", hp: 6, w: 54, h: 72, speed: 0 },
  Beetle: { behavior: "patrol", hp: 10, w: 78, h: 50, speed: 60 },
  Snail: { behavior: "snail", hp: 7, w: 80, h: 68, speed: 38 },
};
const flying = new Set(["Bee", "Mosquito", "DragonFly", "Bat"]);
const clamp = (v, limit) => Math.max(-limit, Math.min(v, limit));

export function createEnemy(object, boss = false) {
  const profile = profiles[object.name] ?? { behavior: flying.has(object.name) ? "fly" : "unverified",
    hp: boss ? 100 : 10, w: boss ? 100 : 40, h: boss ? 100 : 44, speed: boss ? 30 : 45 };
  const x = object.x + 16, y = object.y + 16;
  return { ...profile, kind: object.name, boss, fwd: object.type === "forward",
    x, y, homeX: x, homeY: y, prevX: x, prevY: y, vx: 0, vy: 0,
    dir: object.type === "forward" ? 1 : -1, t: 0, hp: profile.hp, maxhp: profile.hp,
    state: "normal", cooldown: 1, hurtT: 0, deadT: 0, ground: false, active: false,
    anim: null, cur: null };
}

export function enemyAnimation(e, name, restart = false) {
  if (e.anim?.has(name)) { e.anim.set(name, { restart }); e.cur = e.anim.frame; }
}

export function hitEnemy(e, direction = 1) {
  if (e.hp <= 0 || e.hurtT > 0) return false;
  e.hp = Math.max(0, e.hp - 1); e.hurtT = .16;
  if (!e.hp) {
    e.state = "dead"; e.deadT = 0; e.vx = direction * 65; e.vy = -220;
    enemyAnimation(e, "dead", true);
  } else {
    // Don't abandon jump windup on damage or its PhysicEvent would be lost.
    if (e.state !== "windup" && e.state !== "attack") enemyAnimation(e, "damage", true);
    if (e.behavior === "frog" && e.ground && e.state === "normal") e.cooldown = 0;
  }
  return true;
}

export function updateEnemy(e, player, dt, { moveBody, tileAt, shoot }) {
  e.t += dt; e.hurtT = Math.max(0, e.hurtT - dt); e.cooldown -= dt;
  if (e.hp <= 0) {
    e.deadT += dt;
    e.vy += 700 * dt; e.x += e.vx * dt; e.y += e.vy * dt;
    if (e.anim) { e.anim.update(dt); e.cur = e.anim.frame; e.anim.drainEvents(); }
    return;
  }
  const dx = player.x - e.x, dy = player.y - e.y;
  if (e.behavior === "fly") {
    const chase = Math.abs(dx) < 240 && Math.abs(dy) < 160;
    const targetX = chase ? player.x : e.homeX + Math.sin(e.t * 2) * 24;
    const targetY = chase ? player.y - 15 : e.homeY + Math.sin(e.t * 3) * 12;
    e.vx += clamp((targetX - e.x) * 4 - e.vx, 300) * dt;
    e.vy += clamp((targetY - e.y) * 4 - e.vy, 240) * dt;
    e.vx = clamp(e.vx, e.speed); e.vy = clamp(e.vy, 95);
    if (Math.abs(e.vx) > 2) e.dir = Math.sign(e.vx);
    moveBody(e, dt, 0);
  } else if (e.behavior === "flower") {
    e.vx = 0; moveBody(e, dt);
    if (e.state !== "attack") {
      e.dir = Math.sign(dx) || e.dir;
      if (Math.abs(dx) < 420 && Math.abs(dy) < 160 && e.cooldown <= 0) {
        e.state = "attack"; enemyAnimation(e, "attack", true); e.cooldown = 3;
      }
    }
  } else if (e.behavior === "frog") {
    if (e.state === "normal" && e.ground && e.cooldown <= 0 && Math.abs(dx) < 260 && Math.abs(dy) < 140) {
      e.dir = Math.sign(dx) || e.dir; e.state = "windup";
      enemyAnimation(e, "jump", true);
    }
    if (e.state !== "jump") e.vx = 0;
    moveBody(e, dt);
    if (e.state === "jump" && e.ground) {
      e.state = "normal"; e.vx = 0; e.cooldown = 1.0;
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
    if (e.ground && !(tileAt(Math.floor(footX / 32), Math.floor((e.y + 5) / 32)) & (TILE_SOLID | TILE_UP))) e.dir *= -1;
    e.vx = e.dir * e.speed; moveBody(e, dt);
    if (e.hitWall) e.dir *= -1;
    if (e.behavior === "snail" && Math.abs(dx) < 400 && Math.abs(dy) < 140 && e.cooldown <= 0) {
      shoot(e); e.cooldown = 3.5;
    }
  }
  if (e.state === "normal" && e.hurtT <= 0) {
    const normal = ["normal", "walk", "fly", "stand", "idle"].find(a => e.anim?.has(a));
    if (normal) enemyAnimation(e, normal);
  }
  if (e.anim) {
    e.anim.update(dt); e.cur = e.anim.frame;
    for (const event of e.anim.drainEvents()) {
      if (e.behavior === "frog" && e.state === "windup" && event.type === "PhysicEvent") {
        e.state = "jump"; e.vx = e.dir * e.speed; e.vy = -460; e.ground = false;
      }
      if (e.behavior === "flower" && e.state === "attack" && event.type === "Custom") shoot(e);
    }
    if (e.state === "attack" && e.anim.finished) { e.state = "normal"; enemyAnimation(e, "normal"); }
  }
}
