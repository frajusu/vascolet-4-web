// GlobalPositioner ellipse/axis motion, original Platforms group. Position is
// the platform subject's foot; native collider half-width44, height28.
export function createPlatforms(map) {
  const platforms = [];
  for (const [index, o] of (map.groups.find(g => g.name === "Platforms")?.objects || []).entries()) {
    const count = Math.max(1, Math.min(16, Math.floor(Number(o.props.count) || 1)));
    for (let i = 0; i < count; i++) {
      const p = { id: `${index}:${i}`, homeX: o.x + o.w / 2, homeY: o.y + o.h / 2,
        rx: o.w / 2, ry: o.h / 2, ellipse: o.name === "Circle", phase: Math.PI * 2 * i / count,
        period: Math.max(1, Math.hypot(o.w, o.h) / 32), timeScale: Number(o.props.timeScale ?? 1),
        time: 0, x: 0, y: 0, prevX: 0, prevY: 0, w: 88, h: 28, anim: null };
      position(p); p.prevX = p.x; p.prevY = p.y; platforms.push(p);
    }
  }
  return platforms;
}
function position(p) {
  const angle = p.time * p.timeScale * Math.PI * 2 / p.period + p.phase;
  p.x = p.homeX + (p.ellipse ? Math.cos(angle) : Math.sin(angle)) * p.rx;
  p.y = p.homeY + Math.sin(angle) * p.ry;
}
export function updatePlatforms(platforms, dt) {
  for (const p of platforms) { p.prevX = p.x; p.prevY = p.y; p.time += dt; position(p); p.anim?.update(dt); }
}
export function carryPlatform(body, platforms) {
  const p = platforms.find(p => p.id === body.platformId);
  if (!p || !body.ground || body.vy < 0 || body.dropT > 0 ||
    Math.abs(body.x - p.prevX) > (p.w + body.w) / 2) { body.platformId = null; return; }
  body.x += p.x - p.prevX; body.y += p.y - p.prevY;
}
export function landOnPlatform(body, previousFoot, platforms) {
  const supported = body.platformId;
  body.platformId = null;
  if (body.dropT > 0 || body.vy < 0) return;
  const skin = body.skin || 0;
  for (const p of platforms) {
    const top = p.y - p.h, previousTop = p.prevY - p.h;
    if (Math.abs(body.x - p.x) > (body.w + p.w) / 2 ||
      (supported !== p.id && previousFoot > previousTop + skin + 1e-6) || body.y + skin < top - 1e-6) continue;
    body.y = top - skin; body.vy = 0; body.ground = true; body.platformId = p.id;
  }
}
