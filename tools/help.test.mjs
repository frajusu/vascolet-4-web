import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { parseAtlas, parseAnims, parseTexts } from "../js/tmx.js";
import { measureBitmapText, wrapBitmapText, drawBitmapText } from "../js/bitmap-font.js";
import { dialogueLayout, createLampi, updateLampi, signTouchesPlayer } from "../js/help.js";
import { enemySpriteFlip } from "../js/enemies.js";
const dom = new JSDOM();
const asset = async path => new dom.window.DOMParser().parseFromString(await readFile(new URL(`../assets/${path}`, import.meta.url), "utf8"), "text/xml");
test.after(() => dom.window.close());

test("original dialogue pivots and every help text fit without portrait overlap or clipped glyphs", async () => {
  const atlas = parseAtlas(await asset("images/hud/hud.xml"));
  const metrics = await asset("lang/fonts/winnie14-or.xml");
  const font = { image: {}, glyphs: new Map([...metrics.querySelectorAll("character")].map(c => [Number(c.getAttribute("key")), {
    x: +c.querySelector("x").textContent, y: +c.querySelector("y").textContent,
    w: +c.querySelector("width").textContent, h: +c.querySelector("height").textContent,
  }])) };
  const layout = dialogueLayout(atlas, "dialogBannerLampi");
  assert.deepEqual(layout.banner, { x: 33, y: 47, w: 466, h: 68 });
  assert.deepEqual(layout.head, { x: 6, y: 45, w: 72, h: 62 });
  const texts = parseTexts(await asset("data/texts.xml"));
  for (const [key, text] of Object.entries(texts).filter(([key]) => key.startsWith("tip-"))) {
    const lines = wrapBitmapText(font, text, layout.maxWidth);
    assert.equal(lines.join(" ").replace(/\s+/g, " ").trim(), text.replace(/\s+/g, " ").trim(), key);
    for (let page = 0; page < lines.length; page += 3) {
      const rows = lines.slice(page, page + 3);
      for (const [i, line] of rows.entries()) {
        assert.ok(measureBitmapText(font, line) <= layout.maxWidth, key);
        drawBitmapText({ drawImage(_image, _sx, _sy, _sw, _sh, x, y, w, h) {
          assert.ok(x >= layout.head.x + layout.head.w + 2 && x + w <= 512, `${key}: horizontal clipping`);
          assert.ok(y >= layout.banner.y && y + h <= layout.banner.y + layout.banner.h, `${key}: vertical clipping`);
        } }, font, line, Math.round(layout.textX - measureBitmapText(font, line) / 2),
        Math.round(layout.textY - rows.length * 17 / 2 + i * 17));
      }
    }
  }
});

test("Lampi enters from above, animates, floats toward the player and leaves after its native four seconds", async () => {
  const anims = parseAnims(await asset("characters/light-bug/animData/Light-bug.xml"));
  const sign = { x: 272, y: 384 }, p = { x: 272, y: 384, face: 1, w: 28, h: 56 };
  assert.equal(signTouchesPlayer(sign, p), true);
  assert.equal(signTouchesPlayer(sign, { ...p, x: 500 }), false);
  const lampi = createLampi(sign, anims);
  assert.equal(lampi.y, 84);
  for (let i = 0; i < 73; i++) updateLampi(lampi, p, 1 / 60);
  assert.ok(lampi.y > 180 && lampi.y < p.y); assert.equal(lampi.phase, "follow");
  assert.ok(lampi.anim.i > 0); assert.ok(Math.abs(lampi.vx) <= 120 && Math.abs(lampi.vy) <= 240);
  for (let i = 0; i < 180; i++) updateLampi(lampi, p, 1 / 60);
  assert.equal(lampi.phase, "leave");
  for (let i = 0; i < 120; i++) updateLampi(lampi, p, 1 / 60);
  assert.ok(lampi.vy < 0);
});

test("fly art faces the movement direction, independently of its patrol steering state", () => {
  assert.equal(enemySpriteFlip({ kind: "Fly", vx: 120, dir: 1 }), false);
  assert.equal(enemySpriteFlip({ kind: "Fly", vx: -120, dir: -1 }), true);
  assert.equal(enemySpriteFlip({ kind: "Fly", vx: -120, dir: 1 }), true);
  assert.equal(enemySpriteFlip({ kind: "Fly", vx: 0, dir: 1 }), false);
});
