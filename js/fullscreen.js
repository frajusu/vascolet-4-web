// Fullscreen preference is persistent; the checkbox always shows browser state.
// A browser grants fullscreen only following a user gesture. Keyboard Lock is
// optional: without it, leaving fullscreen still pauses gameplay on the first Esc.
import { Save } from "./save.js";

export function createFullscreenController({ doc, target, keyboard, readPreference, writePreference, onExit = () => false }) {
  let initialized = false, previous = false, restorePending = false, pending = null;
  let lockRequested = false, locked = false, suppressEscapeUntil = 0, lastError = null;
  const active = () => !!doc.fullscreenElement;
  const now = () => target.performance?.now() ?? Date.now();
  const unlock = () => { try { keyboard?.unlock?.(); } catch {} locked = false; lockRequested = false; };
  const lockEscape = () => {
    if (!active() || lockRequested || !keyboard?.lock) return;
    lockRequested = true;
    try {
      Promise.resolve(keyboard.lock(["Escape"])).then(() => {
        if (!active()) { unlock(); return; }
        locked = true;
      }).catch(() => { locked = false; });
    } catch { locked = false; }
  };
  const changed = () => {
    const current = active(), exited = previous && !current;
    previous = current;
    if (current) lockEscape();
    else {
      unlock();
      if (exited && onExit()) suppressEscapeUntil = now() + 200;
    }
  };
  const set = (wanted, { persist = true } = {}) => {
    restorePending = false;
    if (pending) return pending.then(() => set(wanted, { persist }));
    if (persist) writePreference(!!wanted);
    if (wanted === active()) { if (wanted) lockEscape(); return Promise.resolve(true); }
    let operation;
    try {
      if (wanted) {
        if (!doc.documentElement?.requestFullscreen) throw new Error("Fullscreen is unavailable");
        operation = doc.documentElement.requestFullscreen({ navigationUI: "hide" });
      } else {
        if (!doc.exitFullscreen) throw new Error("Fullscreen exit is unavailable");
        operation = doc.exitFullscreen();
      }
    } catch (error) { operation = Promise.reject(error); }
    pending = Promise.resolve(operation).then(() => {
      lastError = null; changed(); return active() === wanted;
    }).catch(error => {
      lastError = error;
      if (persist) writePreference(active());
      return false;
    }).finally(() => { pending = null; });
    return pending;
  };
  const gesture = event => {
    if (!event.isTrusted) return;
    if (event.type === "keydown" && event.key === "Escape") {
      if (now() < suppressEscapeUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
      else if (active() && locked) event.preventDefault();
      return;
    }
    if (event.type === "keydown" && (event.repeat || ["Tab","Shift","Control","Alt","Meta"].includes(event.key))) return;
    if (event.type === "pointerup" && event.button !== 0) return;
    if (restorePending && !active()) void set(true, { persist: false });
  };
  return {
    active,
    set,
    get locked() { return locked; },
    get restoring() { return restorePending; },
    get lastError() { return lastError; },
    init() {
      if (initialized) return;
      initialized = true; previous = active(); restorePending = !!readPreference() && !previous;
      doc.addEventListener("fullscreenchange", changed);
      target.addEventListener("keydown", gesture, true);
      target.addEventListener("pointerup", gesture, true);
      if (previous) lockEscape();
    },
    dispose() {
      doc.removeEventListener("fullscreenchange", changed);
      target.removeEventListener("keydown", gesture, true);
      target.removeEventListener("pointerup", gesture, true);
      initialized = false; restorePending = false; unlock();
    },
  };
}

let controller = null;
export function fullscreenActive() { return !!globalThis.document?.fullscreenElement; }
export function initFullscreen(onExit) {
  controller?.dispose();
  const doc = globalThis.document, target = globalThis.window;
  controller = createFullscreenController({ doc, target, keyboard: target.navigator?.keyboard,
    readPreference: () => Save.settings().fullscreen,
    writePreference: value => Save.writeSettings({ ...Save.settings(), fullscreen: value }), onExit });
  controller.init();
  return controller;
}
export function setFullscreen(wanted) {
  if (!controller) initFullscreen();
  return controller.set(wanted);
}
