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
import { PLAYER_PHYSICS, itemDefinition, progressFromItems } from "../js/progression.js";

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
install("removeEventListener", dom.window.removeEventListener.bind(dom.window));
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
async function freshLevel({ preserveSave = false } = {}) {
  if (!preserveSave) Save.clear();
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
    Object.assign(Game.player, { y: 320, vy: 0, inv: 1e9, damage: null });
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
  assert.ok(Math.abs(Game.energy - (100 - 100 / 5)) < 1e-8);
  const energy = Game.energy;
  tick(30); assert.equal(Game.energy, energy); assert.ok(p.inv > 0);
});

test("damage launches the player backward/upward, input cannot cancel it, and recovery completes", async () => {
  await freshLevel(); tick(); const p = Game.player;
  const startX = p.x, startY = p.y;
  const fly = createEnemy({ name: "Fly", x: p.x - 16, y: p.y - 30 }); fly.active = true;
  Game.enemies = [fly]; tick(); Game.enemies = [];
  assert.equal(p.vx, -60); assert.equal(p.vy, -200); assert.equal(p.damage.phase, "air");
  Input.held.add("right"); Input.pressed.add("z"); tick(12);
  assert.ok(p.x < startX - 10); assert.ok(p.y < startY - 15); assert.equal(p.face, 1);
  assert.equal(p.vx, -60, "normal movement must not overwrite recoil");
  Input.reset(); tick(60); assert.equal(p.damage, null); assert.equal(p.ground, true);
  assert.ok(Math.abs(Game.energy - (100 - 100 / 5)) < 1e-8);
});

test("collecting a trophy in gameplay is persisted and checkpoints preserve both trophy and chapter progress", async () => {
  Save.clear(); Save.unlock(6); await freshLevel({ preserveSave: true }); tick();
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
  Game.items = [{ kind: "&B-Item1", x: Game.player.x, y: Game.player.y - 10, taken: false }]; tick();
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

test("help/save signs meet the floor, Lampi returns on re-entry, dialogues stay modeless and saved signs remain visible", async () => {
  clearAssets(); Input.reset(); Save.clear();
  fixtures.set("assets/data/maps/level4.tmx", levelXML().replace("</objectgroup>",
    '<object name="*Info" x="240" y="288"><properties><property name="info" value="tip-fixture"/></properties></object><object name="*Save" x="800" y="288"/></objectgroup>'));
  Game.chars = JSON.parse(await readFile(new URL("../assets/chars.json", import.meta.url), "utf8"));
  Game.texts = { "tip-fixture": "Este jardín tiene muchos insectos... ¡Ten cuidado!\nUsa las flechas para moverte..." };
  await loadLevel(4); tick();
  assert.equal(Game.infos[0].y, 320); assert.equal(Game.saves[0].y, 320);
  assert.ok(Game.helper && Game.helper.anim.anims.length);
  assert.equal(Game.dlg.text, Game.texts["tip-fixture"]);
  tick(73); assert.ok(Game.helper.anim.i > 0);
  const ctx = context(); gameDraw(ctx);
  const head = ctx.draws.find(d => d.image.src?.endsWith("/hud.png") && d.args[0] === 312 && d.args[1] === 1);
  assert.deepEqual(head.args.slice(4), [6, 45, 72, 62]);
  Input.pressed.add("z"); Input.held.add("z"); tick();
  assert.ok(Game.player.y < 320 && Game.dlg, "help must not pause movement or consume jump");
  Input.reset(); Object.assign(Game.player, { x: 600, y: 320, vy: 0 }); tick(5);
  const generation = Game.helperSerial;
  Game.player.x = 256; tick();
  assert.equal(Game.helperSerial, generation + 1); assert.equal(Game.helper.phase, "follow");
  Game.player.x = 816; Game.player.y = 320; Game.player.vy = 0; tick();
  assert.equal(Game.saves[0].used, true); assert.equal(Game.saves[0].x, 816);
  assert.equal(Game.saves[0].anim.cur.name, "savePoint");
  assert.equal(Game.dlg.text, "Juego salvado.");
  assert.equal(Save.read().x, 816);
  Input.reset(); clearAssets();
});

test("a new game gates running, sustained height, double jump and stomping by collected powers", async () => {
  await freshLevel(); tick();
  assert.equal(Game.maxHearts, 5); assert.equal(Game.abilities.maxBoomerangs, 1);
  Input.held.add("right"); Input.pressed.add("right"); tick(3); Input.reset(); tick();
  Input.held.add("right"); Input.pressed.add("right"); tick(6);
  assert.equal(Game.player.run, false); assert.equal(Game.player.vx, 160);
  const apex = async (powered, held = true) => {
    await freshLevel(); tick();
    if (powered) { Game.items = [{kind:"&P-SustainJump",x:Game.player.x,y:300}]; tick(); }
    Input.held.add("z"); Input.pressed.add("z"); tick(); if (!held) Input.reset();
    let minY = Game.player.y;
    for (let i=0;i<60;i++) { tick(); minY=Math.min(minY,Game.player.y); }
    return 320-minY;
  };
  const shortJump=await apex(false), sustained=await apex(true);
  assert.ok(shortJump>25 && shortJump<45, `short jump ${shortJump}`);
  assert.ok(sustained>80 && sustained<90, `sustained ${sustained}`);
  assert.ok((await apex(true,false))<45,"releasing still cuts the upgraded jump");
  await freshLevel(); tick(); Input.held.add("z"); Input.pressed.add("z"); tick(8); Input.reset();
  const before=Game.player.vy; Input.pressed.add("z"); tick();
  assert.ok(Game.player.vy>before, "no extra jump without DoubleJump");
  Save.collectItem("&P-Run"); Save.collectItem("&P-DoubleJump"); Save.collectItem("&P-SustainJump");
  await freshLevel({preserveSave:true}); tick();
  Input.held.add("right"); Input.pressed.add("right"); tick(); Input.reset(); tick();
  Input.held.add("right"); Input.pressed.add("right"); tick(8);
  assert.equal(Game.player.run,true); assert.equal(Game.player.vx,280);
  Input.held.add("z"); Input.pressed.add("z"); tick(8); Input.held.delete("z"); tick();
  Input.held.add("z"); Input.pressed.add("z"); tick(); assert.ok(Game.player.vy < -350);
  assert.equal(Game.player.doubleUsed,true);
  Input.pressed.add("z"); const second=Game.player.vy; tick(); assert.ok(Game.player.vy>second);
  assert.equal(progressFromItems(null).run,false);
});

test("jump-attack pickup enables stomping; touching an enemy from above before it still hurts", async () => {
  for (const owned of [false,true]) {
    await freshLevel(); tick();
    if (owned) { Game.items=[{kind:"&P-JumpAttack",x:Game.player.x,y:300}]; tick(); }
    Object.assign(Game.player,{y:270,vy:120,ground:false,coyote:0,inv:0});
    const fly=createEnemy({name:"Fly",x:Game.player.x-16,y:304}); fly.active=true;Game.enemies=[fly];
    tick();
    assert.equal(fly.hp,owned?0:1); assert.equal(Game.energy,owned?100:80);
    if (owned) assert.equal(Game.player.vy,-280);
  }
});

test("an open map bottom loses a life and restores the checkpoint instead of creating an invisible floor", async () => {
  await freshLevel(); Game.grid.fill(0);
  for(let i=0;i<180 && Game.lives===5;i++) tick();
  assert.equal(Game.lives,4);assert.equal(Game.player.y,Game.checkpoint.y);
  assert.equal(Save.run().lives,4);assert.equal(Game.energy,100);
});

test("down+jump drops through one-way leaves but never through solid terrain", async () => {
  for (const doubleJump of [false,true]) for (const flags of [TILE_UP,TILE_SOLID,TILE_UP|TILE_SOLID]) {
    await freshLevel(); Game.grid.fill(0); Game.grid.fill(flags,10*Game.gw,11*Game.gw); tick();
    Game.abilities.doubleJump=doubleJump;
    Input.held.add("down"); Input.held.add("z"); Input.pressed.add("z"); tick();
    assert.equal(Game.player.y>320,flags===TILE_UP, `flags=${flags}`);
  }
});

test("every real level-1 item has animated art, consumables work, and checkpoint/death/reload preserve progress", async () => {
  Save.clear(); Input.reset(); clearAssets();
  const fixture=fixtures.get("assets/data/maps/level1.tmx"); fixtures.delete("assets/data/maps/level1.tmx");
  try {
    Game.chars=JSON.parse(await readFile(new URL("../assets/chars.json",import.meta.url),"utf8"));
    await loadLevel(1); tick();
    assert.equal(Game.items.length,13); assert.ok(Game.items.every(i=>i.definition && i.anim));
    assert.equal(Game.items.some(i=>i.kind==="&P-Run"),false);
    const ctx=context(); gameDraw(ctx);
    assert.ok(ctx.draws.filter(d=>d.image===Game.charCache.get("Items").img).length>=13);
    const expectedEnemies=Game.enemies.length;
    const take=kind=>{
      const item=Game.items.find(i=>i.kind===kind && !i.taken);
      Object.assign(Game.player,{x:item.x,y:item.y+16,vy:0,vx:0,inv:1e6,damage:null}); tick();
      assert.equal(item.taken,true,kind); return item;
    };
    take("&P-SustainJump"); take("&P-JumpAttack");
    take("&Life1"); take("&Life2"); take("&B-Item1"); take("&B-Item2"); take("&Key1");
    assert.equal(Game.maxHearts,7); assert.equal(Game.abilities.maxBoomerangs,3);
    assert.equal(Game.abilities.run,false); assert.equal(Game.abilities.jumpAttack,true);
    Game.energy=100-200/7;
    const energy=take("Energy"); assert.ok(Math.abs(Game.energy-(100-100/7))<1e-7);
    take("FullEnergy"); assert.equal(Game.energy,100);
    const checkpoint=Game.saves[0];
    Object.assign(Game.player,{x:checkpoint.x,y:checkpoint.y,vx:0,vy:0}); tick();
    assert.equal(checkpoint.used,true); assert.ok(Save.run().consumed.includes(energy.id));
    Game.energy=0; Game.enemies[0].hp=0; tick();
    assert.equal(Game.lives,4); assert.equal(Game.player.x,checkpoint.x);
    assert.equal(Game.enemies.length,expectedEnemies); assert.ok(Game.enemies.every(e=>e.hp===e.maxhp));
    assert.equal(Game.booms.length,0); assert.equal(Game.shots.length,0);
    assert.equal(Game.enemies.find(e=>e.kind==="BigScorpion").fight,false);
    await loadLevel(1);
    assert.equal(Game.player.x,checkpoint.x); assert.equal(Game.lives,4);
    assert.equal(Game.items.find(i=>i.id===energy.id).taken,true);
    assert.equal(Game.abilities.sustainJump,true); assert.equal(Game.maxHearts,7);
    Game.items.push({kind:"ExtraLive",definition:itemDefinition("ExtraLive"),x:Game.player.x,y:Game.player.y-16});
    tick(); assert.equal(Game.lives,5);
    Game.lives=0; Game.energy=0; tick(4);
    assert.equal(Game.events.filter(e=>e.type==="gameover").length,1); assert.equal(Save.run(),null);
    assert.equal(Save.hasItem("&P-SustainJump"),true);
  } finally { fixtures.set("assets/data/maps/level1.tmx",fixture); clearAssets(); Save.clear(); Input.reset(); }
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
  assert.ok(Math.abs(Game.player.x - (256 + PLAYER_PHYSICS.acceleration * 3 / 3600)) < 1e-8);
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
  assert.deepEqual(options.args, [1, 386, 512, 306, 0, -12, 512, 306]);
  assert.ok(ctx.draws.some(call => call.image.src?.endsWith("/options.png") && call.args[1] === 692 && call.args[5] === 318), "extended panel foot must be composed below the extra check");
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
