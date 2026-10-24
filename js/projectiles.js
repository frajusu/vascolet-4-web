import { TILE_SOLID, TILE_UP } from "./tmx.js";

export const handY = player => player.y - (player.crouch ? 8 : 30);

// Segment vs expanded box: fast shots must hit intervening terrain/enemies.
export function segmentBox(x, y, nx, ny, left, top, right, bottom) {
  let entry = 0, exit = 1;
  for (const [start, delta, lo, hi] of [[x, nx - x, left, right], [y, ny - y, top, bottom]]) {
    if (Math.abs(delta) < 1e-9) { if (start < lo || start > hi) return null; }
    else {
      const a = (lo - start) / delta, b = (hi - start) / delta;
      entry = Math.max(entry, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
      if (entry > exit) return null;
    }
  }
  return entry;
}

export function terrainHit(x, y, nx, ny, tileAt, radius = 4, land = false) {
  let nearest = null;
  for (let ty = Math.floor((Math.min(y, ny) - radius) / 32); ty <= Math.floor((Math.max(y, ny) + radius) / 32); ty++) {
    for (let tx = Math.floor((Math.min(x, nx) - radius) / 32); tx <= Math.floor((Math.max(x, nx) + radius) / 32); tx++) {
      const flags = tileAt(tx, ty);
      const solid = flags & TILE_SOLID;
      const platform = land && (flags & TILE_UP) && ny > y && y + radius <= ty * 32;
      if (!solid && !platform) continue;
      const t = segmentBox(x, y, nx, ny, tx * 32 - radius, ty * 32 - radius,
        (tx + 1) * 32 + radius, (ty + 1) * 32 + radius);
      if (t !== null && (nearest === null || t < nearest)) nearest = t;
    }
  }
  return nearest;
}

export function createBoomerang(player, anim) {
  // V4_throwBoomerangLogic: both speed and outbound timer grow with fruit level.
  // The previous 200px calibration was an upgraded throw, not a new-game throw.
  const level = Math.max(0, Math.min(5, player.boomerangLevel ?? 0));
  const speed = 640 + 30 * level, outTime = .1 + .035 * level;
  const x = player.x + player.face * (player.crouch ? 10 : 20), y = handY(player);
  return { x, y, launchX: x, launchY: y, prevX: x, prevY: y, vx: player.face * speed, vy: 0, face: player.face,
    speed, outLeft: outTime, level, state: "out", t: 0, life: 8, caught: false, anim };
}

export function updateBoomerang(b, player, enemies, dt, { tileAt, hitEnemy, wallHit, impact, caught, camera }) {
  if (dt > 1 / 60 + 1e-9) {
    const steps = Math.ceil(dt * 60), step = dt / steps;
    for (let i = 0; i < steps && b.life > 0; i++)
      updateBoomerang(b, player, enemies, step, { tileAt, hitEnemy, wallHit, impact, caught, camera });
    return;
  }
  b.t += dt; b.life -= dt;
  if (camera && (b.state === "falling" || b.state === "settled") &&
    (b.x < camera.x - 64 || b.x > camera.x + 576 || b.y < camera.y - 64 || b.y > camera.y + 448)) { b.life = 0; return; }
  if (b.state === "settled") {
    b.deadT += dt;
    if (b.deadT >= .25) b.life = 0;
    return;
  }
  if (b.state === "falling") {
    // BOOMERANG_BOUNCE: one hit, then a small hop and a 0.25s settled
    // phase. It still occupies a throw slot until its subject actually dies.
    b.vy = Math.min(700, b.vy + 960 * dt);
    const nx = b.x + b.vx * dt;
    const side = terrainHit(b.x, b.y, nx, b.y, tileAt, 4);
    if (side !== null) { b.x += (nx - b.x) * Math.max(0, side - .001); b.vx = 0; }
    else b.x = nx;
    const ny = b.y + b.vy * dt;
    const floor = terrainHit(b.x, b.y, b.x, ny, tileAt, 4, true);
    if (floor !== null) {
      b.y += (ny - b.y) * Math.max(0, floor - .001);
      if (b.vy >= 0) { b.state = "settled"; b.deadT = 0; b.vx = b.vy = 0; }
      else b.vy = 0;
    } else b.y = ny;
    return;
  }
  const oldVX = b.vx, oldVY = b.vy;
  if (b.state === "out") {
    b.vx = b.face * b.speed; b.outLeft -= dt;
  } else if (b.state === "return") {
    // BOOMERANG_BACK seeks with forces 960/350 and caps 640/240.
    const accelerate = (v, force, cap) => {
      v += force * dt;
      v -= Math.sign(v) * Math.min(Math.abs(v), 32 * dt);
      return Math.max(-cap, Math.min(cap, v));
    };
    b.vx = accelerate(b.vx, Math.sign(player.x - b.x) * 960, 640);
    // Arrival steering brakes the vertical seek before crossing the owner's
    // height. Pure sign acceleration oscillated into the floor after jumps.
    const dy = handY(player) - b.y;
    const desiredVY = Math.sign(dy) * Math.min(240, Math.sqrt(2 * 350 * Math.abs(dy)));
    const forceY = Math.max(-350, Math.min(350, (desiredVY - b.vy) / Math.max(dt, 1e-9)));
    b.vy = accelerate(b.vy, forceY, 240);
  }
  const nx = b.x + (oldVX + b.vx) * .5 * dt, ny = b.y + (oldVY + b.vy) * .5 * dt;
  let first = terrainHit(b.x, b.y, nx, ny, tileAt, 4, b.state === "falling");
  let victim = null;
  if (b.state !== "falling") for (const e of enemies) {
    if (e.hp <= 0 || e.removed || e.visible === false || e.contact === false) continue;
    const t = segmentBox(b.x, b.y, nx, ny, e.x - e.w / 2 - 13, e.y - e.h, e.x + e.w / 2 + 13, e.y + 16);
    if (t !== null && (first === null || t < first)) { first = t; victim = e; }
  }
  if (b.state === "return") {
    // Sweep relative to the moving owner too, so a running/jumping player can
    // cross the catch volume between ticks. Terrain/enemy impacts take priority.
    const py = (player.prevY ?? player.y) - (player.crouch ? 8 : 30);
    const catchAt = segmentBox(b.x - (player.prevX ?? player.x), b.y - py,
      nx - player.x, ny - handY(player), -19, -30, 19, 30);
    if (catchAt !== null && (first === null || catchAt < first)) {
      b.x += (nx - b.x) * catchAt; b.y += (ny - b.y) * catchAt;
      b.caught = true; b.life = 0; caught?.(b); return;
    }
  }
  if (first === null) {
    b.x = nx; b.y = ny;
    if (b.state === "out" && b.outLeft <= 0) { b.state = "return"; b.vx = b.face * 320; b.vy = -30; }
    return;
  }
  b.x += (nx - b.x) * Math.max(0, first - .001);
  b.y += (ny - b.y) * Math.max(0, first - .001);
  if (victim) { hitEnemy(victim, b); impact(b.x, b.y); }
  else wallHit();
  b.state = "falling";
  b.vx = Math.sign(b.vx || b.face) * 60; b.vy = -120;
  if (b.anim?.has("normal")) b.anim.set("normal");
}
