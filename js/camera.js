import { autoCameraPath, advanceAutoCamera } from "./stage-modes.js";
// TMX Camera lines bound the playable regions, not the (much taller) tile canvas.
// Named point markers belong to scrolling stages and are not solid barriers.
export function cameraBounds(map, subject, width = 512, height = 384) {
  const bounds = { minX: 0, minY: 0, maxX: Math.max(0, map.w * map.tw - width), maxY: Math.max(0, map.h * map.th - height) };
  const zones = map.groups.find(g => g.name === "Camera");
  for (const line of zones?.objects ?? []) {
    if (line.w > 0 && line.h === 0 && subject.x >= line.x && subject.x <= line.x + line.w) {
      if (subject.y <= line.y) bounds.maxY = Math.min(bounds.maxY, Math.max(0, line.y - height));
    }
    if (line.h > 0 && line.w === 0 && subject.y >= line.y && subject.y <= line.y + line.h) {
      if (subject.x < line.x) bounds.maxX = Math.min(bounds.maxX, Math.max(0, line.x - width));
      else bounds.minX = Math.max(bounds.minX, line.x);
    }
  }
  bounds.minX = Math.min(bounds.minX, bounds.maxX);
  return bounds;
}

export function updateCamera(game, dt, snap = false) {
  const p = game.player, b = cameraBounds(game.map, p);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  if (snap) {
    const points = autoCameraPath(game.map);
    game.autoCamera = points.length > 1 ? { points, x: points[0].x, y: points[0].y, index: 1 } : null;
  }
  if (game.autoCamera) {
    advanceAutoCamera(game.autoCamera, dt);
    game.camX = clamp(game.autoCamera.x - 256, 0, b.maxX);
    game.camY = clamp(game.autoCamera.y - 192, 0, b.maxY);
    return;
  }
  // GameSubjectCamera::updateOnSubject accumulates displacement, clamped to
  // +/-60. It is not an exponential chase behind the player's movement.
  if (snap || !game.cameraTrack) game.cameraTrack = { lastX: p.x, leadX: 0, floorY: p.y };
  const track = game.cameraTrack, px = p.x;
  track.leadX = clamp(track.leadX + px - track.lastX, -60, 60); track.lastX = px;
  if (p.ground || p.y > track.floorY) track.floorY = p.y;
  const jumpCorrection = Math.max(0, track.floorY - p.y) * .5;
  const y = clamp(track.floorY - jumpCorrection - 232, b.minY, b.maxY);
  game.camX = clamp(px + track.leadX - 256, b.minX, b.maxX);
  if (snap || y <= game.camY) game.camY = y;
  else game.camY = Math.min(y, game.camY + Math.max(15, (y - game.camY) * 3) * dt);
  game.camY = clamp(game.camY, b.minY, b.maxY);
}
