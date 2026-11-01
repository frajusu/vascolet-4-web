import { segmentBox, terrainHit } from "./projectiles.js";

export function createEnemyShot(e, anim = null, options = {}) {
  const fire = options.fireball || e.behavior === "snail";
  const x = e.x + e.dir * (options.offsetX ?? (fire ? 0 : 20)), y = e.y + (options.offsetY ?? (fire ? -20 : -40));
  const speed = options.speed ?? (fire ? 480 : 240);
  let vx = e.dir * speed, vy = 0;
  if (options.aim && options.target) {
    const angle = Math.atan2(options.target.y + (options.targetOffsetY ?? -30) - y, options.target.x - x) + (options.angle || 0);
    vx = Math.cos(angle) * speed; vy = Math.sin(angle) * speed;
  }
  return { kind: options.library || (fire ? "fireball" : "effects"), x, y, prevX: x, prevY: y,
    vx: options.vx ?? vx, vy: options.vy ?? vy, gravity: options.gravity || 0,
    cosmetic:!!options.cosmetic, life:options.life, terrain:!!options.terrain,
    endAnimation:options.endAnimation || "ending",
    endLife:options.endLife ?? .5, age:0, homingSpeed:options.homingSpeed,
    homingAcceleration:options.homingAcceleration, homingAfter:options.homingAfter ?? 0,
    homingUntil:options.homingUntil ?? Infinity, targetOffsetY:options.targetOffsetY ?? -30,
    homingMax:options.homingMax ?? 240,
    anim, ending: false, removed: false, seen: false };
}

export function updateEnemyShot(shot, player, dt, { tileAt, camera, hurtPlayer }) {
  if (shot.removed) return;
  if (shot.life !== undefined && (shot.life -= dt) <= 0) { shot.removed = true; return; }
  if (shot.ending) {
    shot.endingT = (shot.endingT || 0) + dt;
    shot.anim?.update(dt);
    if (!shot.anim || shot.anim.finished || shot.endingT > (shot.endLife ?? .5)) shot.removed = true;
    return;
  }
  shot.age = (shot.age || 0) + dt;
  if (shot.homingSpeed) {
    const dx=player.x-shot.x, dy=player.y+shot.targetOffsetY-shot.y, distance=Math.hypot(dx,dy)||1;
    shot.vx=dx/distance*shot.homingSpeed;shot.vy=dy/distance*shot.homingSpeed;
  }
  if (shot.homingAcceleration && shot.age > shot.homingAfter && shot.age <= shot.homingUntil) {
    const max=shot.homingMax;
    shot.vx=Math.max(-max,Math.min(max,shot.vx+Math.sign(player.x-shot.x)*shot.homingAcceleration*dt));
    shot.vy=Math.max(-max,Math.min(max,(shot.vy||0)+Math.sign(player.y+shot.targetOffsetY-shot.y)*shot.homingAcceleration*dt));
  }
  const nx = shot.x + shot.vx * dt, ny = shot.y + (shot.vy || 0) * dt + .5 * (shot.gravity || 0) * dt * dt, radius = 6;
  shot.vy = (shot.vy || 0) + (shot.gravity || 0) * dt;
  const hit = segmentBox(shot.x, shot.y, nx, ny,
    player.x - player.w / 2 - radius, player.y - (player.crouch ? 28 : player.h) - radius,
    player.x + player.w / 2 + radius, player.y + radius);
  // GenericBullet has no map collision. Fireball has an explicit solid-tile
  // extinction rule and plays its ending animation instead of vanishing.
  const wall = shot.kind === "fireball" || shot.terrain ? terrainHit(shot.x, shot.y, nx, ny, tileAt, radius) : null;
  if (!shot.cosmetic && hit !== null && (wall === null || hit <= wall)) hurtPlayer();
  if ((shot.kind === "fireball" || shot.terrain) && (hit !== null || wall !== null)) {
    const contact = Math.min(hit ?? 1, wall ?? 1);
    shot.x += (nx - shot.x) * contact; shot.y += (ny - shot.y) * contact;
    shot.vx = 0; shot.ending = true;
    if (shot.anim?.has(shot.endAnimation || "ending")) shot.anim.restart(shot.endAnimation || "ending");
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
