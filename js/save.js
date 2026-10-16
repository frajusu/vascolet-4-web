// Guardado localStorage (gratis, sin backend).
const KEY = "vascolet4-save-v1", SETK = "vascolet4-settings-v1";
const DEFAULT_SETTINGS = { volume: 0.8, music: 0.8, sfx: 0.8, musicMute: false, sfxMute: false, fullscreen: false, stretch: true };
export const Save = {
  read() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  write(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} },
  unlocked() { try { return JSON.parse(localStorage.getItem(KEY))?.unlocked ?? 1; } catch { return 1; } },
  unlock(n) {
    try {
      const s = JSON.parse(localStorage.getItem(KEY)) || {};
      s.unlocked = Math.max(s.unlocked || 1, Math.min(18, n));
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {}
  },
  settings() { try { return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETK)) || {}) }; } catch { return { ...DEFAULT_SETTINGS }; } },
  writeSettings(s) { try { localStorage.setItem(SETK, JSON.stringify(s)); } catch {} },
};
