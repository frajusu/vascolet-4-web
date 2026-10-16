// Parsers for the shipped XML assets. Preserve presence properties and frame order.
export const TILE_SOLID = 1, TILE_UP = 2, TILE_DAMAGE = 4;
export const TILE_FLAGS = Object.freeze({ SOLID: TILE_SOLID, UP: TILE_UP, DAMAGE: TILE_DAMAGE });

const children = (node, name) => [...node.children].filter(n => n.localName === name);
function root(doc, name) {
  if (!doc?.documentElement || doc.getElementsByTagName("parsererror").length)
    throw new Error(`Invalid ${name} XML`);
  if (doc.documentElement.localName !== name) throw new Error(`Expected <${name}>`);
  return doc.documentElement;
}
function number(node, name, fallback = 0) {
  const raw = node.getAttribute(name);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Invalid ${name}: ${raw}`);
  return value;
}
function properties(node) {
  const out = {};
  for (const ps of children(node, "properties")) for (const p of children(ps, "property"))
    out[p.getAttribute("name")] = p.getAttribute("value") ?? p.textContent;
  return out;
}
function presentation(node) {
  return {
    visible: node.getAttribute("visible") !== "0", opacity: number(node, "opacity", 1),
    x: number(node, "x"), y: number(node, "y"),
    offsetX: number(node, "offsetx"), offsetY: number(node, "offsety"),
  };
}

export function parseTMX(doc) {
  const map = root(doc, "map");
  const M = {
    w: +map.getAttribute("width"), h: +map.getAttribute("height"),
    tw: +map.getAttribute("tilewidth"), th: +map.getAttribute("tileheight"),
    props: properties(map), tilesets: [], layers: [], groups: [],
  };
  for (const t of children(map, "tileset"))
    M.tilesets.push({ firstgid: +t.getAttribute("firstgid"), source: t.getAttribute("source") });
  for (const l of children(map, "layer")) {
    const node = children(l, "data")[0];
    if (!node) throw new Error(`Missing data in layer ${l.getAttribute("name")}`);
    const encoding = node.getAttribute("encoding");
    if (node.hasAttribute("compression") || (encoding && encoding !== "csv"))
      throw new Error(`Unsupported TMX encoding: ${encoding}/${node.getAttribute("compression")}`);
    const text = node.textContent.trim();
    const data = encoding === "csv" ? (text ? text.split(/[\s,]+/).map(Number) : [])
      : children(node, "tile").map(t => number(t, "gid"));
    const w = number(l, "width"), h = number(l, "height");
    if (data.length !== w * h || data.some(g => !Number.isInteger(g) || g < 0 || g > 0xffffffff))
      throw new Error(`Invalid tile data in layer ${l.getAttribute("name")}`);
    M.layers.push({ name: l.getAttribute("name"), w, h, data, props: properties(l), ...presentation(l) });
  }
  for (const g of children(map, "objectgroup")) {
    const grp = { name: g.getAttribute("name"), objects: [], props: properties(g), ...presentation(g) };
    for (const o of children(g, "object")) {
      const obj = {
        name: o.getAttribute("name") || "", type: o.getAttribute("type") || "",
        x: number(o, "x"), y: number(o, "y"),
        w: number(o, "width", 32), h: number(o, "height", 32),
        props: properties(o),
      };
      grp.objects.push(obj);
    }
    M.groups.push(grp);
  }
  return M;
}

export function group(M, name) {
  return (M.groups.find(g => g.name === name) || { objects: [] }).objects;
}
export function layer(M, name) {
  return M.layers.find(l => l.name === name);
}

// TSX flags are independent bits: solid=1, up=2, damage=4.
export function parseTSX(doc) {
  const ts = root(doc, "tileset");
  const im = children(ts, "image")[0];
  if (!im) throw new Error("Tileset has no image");
  const T = {
    tileW: +(ts.getAttribute("tilewidth") || 32), tileH: +(ts.getAttribute("tileheight") || 32),
    imgW: +(im.getAttribute("width") || 1024), imgH: +(im.getAttribute("height") || 1024),
    img: im.getAttribute("source"), trans: im.getAttribute("trans"), flags: {},
    spacing: number(ts, "spacing"), margin: number(ts, "margin"),
  };
  for (const t of children(ts, "tile")) {
    const id = +t.getAttribute("id");
    for (const n of Object.keys(properties(t))) {
      const f = n === "solid" ? TILE_SOLID : n === "up" ? TILE_UP : n === "damage" ? TILE_DAMAGE : 0;
      if (f) T.flags[id] = (T.flags[id] || 0) | f;
    }
  }
  return T;
}

// texts.xml -> {key: texto con saltos reales}
export function parseTexts(doc) {
  root(doc, "data");
  const out = {};
  for (const n of doc.querySelectorAll("node"))
    out[n.getAttribute("key")] = (n.getAttribute("text") || "").replace(/\\n/g, "\n");
  return out;
}

// Atlas LibraryInfo: {key: {img, ax, ay, x, y, w, h}}
export function parseAtlas(doc) {
  root(doc, "LibraryInfo");
  const out = {};
  for (const s of doc.querySelectorAll("SpriteData")) {
    const [ax, ay] = s.getAttribute("axis").split(",").map(Number);
    const [x, y, w, h] = s.getAttribute("sourceRect").split(",").map(Number);
    out[s.getAttribute("keyName")] = { img: s.getAttribute("sourceImage"), ax, ay, x, y, w, h };
  }
  return out;
}

// Every XML Frame is a timeline entry, including blanks and flag-only frames.
// sprites contains transform records; flags contains ALL event type strings.
// img/ox/... and flag alias the first sprite/flag for older callers.
export function parseAnims(doc) {
  root(doc, "ExportedData");
  const out = [];
  for (const a of doc.querySelectorAll("Animation")) {
    const frames = [];
    for (const f of children(a, "Frame")) {
      const sprites = children(f, "Sprite").map(sp => ({
        type: sp.getAttribute("type"), img: sp.getAttribute("image") ?? "",
        ox: number(sp, "xOffset"), oy: number(sp, "yOffset"),
        sx: number(sp, "xScale", 1), sy: number(sp, "yScale", 1),
        rot: number(sp, "rotation"), alpha: number(sp, "alpha", 1),
        blendMode: sp.getAttribute("blendMode") ?? "normal",
      }));
      const flagData = children(f, "Flag").map(fl => Object.fromEntries([...fl.attributes].map(a => [a.name, a.value])));
      const flags = flagData.map(fl => fl.type);
      const dur = number(f, "duration", 1);
      if (dur <= 0) throw new Error(`Invalid frame duration in ${a.getAttribute("name")}`);
      frames.push({
        dur, dx: number(f, "xDisplacement"), dy: number(f, "yDisplacement"), priority: number(f, "priority"),
        img: null, ox: 0, oy: 0, sx: 1, sy: 1, rot: 0, alpha: 1, ...sprites[0],
        sprites, flags, flagData, flag: flags[0] ?? null,
        empty: !sprites.some(sp => sp.img),
      });
    }
    const fps = number(a, "fps", 12), loop = number(a, "loopIndex", -1);
    if (fps <= 0 || !Number.isInteger(loop) || loop < -1 || (frames.length && loop >= frames.length))
      throw new Error(`Invalid animation timing in ${a.getAttribute("name")}`);
    out.push({ name: a.getAttribute("name"), fps, loop, frames });
  }
  return out;
}
