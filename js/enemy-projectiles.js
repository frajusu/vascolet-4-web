import { segmentBox, terrainHit } from "./projectiles.js";

export function createEnemyShot(e, anim = null) {
  const fire = e.behavior === "snail", x = e.x + e.dir * (fire ? 0 : 20), y = e.y - (fire ? 20 : 40);
  return { kind: fire ? "fireball" : "effects", x, y, prevX: x, prevY: y,
    vx: e.dir * (fire ? 480 : 240), anim, ending: false, removed: false, seen: false };
}

export function updateEnemyShot(shot, player, dt, { tileAt, camera, hurtPlayer }) {
  if (shot.removed) return;
  if (shot.ending) {
    shot.anim?.update(dt);
    if (!shot.anim || shot.anim.finished) shot.removed = true;
    return;
  }
  const nx = shot.x + shot.vx * dt, radius = 6;
  const hit = segmentBox(shot.x, shot.y, nx, shot.y,
    player.x - player.w / 2 - radius, player.y - (player.crouch ? 28 : player.h) - radius,
    player.x + player.w / 2 + radius, player.y + radius);
  // GenericBullet has no map collision. Fireball has an explicit solid-tile
  // extinction rule and plays its ending animation instead of vanishing.
  const wall = shot.kind === "fireball" ? terrainHit(shot.x, shot.y, nx, shot.y, tileAt, radius) : null;
  if (hit !== null && (wall === null || hit <= wall)) hurtPlayer();
  if (shot.kind === "fireball" && (hit !== null || wall !== null)) {
    shot.x += (nx - shot.x) * Math.min(hit ?? 1, wall ?? 1);
    shot.vx = 0; shot.ending = true;
    if (shot.anim?.has("ending")) shot.anim.restart("ending");
    else shot.removed = true;
  } else shot.x = nx;
  shot.anim?.update(dt);
  // No arbitrary four-second TTL: an on-screen shot stays alive while traveling.
  const visible = shot.x >= camera.x - 24 && shot.x <= camera.x + 512 + 24 &&
    shot.y >= camera.y - 24 && shot.y <= camera.y + 384 + 24;
  if (visible) shot.seen = true;
  else if (shot.seen || shot.x < camera.x - 512 || shot.x > camera.x + 1024 ||
    shot.y < camera.y - 512 || shot.y > camera.y + 896) shot.removed = true;
}
