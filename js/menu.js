// Menu principal identico al original: fondo + botones del atlas menu.png
// (jugarUp/Over, opcionesUp/Over...) + footer + version.
// Capítulos: 18 posiciones manuales recuperadas, fondo de progreso y título vertical.
// Opciones reales: crop opciones + sliders + checks + VOLVER.
// Videos: overlay <video> con skip.
import { img, loadXML, loadAssets } from "./assets.js";
import { parseAtlas } from "./tmx.js";
import { Input } from "./input.js";
import { Save } from "./save.js";
import { Audio2 } from "./audio.js";
import { loadBitmapFont, drawBitmapText } from "./bitmap-font.js";
import { TROPHIES } from "./trophies.js";

const W = 512, H = 384;
// layout medido (binario: pitch 40, ultimo gap 60 + screenshots CV):
// centros y = {114,154,194,234,294}, x = 457 (botones 110x30, eje al centro)
const BTN = [
  { id: "jugar", up: "jugarUp", over: "jugarOver", cx: 451, y: 115 },
  { id: "opciones", up: "opcionesUp", over: "opcionesOver", cx: 451, y: 155 },
  { id: "ayuda", up: "ayudaUp", over: "ayudaOver", cx: 451, y: 195 },
  { id: "creditos", up: "creditosUp", over: "creditosOver", cx: 451, y: 235 },
  { id: "salir", up: "salirUp", over: "salirOver", cx: 451, y: 295 },
];
let atlas = null, sel = 0, onChoose = null;
let trashHover = false, confirming = false, confirmSel = 0;

export async function menuInit(choose) {
  onChoose = choose;
  if (!atlas) {
    const doc = await loadXML("assets/gui/menu/menu.xml");
    atlas = parseAtlas(doc);
  }
  sel = 0; confirming = false; confirmSel = 0;
  await loadAssets(["assets/gui/menu/reciclebin.png", "assets/gui/menu/reciclebin-over.png"]).catch(() => {});
}

const TRASH = { x: 472, y: 316, w: 32, h: 32 };
function inRect(mx, my, r) {
  return mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h;
}

function btnRect(b) {
  const e = atlas[b.up];
  return { x: b.cx - e.w / 2, y: b.y, w: e.w, h: e.h };
}

export function menuUpdate() {
  const m = Input.mouse;
  if (confirming) {
    if (Input.pressed.has("left")) { confirmSel = 0; Audio2.sfx("assets/audio/button.wav"); }
    if (Input.pressed.has("right")) { confirmSel = 1; Audio2.sfx("assets/audio/button.wav"); }
    if (m.inside) {
      if (inRect(m.x, m.y, { x: 196, y: 220, w: 110, h: 30 })) confirmSel = 0;
      if (inRect(m.x, m.y, { x: 316, y: 220, w: 110, h: 30 })) confirmSel = 1;
      if (Input.pressed.has("click")) {
        if (!inRect(m.x, m.y, { x: 196, y: 220, w: 110, h: 30 }) && !inRect(m.x, m.y, { x: 316, y: 220, w: 110, h: 30 })) return;
        if (confirmSel === 0) Save.clear();
        confirming = false;
        return;
      }
    }
    if (Input.pressed.has("enter")) {
      if (confirmSel === 0) Save.clear();
      confirming = false;
    }
    if (Input.pressed.has("esc")) confirming = false;
    return;
  }
  if (m.inside) {
    trashHover = inRect(m.x, m.y, TRASH);
    BTN.forEach((b, i) => {
      const r = btnRect(b);
      if (inRect(m.x, m.y, r) && sel !== i) { sel = i; Audio2.sfx("assets/audio/button.wav"); }
    });
    if (Input.pressed.has("click")) {
      if (trashHover && Save.read()) { confirming = true; confirmSel = 1; return; }
      const hit = BTN.findIndex(b => inRect(m.x, m.y, btnRect(b)));
      if (hit >= 0) { sel = hit; chooseSel(); return; }
    }
  } else trashHover = false;
  if (Input.pressed.has("up")) { sel = (sel + BTN.length - 1) % BTN.length; Audio2.sfx("assets/audio/button.wav"); }
  if (Input.pressed.has("down")) { sel = (sel + 1) % BTN.length; Audio2.sfx("assets/audio/button.wav"); }
  if (Input.pressed.has("enter")) chooseSel();
  if (Input.pressed.has("esc")) { /* en menu principal, Esc no hace nada */ }
}

function chooseSel() {
  const id = BTN[sel].id;
  if (id === "salir") return; // en web no se puede cerrar
  onChoose && onChoose(id);
}

export function menuDraw(ctx) {
  ctx.imageSmoothingEnabled = true; // arte pintado: suavizado, no nearest
  const bg = img("assets/gui/menu/background.jpg");
  // 512x512 -> se ven filas 0..384 (1:1); abajo queda fuera; "Versión" es texto renderizado
  if (bg) ctx.drawImage(bg, 0, 0, 512, 384, 0, 0, W, H);
  const sheet = img("assets/gui/menu/menu.png");
  ctx.imageSmoothingEnabled = false;
  BTN.forEach((b, i) => {
    const e = atlas[i === sel ? b.over : b.up];
    const r = btnRect(b);
    if (sheet && e) ctx.drawImage(sheet, e.x, e.y, e.w, e.h, r.x, r.y, r.w, r.h);
  });
  ctx.imageSmoothingEnabled = true;
  // footer y hints vienen horneados en el fondo; solo Versión es texto
  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = "#ffd75e";
  ctx.fillText("Versión: 1", 428, 368);
  // papelera: borra el guardado con aviso (hover cambia el icono)
  const trash = img(trashHover && Save.read() ? "assets/gui/menu/reciclebin-over.png" : "assets/gui/menu/reciclebin.png");
  if (trash && Save.read()) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(trash, 0, 0, trash.width, trash.height, TRASH.x, TRASH.y, TRASH.w, TRASH.h);
    ctx.imageSmoothingEnabled = true;
  }
  if (confirming) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#7a0d0d";
    ctx.fillRect(96, 140, 320, 130);
    ctx.strokeStyle = "#ffd75e"; ctx.lineWidth = 2;
    ctx.strokeRect(96, 140, 320, 130);
    ctx.font = "bold 15px sans-serif";
    ctx.fillStyle = "#ffd75e";
    ctx.fillText("¿Borrar datos guardados?", 150, 175);
    const msheet2 = img("assets/gui/menu/menu.png");
    const sSi = atlas && atlas[confirmSel === 0 ? "siOver" : "siUp"];
    const sNo = atlas && atlas[confirmSel === 1 ? "noOver" : "noUp"];
    ctx.imageSmoothingEnabled = false;
    if (msheet2 && sSi) ctx.drawImage(msheet2, sSi.x, sSi.y, sSi.w, sSi.h, 196, 220, sSi.w, sSi.h);
    if (msheet2 && sNo) ctx.drawImage(msheet2, sNo.x, sNo.y, sNo.w, sNo.h, 316, 220, sNo.w, sNo.h);
    ctx.imageSmoothingEnabled = true;
  }
}

// ---------- Capítulos ----------
// Exact manual anchor arrays from LevelSelect::init ELF 0x081b7cfc–0x081b7e57.
export const CHAPTER_POINTS = Object.freeze([
  [19, 231], [31, 271], [59, 299], [95, 325], [146, 343], [200, 348],
  [249, 343], [303, 333], [352, 317], [396, 300], [433, 278], [463, 248],
  [482, 211], [480, 174], [466, 139], [444, 106], [411, 79], [375, 63],
].map(([x, y]) => Object.freeze({ x, y })));
let chAtlas = null, chSel = 0, chUnlocked = 1, chArea = 1, chFont = null, onPickLevel = null;
let chMouseRevision = 0, chTitleIndex = 0, chTitleOffset = 0, chTitlePhase = "idle";
let chLogrosHover = false, chVolverHover = false;
export function chPos(i) {
  return CHAPTER_POINTS[i];
}

export async function chaptersInit(pick, { preserve = false } = {}) {
  onPickLevel = pick;
  chUnlocked = Save.unlocked();
  if (!preserve) {
    chSel = chUnlocked - 1;
    // Snapshot the progression background ONCE. Selection never changes it.
    chArea = Math.min(6, 1 + Math.floor((chUnlocked - 1) / 3));
  } else chSel = Math.min(chSel, chUnlocked - 1);
  chTitleIndex = chSel; chTitleOffset = 0; chTitlePhase = "idle";
  chLogrosHover = chVolverHover = false; chMouseRevision = Input.mouse.revision;
  if (!chAtlas) chAtlas = parseAtlas(await loadXML("assets/gui/level/level.xml"));
  if (!chFont) chFont = await loadBitmapFont("winnie14-ob");
  await loadAssets(["assets/gui/level/level.png", `assets/gui/level/area0${chArea}.jpg`]);
}

function selectChapter(index) {
  if (index < 0 || index >= chUnlocked || index === chSel) return;
  chSel = index; chTitlePhase = "out";
  Audio2.sfx("assets/audio/button.wav");
}

export function chaptersUpdate(dt = 1 / 60) {
  const m = Input.mouse;
  if (Input.pressed.has("left") || Input.pressed.has("up")) selectChapter(chSel - 1);
  if (Input.pressed.has("right") || Input.pressed.has("down")) selectChapter(chSel + 1);
  if (m.inside) {
    let node = -1;
    for (let i = 0; i < chUnlocked; i++) {
      const p = chPos(i), e = chAtlas.levelUp;
      if (inRect(m.x, m.y, { x: p.x - e.ax, y: p.y - e.ay, w: e.w, h: e.h })) node = i;
    }
    // An idle pointer must not undo keyboard selection every rendered frame.
    if (m.revision !== chMouseRevision || Input.pressed.has("click")) {
      chMouseRevision = m.revision;
      if (node >= 0) selectChapter(node);
    }
    chLogrosHover = inRect(m.x, m.y, { x: 394, y: 9, w: 110, h: 30 });
    chVolverHover = inRect(m.x, m.y, { x: 394, y: 345, w: 110, h: 30 });
    if (Input.pressed.has("click")) {
      if (node >= 0) { tryEnterLevel(); return; }
      if (chLogrosHover) { onPickLevel && onPickLevel(-2); return; }
      if (chVolverHover) { onPickLevel && onPickLevel(-1); return; }
    }
  } else { chLogrosHover = chVolverHover = false; }
  if (Input.pressed.has("esc")) { onPickLevel && onPickLevel(-1); return; }
  if (Input.pressed.has("enter")) { tryEnterLevel(); return; }
  if (chTitlePhase === "out") {
    chTitleOffset = Math.max(-46, chTitleOffset - 300 * dt);
    if (chTitleOffset === -46) { chTitleIndex = chSel; chTitlePhase = "in"; }
  } else if (chTitlePhase === "in") {
    chTitleOffset = Math.min(0, chTitleOffset + 300 * dt);
    if (chTitleOffset === 0) chTitlePhase = "idle";
  }
}

function tryEnterLevel() {
  if (chSel + 1 <= chUnlocked) onPickLevel && onPickLevel(chSel + 1);
}

export function chaptersDraw(ctx, texts) {
  ctx.imageSmoothingEnabled = true;
  const bg = img(`assets/gui/level/area0${chArea}.jpg`);
  if (bg) ctx.drawImage(bg, 0, 0, W, H, 0, 0, W, H);
  const sheet = img("assets/gui/level/level.png");
  for (let i = 0; i < 18; i++) {
    const p = chPos(i);
    const open = i < chUnlocked;
    const key = !open ? "levelDisabled" : (i === chSel ? "levelOver" : "levelUp");
    const e = chAtlas && chAtlas[key];
    if (sheet && e) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sheet, e.x, e.y, e.w, e.h, p.x - e.ax, p.y - e.ay, e.w, e.h);
      ctx.imageSmoothingEnabled = true;
    }
  }
  const b = chAtlas && chAtlas.banner;
  if (sheet && b) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheet, b.x, b.y, b.w, b.h, -20, chTitleOffset, b.w, b.h);
  }
  if (chFont) drawBitmapText(ctx, chFont, texts[`ln-lvl${chTitleIndex + 1}`] || `Capítulo ${chTitleIndex + 1}`, 12, 18 + chTitleOffset);
  const msheet = img("assets/gui/menu/menu.png");
  const drawBtn = (key, x, y) => {
    const e = atlas && atlas[key];
    if (msheet && e) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(msheet, e.x, e.y, e.w, e.h, x, y, e.w, e.h);
      ctx.imageSmoothingEnabled = true;
    }
  };
  drawBtn(chLogrosHover ? "logrosOver" : "logrosUp", 394, 9);
  drawBtn(chVolverHover ? "volverOver" : "volverUp", 394, 345);
}

// ---------- Opciones reales ----------
// Crop opciones + sliders (volumeControl) + checks + soundOn/Off + VOLVER.
let optAtlas = null;
// Windows Options::init 0x005108e0. These are atlas anchors, not sprite centers.
export const OPTION_CONTROLS = Object.freeze([
  { id: "musicMute", x: 307, y: 125, w: 48, h: 40, type: "mute", setting: "music" },
  { id: "music", x: 145, y: 160, w: 228, h: 28, type: "slider", travel: 200 },
  { id: "sfxMute", x: 307, y: 190, w: 48, h: 40, type: "mute", setting: "sfx" },
  { id: "sfx", x: 145, y: 226, w: 228, h: 28, type: "slider", travel: 200 },
  { id: "fullscreen", x: 314, y: 258, w: 24, h: 24, type: "check" },
  { id: "stretch", x: 314, y: 282, w: 24, h: 24, type: "check" },
  { id: "volver", x: 201, y: 315, w: 110, h: 30, type: "back" },
]);
let optSel = 1, optDrag = null, optMouseRevision = 0;
let optionsDone = null;
export function onOptionsDone(cb) { optionsDone = cb; }

export async function optionsInit() {
  optSel = 1; optDrag = null; optMouseRevision = Input.mouse.revision;
  if (!optAtlas) optAtlas = parseAtlas(await loadXML("assets/gui/options/options.xml"));
  await loadAssets(["assets/gui/options/options.png"]);
}

function optSettings() { return Save.settings(); }

function commitOpt(s) {
  s.volume = s.music ?? 0.8; // compatibilidad: volumen maestro heredado
  Save.writeSettings(s);
  Audio2.setVolumes(s.musicMute ? 0 : s.music, s.sfxMute ? 0 : s.sfx);
  applyDisplay(s);
}

export function optionsUpdate() {
  const s = optSettings();
  const m = Input.mouse;
  const activate = control => {
    if (control.type === "back") { optDrag = null; optionsDone?.(); return; }
    if (control.type === "mute") s[control.id] = !s[control.id];
    if (control.type === "check") s[control.id] = !s[control.id];
    commitOpt(s);
  };
  const drag = control => {
    // Knob center = anchor + 13 for the normal atlas crop.
    s[control.id] = Math.round(Math.max(0, Math.min(1, (m.x - control.x - 13) / control.travel)) * 100) / 100;
    commitOpt(s);
  };
  if (!m.down) optDrag = null;
  if (optDrag) { drag(optDrag); return; }
  const hit = m.inside ? OPTION_CONTROLS.findIndex(c => inRect(m.x, m.y, c)) : -1;
  if (hit >= 0 && m.revision !== optMouseRevision) optSel = hit;
  optMouseRevision = m.revision;
  if (Input.pressed.has("click") && hit >= 0) {
    optSel = hit;
    const control = OPTION_CONTROLS[hit];
    if (control.type === "slider") { optDrag = m.down ? control : null; drag(control); }
    else activate(control);
    return;
  }
  if (Input.pressed.has("up")) optSel = (optSel + OPTION_CONTROLS.length - 1) % OPTION_CONTROLS.length;
  if (Input.pressed.has("down")) optSel = (optSel + 1) % OPTION_CONTROLS.length;
  if (Input.pressed.has("esc")) { optDrag = null; optionsDone?.(); return; }
  const control = OPTION_CONTROLS[optSel];
  if (Input.pressed.has("left") || Input.pressed.has("right")) {
    const d = Input.pressed.has("left") ? -0.1 : 0.1;
    if (control.type === "slider") { s[control.id] = Math.round(Math.max(0, Math.min(1, s[control.id] + d)) * 100) / 100; commitOpt(s); }
    else if (control.type !== "back") activate(control);
  }
  if (Input.pressed.has("enter")) {
    if (control.type === "slider") { s[`${control.id}Mute`] = !s[`${control.id}Mute`]; commitOpt(s); }
    else activate(control);
  }
}

export function applyDisplay(s) {
  const canvas = document.getElementById("game");
  if (s.fullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  if (!s.fullscreen && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  if (canvas) canvas.dataset.stretch = s.stretch === false ? "0" : "1";
}

export function optionsDraw(ctx) {
  ctx.imageSmoothingEnabled = true;
  const bgm = img("assets/gui/menu/background.jpg");
  if (bgm) ctx.drawImage(bgm, 0, 0, 512, 384, 0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, 0, W, H);
  const sheet = img("assets/gui/options/options.png");
  const crop = optAtlas && optAtlas.opciones;
  if (sheet && crop) ctx.drawImage(sheet, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
  const s = optSettings();
  for (const [i, control] of OPTION_CONTROLS.entries()) {
    const selected = i === optSel;
    let key, x = control.x, y = control.y, source = sheet, entry;
    if (control.type === "back") { source = img("assets/gui/menu/menu.png"); entry = atlas?.[selected ? "volverOver" : "volverUp"]; }
    else {
      if (control.type === "slider") { key = "volumeControl"; x += s[control.id] * control.travel; }
      if (control.type === "mute") key = s[control.id] ? "soundOff" : "soundOn";
      if (control.type === "check") key = s[control.id] ? "check" : "uncheck";
      entry = optAtlas?.[key + (selected ? "Selected" : "")];
      if (entry) { x -= entry.ax; y -= entry.ay; }
    }
    if (source && entry) ctx.drawImage(source, entry.x, entry.y, entry.w, entry.h, x, y, entry.w, entry.h);
  }
  ctx.imageSmoothingEnabled = true;
}

// ---------- Logros ----------
// Original twenty-card atlas layout over its 512x384 background region.
let achAtlas = null, achHover = false, achItems = new Set();
const ACH_BACK = { x: 201, y: 325, w: 110, h: 30 };
export async function achInit() {
  if (!achAtlas) achAtlas = parseAtlas(await loadXML("assets/images/achievements/trofeos.xml"));
  if (!atlas) atlas = parseAtlas(await loadXML("assets/gui/menu/menu.xml"));
  await loadAssets(["assets/images/achievements/background.jpg", "assets/images/achievements/trofeos.png", "assets/gui/menu/menu.png"]);
  achHover = false;
  const items = Save.read()?.items;
  achItems = new Set(Array.isArray(items) ? items : []);
}

export function achUpdate(goBack) {
  const m = Input.mouse;
  achHover = m.inside && inRect(m.x, m.y, ACH_BACK);
  if (Input.pressed.has("esc") || Input.pressed.has("enter") || (Input.pressed.has("click") && achHover)) goBack();
}

export function achDraw(ctx) {
  ctx.imageSmoothingEnabled = true;
  const bg = img("assets/images/achievements/background.jpg");
  if (bg) ctx.drawImage(bg, 0, 0, W, H, 0, 0, W, H);
  const tr = img("assets/images/achievements/trofeos.png");
  ctx.imageSmoothingEnabled = false;
  if (tr && achAtlas) for (const trophy of TROPHIES) {
    const e = achAtlas[`${trophy.key}_${achItems.has(trophy.item) ? "enabled" : "disabled"}`];
    if (e) ctx.drawImage(tr, e.x, e.y, e.w, e.h, trophy.x - e.ax, trophy.y - e.ay, e.w, e.h);
  }
  const buttons = img("assets/gui/menu/menu.png"), back = atlas?.[achHover ? "volverOver" : "volverUp"];
  if (buttons && back) ctx.drawImage(buttons, back.x, back.y, back.w, back.h, ACH_BACK.x, ACH_BACK.y, back.w, back.h);
}

// ---------- Pausa ----------
// Panel real: crop "pause" de quit-confirmation.png + botones menu.png.
// Salir pide confirmación con crop "quitConfirmation" + Si/No.
let pauseAtlas = null, pauseSel = 0, pauseConfirm = false, pauseConfirmSel = 1, onPauseAction = null;
const PAUSE_BTN = [
  { id: "volver", up: "volverUp", over: "volverOver", x: 201, y: 230 },
  { id: "opciones", up: "opcionesUp", over: "opcionesOver", x: 201, y: 288 },
  { id: "salir", up: "salirUp", over: "salirOver", x: 201, y: 346 },
];

export async function pauseInit(action) {
  onPauseAction = action;
  pauseSel = 0; pauseConfirm = false; pauseConfirmSel = 1;
  if (!pauseAtlas) {
    pauseAtlas = parseAtlas(await loadXML("assets/gui/hud/quit-confirmation.xml"));
  }
  await loadAssets(["assets/gui/hud/quit-confirmation.png"]).catch(() => {});
}

function pauseBtnRect(b) {
  const e = atlas && (atlas[b.up] || atlas[b.id + "Up"]);
  const w = e ? e.w : 110, h = e ? e.h : 30;
  return { x: b.x, y: b.y, w, h };
}

export function pauseUpdate() {
  const m = Input.mouse;
  if (pauseConfirm) {
    if (Input.pressed.has("left")) { pauseConfirmSel = 0; Audio2.sfx("assets/audio/button.wav"); }
    if (Input.pressed.has("right")) { pauseConfirmSel = 1; Audio2.sfx("assets/audio/button.wav"); }
    if (m.inside) {
      if (inRect(m.x, m.y, { x: 196, y: 272, w: 110, h: 30 })) pauseConfirmSel = 0;
      if (inRect(m.x, m.y, { x: 316, y: 272, w: 110, h: 30 })) pauseConfirmSel = 1;
      if (Input.pressed.has("click")) {
        if (!inRect(m.x, m.y, { x: 196, y: 272, w: 110, h: 30 }) && !inRect(m.x, m.y, { x: 316, y: 272, w: 110, h: 30 })) return;
        if (pauseConfirmSel === 0) onPauseAction && onPauseAction("salir");
        else { pauseConfirm = false; return; }
        return;
      }
    }
    if (Input.pressed.has("enter")) {
      if (pauseConfirmSel === 0) onPauseAction && onPauseAction("salir");
      else pauseConfirm = false;
    }
    if (Input.pressed.has("esc")) pauseConfirm = false;
    return;
  }
  if (m.inside) {
    PAUSE_BTN.forEach((b, i) => {
      if (inRect(m.x, m.y, pauseBtnRect(b)) && pauseSel !== i) {
        pauseSel = i; Audio2.sfx("assets/audio/button.wav");
      }
    });
    if (Input.pressed.has("click")) {
      const hit = PAUSE_BTN.findIndex(b => inRect(m.x, m.y, pauseBtnRect(b)));
      if (hit >= 0) { pauseSel = hit; choosePause(); return; }
    }
  }
  if (Input.pressed.has("up")) { pauseSel = (pauseSel + PAUSE_BTN.length - 1) % PAUSE_BTN.length; Audio2.sfx("assets/audio/button.wav"); }
  if (Input.pressed.has("down")) { pauseSel = (pauseSel + 1) % PAUSE_BTN.length; Audio2.sfx("assets/audio/button.wav"); }
  if (Input.pressed.has("enter")) choosePause();
  if (Input.pressed.has("esc")) onPauseAction && onPauseAction("volver");
}

function choosePause() {
  const id = PAUSE_BTN[pauseSel].id;
  if (id === "salir") { pauseConfirm = true; pauseConfirmSel = 1; return; }
  onPauseAction && onPauseAction(id);
}

export function pauseDraw(ctx) {
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  const sheet = img("assets/gui/hud/quit-confirmation.png");
  const crop = pauseAtlas && pauseAtlas[pauseConfirm ? "quitConfirmation" : "pause"];
  if (sheet && crop) ctx.drawImage(sheet, crop.x, crop.y, crop.w, crop.h, 0, 0, W, H);
  if (pauseConfirm) {
    const msheet = img("assets/gui/menu/menu.png");
    const sSi = atlas && atlas[pauseConfirmSel === 0 ? "siOver" : "siUp"];
    const sNo = atlas && atlas[pauseConfirmSel === 1 ? "noOver" : "noUp"];
    ctx.imageSmoothingEnabled = false;
    if (msheet && sSi) ctx.drawImage(msheet, sSi.x, sSi.y, sSi.w, sSi.h, 196, 272, sSi.w, sSi.h);
    if (msheet && sNo) ctx.drawImage(msheet, sNo.x, sNo.y, sNo.w, sNo.h, 316, 272, sNo.w, sNo.h);
    ctx.imageSmoothingEnabled = true;
    return;
  }
  const msheet = img("assets/gui/menu/menu.png");
  PAUSE_BTN.forEach((b, i) => {
    const e = atlas && atlas[i === pauseSel ? b.over : b.up];
    const r = pauseBtnRect(b);
    if (msheet && e) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(msheet, e.x, e.y, e.w, e.h, r.x, r.y, r.w, r.h);
      ctx.imageSmoothingEnabled = true;
    }
  });
  ctx.imageSmoothingEnabled = true;
}

// ---------- Videos ----------
// Overlay <video> 512x384 con skip. Mapeo provisional videoN<->nivelN.
let videoEl = null, videoGen = 0, videoCleanup = null;
export function playVideo(n, onDone) {
  stopVideo();
  const myGen = ++videoGen;
  const canvas = document.getElementById("game");
  videoEl = document.createElement("video");
  videoEl.src = `assets/videos/video${n}.mp4`;
  const r = canvas.getBoundingClientRect();
  videoEl.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:#000;z-index:5;`;
  const done = () => { if (myGen !== videoGen) return; const cb = onDone; stopVideo(); cb && cb(); };
  videoEl.onended = done;
  videoEl.onerror = done;
  const skip = () => done();
  const sync = () => {
    if (myGen !== videoGen || !videoEl) return;
    const r = canvas.getBoundingClientRect();
    Object.assign(videoEl.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  addEventListener("keydown", skip); addEventListener("mousedown", skip); addEventListener("resize", sync);
  document.addEventListener("fullscreenchange", sync);
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(sync) : null;
  observer?.observe(canvas);
  videoCleanup = () => {
    removeEventListener("keydown", skip); removeEventListener("mousedown", skip); removeEventListener("resize", sync);
    document.removeEventListener("fullscreenchange", sync); observer?.disconnect();
  };
  canvas.parentElement.appendChild(videoEl);
  try {
    const res = videoEl.play();
    if (res && typeof res.catch === "function") res.catch(done);
    else if (res === undefined && typeof videoEl.pause === "function" && videoEl.readyState === 0) {
      // Entornos sin reproducción (tests): saltear sin colgar el flujo.
      done();
    }
  } catch { done(); }
}
export function stopVideo() {
  videoGen++;
  videoCleanup?.(); videoCleanup = null;
  if (videoEl) {
    try { videoEl.pause(); videoEl.removeAttribute("src"); videoEl.remove(); } catch {}
    videoEl = null;
  }
}
