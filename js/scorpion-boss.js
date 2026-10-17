// BIG_SCORP_{INITIAL_WAIT,WALK,JUMP}, native scripts + controlled Windows capture.
export function startScorpion(b, player) {
  b.state = "walk"; b.stateTime = 0; b.dir = Math.sign(player.x - b.x) || -1;
  b.fight = true; b.freeze = 0; b.landed = false;
  b.lastWalkFrame = -1; b.anim?.restart("walk");
}
export function damageScorpion(b) {
  if (!b.fight || b.hp <= 0 || b.freeze > 0 || b.state === "dying") return false;
  b.hp--; b.freeze = .2; b.hurtT = .25; b.look = true;
  if (b.hp <= 0) {
    b.state = "dying"; b.stateTime = 0; b.vx = b.vy = 0;
    b.anim?.restart("dead"); b.cur = b.anim?.frame;
  }
  return true;
}
export function updateScorpion(b, player, dt, api) {
  if (!b.fight) {
    b.vx = 0;
    if (api.inCamera(b)) { startScorpion(b, player); api.bossStart?.(b); }
    return;
  }
  b.stateTime += dt;
  b.freeze = Math.max(0, (b.freeze || 0) - dt); b.hurtT = Math.max(0, b.hurtT - dt);
  if (b.state === "dying") {
    if (b.stateTime >= 4) { b.state = "defeated"; b.defeated = true; api.bossDefeated?.(b); }
    else if (b.stateTime < 3 && Math.floor((b.stateTime - dt) * 10) !== Math.floor(b.stateTime * 10)) api.explosion?.(b);
    return;
  }
  if (b.state === "defeated") return;
  if (b.look && b.freeze <= 0 && b.state === "walk") { b.dir = Math.sign(player.x - b.x) || b.dir; b.look = false; }
  if (b.state === "walk") {
    let displacement = 0;
    if (b.anim && b.anim.i !== b.lastWalkFrame) { displacement = b.anim.frame?.dx || 0; b.lastWalkFrame = b.anim.i; }
    b.vx = b.freeze > 0 ? 0 : b.dir * (b.speed + displacement / Math.max(dt, 1 / 120));
    api.moveBody(b, dt, b.gravity);
    if (b.hitWall) b.dir *= -1;
    if (b.stateTime > 3 && b.freeze <= 0 && api.minionCount() <= 1 && b.ground) {
      b.state = "jump"; b.stateTime = 0; b.vx = b.dir * 60; b.vy = -240;
      b.ground = false; b.landed = false; b.anim?.restart("jump");
    }
  } else if (b.state === "jump") {
    api.moveBody(b, dt, b.gravity);
    if (b.ground && !b.landed) {
      b.landed = true; b.stateTime = 0; b.vx = 0; api.shake?.(.5);
      api.spawnMinion(b.x - b.dir * 30, b.y - 250, b.dir);
      api.spawnMinion(b.x + b.dir * 128, b.y - 366, b.dir);
    }
    if (b.landed && b.stateTime >= 1) { b.state = "walk"; b.stateTime = 0; b.lastWalkFrame = -1; b.anim?.restart("walk"); }
  }
  if (b.anim) {
    b.anim.update(dt); b.cur = b.anim.frame;
    for (const ev of b.anim.drainEvents()) if (ev.type === "MakeEffect") api.shake?.(.25);
  }
}
