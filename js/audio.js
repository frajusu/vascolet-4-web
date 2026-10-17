import { Save } from "./save.js";

const volume = (n, fallback = 1) => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
export const Audio2 = {
  ctx: null, musicGain: null, musicEl: null, buffers: new Map(), errors: new Map(),
  volume: 0.8, maxEffects: 16, maxBuffers: 64,
  _bufferPromises: new Map(), _active: new Map(), _pendingEffects: 0,
  _target: null, _pendingMusic: false, _effectVersion: 0,
  init(target = globalThis.window ?? globalThis) {
    if (this._target === target) return this;
    if (this._target) {
      this._target.removeEventListener("pointerdown", this._unlockHandler);
      this._target.removeEventListener("keydown", this._unlockHandler);
    }
    this._target = target;
    const s = Save.settings();
    this.setVolumes(s.musicMute ? 0 : s.music ?? s.volume ?? 0.8, s.sfxMute ? 0 : s.sfx ?? s.volume ?? 0.8);
    this._unlockHandler = () => { void this.unlock(); };
    // Keep listening: a later track/context may need another gesture retry.
    target.addEventListener("pointerdown", this._unlockHandler);
    target.addEventListener("keydown", this._unlockHandler);
    return this;
  },
  _report(key, error) {
    if (!this.errors.has(key)) {
      this.errors.set(key, error);
      console.error(`Audio ${key}:`, error);
    }
  },
  // Failed files are suppressed until explicitly retried, avoiding per-frame spam.
  clearErrors() { this.errors.clear(); },
  _ensureContext() {
    if (this.ctx) return this.ctx;
    const target = this._target ?? globalThis.window ?? globalThis;
    const AC = target.AudioContext || target.webkitAudioContext;
    if (!AC) { this._report("context", new Error("WebAudio is unavailable")); return null; }
    try {
      this.ctx = new AC();
      // Legacy name retained; this is the effects master gain, not the media element.
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.sfxVolume ?? this.volume;
      this.musicGain.connect(this.ctx.destination);
      return this.ctx;
    } catch (error) { this.ctx = null; this._report("context", error); return null; }
  },
  async _resumeContext() {
    const ctx = this._ensureContext();
    if (!ctx) return false;
    try {
      if (ctx.state !== "running") await ctx.resume();
      return ctx.state === "running";
    } catch (error) {
      if (error.name !== "NotAllowedError") this._report("resume", error);
      return false;
    }
  },
  async unlock() {
    // Invoke play() during the gesture, before awaiting resume().
    const music = this._pendingMusic ? this._playMusic() : Promise.resolve(true);
    const resumed = this._resumeContext();
    const results = await Promise.all([music, resumed]);
    return results.every(Boolean);
  },
  setVolume(v) {
    return this.setVolumes(v, v);
  },
  setVolumes(music, sfx) {
    this.musicVolume = volume(music, this.musicVolume ?? 0.8);
    this.sfxVolume = volume(sfx, this.sfxVolume ?? 0.8);
    this.volume = Math.max(this.musicVolume, this.sfxVolume);
    if (this.musicGain) this.musicGain.gain.value = this.sfxVolume;
    if (this.musicEl) this.musicEl.volume = this.musicVolume;
    return this.volume;
  },
  stopMusic() {
    if (this.musicEl) this.musicEl.pause();
    this.musicEl = null; this._musicPath = null; this._pendingMusic = false;
  },
  async music(path) {
    this.stopMusic();
    if (!path) return true;
    if (this.errors.has(`music:${path}`)) return false;
    try {
      const target = this._target ?? globalThis.window ?? globalThis;
      const el = new target.Audio(path);
      el.loop = true; el.volume = this.musicVolume ?? this.volume;
      this.musicEl = el; this._musicPath = path;
      el.addEventListener("error", () => {
        if (this.musicEl !== el) return;
        this._pendingMusic = false;
        this._report(`music:${path}`, new Error(`Media load failed: ${path} (code ${el.error?.code ?? "unknown"})`));
      });
      this._pendingMusic = true;
      return await this._playMusic();
    } catch (error) { this._report(`music:${path}`, error); return false; }
  },
  async _playMusic() {
    const el = this.musicEl, path = this._musicPath;
    if (!el) return false;
    try {
      await el.play();
      if (this.musicEl !== el) { el.pause(); return false; }
      this._pendingMusic = false;
      return true;
    } catch (error) {
      if (this.musicEl !== el) return false;
      this._pendingMusic = error.name === "NotAllowedError" || error.name === "AbortError";
      if (!this._pendingMusic) this._report(`music:${path}`, error);
      return false;
    }
  },
  async _loadBuffer(path, ctx) {
    if (this.buffers.has(path)) {
      const buffer = this.buffers.get(path);
      this.buffers.delete(path); this.buffers.set(path, buffer);
      return buffer;
    }
    if (this._bufferPromises.has(path)) return this._bufferPromises.get(path);
    const promise = (async () => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      this.buffers.set(path, buffer);
      while (this.buffers.size > Math.max(1, this.maxBuffers)) this.buffers.delete(this.buffers.keys().next().value);
      return buffer;
    })();
    this._bufferPromises.set(path, promise);
    try { return await promise; } finally { this._bufferPromises.delete(path); }
  },
  async sfx(path, vol = 1) {
    if (this.errors.has(`sfx:${path}`) || this._active.size + this._pendingEffects >= this.maxEffects) return null;
    const version = this._effectVersion;
    this._pendingEffects++;
    let source, gain;
    try {
      if (!await this._resumeContext()) return null;
      const ctx = this.ctx, buffer = await this._loadBuffer(path, ctx);
      if (version !== this._effectVersion || ctx !== this.ctx || ctx.state !== "running") return null;
      source = ctx.createBufferSource(); gain = ctx.createGain();
      source.buffer = buffer; gain.gain.value = volume(vol);
      source.connect(gain); gain.connect(this.musicGain);
      this._active.set(source, gain);
      source.onended = () => this._release(source, gain);
      source.start();
      return source;
    } catch (error) {
      if (source) this._release(source, gain);
      this._report(`sfx:${path}`, error);
      return null;
    } finally { this._pendingEffects--; }
  },
  _release(source, gain) {
    this._active.delete(source);
    source.disconnect(); gain?.disconnect();
  },
  stopEffects() {
    this._effectVersion++;
    for (const [source, gain] of this._active) {
      source.onended = null;
      try { source.stop(); } finally { this._release(source, gain); }
    }
  },
};
