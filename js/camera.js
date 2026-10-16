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
  const x = clamp(p.x - 256, b.minX, b.maxX);
  const y = clamp(p.y - 232, b.minY, b.maxY);
  const blend = snap ? 1 : 1 - Math.exp(-8 * dt);
  game.camX = clamp(game.camX + (x - game.camX) * blend, b.minX, b.maxX);
  game.camY = clamp(game.camY + (y - game.camY) * blend, b.minY, b.maxY);
}
