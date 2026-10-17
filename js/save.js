// Guardado localStorage (gratis, sin backend).
import { trophyForItem } from "./trophies.js";
const KEY = "vascolet4-save-v1", SETK = "vascolet4-settings-v1";
const DEFAULT_SETTINGS = { volume: 0.8, music: 0.8, sfx: 0.8, musicMute: false, sfxMute: false, fullscreen: false, stretch: true, filterTextures: true };
export const Save = {
  read() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  write(d) {
    try {
      const previous = this.read() || {};
      localStorage.setItem(KEY, JSON.stringify({ ...previous, ...d,
        unlocked: Math.max(this.unlocked(), Math.min(18, Math.max(1, Math.floor(Number(d.unlocked) || 1)))) }));
    } catch {}
  },
  clear() { try { localStorage.removeItem(KEY); } catch {} },
  unlocked() { return Math.min(18, Math.max(1, Math.floor(Number(this.read()?.unlocked) || 1))); },
  unlock(n) {
    try {
      const s = JSON.parse(localStorage.getItem(KEY)) || {};
      s.unlocked = Math.max(s.unlocked || 1, Math.min(18, n));
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
  },
  hasItem(kind) { return Array.isArray(this.read()?.items) && this.read().items.includes(kind); },
  collectItem(kind) {
    if (!trophyForItem(kind) || this.hasItem(kind)) return false;
    const saved = this.read() || {};
    this.write({ items: [...(Array.isArray(saved.items) ? saved.items : []), kind] });
    return true;
  },
  run() {
    const r = this.read()?.run;
    if (!r || !Number.isInteger(r.level) || r.level < 1 || r.level > 18 || !r.checkpoint ||
      !Number.isFinite(r.checkpoint.x) || !Number.isFinite(r.checkpoint.y) ||
      !Number.isInteger(r.lives) || r.lives < 0 || !Array.isArray(r.consumed)) return null;
    return r;
  },
  saveRun(run) {
    this.write({ run: { ...run, checkpoint: { ...run.checkpoint }, consumed: [...(run.consumed || [])] } });
  },
  completeLevel(n) {
    const s = this.read() || {};
    this.write({ completed: [...new Set([...(Array.isArray(s.completed) ? s.completed : []), n])],
      unlocked: Math.min(18, n + 1), run: null });
  },
  settings() { try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETK)) || {}) }; } catch { return { ...DEFAULT_SETTINGS }; } },
  writeSettings(s) { try { localStorage.setItem(SETK, JSON.stringify(s)); } catch {} },
};
