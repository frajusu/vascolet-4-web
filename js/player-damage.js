// VASCOLET_DAMAGE ELF 0x080cca7f: Jump(-200), SetVelX(-60, 0) (facing-relative).
export const DAMAGE_MOTION = Object.freeze({ jump: -200, speed: 60, gravity: 900, airLimit: .5, fallTime: .25 });
export function beginPlayerDamage(p) {
  p.attack = null; p.run = false; p.buffer = 0; p.coyote = 0; p.crouch = false;
  p.damage = { phase: "air", time: 0, face: p.face };
  p.vx = -p.face * DAMAGE_MOTION.speed; p.vy = DAMAGE_MOTION.jump; p.ground = false;
}
export function advancePlayerDamage(p, dt) {
  const d = p.damage;
  if (!d) return;
  d.time += dt;
  if (d.phase === "air") {
    if (p.ground) { d.phase = "fall"; d.time = 0; p.vx = 0; }
    else if (d.time >= DAMAGE_MOTION.airLimit) p.damage = null;
  } else if (d.phase === "fall" && d.time >= DAMAGE_MOTION.fallTime) { d.phase = "rise"; d.time = 0; }
}
