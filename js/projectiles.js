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
  // Motion fitted to 800x600 client captures (2026-10-16), not recovered constants.
  // Spawn offsets ARE recovered: V4_throwBoomerangLogic ELF 0x080c6bf0,
  // standing (+20,-30), crouched (+10,-8), mirrored by facing.
  const x = player.x + player.face * (player.crouch ? 10 : 20), y = handY(player);
  return { x, y, launchX: x, launchY: y, prevX: x, prevY: y, vx: player.face * 700, vy: 0, face: player.face,
    state: "out", t: 0, life: 8, caught: false, anim };
}

export function updateBoomerang(b, player, enemies, dt, { tileAt, hitEnemy, wallHit, impact }) {
  b.t += dt; b.life -= dt;
  const oldVX = b.vx, oldVY = b.vy;
  if (b.state === "falling") {
    b.vy = Math.min(700, b.vy + 900 * dt);
  } else if (b.state === "out") {
    // World-space flight: no owner position, movement or camera enters this phase.
    b.vx = b.face * Math.max(0, b.face * b.vx - 1200 * dt);
    if (b.state === "out" && b.vx * b.face <= 0) b.state = "return";
  } else if (b.state === "return") {
    // Steer a velocity vector, not independent sign-X / hand-Y followers. The old
    // controller repeatedly overshot on reversals and trailed the player for seconds.
    const dx = player.x - b.x, dy = handY(player) - b.y, distance = Math.hypot(dx, dy) || 1;
    const blend = 1 - Math.exp(-9 * dt), speed = 440;
    b.vx += (dx / distance * speed - b.vx) * blend;
    b.vy += (dy / distance * speed - b.vy) * blend;
  }
  const nx = b.x + (oldVX + b.vx) * .5 * dt, ny = b.y + (oldVY + b.vy) * .5 * dt;
  let first = terrainHit(b.x, b.y, nx, ny, tileAt, 4, b.state === "falling");
  let victim = null;
  if (b.state !== "falling") for (const e of enemies) {
    if (e.hp <= 0) continue;
    const t = segmentBox(b.x, b.y, nx, ny, e.x - e.w / 2 - 4, e.y - e.h - 4, e.x + e.w / 2 + 4, e.y + 4);
    if (t !== null && (first === null || t < first)) { first = t; victim = e; }
  }
  if (b.state === "return") {
    // Sweep relative to the moving owner too, so a running/jumping player can
    // cross the catch volume between ticks. Terrain/enemy impacts take priority.
    const py = (player.prevY ?? player.y) - (player.crouch ? 8 : 30);
    const catchAt = segmentBox(b.x - (player.prevX ?? player.x), b.y - py,
      nx - player.x, ny - handY(player), -14, -18, 14, 18);
    if (catchAt !== null && (first === null || catchAt < first)) {
      b.x += (nx - b.x) * catchAt; b.y += (ny - b.y) * catchAt;
      b.caught = true; b.life = 0; return;
    }
  }
  if (first === null) { b.x = nx; b.y = ny; return; }
  b.x += (nx - b.x) * Math.max(0, first - .001);
  b.y += (ny - b.y) * Math.max(0, first - .001);
  if (victim) { hitEnemy(victim, b); impact(b.x, b.y); b.life = 0; }
  else if (b.state === "falling") { impact(b.x, b.y); b.life = 0; }
  else {
    wallHit();
    b.state = "falling"; b.life = Math.min(b.life, 1.2);
    b.vx = -Math.sign(b.vx || b.face) * 40; b.vy = 30;
    if (b.anim?.has("fast")) b.anim.set("fast");
  }
}
