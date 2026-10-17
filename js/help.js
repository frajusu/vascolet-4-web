import { AnimPlayer } from "./sprite.js";

export const HELP_DIALOG = Object.freeze({ x: 266, y: 45, textY: 36, duration: 2.5 });
export function signTouchesPlayer(sign, player) {
  return Math.abs(sign.x - player.x) <= (46 + player.w) / 2
    && player.y >= sign.y - 76 && player.y - (player.crouch ? 28 : player.h) <= sign.y + 4;
}
export function createLampi(sign, anims, generation = 1) {
  // SIGN_INFO throws LightBug at (0,-300); LIGHT_BUG_NORMAL follows (-64,-48).
  return { x: sign.x, y: sign.y - 300, prevX: sign.x, prevY: sign.y - 300,
    vx: 0, vy: 0, age: 0, phase: "follow", face: 1, generation, anim: new AnimPlayer(anims) };
}
export function updateLampi(lampi, player, dt) {
  const clamp = (v, limit) => Math.max(-limit, Math.min(v, limit));
  lampi.age += dt;
  lampi.face = Math.sign(player.x - lampi.x) || lampi.face;
  if (lampi.age >= 4) lampi.phase = "leave";
  if (lampi.phase === "follow") {
    lampi.vx = clamp(lampi.vx + Math.sign(player.x - player.face * 64 - lampi.x) * 320 * dt, 120);
    lampi.vy = clamp(lampi.vy + Math.sign(player.y - 48 - lampi.y) * 240 * dt, 240);
  } else lampi.vy = clamp(lampi.vy - 240 * dt, 240);
  lampi.x += lampi.vx * dt; lampi.y += lampi.vy * dt; lampi.anim.update(dt);
}

export function dialogueLayout(atlas, portrait) {
  const box = atlas.cartelDialogos, face = portrait && atlas[portrait];
  const banner = { x: HELP_DIALOG.x - box.ax, y: HELP_DIALOG.y - box.ay, w: box.w, h: box.h };
  const head = face ? { x: HELP_DIALOG.x - 224 - face.ax, y: HELP_DIALOG.y + face.h / 2 - face.ay, w: face.w, h: face.h } : null;
  const safeLeft = head ? head.x + head.w + 2 : banner.x + 10;
  return { banner, head, textX: HELP_DIALOG.x, textY: HELP_DIALOG.y + HELP_DIALOG.textY,
    maxWidth: Math.min(512 * .8, 2 * (HELP_DIALOG.x - safeLeft)) };
}
