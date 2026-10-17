// Asset-driven port. First-area combat combines original runtime observations and
// the user's Godot reference; exact physics, other AI and presentation remain provisional.
import { img, loadImage, loadXML } from "./assets.js";
import { parseTMX, parseTSX, group, layer, parseAtlas, parseAnims, TILE_SOLID, TILE_UP, TILE_DAMAGE } from "./tmx.js";
import { drawAtlas, drawAnimFrame, AnimPlayer, pixel } from "./sprite.js";
import { Input, jumpHeld, jumpPressed, firePressed } from "./input.js";
import { Save } from "./save.js";
import { Audio2 } from "./audio.js";
import { updateCamera } from "./camera.js";
import { createBoomerang, updateBoomerang, terrainHit, segmentBox } from "./projectiles.js";
import { createEnemy, hitEnemy, updateEnemy } from "./enemies.js";
import { beginPlayerDamage, advancePlayerDamage, DAMAGE_MOTION } from "./player-damage.js";

const W = 512, H = 384, TILE = 32;
const SFX = "assets/audio/fx/win/", MUS = "assets/audio/music/win/";
const HUD = "assets/images/hud/hud.png";

export const Game = {
  map: null, tsx: [], grid: null, gw: 0, gh: 0,
  bgs: [], // {tilesets, layers:[{w,h,hScale,vScale,visible,opacity,data}]}
  player: null, enemies: [], items: [], infos: [], saves: [],
  booms: [], parts: [], shots: [], effects: [],
  camX: 0, camY: 0, prevCamX: 0, prevCamY: 0, time: 0,
  tip: "", tipT: 0, level: 1, coins: 0, lives: 5, energy: 100,
  dlg: null, // {text, shown, t, portrait}
  charCache: new Map(),
  chars: {}, texts: {},
  hudAtlas: null,
};

function resolveRel(base, rel) {
  // base: "assets/data/maps/level1.tmx", rel: "tilesets/x.tsx" o "../tilesets/x.tsx"
  const parts = base.split("/").slice(0, -1);
  for (const p of rel.replace(/\\/g, "/").split("/")) {
    if (p === "..") parts.pop();
    else if (p && p !== ".") parts.push(p);
  }
  return parts.join("/");
}

// TSX dimensions describe logical pixels. Never infer an atlas size from its
// occupied rectangles (padding is unknown). Normalize only with explicit metadata.
const logicalImages = new WeakMap();
function logicalImage(image, width, height) {
  if (!(width > 0 && height > 0) || (image.width === width && image.height === height)) return image;
  const key = `${width}x${height}`;
  let sizes = logicalImages.get(image);
  if (!sizes) logicalImages.set(image, sizes = new Map());
  if (!sizes.has(key)) {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Cannot normalize image: 2D canvas unavailable");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, width, height);
    sizes.set(key, canvas);
  }
  return sizes.get(key);
}

async function loadChar(tmxName) {
  if (Game.charCache.has(tmxName)) return Game.charCache.get(tmxName);
  const c = { img: null, atlas: {}, anims: [], step: false };
  const entry = (Game.chars || {})[tmxDir(tmxName)];
  // Unsupported entity names retain the prototype marker; declared assets must load.
  if (!entry) {
    if (tmxName === "Vascolet") throw new Error("Missing Vascolet character manifest entry");
    return c;
  }
  const fix = p => String(p || "").replace(/\\/g, "/");
  const [image, atlasDoc, animDoc] = await Promise.all([
    loadImage(fix(entry.png)), entry.xml ? loadXML(fix(entry.xml)) : null, entry.anim ? loadXML(fix(entry.anim)) : null,
  ]);
  c.img = logicalImage(image, entry.width, entry.height);
  if (atlasDoc) c.atlas = parseAtlas(atlasDoc);
  if (animDoc) c.anims = parseAnims(animDoc);
  if (tmxName === "Vascolet" && (!Object.keys(c.atlas).length || !c.anims.length))
    throw new Error("Vascolet atlas/animations are missing");
  Game.charCache.set(tmxName, c);
  return c;
}

function tmxDir(n) {
  const map = {
    Vascolet: "vascolet", Fly: "fly", Frog: "frog", Flower: "flower", Beetle: "beetle",
    Snail: "snail", BigScorpion: "big-scorpion", TopoNinja: "topo-ninja", BigBird: "big-bird",
    BigSnake: "big-snake", VolcanoFlower: "volcano-flower", Panal: "fly", Bat: "big-bat",
    LittleSpider: "little-spider", Fish: "fish", Piranha: "pirana", Pirana2: "pirana2",
    Blowfish: "blowfish", Shell: "shell", Mosquito: "mosquito", DragonFly: "dragon-fly",
    Bee: "bee", GiantDragonfly: "giant-dragonfly", BigUglyDragon: "ugly-dragon",
    FurryCritter: "furry-critter", Mouse: "mouse", BigBat: "big-bat", BigGhost: "ghost2",
    BigSpider: "big-spider", BigAnguila: "anguila2", BigPirana: "big-pirana",
    BigPiranaBlowFish: "blowfish2", Boomerang: "boomerang", Malmark2: "malmark2",
  };
  return map[n] || n.toLowerCase();
}

async function loadBg(levelPath, bgName) {
  const base = resolveRel(levelPath, `backgrounds/${bgName}.tmx`);
  const M = parseTMX(await loadXML(base));
  const tilesets = await loadTilesets(M, base);
  const layers = M.layers.map(l => {
    const hScale = Number(l.props.hScale ?? 1), vScale = Number(l.props.vScale ?? 0);
    if (!Number.isFinite(hScale) || !Number.isFinite(vScale)) throw new Error(`Invalid parallax scale: ${base}/${l.name}`);
    return { ...l, hScale, vScale };
  });
  return { tilesets, layers };
}

async function loadTilesets(map, base) {
  return Promise.all(map.tilesets.map(async t => {
    const path = resolveRel(base, t.source);
    const doc = await loadXML(path), tsx = parseTSX(doc);
    const png = resolveRel(path, tsx.img);
    const metadata = doc.querySelector("tileset > image");
    const width = Number(metadata?.getAttribute("width")), height = Number(metadata?.getAttribute("height"));
    const image = logicalImage(await loadImage(png), width, height);
    return { firstgid: t.firstgid, tsx, png, image };
  }));
}

const BOSSES = new Set(["BigScorpion", "TopoNinja", "BigBird", "BigSnake", "BigBat", "BigGhost",
  "BigSpider", "BigAnguila", "BigPirana", "BigPiranaBlowFish", "BigUglyDragon", "GiantDragonfly",
  "FurryCritter", "Malmark", "Malmark2"]);

export async function loadLevel(n, fresh = true) {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Invalid level: ${n}`);
  const G = Game;
  G.level = n; G.enemies = []; G.items = []; G.infos = []; G.saves = [];
  G.booms = []; G.parts = []; G.shots = []; G.effects = []; G.dlg = null;
  G.coins = 0; G.energy = 100; G.tip = ""; G.tipT = 0;
  if (fresh) G.lives = 5;
  G.start = null; G.player = null; G.time = 0;
  G.camX = G.camY = G.prevCamX = G.prevCamY = 0;
  G.bossHP = 0; G.bossMax = 1; G.bossHead = null;
  const levelPath = `assets/data/maps/level${n}.tmx`;
  const doc = await loadXML(levelPath);
  G.map = parseTMX(doc);
  G.gw = G.map.w; G.gh = G.map.h;
  if (G.map.tw !== TILE || G.map.th !== TILE) throw new Error(`Unsupported tile size in ${levelPath}`);
  G.tsx = await loadTilesets(G.map, levelPath);
  const L = layer(G.map, "Tiles");
  G.grid = new Uint8Array(G.gw * G.gh);
  if (!L) throw new Error(`Missing Tiles layer in ${levelPath}`);
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) {
    const gx = x + L.x + L.offsetX / TILE, gy = y + L.y + L.offsetY / TILE;
    if (!Number.isInteger(gx) || !Number.isInteger(gy)) throw new Error("Collision layer must align to tile grid");
    if (gx < 0 || gy < 0 || gx >= G.gw || gy >= G.gh) continue;
    const gid = L.data[y * L.w + x] & 0x0fffffff;
    if (!gid) continue;
    const ts = tsFor(gid);
    if (ts) G.grid[gy * G.gw + gx] = ts.tsx.flags[gid - ts.firstgid] || 0;
  }
  // fondo parallax (prop background=back_area1)
  G.bgs = [];
  const bgName = G.map.props["background"];
  if (bgName) {
    const bg = await loadBg(levelPath, bgName);
    if (bg) G.bgs.push(bg);
  }
  await loadImage(HUD);
  if (!G.hudAtlas) G.hudAtlas = parseAtlas(await loadXML("assets/images/hud/hud.xml"));
  for (const o of group(G.map, "General")) {
    if (o.name === "Start") G.start = { x: o.x + 16, y: o.y + 16 };
    if (o.name === "*Info") G.infos.push({ x: o.x + 16, y: o.y + 16, key: o.props.info, shown: false });
    if (o.name === "*Save") G.saves.push({ x: o.x + 16, y: o.y + 16, tip: o.props.info });
  }
  const foes = group(G.map, "Enemies");
  for (const o of foes.length ? foes : group(G.map, "Scenes")) {
    const isBoss = BOSSES.has(o.name);
    G.enemies.push(createEnemy(o, isBoss));
  }
  for (const o of group(G.map, "Items"))
    G.items.push({ kind: o.name, x: o.x + 16, y: o.y + 16, taken: Save.hasItem(o.name), t: 0 });
  G.player = {
    x: (G.start || { x: 256 }).x, y: (G.start || { y: 352 }).y,
    vx: 0, vy: 0, w: 28, h: 56, face: 1, ground: false, coyote: 0, buffer: 0,
    inv: 0, fireCd: 0, attack: null, damage: null, run: false, tapD: 0, tapT: -9, crouch: false,
    anim: null, animName: "", cur: null,
  };
  G.checkpoint = G.start ? { x: G.start.x, y: G.start.y } : { x: 256, y: 352 };
  await ensureChar("Vascolet");
  await Promise.all(["Boomerang", "effects", "fireball"].map(ensureChar));
  G.player.anim = new AnimPlayer(Game.charCache.get("Vascolet").anims);
  // carteles de ayuda/guardado (signposts del original)
  try {
    await loadChar("carteles-ayuda-guardar");
    const sc = Game.charCache.get("carteles-ayuda-guardar");
    const frameOf = (anim) => {
      const a = sc.anims.find(a => a.name === anim) || sc.anims[0];
      return a ? a.frames[0] : null;
    };
    G.signInfo = frameOf("info");
    G.signSave = frameOf("savePoint");
  } catch { G.signInfo = null; G.signSave = null; }
  G.player.cur = G.player.anim.frame;
  await Promise.all(G.enemies.map(async e => {
    const c = await ensureChar(e.kind);
    e.anim = c.anims.length ? new AnimPlayer(c.anims) : null;
    if (e.anim) {
      const pref = ["stand", "normal", "idle", "walk", "fly"].find(a => e.anim.has(a));
      if (pref) e.anim.set(pref);
      e.cur = e.anim.frame;
    }
  }));
  const selector = G.map.props.defaultMusic;
  const mus = (selector && G.map.props[`music,${selector}`]) || G.map.props["music,normal"]
    || (selector?.endsWith(".ogg") ? selector : "");
  void Audio2.music(mus ? MUS + mus : null);
  updateCamera(G, 0, true);
  snapshotPositions();
  G.tip = `NIVEL ${n}`; G.tipT = 3;
  // condicion de victoria desde props del mapa
  G.win = null; G.won = false; G.events = [];
  for (const k of Object.keys(G.map.props)) {
    if (k === "winCondition,boss") G.win = { kind: "boss", target: (G.map.props[k].split(",")[0] || "").replace(/^\*/, "") };
    if (k === "winCondition,exit") G.win = { kind: "exit" };
  }
  G.winAction = G.map.props["winAction"] || "";
}

async function ensureChar(tmxName) { return loadChar(tmxName); }

function tsFor(gid, tilesets = Game.tsx) {
  let best = null;
  for (const t of tilesets) if (t.firstgid <= gid && (!best || t.firstgid > best.firstgid)) best = t;
  return best;
}

export function tileAt(tx, ty) {
  const G = Game;
  if (tx < 0 || ty < 0 || tx >= G.gw || ty >= G.gh) return 1;
  return G.grid[ty * G.gw + tx];
}

// Provisional tuning, not recovered original constants.
const GRAV = 1500, MOVE = 170, RUN = 300, JUMP = 560;
const EPS = 1e-7;
function moveBody(b, dt, gravity = GRAV) {
  b.hitWall = false;
  b.vy += gravity * dt;
  if (b.vy > 900) b.vy = 900;
  const prevX = b.x;
  b.x += b.vx * dt;
  const y0 = Math.floor((b.y - b.h + EPS) / TILE), y1 = Math.floor((b.y - EPS) / TILE);
  if (b.vx !== 0) {
    const side = Math.sign(b.vx), half = side * b.w / 2;
    const from = Math.floor((prevX + half - side * EPS) / TILE);
    const to = Math.floor((b.x + half - side * EPS) / TILE);
    for (let tx = from; side > 0 ? tx <= to : tx >= to; tx += side) {
      let wall = false;
      for (let ty = y0; ty <= y1; ty++) {
        const flags = tileAt(tx, ty);
        if (flags & TILE_DAMAGE) b.hurt = true;
        if (flags & TILE_SOLID) wall = true;
      }
      if (wall) {
        b.x = (side > 0 ? tx * TILE : (tx + 1) * TILE) - half;
        b.hitWall = true; b.vx = 0;
        break;
      }
    }
  }
  const prevBottom = b.y;
  b.y += b.vy * dt;
  b.ground = false;
  const x0 = Math.floor((b.x - b.w / 2 + EPS) / TILE), x1 = Math.floor((b.x + b.w / 2 - EPS) / TILE);
  if (b.vy >= 0) {
    // Test crossed support planes, including the exact plane at rest. Sampling
    // y-1 missed this row under gravity and alternated grounded/airborne ticks.
    const from = Math.floor((prevBottom + EPS) / TILE), to = Math.floor((b.y + EPS) / TILE);
    for (let ty = from; ty <= to; ty++) {
      let support = false;
      for (let tx = x0; tx <= x1; tx++) {
        const flags = tileAt(tx, ty);
        if ((flags & (TILE_SOLID | TILE_UP)) && prevBottom <= ty * TILE + EPS) {
          support = true;
          if (flags & TILE_DAMAGE) b.hurt = true;
        }
      }
      if (support) { b.y = ty * TILE; b.vy = 0; b.ground = true; break; }
    }
  } else {
    const from = Math.floor((prevBottom - b.h - EPS) / TILE), to = Math.floor((b.y - b.h - EPS) / TILE);
    for (let ty = from; ty >= to; ty--) {
      let ceiling = false;
      for (let tx = x0; tx <= x1; tx++) {
        const flags = tileAt(tx, ty);
        if (flags & TILE_SOLID) { ceiling = true; if (flags & TILE_DAMAGE) b.hurt = true; }
      }
      if (ceiling) { b.y = (ty + 1) * TILE + b.h; b.vy = 0; break; }
    }
  }
  for (let ty = Math.floor((b.y - b.h + EPS) / TILE); ty <= Math.floor((b.y - EPS) / TILE); ty++)
    for (let tx = x0; tx <= x1; tx++) if (tileAt(tx, ty) & TILE_DAMAGE) b.hurt = true;
}

function snapshotPositions() {
  const G = Game;
  G.prevCamX = G.camX; G.prevCamY = G.camY;
  for (const b of [G.player, ...G.enemies, ...G.booms, ...G.parts, ...G.shots, ...G.effects]) {
    if (b) { b.prevX = b.x; b.prevY = b.y; }
  }
}

// sonidos por animacion (flags PlaySound del XML)
const STEP = { n: 0 };
function flagSound(animName, flag) {
  if (flag !== "PlaySound") return;
  if (animName === "walk" || animName === "run" || animName === "withAntWalk") {
    STEP.n ^= 1;
    Audio2.sfx(SFX + (STEP.n ? "footStep1.ogg" : "footStep2.ogg"), 0.7);
  } else if (animName.startsWith("flying")) {
    Audio2.sfx(SFX + "wings.ogg", 0.5);
  } else if (animName === "boomerang" || animName === "normal" || animName === "fast") {
    Audio2.sfx(SFX + "boomerang2.ogg", 0.6);
  } else if (animName.startsWith("swim")) {
    Audio2.sfx(SFX + "swim.ogg", 0.5);
  }
}

export function gameUpdate(dt) {
  if (!Number.isFinite(dt) || dt < 0) throw new RangeError("Game dt must be finite and nonnegative");
  const G = Game, p = G.player;
  if (!p) return;
  snapshotPositions();
  G.time += dt;
  // dialogo NO modal (como el original): el juego sigue, Z/Enter/click avanza/cierra
  if (G.dlg) {
    G.dlg.t += dt;
    const full = G.dlg.text.length;
    G.dlg.shown = Math.min(full, Math.floor(G.dlg.t * 40));
    if (Input.pressed.has("z") || Input.pressed.has("enter") || Input.pressed.has(" ") || Input.pressed.has("click")) {
      if (G.dlg.shown < full) { G.dlg.shown = full; G.dlg.t = 99; }
      else G.dlg = null;
    }
  }
  let dir = 0;
  if (Input.down("left")) dir -= 1;
  if (Input.down("right")) dir += 1;
  const now = G.time;
  if (!p.damage && (Input.pressed.has("left") || Input.pressed.has("right"))) {
    const d = Input.pressed.has("left") ? -1 : 1;
    if (p.tapD === d && now - p.tapT < 0.3) p.run = true;
    p.tapD = d; p.tapT = now;
  }
  if (dir === 0) p.run = false;
  else if (!p.attack && !p.damage) p.face = dir;
  p.vx = p.damage ? (p.damage.phase === "air" ? -p.damage.face * DAMAGE_MOTION.speed : 0) : dir * (p.run ? RUN : MOVE);
  p.crouch = !p.damage && Input.down("down") && p.ground;
  if (p.crouch || (p.attack && p.ground)) p.vx = 0;
  if (p.damage) p.buffer = 0;
  else if (jumpPressed()) p.buffer = 0.12; else p.buffer = Math.max(0, p.buffer - dt);
  p.coyote = p.ground ? 0.1 : Math.max(0, p.coyote - dt);
  if (!p.damage && p.coyote > 0 && p.buffer > 0) {
    p.vy = -JUMP; p.buffer = 0; p.coyote = 0; p.ground = false;
    Audio2.sfx(SFX + "jumpAir.ogg");
    dust(p.x, p.y, 6);
  }
  if (!p.damage && !jumpHeld() && p.vy < -180) p.vy = -180;
  p.hurt = false;
  const wasGround = p.ground, fallV = p.vy;
  moveBody(p, dt, p.damage ? DAMAGE_MOTION.gravity : GRAV);
  advancePlayerDamage(p, dt);
  if (!wasGround && p.ground && fallV > 300) dust(p.x, p.y, 9);
  p.inv = Math.max(0, p.inv - dt);
  if (p.hurt) hurtPlayer();
  if (!p.damage && firePressed() && p.fireCd <= 0 && !p.attack && G.booms.length < 2) {
    const name = p.crouch && p.anim.has("crouchAttack") ? "crouchAttack" : "standAttack";
    if (p.anim.has(name)) {
      p.attack = { name, released: false, crouch: p.crouch, face: p.face };
      p.animName = name; p.anim.set(name, { restart: true });
      p.fireCd = .15;
    }
  }
  p.fireCd = Math.max(0, p.fireCd - dt);
  for (const e of G.enemies) {
    if (!e.active && Math.abs(e.x - p.x) < 512 && Math.abs(e.y - p.y) < 420) e.active = true;
    if (!e.active || Math.abs(e.x - p.x) > 900 || Math.abs(e.y - p.y) > 700) continue;
    updateEnemy(e, p, dt, { moveBody, tileAt, shoot: enemyShoot, booms: G.booms });
    if (e.y > G.gh * TILE + 160 && e.hp > 0) { e.hp = 0; e.deadT = 2; }
  }
  for (const b of G.booms) {
    updateBoomerang(b, p, G.enemies, dt, { tileAt, hitEnemy: (e, boom) => damageEnemy(e, Math.sign(boom.vx)),
      wallHit: () => Audio2.sfx(SFX + "boomerang_wall_hit.ogg", .7), impact });
    if (b.anim) {
      b.anim.update(dt);
      for (const event of b.anim.drainEvents()) flagSound(event.animation, event.type);
    }
  }
  G.booms = G.booms.filter(b => b.life > 0);
  updateEnemyShots(dt);
  for (const e of G.enemies) {
    if (e.hp <= 0 || Math.abs(p.x - e.x) >= (p.w + e.w) / 2 || p.y <= e.y - e.h || p.y - (p.crouch ? 28 : p.h) >= e.y) continue;
    if (!e.boss && e.behavior !== "flower" && p.vy > 0 && p.prevY <= e.y - e.h + 10) {
      damageEnemy(e, p.face); p.vy = -280; p.ground = false;
    } else hurtPlayer();
  }
  updateCamera(G, dt);
  for (const item of G.items) {
    if (item.taken || Math.abs(p.x - item.x) > 24 || p.y < item.y - 18 || p.y - p.h > item.y + 18) continue;
    if (Save.collectItem(item.kind)) {
      item.taken = true;
      Audio2.sfx(SFX + (item.kind.startsWith("&Key") ? "key.ogg" : "energy.ogg"));
    }
  }
  G.tipT = Math.max(0, G.tipT - dt);
  for (const i of G.infos) {
    // Los carteles los explica Lampi (help.jpg original). Sin pausa.
    if (Math.hypot(i.x - p.x, i.y - p.y) < 48 && !i.shown) {
      i.shown = true;
      const t = Game.texts[i.key];
      if (t) openDialog(t, "dialogBannerLampi");
    } else if (Math.hypot(i.x - p.x, i.y - p.y) > 96) i.shown = false;
  }
  for (const s of G.saves) {
    if (Math.hypot(s.x - p.x, s.y - p.y) < 40) {
      Save.write({ level: G.level, x: s.x, y: s.y, t: Date.now() });
      G.checkpoint = { x: s.x, y: s.y };
      Audio2.sfx(SFX + "save.ogg");
      G.tip = "Guardado."; G.tipT = 2;
      s.x = -99999;
    }
  }
  // barra de jefe: maximo hp entre jefes vivos, visible solo cerca del jefe
  G.bossHP = 0; G.bossMax = 1; G.bossHead = null;
  for (const e of G.enemies) {
    if (!e.boss || e.hp <= 0) continue;
    if (G.player && Math.hypot(e.x - G.player.x, e.y - G.player.y) > 520) continue;
    if (e.hp > G.bossHP) { G.bossHP = e.hp; G.bossMax = e.maxhp; G.bossHead = e.kind; }
  }
  // particulas de polvo
  for (const q of G.parts) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; }
  G.parts = G.parts.filter(q => q.life > 0);
  for (const fx of G.effects) fx.anim.update(dt);
  G.effects = G.effects.filter(fx => !fx.anim.finished);
  // anim jugador con NOMBRES REALES (ataque tiene prioridad mientras dura)
  let want = "stand";
  if (p.attack) want = p.attack.name;
  else if (!p.ground) want = p.vy < -50 ? (p.run && p.anim.has("runJump") ? "runJump" : "standJump") : "fall";
  else if (p.crouch && p.anim.has("crouch")) want = "crouch";
  else if (dir !== 0) want = p.run ? "run" : "walk";
  if (p.damage) want = ({ air: "damage", fall: "damageFall", rise: "damageRaise" })[p.damage.phase];
  if (want !== p.animName && p.anim.has(want)) { p.animName = want; p.anim.set(want); }
  const r = p.anim.update(dt);
  p.cur = r.frame;
  for (const event of p.anim.drainEvents()) {
    flagSound(event.animation, event.type);
    if (event.type === "MakeEffect") dust(p.x, p.y - 4);
    if (p.attack && event.animation === p.attack.name && event.type === "Custom") releaseBoomerang();
  }
  // Crouch XML lacks Custom; its extended throw pose is frame 4.
  if (p.attack?.name === "crouchAttack" && p.anim.i >= 4) releaseBoomerang();
  if (p.attack && p.anim.finished) p.attack = null;
  if (p.damage?.phase === "rise" && (p.animName === "damageRaise" ? p.anim.finished : p.damage.time >= .2)) p.damage = null;
  // muerte: energia o caida al vacio -> pierde vida, respawn o game over
  if ((G.energy <= 0 || p.y > G.gh * TILE + 80) && !G.won) {
    G.lives -= 1;
    Audio2.sfx(SFX + "vasco_death.ogg");
    if (G.lives < 0) {
      G.events.push({ type: "gameover" });
    } else {
      G.energy = 100;
      const s = G.checkpoint || G.start;
      p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0; p.inv = 2;
      p.attack = null; p.damage = null; G.booms = []; G.shots = [];
      updateCamera(G, 0, true); snapshotPositions();
    }
  }
  // victoria segun props del mapa
  if (!G.won && G.win) {
    if (G.win.kind === "boss") {
      if (!G.enemies.some(e => e.kind === G.win.target && e.hp > 0)) {
        G.won = true;
        Audio2.music(MUS + "win_level.ogg");
        G.events.push({ type: "win" });
      }
    } else if (G.win.kind === "exit") {
      if (p.x > G.gw * TILE - 64) {
        G.won = true;
        Audio2.music(MUS + "win_level.ogg");
        G.events.push({ type: "win" });
      }
    }
  }
}

function dust(x, y) {
  for (let i = 0; i < 5; i++)
    Game.parts.push({ x: x + (Math.random() - 0.5) * 20, y, vx: (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 40, life: 0.4 });
}

function releaseBoomerang() {
  const G = Game, p = G.player, attack = p.attack;
  if (!attack || attack.released) return;
  attack.released = true;
  if (G.booms.length >= 2) return;
  const c = G.charCache.get("Boomerang"), anim = c?.anims.length ? new AnimPlayer(c.anims) : null;
  if (anim?.has("normal")) anim.set("normal");
  G.booms.push(createBoomerang({ x: p.x, y: p.y, face: attack.face, crouch: attack.crouch }, anim));
  Audio2.sfx(SFX + "boomerang.ogg");
}

function impact(x, y) {
  const c = Game.charCache.get("effects");
  if (!c?.anims.some(a => a.name === "shot_impact")) return;
  const anim = new AnimPlayer(c.anims); anim.set("shot_impact");
  Game.effects.push({ x, y, prevX: x, prevY: y, anim });
}

function damageEnemy(e, direction) {
  if (!hitEnemy(e, direction)) return;
  Audio2.sfx(SFX + (e.boss && e.hp <= 0 ? "boss_death.ogg" : "enemy_boomerang_hit.ogg"));
}

function hurtPlayer() {
  const G = Game, p = G.player;
  if (p.inv > 0 || G.won) return;
  G.energy = Math.max(0, G.energy - 100 / 7); p.inv = 1;
  beginPlayerDamage(p);
  Audio2.sfx(SFX + "enemy_hit.ogg");
}

function enemyShoot(e) {
  const kind = e.behavior === "snail" ? "fireball" : "effects";
  const c = Game.charCache.get(kind);
  const anim = c?.anims.length ? new AnimPlayer(c.anims) : null;
  if (anim?.has(e.behavior === "snail" ? "normal" : "bullet")) anim.set(e.behavior === "snail" ? "normal" : "bullet");
  const x = e.x + e.dir * (e.behavior === "flower" ? 20 : 0), y = e.y - (e.behavior === "flower" ? 40 : 20);
  Game.shots.push({ kind, x, y, prevX: x, prevY: y, vx: e.dir * 180, life: 4, anim });
}

function updateEnemyShots(dt) {
  const G = Game, p = G.player;
  for (const shot of G.shots) {
    shot.life -= dt;
    const nx = shot.x + shot.vx * dt;
    const wall = terrainHit(shot.x, shot.y, nx, shot.y, tileAt, 6);
    const player = segmentBox(shot.x, shot.y, nx, shot.y,
      p.x - p.w / 2 - 6, p.y - (p.crouch ? 28 : p.h) - 6, p.x + p.w / 2 + 6, p.y + 6);
    if (player !== null && (wall === null || player < wall)) { hurtPlayer(); shot.life = 0; }
    else if (wall !== null) shot.life = 0;
    shot.x = nx; shot.anim?.update(dt);
  }
  G.shots = G.shots.filter(s => s.life > 0);
}

function openDialog(text, portrait) {
  Game.dlg = { text, shown: 0, t: 0, portrait };
  Audio2.sfx(SFX + "help.ogg", 0.6);
}

function drawTile(ctx, raw, tilesets, x, y) {
  const gid = raw & 0x0fffffff;
  if (!gid) return;
  const ts = tsFor(gid, tilesets);
  if (!ts) throw new Error(`No tileset for GID ${gid}`);
  const T = ts.tsx, local = gid - ts.firstgid;
  const cols = Math.floor((T.imgW - 2 * T.margin + T.spacing) / (T.tileW + T.spacing));
  const sx = T.margin + (local % cols) * (T.tileW + T.spacing);
  const sy = T.margin + Math.floor(local / cols) * (T.tileH + T.spacing);
  // inset de 0.5px contra bleeding de tiles vecinos
  const ix = sx + 0.5, iy = sy + 0.5, iw = T.tileW - 1, ih = T.tileH - 1;
  if (raw & 0xe0000000) {
    ctx.save();
    ctx.translate(x + TILE / 2, y + TILE / 2);
    ctx.scale(raw & 0x80000000 ? -1 : 1, raw & 0x40000000 ? -1 : 1);
    if (raw & 0x20000000) ctx.transform(0, -1, -1, 0, 0, 0);
    ctx.drawImage(ts.image, ix, iy, iw, ih, -TILE / 2, -TILE / 2, TILE, TILE);
    ctx.restore();
  } else ctx.drawImage(ts.image, ix, iy, iw, ih, x, y, TILE, TILE);
}

function drawTileLayer(ctx, L, tsxList, cx, cy, repeatX = false) {
  if (L.visible === false || L.opacity === 0 || !L.w || !L.h) return;
  cx -= (L.x || 0) * TILE + (L.offsetX || 0);
  cy -= (L.y || 0) * TILE + (L.offsetY || 0);
  const x0 = repeatX ? Math.floor(cx / TILE) : Math.max(0, Math.floor(cx / TILE));
  const x1 = repeatX ? Math.ceil((cx + W) / TILE) - 1 : Math.min(L.w - 1, Math.ceil((cx + W) / TILE) - 1);
  const y0 = Math.max(0, Math.floor(cy / TILE)), y1 = Math.min(L.h - 1, Math.ceil((cy + H) / TILE) - 1);
  ctx.save();
  ctx.globalAlpha *= L.opacity ?? 1;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const wx = repeatX ? ((tx % L.w) + L.w) % L.w : tx;
    drawTile(ctx, L.data[ty * L.w + wx], tsxList, tx * TILE - cx, ty * TILE - cy);
  }
  ctx.restore();
}

// alpha blends the previous/current fixed-step snapshots; drawing never mutates them.
export function gameDraw(ctx, alpha = 1) {
  const G = Game;
  alpha = Math.max(0, Math.min(1, alpha));
  const lerp = (previous, current) => (previous ?? current) + (current - (previous ?? current)) * alpha;
  const x = b => lerp(b.prevX, b.x), y = b => lerp(b.prevY, b.y);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#0a0a18";
  ctx.fillRect(0, 0, W, H);
  const cx = lerp(G.prevCamX, G.camX), cy = lerp(G.prevCamY, G.camY);
  // fondos parallax (repiten en X, fijos en Y)
  for (const bg of G.bgs) {
    for (const l of bg.layers)
      drawTileLayer(ctx, l, bg.tilesets, cx * l.hScale, cy * l.vScale, true);
  }
  const L = layer(G.map, "Tiles");
  if (L) drawTileLayer(ctx, L, G.tsx, cx, cy);
  const F = layer(G.map, "foreground");
  // items
  for (const i of G.items) {
    if (i.taken) continue;
    ctx.fillStyle = "#7dff9a";
    ctx.fillRect(i.x - cx - 3, i.y - cy - 3, 6, 6);
  }
  // carteles de ayuda/guardado (sprites reales)
  {
    const sc = Game.charCache.get("carteles-ayuda-guardar");
    const drawSign = (sp, fr) => {
      if (!sc || !sc.img || !fr || !fr.img) return;
      const ent = sc.atlas[fr.img];
      if (ent) drawAtlas(ctx, sc.img, { ...ent, ax: ent.ax + (fr.ox || 0), ay: ent.ay + (fr.oy || 0) }, sp.x - cx, sp.y - cy);
    };
    for (const o of G.infos) drawSign(o, G.signInfo);
    for (const o of G.saves) if (o.x > -9999) drawSign(o, G.signSave);
  }
  // enemigos con sprites reales
  for (const e of G.enemies) {
    if (e.hp <= 0 && e.deadT > 1.2) continue;
    const c = Game.charCache.get(e.kind);
    if (c?.img && e.anim) {
      drawAnimFrame(ctx, c.img, c.atlas, e.cur, x(e) - cx, y(e) - cy,
        { flip: e.dir > 0, round: false, alpha: e.hp <= 0 ? Math.max(0, 1 - e.deadT / 1.2) : e.hurtT > 0 ? .65 : 1 });
    } else {
      ctx.fillStyle = "#ffd75e";
      ctx.fillRect(x(e) - cx - 3, y(e) - cy - 3, 6, 6);
    }
  }
  // jugador
  const p = G.player;
  if (p) {
    const c = Game.charCache.get("Vascolet");
    if (c?.img && p.anim) {
      drawAnimFrame(ctx, c.img, c.atlas, p.cur, x(p) - cx, y(p) - cy,
        { flip: p.face < 0, round: false, alpha: p.inv > 0 && Math.floor(G.time / 0.08) % 2 ? 0.4 : 1 });
    } else {
      ctx.fillStyle = "#f66"; ctx.fillRect(x(p) - cx - 8, y(p) - cy - 28, 16, 28);
    }
    const bc = Game.charCache.get("Boomerang");
    for (const b of G.booms) {
      // The atlas already contains the rotation; do not rotate it a second time.
      if (bc?.img && b.anim) {
        drawAnimFrame(ctx, bc.img, bc.atlas, b.anim.frame, x(b) - cx, y(b) - cy, { round: false, flip: b.face < 0 });
      } else {
        ctx.fillStyle = "#fc6";
        ctx.fillRect(x(b) - cx - 4, y(b) - cy - 4, 8, 8);
      }
    }
  }
  const effectChar = G.charCache.get("effects");
  for (const shot of G.shots) {
    const shotChar = G.charCache.get(shot.kind);
    if (shotChar?.img && shot.anim) drawAnimFrame(ctx, shotChar.img, shotChar.atlas, shot.anim.frame, x(shot) - cx, y(shot) - cy, { flip: shot.vx < 0, round: false });
  }
  for (const fx of G.effects) if (effectChar?.img)
    drawAnimFrame(ctx, effectChar.img, effectChar.atlas, fx.anim.frame, fx.x - cx, fx.y - cy, { round: false });
  // polvo
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  for (const q of G.parts) ctx.fillRect(x(q) - cx - 1, y(q) - cy - 1, 3, 3);
  if (F) drawTileLayer(ctx, F, G.tsx, cx, cy);
  drawHUD(ctx);
  // tip chico (title card)
  if (G.tipT > 0 && G.tip && !G.dlg) {
    ctx.imageSmoothingEnabled = true;
    ctx.font = "bold 20px sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    const tw = ctx.measureText(G.tip.split("\n")[0]).width;
    ctx.fillRect((W - tw) / 2 - 12, 30, tw + 24, 30);
    ctx.fillStyle = "#ffe9a3";
    ctx.fillText(G.tip.split("\n")[0], (W - tw) / 2, 52);
  }
  if (G.dlg) drawDialog(ctx);
  ctx.imageSmoothingEnabled = true;
}

function drawHUD(ctx) {
  const G = Game;
  const him = img(HUD);
  if (!him || !G.hudAtlas) {
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 0, W, 22);
    ctx.font = "bold 12px sans-serif"; ctx.fillStyle = "#fff";
    ctx.fillText(`Nv ${G.level}  Vidas ${G.lives}  E ${Math.max(0, Math.round(G.energy))}  $ ${G.coins}`, 8, 15);
    return;
  }
  const A = G.hudAtlas;
  const put = (key, x, y) => {
    const e = A[key];
    if (e) pixel(ctx, () => ctx.drawImage(him, e.x, e.y, e.w, e.h, x, y, e.w, e.h));
  };
  ctx.imageSmoothingEnabled = true;
  ctx.font = "bold 20px sans-serif"; ctx.fillStyle = "#fff";
  put("lives", 6, 2);
  ctx.fillText("x" + G.lives, 100, 30);
  // 7 corazones de energia (como el original)
  for (let i = 0; i < 7; i++)
    put(i < Math.ceil(Math.max(0, G.energy - 1e-7) * 7 / 100) ? "colorHeart" : "blackHeart", 150 + i * 20, 8);
  // barra de jefe con cabeza (arte real del atlas)
  if (G.bossHP > 0) {
    const bx = (W - 226) / 2, by = H - 40;
    put("bossEnergyBase", bx, by);
    const frac = Math.max(0, G.bossHP / G.bossMax);
    const e = A["bossEnergy"];
    if (e && frac > 0) {
      const wpx = Math.floor(e.w * frac);
      pixel(ctx, () => ctx.drawImage(him, e.x, e.y, wpx, e.h, bx, by, wpx, e.h));
    }
    const heads = { BigScorpion: "headBigScorpion", TopoNinja: "headTopoNinja", BigBird: "headBigBird", BigBat: "headBigBat", BigGhost: "headGhost", BigSpider: "headBigSpider", BigAnguila: "headElectricEel", BigPirana: "headPiranha", GiantDragonfly: "headGiantDragonfly", BigUglyDragon: "headUglyDragon", FurryCritter: "headFurryCritter", Malmark: "headMalmark" };
    const hk = heads[G.bossHead];
    if (hk) put(hk, bx - 70, by - 8);
  }
}

function drawDialog(ctx) {
  const G = Game, D = G.dlg;
  const him = img(HUD), A = G.hudAtlas;
  const box = A && A["cartelDialogos"], face = A && A[D.portrait];
  ctx.imageSmoothingEnabled = true;
  if (him && box) {
    // caja nativa 466x68: arriba si el jugador esta abajo y viceversa
    const p = G.player;
    const pScreenY = p ? p.y - G.camY : H / 2;
    const by = pScreenY > H / 2 ? 14 : H - box.h - 10;
    const bx = Math.round((W - box.w) / 2);
    ctx.drawImage(him, box.x, box.y, box.w, box.h, bx, by, box.w, box.h);
    if (face) ctx.drawImage(him, face.x, face.y, face.w, face.h, bx - face.w + 12, by + 12, face.w, face.h);
    ctx.font = "bold 15px sans-serif";
    ctx.textBaseline = "top";
    const lines = D.text.slice(0, D.shown).split("\n");
    lines.slice(0, 3).forEach((ln, i) => {
      const lx = bx + 70, ly = by + 14 + i * 18;
      ctx.lineWidth = 3; ctx.strokeStyle = "#3a0a00";
      ctx.strokeText(ln, lx, ly);
      ctx.fillStyle = "#ffc93c";
      ctx.fillText(ln, lx, ly);
    });
    ctx.textBaseline = "alphabetic";
    if (D.shown >= D.text.length) {
      ctx.fillStyle = "#ffc93c";
      ctx.fillText("▼", bx + box.w - 26, by + box.h - 20);
    }
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillRect(20, H - 90, W - 40, 80);
    ctx.font = "bold 15px sans-serif"; ctx.fillStyle = "#ffc93c";
    D.text.slice(0, D.shown).split("\n").slice(0, 3).forEach((ln, i) => ctx.fillText(ln, 30, H - 64 + i * 18));
  }
}
