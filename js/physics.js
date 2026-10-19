// bat::Particle1::update, ELF 0x082a4fa0: displacement uses v*dt +
// 0.5*a*dt^2, then velocity is advanced and friction is applied separately.
export function integrateAxis(velocity, acceleration, friction, maxSpeed, dt) {
  let displacement = velocity * dt + .5 * acceleration * dt * dt;
  displacement = Math.max(-maxSpeed * dt, Math.min(maxSpeed * dt, displacement));
  velocity += acceleration * dt;
  velocity -= Math.sign(velocity) * Math.min(Math.abs(velocity), friction * dt);
  velocity = Math.max(-maxSpeed, Math.min(maxSpeed, velocity));
  return { velocity, displacement };
}

export const MAP_SKIN = 2;
export const subjectY = tileObject => tileObject.y + 32 - MAP_SKIN;
