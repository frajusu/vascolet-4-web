// Edges persist until a simulation step consumes them, independently of rendering.
export const Input = {
  held: new Set(), pressed: new Set(), released: new Set(),
  mouse: { x: 0, y: 0, inside: false, revision: 0 },
  _keys: new Map(), _target: null, _handlers: null,
  init(target = globalThis.window ?? globalThis) {
    if (this._target === target) return this;
    this.dispose();
    const down = e => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(e.key)) e.preventDefault();
      const k = key(e), physical = e.code || e.key.toLowerCase();
      if (!e.repeat && !this._keys.has(physical)) this.pressed.add(k);
      this._keys.set(physical, k);
      this.held.add(k);
    };
    const up = e => {
      const physical = e.code || e.key.toLowerCase(), k = this._keys.get(physical) ?? key(e);
      this._keys.delete(physical);
      if (![...this._keys.values()].includes(k)) { this.held.delete(k); this.released.add(k); }
    };
    const blur = () => this.reset();
    const visibility = () => { if (target.document?.hidden) this.reset(); };
    const move = e => {
      const canvas = target.document?.getElementById("game");
      if (!canvas) return;
      const r = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) / (r.width || 1) * 512;
      this.mouse.y = (e.clientY - r.top) / (r.height || 1) * 384;
      this.mouse.inside = true;
      this.mouse.revision++;
    };
    const leave = () => { this.mouse.inside = false; };
    const click = e => {
      move(e);
      if (e.button === 0) this.pressed.add("click");
    };
    this._target = target; this._handlers = { keydown: down, keyup: up, blur };
    for (const [type, fn] of Object.entries(this._handlers)) target.addEventListener(type, fn);
    this._mouse = { move, leave, click };
    target.addEventListener("mousemove", move);
    target.addEventListener("mouseleave", leave);
    target.addEventListener("mousedown", click);
    this._visibility = visibility;
    target.document?.addEventListener("visibilitychange", visibility);
    return this;
  },
  dispose() {
    if (this._target) {
      for (const [type, fn] of Object.entries(this._handlers)) this._target.removeEventListener(type, fn);
      if (this._mouse) {
        this._target.removeEventListener("mousemove", this._mouse.move);
        this._target.removeEventListener("mouseleave", this._mouse.leave);
        this._target.removeEventListener("mousedown", this._mouse.click);
      }
      this._target.document?.removeEventListener("visibilitychange", this._visibility);
    }
    this._target = null; this._handlers = null; this._mouse = null;
    this.reset();
  },
  reset() { this.held.clear(); this.pressed.clear(); this.released.clear(); this._keys.clear(); },
  down(k) { return this.held.has(k); },
  consumePressed(k) { return this.pressed.delete(k); },
  endStep() { this.pressed.clear(); this.released.clear(); },
  endFrame() { this.endStep(); }, // Compatibility only: call after an update, not every rAF.
};
function key(e) {
  const k = e.key.toLowerCase();
  return ({ arrowleft: "left", arrowright: "right", arrowup: "up", arrowdown: "down", escape: "esc" })[k] ?? k;
}
export const jumpHeld = () => Input.down("z") || Input.down("s");
export const jumpPressed = () => Input.pressed.has("z") || Input.pressed.has("s");
export const firePressed = () => Input.pressed.has("a") || Input.pressed.has("x");
