import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { menuInit, chaptersInit, chaptersUpdate, chaptersDraw, chPos, achInit, achDraw, achUpdate, optionsInit, optionsUpdate, optionsDraw, onOptionsDone } from "../js/menu.js";
import { Input } from "../js/input.js";
import { Save } from "../js/save.js";
import { Audio2 } from "../js/audio.js";
import { TROPHIES } from "../js/trophies.js";
import { RenderSettings, setTextureFiltering } from "../js/render-settings.js";

const dom = new JSDOM("", { url: "https://menus.test/" });
const originals = new Map();
function install(name, value) {
  originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
install("DOMParser", dom.window.DOMParser);
install("document", dom.window.document);
install("localStorage", dom.window.localStorage);
install("fetch", async path => ({ ok: true, text: async () => readFile(new URL(`../${path}`, import.meta.url), "utf8") }));
install("Image", class {
  width = 512; height = 512;
  set src(value) { this._src = value; queueMicrotask(() => this.onload()); }
  get src() { return this._src; }
});
const sound = Audio2.sfx; Audio2.sfx = () => {};
test.after(() => {
  Audio2.sfx = sound; dom.window.close();
  for (const [name, original] of originals) {
    if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name];
  }
});
const context = () => ({ draws: [], texts: [], fillRect() {}, fillText(text, x, y) { this.texts.push({ text, x, y }); }, drawImage(image, ...rect) { this.draws.push({ src: image.src, rect }); } });
const press = (key, dt = 1 / 60) => { Input.pressed.add(key); chaptersUpdate(dt); Input.endStep(); };
function drawChapters() { const ctx = context(); chaptersDraw(ctx, {}); return ctx; }
const background = ctx => ctx.draws.find(d => /area0\d\.jpg/.test(d.src));
const selected = ctx => ctx.draws.find(d => d.src.endsWith("/level.png") && d.rect[0] === 48 && d.rect[1] === 48);
async function fresh(unlocked, callback = () => {}) {
  localStorage.clear(); Input.reset(); Input.mouse.inside = false;
  Save.unlock(unlocked); await menuInit(() => {}); await chaptersInit(callback);
}

test("chapter nodes use native manual anchors and correct red/grey/blue crops", async () => {
  await fresh(3);
  const ctx = drawChapters(), nodes = ctx.draws.filter(d => d.src.endsWith("/level.png") && d.rect[2] === 36);
  assert.equal(nodes.length, 18);
  assert.deepEqual(nodes[0].rect.slice(0, 4), [1, 89, 36, 34]); // accessible grey
  assert.deepEqual(nodes[2].rect.slice(0, 4), [48, 48, 36, 40]); // selected blue
  assert.deepEqual(nodes[3].rect.slice(0, 4), [38, 89, 36, 34]); // inaccessible red
  assert.deepEqual(nodes[0].rect.slice(4, 6), [10, 223]);
  assert.deepEqual(nodes[17].rect.slice(4, 6), [366, 55]);
  assert.deepEqual(background(ctx).rect, [0, 0, 512, 384, 0, 0, 512, 384]);
});

test("selection and background stay stable across keyboard/mouse, locked nodes and trophies popup", async () => {
  const picked = []; await fresh(6, n => picked.push(n));
  const area = background(drawChapters()).src;
  for (let i = 0; i < 5; i++) press("left");
  press("enter"); assert.deepEqual(picked, [1]);
  assert.equal(background(drawChapters()).src, area);
  // An unmoved pointer over stage 1 must not undo a right-arrow selection.
  Object.assign(Input.mouse, { inside: true, x: chPos(0).x, y: chPos(0).y }); Input.mouse.revision++;
  chaptersUpdate(); Input.endStep(); press("right");
  chaptersUpdate(); Input.endStep(); press("enter"); assert.equal(picked.at(-1), 2);
  Object.assign(Input.mouse, { x: chPos(17).x, y: chPos(17).y }); Input.mouse.revision++;
  press("click"); press("enter"); assert.equal(picked.at(-1), 2);
  Save.unlock(13); // progression changes take effect only on a new selector entry
  assert.equal(background(drawChapters()).src, area);
  await achInit(); await chaptersInit(n => picked.push(n), { preserve: true });
  assert.equal(background(drawChapters()).src, area); press("enter"); assert.equal(picked.at(-1), 2);
  await chaptersInit(() => {});
  assert.ok(background(drawChapters()).src.endsWith("area05.jpg"));
});

test("chapter title animation advances on update time and drawing cannot move it", async () => {
  await fresh(3); press("left");
  const bannerY = ctx => ctx.draws.find(d => d.src.endsWith("/level.png") && d.rect[2] === 376).rect[5];
  const a = drawChapters(), b = drawChapters();
  assert.equal(bannerY(a), bannerY(b)); assert.ok(bannerY(a) < 0);
  chaptersUpdate(.15); assert.equal(bannerY(drawChapters()), -46);
  chaptersUpdate(.16); assert.equal(bannerY(drawChapters()), 0);
});

test("checkpoints preserve unlocks/trophies; duplicate collection is ignored; erasing preserves settings", () => {
  localStorage.clear(); Save.unlock(9);
  assert.equal(Save.collectItem("&P-Run"), true);
  assert.equal(Save.collectItem("&P-Run"), false);
  Save.write({ level: 2, x: 300, y: 400 });
  assert.equal(Save.unlocked(), 9); assert.equal(Save.hasItem("&P-Run"), true);
  Save.writeSettings({ music: .3 }); localStorage.setItem("unrelated", "keep"); Save.clear();
  assert.equal(Save.unlocked(), 1); assert.equal(Save.hasItem("&P-Run"), false);
  assert.equal(Save.settings().music, .3); assert.equal(localStorage.getItem("unrelated"), "keep");
});

test("trophies draw all 20 cropped cards in original groups, with enabled state only for collected items", async () => {
  await fresh(3); Save.collectItem("&B-Item1"); await achInit();
  const ctx = context(); achDraw(ctx);
  const cards = ctx.draws.filter(d => d.src.endsWith("trofeos.png"));
  assert.equal(cards.length, 20);
  assert.deepEqual(cards[0].rect.slice(0, 4), [278, 54, 50, 50]); // grey sustain jump
  assert.deepEqual(cards[5].rect.slice(0, 4), [56, 119, 52, 54]); // collected apple
  assert.deepEqual(cards[0].rect.slice(4, 6), [19, 124]);
  assert.deepEqual(cards[15].rect.slice(4, 6), [266, 236]);
  assert.ok(cards.every(d => d.rect[2] <= 60 && d.rect[3] <= 60));
  assert.equal(TROPHIES[13].item, "&Life4"); assert.equal(TROPHIES[13].key, "cebolla");
  const bg = ctx.draws.find(d => d.src.endsWith("background.jpg")); assert.equal(bg.rect[3], 384);
  let closed = 0;
  Input.mouse.inside = false; Input.pressed.add("right"); achUpdate(() => closed++); Input.endStep();
  assert.equal(closed, 0);
  Object.assign(Input.mouse, { inside: true, x: 100, y: 100 }); Input.pressed.add("click");
  achUpdate(() => closed++); Input.endStep(); assert.equal(closed, 0);
  Object.assign(Input.mouse, { x: 256, y: 340 }); Input.pressed.add("click");
  achUpdate(() => closed++); Input.endStep(); assert.equal(closed, 1);
});

test("Options share original draw/hit geometry; outside clicks are inert; mute, drag and keyboard operate independently", async () => {
  await fresh(1); await optionsInit(); Save.writeSettings({ music: .5, sfx: .8 });
  const set = Audio2.setVolumes; Audio2.setVolumes = () => {};
  try {
    let closed = 0; onOptionsDone(() => closed++);
    const click = (x, y) => {
      Object.assign(Input.mouse, { x, y, inside: true, down: false }); Input.mouse.revision++;
      Input.pressed.add("click"); optionsUpdate(); Input.endStep();
    };
    click(50, 173); assert.equal(Save.settings().music, .5);
    click(50, 330); assert.equal(closed, 0);
    click(331, 133); assert.equal(Save.settings().musicMute, true); assert.equal(Save.settings().sfxMute, false);
    click(258, 162); assert.equal(Save.settings().music, .5);
    Object.assign(Input.mouse, { x: 258, y: 162, down: true }); Input.pressed.add("click"); optionsUpdate(); Input.endStep();
    Input.mouse.x = 358; optionsUpdate(); assert.equal(Save.settings().music, 1);
    Input.mouse.down = false; optionsUpdate();
    click(327, 282); assert.equal(Save.settings().stretch, false);
    click(327, 306); assert.equal(Save.settings().filterTextures, false); assert.equal(RenderSettings.filterTextures, false);
    const ctx = context(); optionsDraw(ctx);
    const knob = ctx.draws.find(d => d.rect[0] === 592 && d.rect[1] === 38);
    assert.ok(knob && knob.rect[4] === 347 && knob.rect[5] === 150, "music knob must sit on its translated rail");
    assert.deepEqual(ctx.texts.find(t => t.text === "Filtrar texturas"), { text: "Filtrar texturas", x: 152, y: 312 });
    assert.ok(ctx.draws.filter(d => d.src.endsWith("options.png") && d.rect[0] === 1).every(d => d.rect[2] === d.rect[6] && d.rect[3] === d.rect[7]), "panel slices must not distort the logo or original labels");
    click(256, 342); assert.equal(closed, 1);
  } finally { Audio2.setVolumes = set; Input.reset(); setTextureFiltering(true); }
});
