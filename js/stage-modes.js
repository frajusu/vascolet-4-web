import { integrateAxis } from "./physics.js";

// VH_NORMAL / VB_FLYING, ELF 0x08168439 / 0x0816afe0. applyD maps
// GameD friction/maxX/maxY to Particle1; these aren't normal-player upgrades.
export const MOUNTED = Object.freeze({
  ant: Object.freeze({ speed: 210, friction: 1200, force: 3200, airForce: 640,
    gravity: 960, jump: -400, maxFall: 500, width: 28, initialVY: 0,
    stand: "withAntStand", walk: "withAntWalk", attack: "withAntAttack", damage: "withAntDamage" }),
  butterfly: Object.freeze({ speed: 280, friction: 1200, force: 3200, airForce: 3200,
    gravity: 450, jump: -200, maxFall: 160, width: 8, initialVY: -80,
    stand: "flyingWithButterfly", walk: "flyingWithButterfly", attack: "flyingWithButterflyAttack", damage: "flyingWithButterflyDamage" }),
});

export function playerMode(map) {
  return ({ VascoletAndAnt: "ant", VascoletAndButterfly: "butterfly" })[map.props.player] || "normal";
}

export function moveMountedPlayer(p, controls, dt, { moveBody, jumpSound }) {
  const profile = MOUNTED[p.mode];
  const dir = Number(controls.held.has("right")) - Number(controls.held.has("left"));
  p.crouch = p.run = false; p.maxFall = profile.maxFall;
  if (p.damage) p.vx = -p.damage.face * 60;
  else {
    if (dir) p.face = dir;
    const axis = integrateAxis(p.vx, dir * (p.ground ? profile.force : profile.airForce),
      p.mode === "butterfly" || p.ground ? profile.friction : 0, profile.speed, dt);
    p.vx = axis.velocity; p.stepX = axis.displacement;
    const jump = controls.pressed.has("z") || controls.pressed.has("s");
    if ((p.mode === "butterfly" && (jump || p.ground)) || (p.mode === "ant" && p.ground && jump)) {
      p.vy = profile.jump; p.ground = false; jumpSound();
    }
  }
  moveBody(p, dt, profile.gravity);
}

export function autoCameraPath(map) {
  // DrawableGameTileMap::insertCameraData sorts numbered TMX points and supplies
  // speed=60 (0x081d41ce). A line/zone is not an automatic control point.
  return (map.groups.find(g => g.name === "Camera")?.objects || [])
    .filter(o => /^\d+$/.test(o.name) && o.w === 0 && o.h === 0)
    .sort((a, b) => Number(a.name) - Number(b.name)).map(o => ({ x: o.x, y: o.y }));
}

export function advanceAutoCamera(track, dt) {
  let remaining = 60 * dt;
  while (remaining > 0 && track.index < track.points.length) {
    const next = track.points[track.index], dx = next.x - track.x, dy = next.y - track.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= remaining) { track.x = next.x; track.y = next.y; remaining -= distance; track.index++; }
    else { track.x += dx / distance * remaining; track.y += dy / distance * remaining; remaining = 0; }
  }
}

export function touchesExit(p, exits) {
  return exits.some(e => p.x + p.w / 2 >= e.x && p.x - p.w / 2 <= e.x + e.w &&
    p.y + (p.skin || 0) >= e.y && p.y - p.h <= e.y + e.h);
}

export function constrainToAutoCamera(game, moveBody) {
  if (!game.autoCamera) return false;
  const p = game.player, left = game.camX + p.w / 2, right = game.camX + 512 - p.w / 2;
  const dx = Math.max(left, Math.min(right, p.x)) - p.x;
  if (dx) { p.stepX = dx; moveBody(p, 0, 0); }
  // Correction uses real tile collision: a scrolling wall must crush the player,
  // never teleport them through the intervening rock.
  return p.x + p.w / 2 < game.camX || p.x - p.w / 2 > game.camX + 512 ||
    p.y < game.camY || p.y - p.h > game.camY + 384;
}
