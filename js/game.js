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
import { createEnemy, hitEnemy, updateEnemy, enemySpriteFlip } from "./enemies.js";
import { beginPlayerDamage, advancePlayerDamage, DAMAGE_MOTION } from "./player-damage.js";
import { loadBitmapFont, drawBitmapText, measureBitmapText, wrapBitmapText } from "./bitmap-font.js";
import { createLampi, updateLampi, signTouchesPlayer, dialogueLayout, HELP_DIALOG } from "./help.js";
import { RenderSettings } from "./render-settings.js";
import { progressFromItems, itemDefinition, PLAYER_PHYSICS } from "./progression.js";

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
  helper: null, helperSerial: 0, dialogFont: null,
  charCache: new Map(),
  chars: {}, texts: {},
  hudAtlas: null,
  abilities: progressFromItems(), maxHearts: 5, checkpointConsumed: [], shakeT: 0,
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
    Snail: "snail", BigScorpion: "big-scorpion-v02", Scorpion: "escorpion", Items: "items", TopoNinja: "topo-ninja", BigBird: "big-bird",
    BigSnake: "big-snake", VolcanoFlower: "volcano-flower", Panal: "fly", Bat: "big-bat",
    LittleSpider: "little-spider", Fish: "fish", Piranha: "pirana", Pirana2: "pirana2",
    Blowfish: "blowfish", Shell: "shell", Mosquito: "mosquito", DragonFly: "dragon-fly",
    Bee: "bee", GiantDragonfly: "giant-dragonfly", BigUglyDragon: "ugly-dragon",
    FurryCritter: "furry-critter", Mouse: "mouse", BigBat: "big-bat", BigGhost: "ghost2",
    BigSpider: "big-spider", BigAnguila: "anguila2", BigPirana: "big-pirana",
    BigPiranaBlowFish: "blowfish2", Boomerang: "boomerang", Malmark2: "malmark2", LightBug: "light-bug",
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
  G.helper = null; G.helperSerial = 0;
  G.coins = 0; G.energy = 100; G.tip = ""; G.tipT = 0; G.shakeT = 0; G.winTimer = 0;
  const run = Save.run(), savedRun = fresh && run?.level === n ? run : null;
  if (fresh) G.lives = Number.isInteger(savedRun?.lives) ? savedRun.lives : 5;
  G.abilities = progressFromItems(Save.read()?.items); G.maxHearts = G.abilities.maxHearts;
  G.start = null; G.player = null; G.time = 0;
  G.camX = G.camY = G.prevCamX = G.prevCamY = 0;
  G.bossHP = 0; G.bossMax = 1; G.bossHead = null; G.bossVisible = false;
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
    if (o.name === "*Info") G.infos.push({ x: o.x + 16, y: o.y + 32, key: o.props.info, shown: false, dismissed: false });
    if (o.name === "*Save") G.saves.push({ x: o.x + 16, y: o.y + 32, tip: o.props.info, used: false, anim: null });
  }
  const foes = group(G.map, "Enemies");
  G.spawnDescriptors = (foes.length ? foes : group(G.map, "Scenes")).map(o => ({ ...o }));
  for (const o of foes.length ? foes : group(G.map, "Scenes")) {
    const isBoss = BOSSES.has(o.name);
    G.enemies.push(createEnemy(o, isBoss));
  }
  G.checkpointConsumed = [...(savedRun?.consumed || [])];
  for (const o of group(G.map, "Items")) {
    const id = `${n}:${o.name}:${o.x}:${o.y}`, definition = itemDefinition(o.name);
    G.items.push({ id, kind: o.name, definition, x: o.x + 16, y: o.y + 16,
      taken: Save.hasItem(o.name) || G.checkpointConsumed.includes(id), t: 0, anim: null });
  }
  G.player = {
    x: (G.start || { x: 256 }).x, y: (G.start || { y: 352 }).y,
    vx: 0, vy: 0, w: 8, h: 60, face: 1, ground: false, coyote: 0, buffer: 0, doubleUsed: false, dropT: 0,
    inv: 0, fireCd: 0, attack: null, damage: null, run: false, tapD: 0, tapT: -9, crouch: false,
    anim: null, animName: "", cur: null,
  };
  G.checkpoint = G.start ? { x: G.start.x, y: G.start.y } : { x: 256, y: 352 };
  if (savedRun && savedRun.checkpoint.x >= 0 && savedRun.checkpoint.x < G.gw * TILE &&
    savedRun.checkpoint.y >= 0 && savedRun.checkpoint.y < G.gh * TILE) {
    G.checkpoint = { ...savedRun.checkpoint }; G.player.x = G.checkpoint.x; G.player.y = G.checkpoint.y;
  }
  await ensureChar("Vascolet");
  await Promise.all(["Boomerang", "effects", "fireball", "LightBug", "Items", "Scorpion"].map(ensureChar));
  const itemChar = G.charCache.get("Items");
  for (const item of G.items) if (itemChar?.anims.some(a => a.name === item.definition?.animation)) {
    item.anim = new AnimPlayer(itemChar.anims); item.anim.set(item.definition.animation);
  }
  if (!G.dialogFont) G.dialogFont = await loadBitmapFont("winnie14-or");
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
    G.signSave = frameOf("saveStale");
    for (const save of G.saves) { save.anim = new AnimPlayer(sc.anims); save.anim.set("saveStale"); }
    for (const save of G.saves) if (savedRun && Math.hypot(save.x - G.checkpoint.x, save.y - G.checkpoint.y) < 2) {
      save.used = true; save.anim?.set("savePoint");
    }
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
  G.win = null; G.won = false; G.winSent = false; G.gameover = false; G.events = [];
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
  if (ty >= G.gh) return 0; // An open map bottom must lead to falling/death, not an invisible floor.
  if (tx < 0 || ty < 0 || tx >= G.gw) return TILE_SOLID;
  return G.grid[ty * G.gw + tx];
}

// Script-derived impulses and limits; collision integration remains a port approximation.
const { gravity: GRAV, walk: MOVE, run: RUN, jump: JUMP } = PLAYER_PHYSICS;
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
        if (((flags & TILE_SOLID) || ((flags & TILE_UP) && !(b.dropT > 0))) && prevBottom <= ty * TILE + EPS) {
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
  for (const b of [G.player, G.helper, ...G.enemies, ...G.booms, ...G.parts, ...G.shots, ...G.effects]) {
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
  G.shakeT = Math.max(0, G.shakeT - dt);
  if (G.gameover) return;
  if (G.won) {
    p.vx = 0; moveBody(p, dt); p.anim.update(dt); p.cur = p.anim.frame;
    for (const fx of G.effects) fx.anim.update(dt);
    G.effects = G.effects.filter(fx => !fx.anim.finished);
    G.winTimer = Math.max(0, G.winTimer - dt);
    if (!G.winTimer && !G.winSent) { G.winSent = true; G.events.push({ type: "win" }); }
    return;
  }
  // Quick-info is modeless and refreshed while touching its sign; jumping is free.
  if (G.dlg) {
    const d = G.dlg; d.t += dt; d.remaining -= dt;
    if (Input.pressed.has("enter") || Input.pressed.has("click")) {
      if (d.page + 1 < d.pages.length) { d.page++; d.remaining = HELP_DIALOG.duration; }
      else { if (d.source) d.source.dismissed = true; G.dlg = null; }
    }
    if (d.remaining <= 0) G.dlg = null;
  }
  let dir = 0;
  if (Input.down("left")) dir -= 1;
  if (Input.down("right")) dir += 1;
  const now = G.time;
  if (!p.damage && (Input.pressed.has("left") || Input.pressed.has("right"))) {
    const d = Input.pressed.has("left") ? -1 : 1;
    if (G.abilities.run && p.tapD === d && now - p.tapT < 0.3) p.run = true;
    p.tapD = d; p.tapT = now;
  }
  if (dir === 0 || !G.abilities.run) p.run = false;
  if (dir && !p.attack && !p.damage) p.face = dir;
  if (p.damage) p.vx = p.damage.phase === "air" ? -p.damage.face * DAMAGE_MOTION.speed : 0;
  else {
    const target = dir * (p.run ? RUN : MOVE);
    const accel = dir ? PLAYER_PHYSICS.acceleration : p.ground ? PLAYER_PHYSICS.friction : 0;
    p.vx += Math.sign(target - p.vx) * Math.min(Math.abs(target - p.vx), accel * dt);
  }
  p.crouch = !p.damage && Input.down("down") && p.ground;
  if (p.crouch || (p.attack && p.ground)) p.vx = 0;
  if (p.damage) p.buffer = 0;
  else if (jumpPressed()) p.buffer = 0.12; else p.buffer = Math.max(0, p.buffer - dt);
  p.coyote = p.ground ? 0.1 : Math.max(0, p.coyote - dt);
  p.dropT = Math.max(0, p.dropT - dt);
  if (!p.damage && p.ground && Input.down("down") && p.buffer > 0) {
    const supports = [];
    for (let x = Math.floor((p.x - p.w / 2 + EPS) / TILE); x <= Math.floor((p.x + p.w / 2 - EPS) / TILE); x++)
      supports.push(tileAt(x, Math.floor((p.y + EPS) / TILE)));
    if (supports.some(f => f & TILE_UP) && !supports.some(f => f & TILE_SOLID)) {
      p.dropT = .2; p.y += 2; p.vy = 60; p.ground = false; p.coyote = 0; p.buffer = 0;
    }
  }
  let launched = false;
  if (!p.damage && p.coyote > 0 && p.buffer > 0) {
    p.vy = -JUMP; p.buffer = 0; p.coyote = 0; p.ground = false; p.doubleUsed = false;
    launched = true;
    Audio2.sfx(SFX + "jumpAir.ogg");
    dust(p.x, p.y, 6);
  }
  else if (!p.damage && !p.ground && !p.dropT && jumpPressed() && G.abilities.doubleJump && !p.doubleUsed) {
    p.vy = -PLAYER_PHYSICS.secondJump; p.doubleUsed = true; p.buffer = 0;
    launched = true;
    Audio2.sfx(SFX + "double_jump.ogg");
  }
  // Native V4: (!jumpHeld OR !canSustainJumpEnabled) AND vy < -240.
  // Preserve the entry impulse for one step before applying the inherited cut.
  if (!p.damage && !launched && (!G.abilities.sustainJump || !jumpHeld()) && p.vy < -PLAYER_PHYSICS.cutJump) p.vy = -PLAYER_PHYSICS.cutJump;
  p.hurt = false;
  const wasGround = p.ground, fallV = p.vy;
  moveBody(p, dt, p.damage ? DAMAGE_MOTION.gravity : GRAV);
  if (p.ground) p.doubleUsed = false;
  advancePlayerDamage(p, dt);
  if (!wasGround && p.ground && fallV > 300) dust(p.x, p.y, 9);
  p.inv = Math.max(0, p.inv - dt);
  if (p.hurt) hurtPlayer();
  if (!p.damage && firePressed() && p.fireCd <= 0 && !p.attack && G.booms.length < G.abilities.maxBoomerangs) {
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
    const finishingBoss = e.behavior === "scorpion-boss" && e.state === "dying";
    if (!finishingBoss && (!e.active || Math.abs(e.x - p.x) > 900 || Math.abs(e.y - p.y) > 700)) continue;
    updateEnemy(e, p, dt, { moveBody, tileAt, shoot: enemyShoot, booms: G.booms,
      inCamera: b => b.x >= G.camX && b.x <= G.camX + W && b.y >= G.camY && b.y <= G.camY + H,
      bossStart: () => void Audio2.music(G.map.props["music,boss"] ? MUS + G.map.props["music,boss"] : null),
      minionCount: () => G.enemies.filter(m => m.minion && m.hp > 0).length, spawnMinion,
      shake: time => { G.shakeT = Math.max(G.shakeT, time); },
      explosion: b => impact(b.x + Math.sin(b.stateTime * 47) * 45, b.y - 30 + Math.cos(b.stateTime * 31) * 30, 2),
      bossDefeated: b => { G.shakeT = .2; impact(b.x, b.y - 30, 4); Audio2.sfx(SFX + "boss_death.ogg"); },
    });
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
    if (G.abilities.jumpAttack && !e.boss && e.behavior !== "flower" && p.vy > 0 && p.prevY <= e.y - e.h + 10) {
      damageEnemy(e, p.face); p.vy = -280; p.ground = false;
    } else hurtPlayer();
  }
  updateCamera(G, dt);
  for (const item of G.items) {
    if (!item.taken) item.anim?.update(dt);
    if (item.taken || Math.abs(p.x - item.x) > 24 || p.y < item.y - 18 || p.y - p.h > item.y + 18) continue;
    collectItem(item);
  }
  G.tipT = Math.max(0, G.tipT - dt);
  let nearest = null;
  for (const sign of G.infos) {
    if (!signTouchesPlayer(sign, p)) { sign.shown = false; sign.dismissed = false; }
    else if (!nearest || Math.abs(sign.x - p.x) < Math.abs(nearest.x - p.x)) nearest = sign;
  }
  if (nearest) {
    if (!nearest.shown) {
      nearest.shown = true; G.helperSerial++;
      const c = G.charCache.get("LightBug");
      if (G.helper?.phase === "follow") { G.helper.age = 0; G.helper.generation = G.helperSerial; }
      else G.helper = createLampi(nearest, c?.anims || [], G.helperSerial);
    }
    if (!nearest.dismissed && G.texts[nearest.key]) {
      if (G.dlg?.source === nearest) G.dlg.remaining = HELP_DIALOG.duration;
      else openDialog(G.texts[nearest.key], "dialogBannerLampi", HELP_DIALOG.duration, nearest);
    }
  }
  if (G.helper) {
    updateLampi(G.helper, p, dt);
    if (G.helper.age > 9 || (G.helper.phase === "leave" && G.helper.y < G.camY - 80)) G.helper = null;
  }
  for (const s of G.saves) {
    s.anim?.update(dt);
    if (!s.used && signTouchesPlayer(s, p)) {
      G.checkpoint = { x: s.x, y: s.y };
      G.checkpointConsumed = G.items.filter(i => i.taken && !i.definition?.permanent).map(i => i.id);
      saveCheckpoint();
      Audio2.sfx(SFX + "save.ogg");
      s.used = true; s.anim?.set("savePoint");
      openDialog("Juego salvado.", null, 2.7);
    }
  }
  // Scorpion keeps its bar through the death sequence; other bosses remain proximity-based.
  G.bossHP = 0; G.bossMax = 1; G.bossHead = null; G.bossVisible = false;
  for (const e of G.enemies) {
    if (!e.boss || e.defeated) continue;
    if (e.behavior === "scorpion-boss" ? !e.fight : e.hp <= 0 || Math.hypot(e.x - p.x, e.y - p.y) > 520) continue;
    G.bossVisible = true; G.bossHP = Math.max(0, e.hp); G.bossMax = e.maxhp; G.bossHead = e.kind;
  }
  // particulas de polvo
  for (const q of G.parts) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; }
  G.parts = G.parts.filter(q => q.life > 0);
  for (const fx of G.effects) fx.anim.update(dt);
  G.effects = G.effects.filter(fx => !fx.anim.finished);
  // anim jugador con NOMBRES REALES (ataque tiene prioridad mientras dura)
  let want = "stand";
  if (p.attack) want = p.attack.name;
  else if (!p.ground) want = p.doubleUsed ? "runJumpMid" : p.vy < -120 ? (p.run && p.anim.has("runJump") ? "runJump" : "standJump") : p.vy < 0 ? "standJumpMid" : G.abilities.jumpAttack ? "jumpAttack" : "fall";
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
      G.gameover = true; Save.write({ run: null }); G.events.push({ type: "gameover" });
    } else {
      G.energy = 100;
      const s = G.checkpoint || G.start;
      p.x = s.x; p.y = s.y; p.vx = 0; p.vy = 0; p.inv = 2;
      p.attack = null; p.damage = null; p.run = false; p.ground = false; p.coyote = 0; p.buffer = 0; p.dropT = 0; p.doubleUsed = false; p.tapT = -9;
      p.crouch = false; p.fireCd = 0; p.animName = "stand"; p.anim.restart("stand"); p.cur = p.anim.frame;
      G.booms = []; G.shots = []; G.effects = []; G.parts = []; G.dlg = null; G.helper = null; G.shakeT = 0;
      G.bossVisible = false; G.bossHP = 0;
      G.enemies = G.spawnDescriptors.map(o => attachEnemyAnimation(createEnemy(o, BOSSES.has(o.name))));
      for (const item of G.items) item.taken = Save.hasItem(item.kind) || G.checkpointConsumed.includes(item.id);
      for (const info of G.infos) { info.shown = false; info.dismissed = false; }
      void Audio2.music(G.map.props["music,normal"] ? MUS + G.map.props["music,normal"] : null);
      saveCheckpoint();
      updateCamera(G, 0, true); snapshotPositions();
    }
  }
  // victoria segun props del mapa
  if (!G.gameover && !G.won && G.win) {
    if (G.win.kind === "boss") {
      const bosses = G.enemies.filter(e => e.kind === G.win.target);
      if (bosses.length && bosses.every(e => e.behavior === "scorpion-boss" ? e.defeated : e.hp <= 0)) finishLevel();
    } else if (G.win.kind === "exit") {
      if (p.x > G.gw * TILE - 64) {
        finishLevel();
      }
    }
  }
}

function dust(x, y) {
  for (let i = 0; i < 5; i++)
    Game.parts.push({ x: x + (Math.random() - 0.5) * 20, y, vx: (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 40, life: 0.4 });
}

function attachEnemyAnimation(e) {
  const c = Game.charCache.get(e.kind);
  if (c?.anims.length) {
    e.anim = new AnimPlayer(c.anims);
    const normal = ["normal", "walk", "flying", "stand", "idle"].find(name => e.anim.has(name));
    if (normal) e.anim.set(normal);
    e.cur = e.anim.frame;
  }
  return e;
}

function spawnMinion(x, y, dir) {
  const e = attachEnemyAnimation(createEnemy({ name: "Scorpion", x: x - 16, y: y - 16, type: dir > 0 ? "forward" : "" }));
  e.minion = true; e.active = true; Game.enemies.push(e);
}

function saveCheckpoint() {
  const G = Game;
  Save.write({ level: G.level, x: G.checkpoint.x, y: G.checkpoint.y, t: Date.now() });
  Save.saveRun({ level: G.level, checkpoint: G.checkpoint, lives: G.lives, consumed: G.checkpointConsumed });
}

function collectItem(item) {
  const G = Game, d = item.definition ?? itemDefinition(item.kind);
  if (!d) return;
  const oldHearts = G.maxHearts, currentHearts = G.energy * oldHearts / 100;
  if (d.permanent) {
    Save.collectItem(item.kind);
    G.abilities = progressFromItems(Save.read()?.items); G.maxHearts = G.abilities.maxHearts;
    G.energy = Math.min(100, (currentHearts + G.maxHearts - oldHearts) * 100 / G.maxHearts);
  } else if (d.effect === "energy") G.energy = Math.min(100, G.energy + 100 / G.maxHearts);
  else if (d.effect === "full") G.energy = 100;
  else if (d.effect === "life") G.lives++;
  item.taken = true; Audio2.sfx(SFX + d.sound); impact(item.x, item.y);
}

function finishLevel() {
  const G = Game;
  G.won = true; G.winSent = false; G.winTimer = Math.max(0, Number(G.map.props.winEffect?.split(",")[1]) || 0);
  G.player.attack = null; G.player.damage = null; G.player.inv = 0; G.player.vx = 0;
  G.player.anim.set("stand"); G.player.cur = G.player.anim.frame;
  G.booms = []; G.shots = []; G.dlg = null; Save.completeLevel(G.level);
  void Audio2.music(MUS + (G.map.props["music,win"] || "win_level.ogg"));
  if (!G.winTimer) { G.winSent = true; G.events.push({ type: "win" }); }
}

function releaseBoomerang() {
  const G = Game, p = G.player, attack = p.attack;
  if (!attack || attack.released) return;
  attack.released = true;
  if (G.booms.length >= G.abilities.maxBoomerangs) return;
  const c = G.charCache.get("Boomerang"), anim = c?.anims.length ? new AnimPlayer(c.anims) : null;
  if (anim?.has("normal")) anim.set("normal");
  G.booms.push(createBoomerang({ x: p.x, y: p.y, face: attack.face, crouch: attack.crouch }, anim));
  Audio2.sfx(SFX + "boomerang.ogg");
}

function impact(x, y, scale = 1) {
  const c = Game.charCache.get("effects");
  if (!c?.anims.some(a => a.name === "shot_impact")) return;
  const anim = new AnimPlayer(c.anims); anim.set("shot_impact");
  Game.effects.push({ x, y, prevX: x, prevY: y, anim, scale });
}

function damageEnemy(e, direction) {
  if (!hitEnemy(e, direction)) return;
  Audio2.sfx(SFX + (e.boss && e.hp <= 0 ? "boss_death.ogg" : "enemy_boomerang_hit.ogg"));
}

function hurtPlayer() {
  const G = Game, p = G.player;
  if (p.inv > 0 || G.won) return;
  G.energy = Math.max(0, G.energy - 100 / G.maxHearts); p.inv = 1;
  if (G.energy < 1e-7) G.energy = 0;
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

function openDialog(text, portrait, duration = HELP_DIALOG.duration, source = null) {
  const layout = dialogueLayout(Game.hudAtlas, portrait);
  const lines = wrapBitmapText(Game.dialogFont, text, layout.maxWidth);
  const pages = [];
  for (let i = 0; i < lines.length; i += 3) pages.push(lines.slice(i, i + 3));
  Game.dlg = { text, shown: text.length, t: 0, remaining: duration, portrait, source, pages, page: 0, layout };
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
  const inset = ctx.imageSmoothingEnabled ? .5 : 0;
  const ix = sx + inset, iy = sy + inset, iw = T.tileW - 2 * inset, ih = T.tileH - 2 * inset;
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
  ctx.imageSmoothingEnabled = RenderSettings.filterTextures;
  ctx.fillStyle = "#0a0a18";
  ctx.fillRect(0, 0, W, H);
  const cx = lerp(G.prevCamX, G.camX) + (G.shakeT > 0 ? Math.sin(G.time * 91) * 3 : 0);
  const cy = lerp(G.prevCamY, G.camY) + (G.shakeT > 0 ? Math.cos(G.time * 73) * 3 : 0);
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
    const c = G.charCache.get("Items");
    if (c?.img && i.anim) drawAnimFrame(ctx, c.img, c.atlas, i.anim.frame, i.x - cx, i.y - cy);
  }
  // carteles de ayuda/guardado (sprites reales)
  {
    const sc = Game.charCache.get("carteles-ayuda-guardar");
    const drawSign = (sp, fr) => {
      if (!sc || !sc.img || !fr || !fr.img) return;
      drawAnimFrame(ctx, sc.img, sc.atlas, fr, sp.x - cx, sp.y - cy);
    };
    for (const o of G.infos) drawSign(o, G.signInfo);
    for (const o of G.saves) drawSign(o, o.anim?.frame ?? G.signSave);
  }
  // enemigos con sprites reales
  for (const e of G.enemies) {
    if (e.defeated || (e.hp <= 0 && e.deadT > 1.2)) continue;
    const c = Game.charCache.get(e.kind);
    if (c?.img && e.anim) {
      ctx.save();
      if (e.behavior === "scorpion-boss" && e.state === "dying" && e.stateTime >= 3) ctx.filter = "brightness(0) invert(1)";
      drawAnimFrame(ctx, c.img, c.atlas, e.cur, x(e) - cx, y(e) - cy,
        { flip: enemySpriteFlip(e), round: false, alpha: e.hp <= 0 ? Math.max(0, 1 - e.deadT / 1.2) : e.hurtT > 0 ? .65 : 1 });
      ctx.restore();
    } else {
      ctx.fillStyle = "#ffd75e";
      ctx.fillRect(x(e) - cx - 3, y(e) - cy - 3, 6, 6);
    }
  }
  if (G.helper) {
    const c = G.charCache.get("LightBug"), b = G.helper;
    if (c?.img) drawAnimFrame(ctx, c.img, c.atlas, b.anim.frame, x(b) - cx, y(b) - cy, { flip: b.face < 0, round: false });
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
    drawAnimFrame(ctx, effectChar.img, effectChar.atlas, fx.anim.frame, fx.x - cx, fx.y - cy, { round: false, scale: fx.scale ?? 1 });
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
  if (G.dialogFont) drawBitmapText(ctx, G.dialogFont, String(G.lives), 81, 12);
  for (let i = 0; i < G.maxHearts; i++)
    put(i < Math.ceil(Math.max(0, G.energy - 1e-7) * G.maxHearts / 100) ? "colorHeart" : "blackHeart", 112 + (i % 5) * 20, 3 + Math.floor(i / 5) * 20);
  // barra de jefe con cabeza (arte real del atlas)
  if (G.bossVisible) {
    const bx = 231, by = 336;
    put("bossEnergyBase", bx, by);
    const frac = Math.max(0, G.bossHP / G.bossMax);
    const e = A["bossEnergy"];
    if (e && frac > 0) {
      const wpx = Math.floor(e.w * frac);
      pixel(ctx, () => ctx.drawImage(him, e.x, e.y, wpx, e.h, bx, by, wpx, e.h));
    }
    const heads = { BigScorpion: "headBigScorpion", TopoNinja: "headTopoNinja", BigBird: "headBigBird", BigBat: "headBigBat", BigGhost: "headGhost", BigSpider: "headBigSpider", BigAnguila: "headElectricEel", BigPirana: "headPiranha", GiantDragonfly: "headGiantDragonfly", BigUglyDragon: "headUglyDragon", FurryCritter: "headFurryCritter", Malmark: "headMalmark" };
    const hk = heads[G.bossHead];
    if (hk) put(hk, 448, 327);
  }
}

function drawDialog(ctx) {
  const G = Game, D = G.dlg;
  const him = img(HUD), A = G.hudAtlas;
  const box = A && A["cartelDialogos"], face = A && A[D.portrait];
  if (!him || !box || !G.dialogFont) return;
  const layout = D.layout, b = layout.banner, head = layout.head, lines = D.pages[D.page];
  ctx.save();
  ctx.globalAlpha *= Math.min(1, D.t / .12, Math.max(0, D.remaining / .16));
  ctx.imageSmoothingEnabled = RenderSettings.filterTextures;
  ctx.drawImage(him, box.x, box.y, box.w, box.h, b.x, b.y, b.w, b.h);
  if (face && head) ctx.drawImage(him, face.x, face.y, face.w, face.h, head.x, head.y, head.w, head.h);
  lines.forEach((line, i) => drawBitmapText(ctx, G.dialogFont, line,
    Math.round(layout.textX - measureBitmapText(G.dialogFont, line) / 2),
    Math.round(layout.textY - lines.length * 17 / 2 + i * 17)));
  if (D.pages.length > 1) drawBitmapText(ctx, G.dialogFont, `${D.page + 1}/${D.pages.length}`, b.x + b.w - 30, b.y + b.h - 19);
  ctx.restore();
}
