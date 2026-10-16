// Test en node: parsea los 18 niveles, tilesets, atlas y anims reales.
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";

const A = "C:/Users/faust/Desktop/cosas IA/vascolet-js/assets/";
function loadXML(p) {
  const t = fs.readFileSync(A + p, "utf-8");
  return new JSDOM(t, { contentType: "text/xml" }).window.document;
}
// stub DOMParser global para importar tmx.js tal cual
const { window } = new JSDOM("", {});
global.DOMParser = window.DOMParser;

const { parseTMX, parseTSX, parseTexts, parseAtlas, parseAnims, group, layer } = await import("../js/tmx.js");

let fails = 0;
for (let n = 1; n <= 18; n++) {
  try {
    const M = parseTMX(loadXML(`data/maps/level${n}.tmx`));
    const L = layer(M, "Tiles");
    const nz = L.data.filter(g => g !== 0).length;
    const sc = group(M, "Scenes").length, it = group(M, "Items").length;
    const gn = group(M, "General").length;
    console.log(`L${n}: ${M.w}x${M.h} tiles=${nz} scenes=${sc} items=${it} general=${gn} music=${M.props["music,normal"]}`);
    if (!L || nz === 0) { console.log("  FAIL sin tiles"); fails++; }
  } catch (e) { console.log(`L${n} ERROR`, e.message); fails++; }
}
for (const f of ["tileset_area1","tileset_area2","tileset_area3","tileset_area4","tileset_area5","tileset_area6","tileset_cave","tileset_cave2"]) {
  const T = parseTSX(loadXML(`data/maps/tilesets/${f}.tsx`));
  const nf = Object.keys(T.flags).length;
  console.log(`${f}: ${T.imgW}x${T.imgH} flags=${nf}`);
  if (!nf) fails++;
}
const texts = parseTexts(loadXML("data/texts.xml"));
console.log("texts:", Object.keys(texts).length);
const chars = JSON.parse(fs.readFileSync(A + "chars.json", "utf-8"));
let okA = 0, okN = 0;
for (const [dir, e] of Object.entries(chars)) {
  try {
    if (e.xml) { const a = parseAtlas(loadXML(e.xml.replace(/^assets\//, ""))); okA += Object.keys(a).length; }
    if (e.anim) { const an = parseAnims(loadXML(e.anim.replace(/^assets\//, ""))); okN += an.length; }
  } catch (err) { console.log("CHAR FAIL", dir, err.message); fails++; }
}
console.log(`atlas sprites=${okA} animaciones=${okN} fails=${fails}`);
process.exit(fails ? 1 : 0);
