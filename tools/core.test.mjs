import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { parseTMX, parseTSX, parseAnims, parseAtlas, TILE_FLAGS } from "../js/tmx.js";
import { AnimPlayer, drawAtlas, drawAnimFrame, pixel } from "../js/sprite.js";
import { Input, jumpHeld, jumpPressed, firePressed } from "../js/input.js";
import { A, loadImage, loadAssets, loadXML, img } from "../js/assets.js";
import { Audio2 } from "../js/audio.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const dom = new JSDOM("", { url: "https://core.test/" });
const parser = new dom.window.DOMParser();
const xml = text => parser.parseFromString(text, "text/xml");
const assetXML = file => xml(fs.readFileSync(path.join(root, "assets", file), "utf8"));
test.after(() => { Input.dispose(); dom.window.close(); });

test("every character XML preserves all animations, frames, sprites, flags and timing", t => {
  const base = path.join(root, "assets", "characters");
  const files = fs.readdirSync(base, { recursive: true })
    .filter(file => /animdata[\\/].*\.xml$/i.test(file)).sort();
  const totals = { files: files.length, animations: 0, frames: 0, sprites: 0, flags: 0, empty: 0, multipleFlags: 0 };
  for (const file of files) {
    const doc = xml(fs.readFileSync(path.join(base, file), "utf8"));
    const source = [...doc.querySelectorAll("Animation")], parsed = parseAnims(doc);
    assert.equal(parsed.length, source.length, file);
    totals.animations += source.length;
    source.forEach((animation, ai) => {
      const a = parsed[ai], frames = [...animation.querySelectorAll("Frame")];
      assert.equal(a.name, animation.getAttribute("name"));
      assert.equal(a.fps, Number(animation.getAttribute("fps")));
      assert.equal(a.loop, Number(animation.getAttribute("loopIndex")));
      assert.equal(a.frames.length, frames.length, `${file}:${a.name}`);
      frames.forEach((frame, fi) => {
        const f = a.frames[fi], sprites = [...frame.querySelectorAll("Sprite")];
        const flags = [...frame.querySelectorAll("Flag")].map(flag => flag.getAttribute("type"));
        totals.frames++; totals.sprites += sprites.length; totals.flags += flags.length;
        if (!sprites.length && !flags.length) totals.empty++;
        if (flags.length > 1) totals.multipleFlags++;
        assert.equal(f.dur, Number(frame.getAttribute("duration")));
        assert.equal(f.dx, Number(frame.getAttribute("xDisplacement")));
        assert.equal(f.dy, Number(frame.getAttribute("yDisplacement")));
        assert.equal(f.sprites.length, sprites.length);
        assert.deepEqual(f.flags, flags);
        assert.equal(f.flag, flags[0] ?? null);
        assert.equal(f.img, sprites[0]?.getAttribute("image") ?? null);
        assert.equal(f.empty, !sprites.some(s => s.getAttribute("image")));
        sprites.forEach((sp, si) => {
          const s = f.sprites[si];
          assert.equal(s.img, sp.getAttribute("image"));
          for (const [property, attr, fallback] of [
            ["ox", "xOffset", 0], ["oy", "yOffset", 0], ["sx", "xScale", 1],
            ["sy", "yScale", 1], ["rot", "rotation", 0], ["alpha", "alpha", 1],
          ]) assert.equal(s[property], sp.hasAttribute(attr) ? Number(sp.getAttribute(attr)) : fallback);
        });
      });
      assert.equal(a.frames.reduce((sum, f) => sum + f.dur / a.fps, 0),
        frames.reduce((sum, f) => sum + Number(f.getAttribute("duration")) / a.fps, 0));
    });
  }
  assert.ok(totals.files > 70 && totals.frames > 1000);
  assert.ok(totals.empty > 0 && totals.flags > 0 && totals.multipleFlags > 0);
  t.diagnostic(JSON.stringify(totals));
});

test("synthetic composite frame retains sprite order, simultaneous flags and optional defaults", () => {
  const [a] = parseAnims(xml(`<ExportedData><Animations><Animation name="test" fps="24" loopIndex="-1">
    <Frame duration="2"><Sprite image="front"/><Sprite image="back" xScale="-1" alpha="0"/>
      <Flag type="PlaySound" sound="step"/><Flag type="MakeEffect"/></Frame>
    <Frame duration="3"/><Frame duration="1"><Sprite image=""/></Frame>
  </Animation></Animations></ExportedData>`));
  assert.deepEqual(a.frames[0].sprites.map(s => s.img), ["front", "back"]);
  assert.equal(a.frames[0].sprites[0].alpha, 1);
  assert.equal(a.frames[0].sprites[1].alpha, 0);
  assert.equal(a.frames[0].sprites[1].sx, -1);
  assert.deepEqual(a.frames[0].flags, ["PlaySound", "MakeEffect"]);
  assert.equal(a.frames[0].flagData[0].sound, "step");
  assert.equal(a.frames[1].empty, true);
  assert.equal(a.frames[2].empty, true);
  assert.equal(a.frames.length, 3);
});

test("all 18 TMX maps retain dimensions, layer opacity/visibility and object coordinates", () => {
  for (let n = 1; n <= 18; n++) {
    const doc = assetXML(`data/maps/level${n}.tmx`), m = parseTMX(doc);
    assert.equal(m.tw, 32); assert.equal(m.th, 32);
    assert.equal(m.layers.length, doc.querySelectorAll("layer").length);
    [...doc.querySelectorAll("layer")].forEach((source, i) => {
      const layer = m.layers[i];
      assert.equal(layer.data.length, layer.w * layer.h);
      assert.equal(layer.opacity, Number(source.getAttribute("opacity") ?? 1));
      assert.equal(layer.visible, source.getAttribute("visible") !== "0");
    });
    const start = m.groups.find(g => g.name === "General").objects.find(o => o.name === "Start");
    const original = doc.querySelector('object[name="Start"]');
    assert.equal(start.x, Number(original.getAttribute("x")));
    assert.equal(start.y, Number(original.getAttribute("y")));
  }
  const bg = parseTMX(assetXML("data/maps/backgrounds/back_area1.tmx"));
  assert.equal(bg.layers[0].h, 12);
  assert.equal(bg.layers[1].visible, false);
  const sample = parseTMX(xml(`<map width="1" height="1" tilewidth="32" tileheight="32">
    <properties><property name="present" value=""/></properties>
    <layer name="a" width="1" height="1" opacity="0" visible="0"><data encoding="csv">0</data>
      <properties><property name="local">text value</property></properties></layer>
    <objectgroup name="g"><object x="0" y="0" width="0" height="0"/></objectgroup></map>`));
  assert.deepEqual(sample.props, { present: "" });
  assert.deepEqual(sample.layers[0].props, { local: "text value" });
  assert.equal(sample.layers[0].opacity, 0);
  assert.equal(sample.groups[0].objects[0].w, 0);
  assert.throws(() => parseTMX(xml('<map><layer width="1" height="1"><data encoding="base64">AAAA</data></layer></map>')), /Unsupported TMX/);
});

test("TSX collision flags combine by presence, including real solid+damage tiles", () => {
  assert.deepEqual(TILE_FLAGS, { SOLID: 1, UP: 2, DAMAGE: 4 });
  const ts = parseTSX(assetXML("data/maps/tilesets/tileset_area5.tsx"));
  for (const id of [514, 515, 516, 517, 546, 547, 548, 549]) assert.equal(ts.flags[id], 5);
  const all = parseTSX(xml(`<tileset tilewidth="32" tileheight="32"><image source="a.png" width="32" height="32"/>
    <tile id="0"><properties><property name="solid" value=""/><property name="up" value=""/>
      <property name="damage" value=""/></properties></tile></tileset>`));
  assert.equal(all.flags[0], 7);
});

test("animation dispatches initial and every loop-visit flag, including multiple crossed frames", () => {
  const player = new AnimPlayer([{ name: "loop", fps: 10, loop: 1, frames: [
    { dur: 2, flags: ["initial"] }, { dur: 1, flags: ["sound", "effect"] }, { dur: 1, flags: ["end"] },
  ] }]);
  assert.deepEqual(player.update(0).flags, ["initial"]);
  assert.deepEqual(player.drainEvents().map(e => [e.type, e.frameIndex]), [["initial", 0]]);
  assert.deepEqual(player.update(0.5).flags, ["sound", "effect", "end", "sound", "effect", "end"]);
  assert.equal(player.i, 2);
  assert.equal(player.finished, false);
  assert.deepEqual(player.drainEvents().map(e => e.type), ["sound", "effect", "end", "sound", "effect", "end"]);
  assert.deepEqual(player.drainEvents(), []);
  player.restart();
  assert.deepEqual(player.drainEvents().map(e => e.type), ["initial"]);
  assert.deepEqual(player.update(0).flags, []); // Already consumed through the queue.
});

test("single-frame flags repeat each loop and no 64-frame guard loses events", () => {
  const player = new AnimPlayer([{ name: "sound", fps: 12, loop: 0, frames: [{ dur: 1, flag: "PlaySound" }] }]);
  assert.equal(player.update(0).flag, "PlaySound");
  player.drainEvents();
  assert.equal(player.update(6).flags.length, 72);
  assert.equal(player.drainEvents().length, 72);
  assert.equal(player.update(1 / 12).flag, "PlaySound");
});

test("duration/fps timing preserves blank frames and completes one-shots only after the final duration", () => {
  const [animation] = parseAnims(xml(`<ExportedData><Animations><Animation name="once" fps="12" loopIndex="-1">
    <Frame duration="24"><Sprite image="stand"/><Flag type="start"/></Frame>
    <Frame duration="1"/><Frame duration="2"><Sprite image="last"/><Flag type="last"/></Frame>
  </Animation></Animations></ExportedData>`));
  const player = new AnimPlayer([animation]);
  player.drainEvents();
  for (let i = 0; i < 119; i++) player.update(1 / 60);
  assert.equal(player.frame.img, "stand");
  assert.equal(player.update(1 / 60).frame.empty, true);
  player.update(1 / 12);
  assert.equal(player.frame.img, "last");
  assert.equal(player.finished, false);
  assert.equal(player.update(2 / 12).finished, true);
  assert.deepEqual(player.drainEvents().map(e => e.type), ["last"]);
  assert.deepEqual(player.update(10).events, []);
  player.set("once");
  assert.equal(player.finished, true); // Same-name set is backward-compatible/idempotent.
  player.restart();
  assert.equal(player.finished, false);
  assert.equal(player.frame.img, "stand");
  assert.throws(() => player.update(-1), /nonnegative/);
  assert.throws(() => player.update(Infinity), /finite/);
});

function fakeContext() {
  const ctx = { commands: [], draws: [], globalAlpha: 0.5, globalCompositeOperation: "multiply", imageSmoothingEnabled: true };
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const multiply = ([a, b, c, d, e, f]) => {
    const [aa, bb, cc, dd, ee, ff] = matrix;
    matrix = [aa * a + cc * b, bb * a + dd * b, aa * c + cc * d, bb * c + dd * d,
      aa * e + cc * f + ee, bb * e + dd * f + ff];
  };
  ctx.save = () => { ctx.commands.push(["save"]); stack.push([matrix.slice(), ctx.globalAlpha, ctx.globalCompositeOperation]); };
  ctx.restore = () => { ctx.commands.push(["restore"]); [matrix, ctx.globalAlpha, ctx.globalCompositeOperation] = stack.pop(); };
  ctx.translate = (x, y) => { ctx.commands.push(["translate", x, y]); multiply([1, 0, 0, 1, x, y]); };
  ctx.scale = (x, y) => { ctx.commands.push(["scale", x, y]); multiply([x, 0, 0, y, 0, 0]); };
  ctx.rotate = r => { ctx.commands.push(["rotate", r]); multiply([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]); };
  ctx.drawImage = (...args) => ctx.draws.push({ args, matrix: matrix.slice(), alpha: ctx.globalAlpha, blend: ctx.globalCompositeOperation });
  return ctx;
}

test("atlas draw uses source crop, pivot, explicit local transforms and inherited alpha", () => {
  const ctx = fakeContext(), image = {}, entry = { x: 7, y: 11, w: 20, h: 30, ax: 3, ay: 25 };
  drawAtlas(ctx, image, entry, 100.4, 200.4, { flip: true, ox: 4, oy: -2, rot: Math.PI / 2, sx: 2, sy: 3, scale: 0.5, alpha: 0.4 });
  assert.deepEqual(ctx.draws[0].args, [image, 7.5, 11.5, 19, 29, -3, -25, 20, 30]);
  assert.deepEqual(ctx.commands, [["save"], ["translate", 100, 200], ["scale", -1, 1],
    ["translate", 4, -2], ["rotate", Math.PI / 2], ["scale", 1, 1.5], ["restore"]]);
  assert.equal(ctx.draws[0].alpha, 0.2);
  assert.equal(ctx.globalAlpha, 0.5);
  assert.equal(ctx.globalCompositeOperation, "multiply");
  assert.equal(drawAtlas(ctx, image, entry, 0, 0, { sx: 0 }), false);
  assert.equal(drawAtlas(ctx, image, entry, 0, 0, { alpha: 0 }), false);
  assert.equal(ctx.draws.length, 1);
});

test("frame drawing orders composite sprites, mirrors positive offsets, and never reuses a blank frame", () => {
  const [a] = parseAnims(xml(`<ExportedData><Animations><Animation name="draw" fps="12" loopIndex="-1">
    <Frame duration="1"><Sprite image="front" xOffset="4" yOffset="-2" xScale="-1" alpha="0.5"/>
      <Sprite image="back" xOffset="-3" yOffset="1"/><Sprite image="front" alpha="0"/></Frame>
    <Frame duration="1"/><Frame duration="1"><Sprite image=""/></Frame>
  </Animation></Animations></ExportedData>`));
  const ctx = fakeContext(), image = {};
  const atlas = { front: { img: "page", x: 1, y: 2, w: 8, h: 9, ax: 3, ay: 7 },
    back: { img: "page", x: 20, y: 30, w: 10, h: 11, ax: 5, ay: 6 } };
  assert.equal(drawAnimFrame(ctx, new Map([["page", image]]), atlas, a.frames[0], 100, 200, { flip: true, scale: 2 }), 2);
  assert.deepEqual(ctx.draws.map(d => d.args.slice(1, 5)), [[1.5, 2.5, 7, 8], [20.5, 30.5, 9, 10]]);
  assert.deepEqual(ctx.draws[0].matrix, [2, 0, 0, 2, 92, 196]);
  assert.deepEqual(ctx.draws[1].matrix, [-2, 0, 0, 2, 106, 202]);
  assert.equal(ctx.draws[0].alpha, 0.25);
  assert.equal(drawAnimFrame(ctx, image, atlas, a.frames[1], 0, 0), 0);
  assert.equal(drawAnimFrame(ctx, image, atlas, a.frames[2], 0, 0), 0);
  assert.equal(ctx.draws.length, 2);
  const gui = parseAtlas(assetXML("gui/options/options.xml"));
  drawAtlas(ctx, image, gui.opciones, 256, 192);
  assert.deepEqual(ctx.draws[2].args.slice(1), [1.5, 386.5, 511, 383, -256, -192, 512, 384]);
});

test("drawing restores context even when drawImage or a pixel callback fails", () => {
  const ctx = fakeContext();
  ctx.drawImage = () => { throw new Error("draw failed"); };
  assert.throws(() => drawAtlas(ctx, {}, { x: 0, y: 0, w: 1, h: 1, ax: 0, ay: 0 }, 0, 0, { alpha: 0.2 }), /draw failed/);
  assert.equal(ctx.globalAlpha, 0.5);
  assert.throws(() => pixel(ctx, () => { assert.equal(ctx.imageSmoothingEnabled, false); throw new Error("pixel failed"); }), /pixel failed/);
  assert.equal(ctx.imageSmoothingEnabled, true);
});

test("input edges persist until endStep, held keys survive steps, repeats do not create edges, blur resets", () => {
  Input.init(dom.window); Input.init(dom.window);
  const key = (type, value, options = {}) => dom.window.dispatchEvent(new dom.window.KeyboardEvent(type, { key: value, bubbles: true, cancelable: true, ...options }));
  assert.equal(key("keydown", "ArrowRight"), false); // Scroll prevention.
  assert.equal(Input.pressed.has("right"), true);
  assert.equal(Input.down("right"), true);
  assert.equal(Input.pressed.has("right"), true); // No update has consumed it.
  Input.endStep();
  assert.equal(Input.pressed.has("right"), false);
  assert.equal(Input.down("right"), true);
  key("keydown", "ArrowRight", { repeat: true });
  key("keydown", "ArrowRight"); // Duplicate non-repeat event while physically held.
  assert.equal(Input.pressed.size, 0);
  key("keyup", "ArrowRight");
  assert.equal(Input.down("right"), false);
  assert.equal(Input.released.has("right"), true);
  key("keydown", "z", { code: "KeyZ" });
  assert.equal(jumpPressed(), true); assert.equal(jumpHeld(), true);
  assert.equal(Input.consumePressed("z"), true);
  assert.equal(Input.consumePressed("z"), false);
  assert.equal(jumpHeld(), true);
  key("keydown", "x"); assert.equal(firePressed(), true);
  dom.window.dispatchEvent(new dom.window.Event("blur"));
  assert.equal(Input.held.size + Input.pressed.size + Input.released.size, 0);
  key("keydown", "Z", { code: "KeyZ" });
  key("keyup", "z", { code: "KeyZ" });
  assert.equal(Input.down("z"), false);
  Input.endFrame(); assert.equal(Input.pressed.size, 0);
  Input.dispose();
  key("keydown", "x"); assert.equal(Input.pressed.size, 0);
});

test("two physical keys mapped to the same action stay held until both are released", () => {
  Input.init(dom.window);
  for (const code of ["ShiftLeft", "ShiftRight"]) dom.window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Shift", code }));
  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "Shift", code: "ShiftLeft" }));
  assert.equal(Input.down("shift"), true);
  dom.window.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "Shift", code: "ShiftRight" }));
  assert.equal(Input.down("shift"), false);
  Input.dispose();
});

function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; });
}
function clearAssets() {
  for (const map of [A.images, A.texts, A.imagePromises, A.xmlPromises]) map.clear();
}

test("XML loading shares in-flight promises and rejects HTTP, malformed XML and network failures", async t => {
  clearAssets(); t.after(clearAssets);
  replaceGlobal(t, "DOMParser", dom.window.DOMParser);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async file => {
    calls++;
    if (file === "missing.xml") return new Response("missing", { status: 404 });
    if (file === "broken.xml") return new Response("<data>");
    if (file === "offline.xml") throw new Error("offline");
    return new Response("<data><texts/></data>");
  });
  const first = loadXML("assets\\data.xml"), second = loadXML("assets/data.xml");
  assert.equal(first, second);
  assert.equal((await first).documentElement.localName, "data");
  assert.equal(await loadXML("assets/data.xml"), await first);
  assert.equal(calls, 1);
  assert.equal(A.texts.get("assets/data.xml"), "<data><texts/></data>");
  await assert.rejects(loadXML("missing.xml"), /missing\.xml.*HTTP 404/);
  await assert.rejects(loadXML("broken.xml"), /broken\.xml.*Malformed XML/);
  await assert.rejects(loadXML("offline.xml"), /offline\.xml.*offline/);
  assert.equal(A.xmlPromises.has("missing.xml"), false);
  await assert.rejects(loadXML("missing.xml"), /HTTP 404/);
  assert.equal(calls, 5); // Failed requests can be explicitly retried.
});

test("image loading shares requests, propagates failures and keeps overlapping progress local", async t => {
  clearAssets(); t.after(clearAssets);
  const pending = new Map();
  let created = 0;
  replaceGlobal(t, "Image", class {
    constructor() { created++; }
    set src(file) { this.path = file; pending.set(file, this); }
  });
  const first = loadImage("shared.png");
  assert.equal(first, loadImage("shared.png"));
  const a = [], b = [];
  const batchA = loadAssets(["shared.png", "slow.png"], (n, total) => a.push([n, total]));
  const batchB = loadAssets(["shared.png"], (n, total) => b.push([n, total]));
  pending.get("shared.png").onload();
  await batchB;
  pending.get("slow.png").onload();
  await batchA;
  assert.equal(created, 2);
  assert.equal(img("shared.png"), await first);
  assert.deepEqual(a, [[1, 2], [2, 2]]);
  assert.deepEqual(b, [[1, 1]]);
  assert.equal(A.loaded, 1); assert.equal(A.total, 1);
  const failed = loadAssets(["missing.png"]);
  pending.get("missing.png").onerror();
  await assert.rejects(failed, /Image load failed: missing\.png/);
  assert.equal(img("missing.png"), undefined);
  assert.equal(A.imagePromises.has("missing.png"), false);
  const retry = loadImage("missing.png");
  pending.get("missing.png").onload();
  await retry;
});

function fakeAudio(t) {
  const target = new dom.window.EventTarget(), instances = [], sources = [], logs = [];
  let contexts = 0, decodeCalls = 0;
  target.Audio = class extends dom.window.EventTarget {
    constructor(src) { super(); this.src = src; this.playCalls = 0; this.pauseCalls = 0; instances.push(this); }
    async play() {
      this.playCalls++;
      if (this.failure) throw this.failure;
    }
    pause() { this.pauseCalls++; }
  };
  const node = () => ({ gain: { value: 1 }, connect(to) { this.connected = to; }, disconnect() { this.disconnected = true; } });
  target.AudioContext = class {
    constructor() { contexts++; this.state = "suspended"; this.destination = {}; }
    createGain() { return node(); }
    async resume() { this.state = "running"; }
    async decodeAudioData() { decodeCalls++; return { decoded: decodeCalls }; }
    createBufferSource() {
      const source = { ...node(), start() { this.started = true; }, stop() { this.stopped = true; } };
      sources.push(source); return source;
    }
  };
  // Give each test independent maps/context without changing the exported singleton.
  const audio = { ...Audio2, ctx: null, musicGain: null, musicEl: null, errors: new Map(), buffers: new Map(),
    _bufferPromises: new Map(), _active: new Map(), _target: null, _pendingMusic: false, _pendingEffects: 0 };
  t.mock.method(console, "error", (...args) => logs.push(args));
  audio.init(target);
  t.after(() => {
    audio.stopMusic(); audio.stopEffects();
    target.removeEventListener("pointerdown", audio._unlockHandler);
    target.removeEventListener("keydown", audio._unlockHandler);
  });
  return { audio, target, instances, sources, logs, contexts: () => contexts, decodes: () => decodeCalls };
}

test("audio initializes lazily, updates the real music volume and retries autoplay on gestures", async t => {
  const { audio, target, instances, contexts } = fakeAudio(t);
  assert.equal(contexts(), 0);
  const promise = audio.music("menu.ogg");
  await promise;
  const el = instances[0];
  audio.setVolume(0.25);
  assert.equal(el.volume, 0.25);
  audio.setVolume(2); assert.equal(el.volume, 1);
  el.failure = Object.assign(new Error("gesture required"), { name: "NotAllowedError" });
  audio._pendingMusic = true;
  assert.equal(await audio._playMusic(), false);
  assert.equal(audio.errors.size, 0);
  el.failure = null;
  target.dispatchEvent(new dom.window.Event("keydown"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(el.playCalls, 3);
  assert.equal(audio._pendingMusic, false);
  assert.equal(contexts(), 1);
  audio.setVolume(0.4);
  assert.equal(el.volume, 0.4); assert.equal(audio.musicGain.gain.value, 0.4);
});

test("music track replacement cannot resurrect an older in-flight play request", async t => {
  const { audio, target, instances } = fakeAudio(t);
  let release;
  const original = target.Audio.prototype.play;
  target.Audio.prototype.play = function () {
    if (this.src === "old.ogg") return new Promise(resolve => { release = resolve; });
    return original.call(this);
  };
  const old = audio.music("old.ogg");
  assert.equal(await audio.music("new.ogg"), true);
  release();
  assert.equal(await old, false);
  assert.equal(audio.musicEl, instances[1]);
  assert.ok(instances[0].pauseCalls >= 1);
});

test("SFX requests share decode, cap active and pending voices, route through master gain and release nodes", async t => {
  const { audio, sources, decodes } = fakeAudio(t);
  let fetchCalls = 0;
  t.mock.method(globalThis, "fetch", async () => { fetchCalls++; return new Response(new Uint8Array([1, 2, 3])); });
  audio.maxEffects = 2;
  const [one, two, dropped] = await Promise.all([audio.sfx("step.ogg", 0.5), audio.sfx("step.ogg"), audio.sfx("step.ogg")]);
  assert.ok(one && two); assert.equal(dropped, null);
  assert.equal(fetchCalls, 1); assert.equal(decodes(), 1);
  assert.equal(sources.length, 2);
  assert.equal(audio._active.size, 2);
  assert.equal(one.connected.gain.value, 0.5 * audio.sfxVolume);
  assert.equal(one.connected.connected, audio.musicGain);
  audio.setVolume(0);
  assert.equal(audio.musicGain.gain.value, 0);
  one.onended();
  assert.equal(audio._active.size, 1);
  assert.equal(one.disconnected, true);
  assert.ok(await audio.sfx("step.ogg"));
  assert.equal(fetchCalls, 1);
  audio.stopEffects();
  assert.equal(audio._active.size, 0);
});

test("audio reports missing files once, suppresses repeated requests and permits explicit retry", async t => {
  const { audio, logs, instances } = fakeAudio(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return new Response("missing", { status: 404 }); });
  assert.equal(await audio.sfx("missing.ogg"), null);
  assert.equal(await audio.sfx("missing.ogg"), null);
  assert.equal(calls, 1); assert.equal(logs.length, 1);
  assert.match(audio.errors.get("sfx:missing.ogg").message, /404/);
  audio.clearErrors();
  await audio.sfx("missing.ogg");
  assert.equal(calls, 2); assert.equal(logs.length, 2);
  await audio.music("bad-music.ogg");
  instances[0].error = { code: 4 };
  instances[0].dispatchEvent(new dom.window.Event("error"));
  assert.equal(await audio.music("bad-music.ogg"), false);
  assert.equal(instances.length, 1);
  assert.equal(logs.length, 3);
});

test("decoded effect buffers are bounded and stopped in-flight effects never start later", async t => {
  const { audio, sources } = fakeAudio(t);
  audio.maxBuffers = 1;
  let release;
  t.mock.method(globalThis, "fetch", async file => {
    if (file === "slow.ogg") await new Promise(resolve => { release = resolve; });
    return new Response(new Uint8Array([1]));
  });
  (await audio.sfx("a.ogg")).onended();
  (await audio.sfx("b.ogg")).onended();
  assert.equal(audio.buffers.size, 1);
  assert.equal(audio.buffers.has("b.ogg"), true);
  const slow = audio.sfx("slow.ogg");
  await new Promise(resolve => setImmediate(resolve));
  audio.stopEffects();
  release();
  assert.equal(await slow, null);
  assert.equal(sources.length, 2);
  assert.equal(audio._pendingEffects, 0);
});
