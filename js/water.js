import { integrateAxis } from "./physics.js";

// VASCOLET_SWIMMING(_WITH_SNORKEL): max axes320, force3200,
// strokes -100 without snorkel and -300/-200 with a .4s fastSwim timer.
// Fluid drag/buoyancy are calibrated; the state/action values are recovered.
export function waterZones(map) {
  return (map.groups.find(g => g.name === "dataExt")?.objects || [])
    .filter(o => o.name === "water" && o.w > 0 && o.h > 0).map(o => ({ ...o }));
}
export function waterAt(zones, x, y) {
  return zones.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) || null;
}
export function updateSwimming(p, abilities, zones, controls, dt, { moveBody, sound, bubble }) {
  p.waterExitT = Math.max(0, (p.waterExitT || 0) - dt);
  const zone = waterAt(zones, p.x, p.y - 8);
  const wasSwimming = !!p.swimming;
  p.swimming = !!zone && p.waterExitT <= 0;
  if (!p.swimming) { if (wasSwimming) sound?.("jumpWater"); p.maxFall = 500; return false; }
  p.run = false; p.crouch = false; p.doubleUsed = false; p.platformId = null; p.maxFall = 320;
  p.coyote = 0; p.buffer = 0; p.dropT = Math.max(0,(p.dropT || 0)-dt); p.tapT = -9;
  p.swimFastT = Math.max(0, (p.swimFastT || 0) - dt);
  const dir = Number(controls.held.has("right")) - Number(controls.held.has("left"));
  const jump = controls.pressed.has("z") || controls.pressed.has("s");
  if (!wasSwimming) { p.vy = Math.min(160, p.vy); sound?.("jumpWater"); }
  if (!p.damage) {
    if (dir) p.face = dir;
    const axis = integrateAxis(p.vx, dir * 3200, 1200, 320, dt);
    p.vx = axis.velocity; p.stepX = axis.displacement;
    // A fresh stroke at the surface launches out onto the bank.
    if (jump && p.y - p.h < zone.y && p.y < zone.y + p.h + 8 && p.vy <= 60) {
      p.vy = -400; p.waterExitT = .25; p.swimming = false; p.maxFall = 500;
      sound?.("jumpAir"); moveBody(p, dt, 900); return true;
    }
    if (abilities.swim && jump) {
      p.vy = p.swimFastT > 0 ? -300 : -200; p.swimFastT = .4; sound?.("swim");
    } else if (!abilities.swim && waterAt(zones, p.x, p.y - p.h + 6)) {
      p.vy = -100; // Surface swimming before acquiring the snorkel, not free diving.
    }
    if (controls.held.has("down") && abilities.swim) p.vy = Math.min(320, p.vy + 600 * dt);
  } else p.vx = -p.damage.face * 60;
  moveBody(p, dt, 300);
  p.bubbleT = (p.bubbleT || 0) - dt;
  if (abilities.swim && p.bubbleT <= 0) { bubble?.(p.x, p.y - 40); p.bubbleT = 1; }
  return true;
}
