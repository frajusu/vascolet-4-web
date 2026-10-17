import { loadXML, loadImage } from "./assets.js";

const fonts = new Map();
export async function loadBitmapFont(name) {
  if (!fonts.has(name)) fonts.set(name, (async () => {
    const base = "assets/lang/fonts/", doc = await loadXML(base + name + ".xml");
    const image = await loadImage(base + doc.documentElement.getAttribute("file"));
    const glyphs = new Map();
    for (const ch of doc.querySelectorAll("character")) {
      const metric = key => Number(ch.querySelector(key).textContent);
      glyphs.set(Number(ch.getAttribute("key")), { x: metric("x"), y: metric("y"), w: metric("width"), h: metric("height") });
    }
    return { image, glyphs };
  })());
  return fonts.get(name);
}

export function drawBitmapText(ctx, font, text, x, y) {
  const startX = x;
  for (const ch of text) {
    if (ch === "\n") { x = startX; y += 17; continue; }
    const g = font.glyphs.get(ch.codePointAt(0)) ?? font.glyphs.get(63);
    if (!g) continue;
    ctx.drawImage(font.image, g.x, g.y, g.w, g.h, x, y, g.w, g.h);
    x += g.w;
  }
  return x - startX;
}

export function measureBitmapText(font, text) {
  return [...text].reduce((width, ch) => width + ((font.glyphs.get(ch.codePointAt(0)) ?? font.glyphs.get(63))?.w ?? 0), 0);
}

export function wrapBitmapText(font, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && measureBitmapText(font, line + " " + word) > maxWidth) { lines.push(line); line = ""; }
      for (const ch of (line ? " " : "") + word) {
        if (line && measureBitmapText(font, line + ch) > maxWidth) { lines.push(line); line = ""; }
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}
