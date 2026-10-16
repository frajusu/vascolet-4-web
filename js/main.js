// Fixed-step prototype simulation with independent, interpolated rAF rendering.
// 60 Hz is a port choice; the original simulation rate has not been verified.
import { loadAssets, loadXML, img } from "./assets.js";
import { parseTexts } from "./tmx.js";
import { Input } from "./input.js";
import { Save } from "./save.js";
import { Audio2 } from "./audio.js";
import { menuInit, menuUpdate, menuDraw, chaptersInit, chaptersUpdate, chaptersDraw, optionsInit, optionsUpdate, optionsDraw, onOptionsDone, achInit, achUpdate, achDraw, pauseInit, pauseUpdate, pauseDraw, playVideo, stopVideo } from "./menu.js";
import { Game, loadLevel, gameUpdate, gameDraw } from "./game.js";

const canvas = document.getElementById("game");
const ctx = canvas?.getContext("2d", { willReadFrequently: true });
const bootEl = document.getElementById("boot");
const STEP = 1 / 60, MAX_STEPS = 5, MAX_DELTA = STEP * MAX_STEPS;
let state = "boot", last = null, acc = 0, levelData = null;

function fit() {
  const s = Math.max(1, Math.floor(Math.min(innerWidth / 512, innerHeight / 384)));
  canvas.style.width = 512 * s + "px";
  canvas.style.height = 384 * s + "px";
}

function setBoot(text) {
  if (!bootEl) return;
  if (text == null) { bootEl.remove(); return; }
  if (state === "fatal") return;
  bootEl.textContent = text;
  if (!bootEl.isConnected) document.body.append(bootEl);
}

function resetClock() { last = null; acc = 0; }

function fatal(error) {
  if (state === "fatal") return;
  state = "fatal";
  resetClock(); Input.reset();
  Audio2.stopEffects(); Audio2.stopMusic();
  setBoot(null);
  const message = error?.stack || error?.message || String(error);
  const overlay = document.getElementById("err");
  if (overlay) overlay.textContent = `Error fatal: ${message}`;
  console.error("Fatal runtime error:", error);
}

async function boot() {
  if (!canvas || !ctx) throw new Error("Game canvas / 2D context unavailable");
  ctx.imageSmoothingEnabled = false;
  addEventListener("resize", fit); fit();
  addEventListener("error", e => fatal(e.error || new Error(e.message)));
  addEventListener("unhandledrejection", e => fatal(e.reason));
  document.addEventListener("visibilitychange", () => { resetClock(); Input.reset(); });
  Input.init(); Audio2.init();
  setBoot("Cargando menú…");
  await loadAssets([
    "assets/gui/menu/background.jpg", "assets/gui/menu/menu.png",
  ], (a, b) => setBoot(`Cargando menú… ${a}/${b}`));
  await menuInit(id => {
    if (state !== "menu") return;
    if (id === "jugar") void showChapters().catch(fatal);
    else if (id === "opciones") void showOptions("menu").catch(fatal);
    else {
      const kind = { ayuda: "help", creditos: "credits" }[id];
      if (kind) void showStatic(kind).catch(fatal);
    }
  });
  onOptionsDone(() => {
    if (state !== "options") return;
    if (optionsFrom === "paused") void showPause().catch(fatal);
    else returnToMenu();
  });
  if (state === "fatal") return;
  setBoot(null);
  state = "menu";
  Audio2.stopMusic();
  requestAnimationFrame(frame);
}

async function loadLevelData() {
  if (!levelData) levelData = (async () => {
    const [texts, response] = await Promise.all([
      loadXML("assets/data/texts.xml"), fetch("assets/chars.json"),
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}: assets/chars.json`);
    const chars = await response.json();
    if (!chars || typeof chars !== "object" || Array.isArray(chars) || !chars.vascolet)
      throw new Error("Invalid character manifest: assets/chars.json");
    Game.texts = parseTexts(texts); Game.chars = chars;
  })();
  await levelData;
}

async function startLevel(n) {
  // video de entrada del nivel (skipeable), luego gameplay
  state = "loading"; resetClock(); Input.reset();
  setBoot(null);
  await new Promise(resolve => {
    state = "video";
    playVideo(n, resolve);
  });
  if (state === "fatal") return;
  state = "loading";
  setBoot(`Cargando nivel ${n}…`);
  await loadLevelData();
  if (state === "fatal") return;
  await loadLevel(n);
  if (state === "fatal") { Audio2.stopEffects(); Audio2.stopMusic(); return; }
  resetClock(); Input.reset();
  setBoot(null); state = "game";
}

async function showChapters() {
  state = "loading"; resetClock();
  Audio2.stopMusic();
  setBoot("Cargando mapa…");
  await loadLevelData();
  if (state === "fatal") return;
  await chaptersInit(n => {
    if (state !== "chapters") return;
    if (n === -1) returnToMenu();
    else if (n === -2) void showAchievements().catch(fatal);
    else void startLevel(n).catch(fatal);
  });
  if (state === "fatal") return;
  Input.endStep(); setBoot(null); state = "chapters";
}

let optionsFrom = "menu";
async function showAchievements() {
  state = "loading"; resetClock();
  setBoot("Cargando…");
  await achInit();
  if (state === "fatal") return;
  Input.endStep(); setBoot(null); state = "logros";
}

async function showOptions(from) {
  optionsFrom = from || "menu";
  state = "loading"; resetClock();
  setBoot("Cargando…");
  await optionsInit();
  if (state === "fatal") return;
  Input.endStep(); setBoot(null); state = "options";
}

async function showPause() {
  state = "loading"; resetClock();
  setBoot("Cargando…");
  await pauseInit(action => {
    if (state !== "paused") return;
    if (action === "volver") { resetClock(); Input.reset(); setBoot(null); state = "game"; }
    else if (action === "opciones") void showOptions("paused").catch(fatal);
    else if (action === "salir") { stopVideo(); Audio2.stopMusic(); void showChapters().catch(fatal); }
  });
  if (state === "fatal") return;
  Input.endStep(); setBoot(null); state = "paused";
}

const STATIC = {
  help: "assets/gui/help/help.jpg",
  credits: "assets/gui/credits/credits.jpg",
};

async function showStatic(kind) {
  state = "loading"; resetClock();
  setBoot("Cargando…");
  await loadAssets([STATIC[kind]]);
  if (state === "fatal") return;
  Input.endStep(); setBoot(null); state = kind;
}

function returnToMenu() {
  stopVideo();
  state = "menu"; resetClock(); Input.reset();
  window.scrollTo(0, 0);
  Audio2.stopMusic(); // el menu original no tiene musica
}

async function onLevelWin() {
  const action = Game.winAction || "";
  Save.unlock(Game.level + 1);
  const m = action.match(/goto:level(\d+)/);
  if (action === "toEnding" || Game.level >= 18) {
    await showEnd("victory");
  } else if (m) {
    await startLevel(parseInt(m[1], 10));
  } else {
    await startLevel(Math.min(18, Game.level + 1));
  }
}

async function showEnd(kind) {
  state = "loading"; resetClock();
  setBoot("Cargando…");
  stopVideo();
  if (kind === "gameover") {
    await loadAssets(["assets/gui/gameover/gameover.png"]).catch(() => {});
    void Audio2.music("assets/audio/music/win/gameover.ogg");
  } else {
    await loadAssets(["assets/gui/win/win.png"]).catch(() => {});
    void Audio2.music("assets/audio/music/win/win_game.ogg");
  }
  if (state === "fatal") return;
  Input.endStep(); setBoot(null); state = kind;
}

function drawEnd(ctx, path, fallback) {
  ctx.imageSmoothingEnabled = true;
  const bg = img(path);
  if (bg) ctx.drawImage(bg, 0, 0, 512, 384, 0, 0, 512, 384);
  else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 512, 384); }
  ctx.font = "bold 20px sans-serif"; ctx.fillStyle = "#ffd75e";
  ctx.fillText(fallback + "   (ENTER: continuar)", 60, 360);
}

// Existing volume overlay is provisional until the menu's options API is wired.
function drawStatic(kind) {
  const bg = img(STATIC[kind]);
  if (!bg) throw new Error(`Static screen was not loaded: ${kind}`);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bg, 0, 0, 512, 384, 0, 0, 512, 384);
  ctx.font = "bold 14px sans-serif"; ctx.fillStyle = "#ffd75e";
  ctx.fillText("Cualquier tecla: volver", 20, 370);
}

function staticUpdate(kind) {
  if (Input.pressed.size) returnToMenu();
}

function frame(ts) {
  if (state === "fatal") return;
  try {
    const dt = last === null ? 0 : Math.max(0, Math.min(MAX_DELTA, (ts - last) / 1000));
    last = ts;
    if (document.hidden) { resetClock(); requestAnimationFrame(frame); return; }
    if (state === "menu") {
      try { menuUpdate(); } finally { Input.endStep(); }
      menuDraw(ctx);
    } else if (state === "chapters") {
      try { chaptersUpdate(); } finally { Input.endStep(); }
      if (state === "chapters") chaptersDraw(ctx, Game.texts);
      else if (state === "menu") menuDraw(ctx);
    } else if (state === "logros") {
      try { achUpdate(() => { if (state === "logros") void showChapters().catch(fatal); }); } finally { Input.endStep(); }
      if (state === "logros") achDraw(ctx);
      else if (state === "menu") menuDraw(ctx);
    } else if (state === "options") {
      try { optionsUpdate(); } finally { Input.endStep(); }
      if (state === "options") optionsDraw(ctx);
      else if (state === "menu") menuDraw(ctx);
      else if (state === "paused") pauseDraw(ctx);
    } else if (state === "paused") {
      try { pauseUpdate(); } finally { Input.endStep(); }
      if (state === "paused") { gameDraw(ctx, 1); pauseDraw(ctx); }
      else if (state === "menu") menuDraw(ctx);
    } else if (state === "video") {
      try { /* el overlay <video> se maneja solo; cualquier tecla lo salta */ } finally { Input.endStep(); }
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 512, 384);
    } else if (state === "game") {
      acc += dt;
      let steps = 0;
      while (acc + 1e-10 >= STEP && steps < MAX_STEPS && state === "game") {
        try {
          if (Input.pressed.has("esc")) void showPause().catch(fatal);
          else gameUpdate(STEP);
        } finally { Input.endStep(); }
        if (state !== "game") break;
        acc = Math.max(0, acc - STEP); steps++;
      }
      for (const ev of Game.events.splice(0)) {
        if (ev.type === "win") { void onLevelWin().catch(fatal); break; }
        if (ev.type === "gameover") { void showEnd("gameover").catch(fatal); break; }
      }
      if (state === "game") gameDraw(ctx, acc / STEP);
      else if (state === "menu") menuDraw(ctx);
    } else if (state === "gameover" || state === "victory") {
      try {
        if (Input.pressed.size) {
          if (state === "gameover") void showChapters().catch(fatal);
          else returnToMenu();
        }
      } finally { Input.endStep(); }
      if (state === "gameover") drawEnd(ctx, "assets/gui/gameover/gameover.png", "GAME OVER");
      else if (state === "victory") drawEnd(ctx, "assets/gui/win/win.png", "¡JUEGO COMPLETADO!");
      else if (state === "menu") menuDraw(ctx);
    } else if (STATIC[state]) {
      try { staticUpdate(state); } finally { Input.endStep(); }
      if (state === "menu") menuDraw(ctx);
      else drawStatic(state);
    }
    // Rendering-only frames keep pending edges, including at 144 Hz.
    requestAnimationFrame(frame);
  } catch (error) { fatal(error); }
}

setBoot("Iniciando…");
void boot().catch(fatal);
