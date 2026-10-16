import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { A } from "../js/assets.js";
import { Input } from "../js/input.js";
import { Audio2 } from "../js/audio.js";
import { Game, loadLevel, gameUpdate, gameDraw } from "../js/game.js";
import { parseAnims, TILE_SOLID, TILE_UP, TILE_DAMAGE } from "../js/tmx.js";
import { AnimPlayer } from "../js/sprite.js";
import { createEnemy } from "../js/enemies.js";
import { Save } from "../js/save.js";

const dom = new JSDOM('<canvas id="game" width="512" height="384"></canvas><div id="boot"></div><div id="err"></div>', {
  url: "https://integration.test/", pretendToBeVisual: true,
});
const requests = [], imageRequests = [], fixtures = new Map(), failedImages = new Set(), music = [], sounds = [];
const frames = [];
const originalAudio = { init: Audio2.init, music: Audio2.music, sfx: Audio2.sfx };
const originalGlobals = new Map();
function install(name, value) {
  originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

function context(canvas = {}) {
  const stack = [];
  return {
    canvas, globalAlpha: 1, imageSmoothingEnabled: false, draws: [], fills: [], translations: [], scales: [],
    save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); },
    drawImage(image, ...args) { this.draws.push({ image, args, alpha: this.globalAlpha }); },
    fillRect(...args) { this.fills.push({ args, color: this.fillStyle }); },
    translate(...args) { this.translations.push(args); }, scale(...args) { this.scales.push(args); },
    rotate() {}, transform() {}, setTransform() {}, clearRect() {}, fillText() {}, strokeRect() {},
    measureText(text) { return { width: text.length * 8 }; },
  };
}
dom.window.HTMLCanvasElement.prototype.getContext = function () { return this._ctx ??= context(this); };
class MockImage {
  set src(path) {
    this._src = path.replace(/\\/g, "/"); imageRequests.push(this._src);
    [this.width, this.height] = this._src.endsWith("terrain.png") ? [64, 64]
      : this._src.includes("tileset_area1") ? [1024, 1024] : [1024, 1024];
    queueMicrotask(() => failedImages.has(this._src) ? this.onerror?.() : this.onload?.());
  }
  get src() { return this._src; }
}
install("window", dom.window); install("document", dom.window.document);
install("DOMParser", dom.window.DOMParser); install("Image", MockImage);
install("localStorage", dom.window.localStorage);
install("innerWidth", 1024); install("innerHeight", 768);
install("addEventListener", dom.window.addEventListener.bind(dom.window));
install("requestAnimationFrame", callback => { frames.push(callback); return frames.length; });
install("fetch", async raw => {
  const path = String(raw).replace(/\\/g, "/"); requests.push(path);
  let text = fixtures.get(path);
  if (text === undefined) {
    try { text = await readFile(new URL(`../${path}`, import.meta.url), "utf8"); }
    catch { return { ok: false, status: 404, statusText: "Not found" }; }
  }
  return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
});
Audio2.init = () => Audio2;
Audio2.music = async path => { music.push(path); return true; };
Audio2.sfx = async path => { sounds.push(path); return null; };

const charEntry = { png: "assets/mock/player.png", xml: "assets/mock/player.xml", anim: "assets/mock/anim.xml" };
const data = Array.from({ length: 32 * 16 }, (_, i) => Math.floor(i / 32) === 10 ? 1 : 0);
function levelXML({ start = true, background = true } = {}) {
  return `<map width="32" height="16" tilewidth="32" tileheight="32">
    <properties>${background ? '<property name="background" value="back_area1"/>' : ""}
      <property name="defaultMusic" value="normal"/><property name="music,normal" value="autoscroll.ogg"/></properties>
    <tileset firstgid="1" source="tilesets/test.tsx"/>
    <layer name="Tiles" width="32" height="16"><data encoding="csv">${data}</data></layer>
    <objectgroup name="General">${start ? '<object name="Start" x="240" y="304"/>' : ""}</objectgroup></map>`;
}
fixtures.set("assets/data/maps/level1.tmx", levelXML());
fixtures.set("assets/data/maps/level2.tmx", levelXML({ start: false }));
fixtures.set("assets/data/maps/level3.tmx", levelXML({ background: false }).replace("test.tsx", "no-dimensions.tsx"));
fixtures.set("assets/data/maps/tilesets/test.tsx", `<tileset tilewidth="32" tileheight="32">
  <image source="terrain.png" width="32" height="32"/><tile id="0"><properties>
  <property name="solid"/></properties></tile></tileset>`);
fixtures.set("assets/data/maps/tilesets/no-dimensions.tsx", `<tileset tilewidth="32" tileheight="32">
  <image source="terrain.png"/><tile id="0"><properties><property name="solid"/></properties></tile></tileset>`);
fixtures.set("assets/chars.json", JSON.stringify({ vascolet: charEntry }));
fixtures.set(charEntry.xml, `<LibraryInfo><data><SpriteData keyName="body" sourceImage="player" axis="4,8" sourceRect="0,0,8,8"/></data></LibraryInfo>`);
fixtures.set(charEntry.anim, `<ExportedData><Animations>
  ${["stand", "walk", "run", "standJump", "fall"].map(name => `<Animation name="${name}" fps="60" loopIndex="0">
  <Frame duration="10"><Sprite image="body" xOffset="3" yOffset="-2" xScale="2" yScale="0.5"/></Frame></Animation>`).join("")}
  </Animations></ExportedData>`);

function clearAssets() {
  for (const cache of [A.images, A.texts, A.imagePromises, A.xmlPromises]) cache.clear();
  Game.charCache.clear(); Game.hudAtlas = null;
}
async function freshLevel() {
  Input.reset(); Game.chars = { vascolet: charEntry }; Game.texts = {};
  await loadLevel(1);
}
function tick(count = 1) {
  for (let i = 0; i < count; i++) { gameUpdate(1 / 60); Input.endStep(); }
}
function key(type, value, code = value) {
  dom.window.dispatchEvent(new dom.window.KeyboardEvent(type, { key: value, code, bubbles: true }));
}
async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for asynchronous boot/level load");
}
function render(ts) {
  assert.ok(frames.length, "A frame must be scheduled");
  frames.shift()(ts);
}

test.after(() => {
  Input.dispose(); Object.assign(Audio2, originalAudio); dom.window.close();
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

test("flat floor remains on one support plane for 600 ticks; mixed flags retain support and damage", async () => {
  await freshLevel();
  tick();
  for (const flags of [TILE_SOLID, TILE_UP, TILE_SOLID | TILE_DAMAGE, TILE_UP | TILE_DAMAGE]) {
    Game.grid.fill(0); Game.grid.fill(flags, 10 * Game.gw, 11 * Game.gw);
    Object.assign(Game.player, { y: 320, vy: 0, inv: 0 });
    for (let i = 0; i < 600; i++) {
      tick();
      assert.equal(Game.player.y, 320, `flags=${flags}, tick=${i}`);
      assert.equal(Game.player.vy, 0); assert.equal(Game.player.ground, true);
      assert.equal(Game.player.hurt, Boolean(flags & TILE_DAMAGE));
    }
  }
});

test("one-way platforms allow ascent and catch a downward crossing without tunneling", async () => {
  await freshLevel();
  Game.grid.fill(0); Game.grid.fill(TILE_UP | TILE_DAMAGE, 10 * Game.gw, 11 * Game.gw);
  Object.assign(Game.player, { y: 330, vy: -180 });
  tick(); assert.ok(Game.player.y < 330); assert.equal(Game.player.ground, false);
  Object.assign(Game.player, { y: 310, vy: 900 });
  tick(); assert.equal(Game.player.y, 320); assert.equal(Game.player.ground, true);
});

test("shipped parallax retains four layer heights and draws only its two visible layers with opacity", async () => {
  await freshLevel();
  const bg = Game.bgs[0];
  assert.equal(bg.layers.length, 4);
  assert.deepEqual(bg.layers.map(l => l.h), [12, 12, 12, 12]);
  assert.equal(bg.layers.filter(l => l.visible).length, 2);
  const savedMap = Game.map;
  Game.map = { layers: [] }; Game.player = null; Game.items = [];
  Game.camX = Game.camY = Game.prevCamX = Game.prevCamY = 0; Game.tipT = 0;
  bg.layers[0].opacity = 0.25;
  const ctx = context(); gameDraw(ctx);
  const tiles = ctx.draws.filter(call => call.image === bg.tilesets[0].image);
  assert.equal(tiles.length, 16 * 12 * 2);
  assert.equal(tiles.filter(call => call.alpha === 0.25).length, 16 * 12);
  assert.equal(tiles.filter(call => call.alpha === 1).length, 16 * 12);
  assert.equal(ctx.globalAlpha, 1);
  Game.map = savedMap;
});

test("level load uses exact music, resets camera/start snapshots, and normalizes explicit TSX dimensions", async () => {
  await freshLevel();
  assert.equal(music.at(-1), "assets/audio/music/win/autoscroll.ogg");
  assert.equal(Game.tsx[0].image.width, 32); assert.equal(Game.tsx[0].image.height, 32);
  const normalizedDraw = Game.tsx[0].image._ctx.draws[0];
  assert.deepEqual(normalizedDraw.args, [0, 0, 64, 64, 0, 0, 32, 32]);
  Game.camX = 9999; Game.camY = 8888; Game.start = { x: 7777, y: 7777 };
  await loadLevel(2);
  assert.equal(Game.player.x, 256); assert.equal(Game.player.y, 352);
  assert.equal(Game.prevCamX, Game.camX); assert.equal(Game.prevCamY, Game.camY);
  assert.equal(Game.player.prevX, Game.player.x); assert.equal(Game.player.prevY, Game.player.y);
  assert.ok(Game.camX < 1000 && Game.camY < 1000);
  await loadLevel(3);
  assert.equal(Game.tsx[0].image, A.images.get("assets/data/maps/tilesets/terrain.png"),
    "Missing explicit image dimensions must not normalize to parser fallback dimensions");
});

test("render interpolates body and camera, honors frame transforms, and leaves blank frames blank", async () => {
  await freshLevel();
  Game.bgs = []; Game.map = { layers: [] }; Game.tipT = 0;
  Object.assign(Game, { prevCamX: 20, camX: 30, prevCamY: 10, camY: 20 });
  Object.assign(Game.player, { prevX: 100, x: 120, prevY: 200, y: 220 });
  const p = Game.player, frame = p.cur;
  const ctx = context(); gameDraw(ctx, 0.5);
  assert.ok(ctx.translations.some(([x, y]) => x === 85 && y === 195));
  assert.ok(ctx.translations.some(([x, y]) => x === 3 && y === -2));
  assert.ok(ctx.scales.some(([x, y]) => x === 2 && y === 0.5));
  assert.equal(p.x, 120); assert.equal(Game.camX, 30);
  const playerImage = Game.charCache.get("Vascolet").img;
  assert.equal(ctx.draws.filter(d => d.image === playerImage).length, 1);
  p.cur = { sprites: [], empty: true, flags: [] };
  const blank = context(); gameDraw(blank, 0.75);
  assert.equal(blank.draws.filter(d => d.image === playerImage).length, 0);
  assert.ok(!blank.fills.some(d => d.color === "#f66"));
  p.cur = frame;
});

test("animation drains every simultaneous/crossed event exactly once", async () => {
  await freshLevel(); sounds.length = 0;
  const { AnimPlayer } = await import("../js/sprite.js");
  const anim = new AnimPlayer([{ name: "walk", fps: 120, loop: -1, frames: [
    { dur: 1, sprites: [], flags: ["MakeEffect", "PlaySound"] },
    { dur: 1, sprites: [], flags: ["PlaySound"] },
    { dur: 100, sprites: [], flags: [] },
  ] }]);
  Game.player.anim = anim; Game.player.animName = "walk";
  Input.held.add("right"); tick();
  assert.equal(sounds.filter(path => path.includes("footStep")).length, 2);
  assert.equal(Game.parts.length, 5); assert.equal(anim.events.length, 0);
  tick(); assert.equal(sounds.filter(path => path.includes("footStep")).length, 2);
  Input.reset();
});

test("enemy contact removes one heart and invulnerability prevents damage every simulation tick", async () => {
  await freshLevel(); tick();
  const p = Game.player;
  const fly = createEnemy({ name: "Fly", x: p.x - 16, y: p.y - 30 });
  fly.active = true; Game.enemies = [fly];
  tick();
  assert.ok(Math.abs(Game.energy - (100 - 100 / 7)) < 1e-8);
  const energy = Game.energy;
  tick(30); assert.equal(Game.energy, energy); assert.ok(p.inv > 0);
});

test("collecting a trophy in gameplay is persisted and checkpoints preserve both trophy and chapter progress", async () => {
  Save.clear(); Save.unlock(6); await freshLevel(); tick();
  Game.items = [{ kind: "&B-Item1", x: Game.player.x, y: Game.player.y - 10, taken: false }];
  tick(); assert.equal(Game.items[0].taken, true); assert.equal(Save.hasItem("&B-Item1"), true);
  Save.write({ level: 1, x: 300, y: 320 });
  assert.equal(Save.unlocked(), 6); assert.equal(Save.hasItem("&B-Item1"), true);
  Save.clear();
});

test("attack releases at the original XML flag, crouch uses its own pose, and rapid fire respects two boomerangs", async () => {
  const doc = new dom.window.DOMParser().parseFromString(await readFile(new URL(
    "../assets/characters/vascolet/animData/Vascolet.xml", import.meta.url), "utf8"), "text/xml");
  const anims = parseAnims(doc);
  await freshLevel(); tick();
  Game.player.anim = new AnimPlayer(anims); Game.player.anim.set("stand");
  Input.pressed.add("x"); tick();
  assert.equal(Game.booms.length, 0, "no shot on initial attack pose");
  tick(3); assert.equal(Game.booms.length, 0);
  tick(); assert.equal(Game.booms.length, 1, "Custom flag releases the shot after 2/24 seconds");
  assert.equal(Game.booms[0].y, Game.player.y - 30);
  let peak = 1;
  for (let i = 0; i < 70; i++) {
    if (i % 3 === 0) Input.pressed.add("x");
    tick(); peak = Math.max(peak, Game.booms.length);
    assert.ok(Game.booms.length <= 2);
  }
  assert.equal(peak, 2);
  await freshLevel(); tick();
  Game.player.anim = new AnimPlayer(anims); Game.player.anim.set("stand");
  Input.held.add("down"); Input.pressed.add("x");
  tick(); assert.equal(Game.player.animName, "crouchAttack");
  tick(10); assert.equal(Game.booms.length, 1);
  assert.equal(Game.booms[0].y, Game.player.y - 8);
  Input.reset();
});

test("main boots menu-only, keeps 144 Hz input queued, consumes once during catchup, caps pauses and crops pages", async () => {
  clearAssets(); requests.length = imageRequests.length = frames.length = 0;
  Game.map = null; Game.player = null; dom.window.localStorage.clear();
  await import(`../js/main.js?integration=${Date.now()}`);
  await until(() => frames.length > 0);
  assert.equal(Game.map, null); assert.equal(Game.player, null);
  assert.ok(!requests.some(path => /maps\/level|texts\.xml|chars\.json/.test(path)));
  assert.ok(!imageRequests.some(path => /characters|tilesets|hud/.test(path)));
  render(0);
  key("keydown", "Enter", "Enter"); render(7); key("keyup", "Enter", "Enter");
  await until(() => !document.getElementById("boot")); render(14);
  // Jugar abre capítulos; Enter elige el nivel 1 (video salteado en tests).
  key("keydown", "Enter", "Enter"); render(21); key("keyup", "Enter", "Enter");
  await until(() => Game.player !== null && !document.getElementById("boot"));
  assert.ok(requests.includes("assets/data/texts.xml"));
  render(100); // Establish a fresh clock after loading.
  key("keydown", "ArrowRight", "ArrowRight"); render(107);
  assert.equal(Input.pressed.has("right"), true, "Render-only frame must retain edge");
  assert.equal(Game.player.x, 256);
  render(141); // Two ticks of catchup; same edge cannot count as a double tap.
  assert.equal(Game.time, 2 / 60); assert.equal(Game.player.run, false);
  assert.equal(Input.pressed.size, 0);
  assert.ok(Math.abs(Game.player.x - (256 + 170 * 2 / 60)) < 1e-8);
  const time = Game.time; render(10_141);
  assert.ok(Math.abs(Game.time - time - 5 / 60) < 1e-8, "Resume cannot simulate the full pause");
  key("keyup", "ArrowRight", "ArrowRight");
  key("keydown", "Escape", "Escape"); render(10_160); key("keyup", "Escape", "Escape");
  await until(() => !document.getElementById("boot"));
  render(10_167); // paused frame draws the quit-confirmation crop
  await until(() => document.getElementById("game")._ctx.draws.some(call => call.image.src?.endsWith("/quit-confirmation.png")));
  render(10_168);
  key("keydown", "ArrowDown", "ArrowDown"); render(10_174); key("keyup", "ArrowDown", "ArrowDown");
  key("keydown", "Enter", "Enter"); render(10_181); key("keyup", "Enter", "Enter");
  await until(() => !document.getElementById("boot")); render(10_188);
  const ctx = document.getElementById("game")._ctx;
  const options = ctx.draws.find(call => call.image.src?.endsWith("/options.png") && call.args[0] === 1);
  assert.deepEqual(options.args, [1, 386, 512, 384, 0, 0, 512, 384]);
  let ts = 10_190;
  // Volver al menu principal: opciones -> Esc -> pausa -> Salir -> Si -> capítulos -> Esc.
  key("keydown", "Escape", "Escape"); render(ts += 17); key("keyup", "Escape", "Escape");
  await until(() => !document.getElementById("boot")); render(ts += 17);
  key("keydown", "ArrowDown", "ArrowDown"); render(ts += 17); key("keyup", "ArrowDown", "ArrowDown");
  key("keydown", "ArrowDown", "ArrowDown"); render(ts += 17); key("keyup", "ArrowDown", "ArrowDown");
  key("keydown", "Enter", "Enter"); render(ts += 17); key("keyup", "Enter", "Enter");
  await until(() => !document.getElementById("boot")); render(ts += 17);
  key("keydown", "ArrowLeft", "ArrowLeft"); render(ts += 17); key("keyup", "ArrowLeft", "ArrowLeft");
  key("keydown", "Enter", "Enter"); render(ts += 17); key("keyup", "Enter", "Enter");
  await until(() => !document.getElementById("boot")); render(ts += 17);
  key("keydown", "Escape", "Escape"); render(ts += 17); key("keyup", "Escape", "Escape");
  await until(() => !document.getElementById("boot")); render(ts += 17);
  for (const [kind, downs] of [["help", 2], ["credits", 1]]) {
    for (let i = 0; i < downs; i++) {
      key("keydown", "ArrowDown", "ArrowDown"); render(ts += 17); key("keyup", "ArrowDown", "ArrowDown");
    }
    key("keydown", "Enter", "Enter"); render(ts += 17); key("keyup", "Enter", "Enter");
    await until(() => !document.getElementById("boot")); render(ts += 17);
    const page = ctx.draws.findLast(call => call.image.src?.endsWith(`/${kind}.jpg`));
    assert.deepEqual(page.args, [0, 0, 512, 384, 0, 0, 512, 384]);
    key("keydown", "Escape", "Escape"); render(ts += 17); key("keyup", "Escape", "Escape");
    await until(() => !document.getElementById("boot")); render(ts += 17);
  }
});

test("declared required assets reject instead of producing an apparently loaded level", async () => {
  clearAssets(); failedImages.add("assets/data/maps/tilesets/terrain.png");
  try { await assert.rejects(freshLevel(), /Image load failed:.*terrain\.png/); }
  finally { failedImages.clear(); }
});

test("failed menu boot becomes a visible fatal error and never schedules the game loop", async () => {
  clearAssets(); frames.length = 0; requests.length = 0;
  failedImages.add("assets/gui/menu/menu.png");
  const originalError = console.error, errors = [];
  console.error = (...args) => errors.push(args);
  try {
    await import(`../js/main.js?fatal-integration=${Date.now()}`);
    await until(() => document.getElementById("err").textContent.includes("Error fatal:"));
    assert.match(document.getElementById("err").textContent, /Image load failed:.*menu\.png/);
    assert.equal(frames.length, 0); assert.equal(errors.length, 1);
    assert.ok(!requests.some(path => /maps\/level|texts\.xml|chars\.json/.test(path)));
    assert.equal(Input.pressed.size, 0); assert.equal(Input.held.size, 0);
  } finally { console.error = originalError; failedImages.clear(); }
});
