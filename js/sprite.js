// Atlas coordinates and axis are source pixels, with no implicit HD conversion.
function transform(ctx, x, y, opts) {
  ctx.translate(opts.round === false ? x : Math.round(x), opts.round === false ? y : Math.round(y));
  // Parent flip also mirrors offsets/rotation; local scale does not move the pivot.
  if (opts.flip) ctx.scale(-1, 1);
  if (opts.ox || opts.oy) ctx.translate(opts.ox ?? 0, opts.oy ?? 0);
  if (opts.rot) ctx.rotate(opts.rot); // Canvas radians; original engine units remain unverified.
  const scale = opts.scale ?? 1;
  ctx.scale((opts.sx ?? 1) * scale, (opts.sy ?? 1) * scale);
  ctx.globalAlpha *= Math.max(0, Math.min(1, opts.alpha ?? 1));
  if (opts.blendMode) ctx.globalCompositeOperation = opts.blendMode === "normal" ? "source-over" : opts.blendMode;
}

export function drawAtlas(ctx, atlasImg, entry, dx, dy, opts = {}) {
  if (!atlasImg || !entry || entry.w <= 0 || entry.h <= 0) return false;
  if (opts.alpha === 0 || opts.scale === 0 || opts.sx === 0 || opts.sy === 0) return false;
  ctx.save();
  try {
    transform(ctx, dx, dy, opts);
    // inset anti-bleeding: recorta medio pixel de cada borde del atlas
    ctx.drawImage(atlasImg, entry.x + 0.5, entry.y + 0.5, entry.w - 1, entry.h - 1,
      -entry.ax, -entry.ay, entry.w, entry.h);
  } finally { ctx.restore(); }
  return true;
}

// Draw only this frame's sprites, in XML order. Empty frames draw nothing.
// atlasImg may also be a Map or resolver(sourceImage) for multi-page libraries.
export function drawAnimFrame(ctx, atlasImg, atlas, frame, dx, dy, opts = {}) {
  const sprites = frame?.sprites ?? (frame?.img ? [frame] : []);
  let count = 0;
  if (!sprites.length) return count;
  ctx.save();
  try {
    transform(ctx, dx, dy, opts);
    for (const sp of sprites) {
      const entry = sp.img && atlas?.[sp.img];
      if (!entry) continue;
      const image = typeof atlasImg === "function" ? atlasImg(entry.img)
        : atlasImg instanceof Map ? atlasImg.get(entry.img) : atlasImg;
      if (drawAtlas(ctx, image, entry, sp.ox ?? 0, sp.oy ?? 0, { ...sp, ox: 0, oy: 0, round: false })) count++;
    }
  } finally { ctx.restore(); }
  return count;
}

// duration/fps seconds is inferred from asset consistency, not confirmed engine timing.
export class AnimPlayer {
  constructor(anims = []) {
    this.anims = anims;
    this.events = [];
    this._pending = [];
    this.finished = true;
    this.i = 0; this.t = 0;
    this.set(anims[0]?.name);
  }
  get frame() { return this.cur?.frames[this.i] ?? null; }
  set(name, { restart = false } = {}) {
    const a = this.anims.find(a => a.name === name) || this.anims[0];
    if (!a || (a === this.cur && !restart)) return this;
    const loop = a.loop ?? -1;
    if (!Number.isInteger(loop) || loop < -1 || (a.frames.length && loop >= a.frames.length))
      throw new RangeError(`Invalid loop index in ${a.name}`);
    this.cur = a; this.i = 0; this.t = 0;
    this.events.length = 0; this._pending.length = 0;
    this.finished = !a.frames.length;
    if (!this.finished) this._enter();
    return this;
  }
  restart(name = this.cur?.name) { return this.set(name, { restart: true }); }
  has(name) { return this.anims.some(a => a.name === name); }
  _enter() {
    const frame = this.frame;
    for (const type of frame.flags ?? (frame.flag ? [frame.flag] : [])) {
      const event = { type, animation: this.cur.name, frameIndex: this.i, frame };
      this.events.push(event); this._pending.push(event);
    }
  }
  // The queue survives update(). Consume once via drainEvents(), or use the
  // per-update events/flags result. flag is a lossy compatibility alias only.
  drainEvents() {
    const events = this.events.splice(0);
    this._pending.length = 0;
    return events;
  }
  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError("Animation dt must be finite and nonnegative");
    if (this.cur && !this.finished) {
      const fps = this.cur.fps ?? 12;
      if (!Number.isFinite(fps) || fps <= 0) throw new RangeError("Animation fps must be positive");
      this.t += dt;
      while (!this.finished) {
        const duration = (this.frame.dur ?? 1) / fps;
        if (!Number.isFinite(duration) || duration <= 0) throw new RangeError("Frame duration must be positive");
        if (this.t < duration && duration - this.t > duration * 1e-10) break;
        this.t = Math.max(0, this.t - duration);
        if (this.i + 1 < this.cur.frames.length) this.i++;
        else if ((this.cur.loop ?? -1) >= 0) this.i = this.cur.loop;
        else { this.finished = true; this.t = 0; break; }
        this._enter();
      }
    }
    const events = this._pending.splice(0), flags = events.map(e => e.type);
    return { frame: this.frame, flag: flags[0] ?? null, flags, events, finished: this.finished };
  }
}

export function pixel(ctx, fn) {
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  try { return fn(); } finally { ctx.imageSmoothingEnabled = prev; }
}
