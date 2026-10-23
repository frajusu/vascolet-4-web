import { segmentBox, terrainHit } from "./projectiles.js";

export function createEnemyShot(e, anim = null, options = {}) {
  const fire = options.fireball || e.behavior === "snail", x = e.x + e.dir * (fire ? 0 : 20), y = e.y - (fire ? 20 : 40);
  let vx = e.dir * (fire ? 480 : 240), vy = 0;
  if (options.aim && options.target) {
    const angle = Math.atan2(options.target.y - 30 - y, options.target.x - x) + (options.angle || 0);
    vx = Math.cos(angle) * 240; vy = Math.sin(angle) * 240;
  }
  return { kind: fire ? "fireball" : "effects", x, y, prevX: x, prevY: y,
    vx: options.vx ?? vx, vy: options.vy ?? vy, gravity: options.gravity || 0,
    anim, ending: false, removed: false, seen: false };
}

export function updateEnemyShot(shot, player, dt, { tileAt, camera, hurtPlayer }) {
  if (shot.removed) return;
  if (shot.ending) {
    shot.anim?.update(dt);
    if (!shot.anim || shot.anim.finished) shot.removed = true;
    return;
  }
  const nx = shot.x + shot.vx * dt, ny = shot.y + (shot.vy || 0) * dt + .5 * (shot.gravity || 0) * dt * dt, radius = 6;
  shot.vy = (shot.vy || 0) + (shot.gravity || 0) * dt;
  const hit = segmentBox(shot.x, shot.y, nx, ny,
    player.x - player.w / 2 - radius, player.y - (player.crouch ? 28 : player.h) - radius,
    player.x + player.w / 2 + radius, player.y + radius);
  // GenericBullet has no map collision. Fireball has an explicit solid-tile
  // extinction rule and plays its ending animation instead of vanishing.
  const wall = shot.kind === "fireball" ? terrainHit(shot.x, shot.y, nx, ny, tileAt, radius) : null;
  if (hit !== null && (wall === null || hit <= wall)) hurtPlayer();
  if (shot.kind === "fireball" && (hit !== null || wall !== null)) {
    const contact = Math.min(hit ?? 1, wall ?? 1);
    shot.x += (nx - shot.x) * contact; shot.y += (ny - shot.y) * contact;
    shot.vx = 0; shot.ending = true;
    if (shot.anim?.has("ending")) shot.anim.restart("ending");
    else shot.removed = true;
  } else { shot.x = nx; shot.y = ny; }
  shot.anim?.update(dt);
  // No arbitrary four-second TTL: an on-screen shot stays alive while traveling.
  const visible = shot.x >= camera.x - 24 && shot.x <= camera.x + 512 + 24 &&
    shot.y >= camera.y - 24 && shot.y <= camera.y + 384 + 24;
  if (visible) shot.seen = true;
  else if (shot.seen || shot.x < camera.x - 512 || shot.x > camera.x + 1024 ||
    shot.y < camera.y - 512 || shot.y > camera.y + 896) shot.removed = true;
}
