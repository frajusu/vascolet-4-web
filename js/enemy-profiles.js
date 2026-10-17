// Recovered script parameters. Addresses and remaining fidelity gaps are recorded
// in docs/enemy-fidelity-workflow.md. Collision boxes remain port approximations.
export const ENEMY_PROFILES = Object.freeze({
  Fly: { behavior: "fly", hp: 1, w: 28, h: 34, speed: 240, gravity: 0,
    patrolTurn: 32, acceleration: 480, verticalAcceleration: 600 },
  Frog: { behavior: "frog", hp: 4, w: 54, h: 46, speed: 240, gravity: 900,
    triggerRange: 128, jumpSpeed: 500 },
  Flower: { behavior: "flower", hp: 5, w: 54, h: 72, speed: 0, gravity: 0,
    attackDelay: 1, attackSpread: 2 },
  Beetle: { behavior: "patrol", hp: 10, w: 78, h: 50, speed: 30, gravity: 900 },
  Snail: { behavior: "snail", hp: 10, w: 80, h: 68, speed: 30, gravity: 900,
    attackDelay: 1, attackSpread: 1, attackDuration: .5 },
});

// Each lab run uses the same sequence; a seed can be supplied for timer sweeps.
export function enemyRandom(e) {
  let x = e.seed | 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  e.seed = x >>> 0;
  return e.seed / 4294967296;
}
