import { Game as g, loadLevel, gameUpdate, gameDraw } from "../js/game.js";
import { loadXML } from "../js/assets.js";
import { parseTexts, TILE_SOLID } from "../js/tmx.js";
import { AnimPlayer } from "../js/sprite.js";
import { createEnemy } from "../js/enemies.js";
import { createBoomerang } from "../js/projectiles.js";
import { Input } from "../js/input.js";
import { Audio2 } from "../js/audio.js";

// Use the real game update, map collision and renderer, with controlled inputs.
Audio2.music = async () => true; Audio2.sfx = async () => null;
g.chars = await (await fetch("../assets/chars.json")).json();
g.texts = parseTexts(await loadXML("assets/data/texts.xml"));
await loadLevel(1);
const originalMap = g.map, originalLayer = g.map.layers.find(l => l.name === "Tiles");
const tileSet = g.tsx.find(t => Object.values(t.tsx.flags).includes(TILE_SOLID));
const solidGid = tileSet.firstgid + Number(Object.entries(tileSet.tsx.flags).find(([, flags]) => flags === TILE_SOLID)[0]);
const ctx = document.querySelector("canvas").getContext("2d");
let actor, scenario, trace = [], seed;

function render() {
  g.camX = g.prevCamX = actor.homeX - 256; g.camY = g.prevCamY = 96;
  gameDraw(ctx, 1);
}
function setup(kind, mode = "near", runSeed = 1) {
  scenario = mode; seed = runSeed;
  g.gw = 64; g.gh = 24; g.grid = new Uint8Array(g.gw * g.gh);
  const tiles = Array(g.gw * g.gh).fill(0);
  for (let x = 0; x < g.gw; x++) { g.grid[12 * g.gw + x] = TILE_SOLID; tiles[12 * g.gw + x] = solidGid; }
  g.map = { ...originalMap, w: g.gw, h: g.gh, groups: [], layers: [{ ...originalLayer, w: g.gw, h: g.gh, data: tiles }] };
  const grounded = kind !== "Fly";
  actor = createEnemy({ name: kind, x: 544, y: (grounded ? 384 : 300) - (kind === "Flower" ? 32 : 16) }, false, runSeed);
  const c = g.charCache.get(kind); actor.anim = new AnimPlayer(c.anims);
  actor.anim.set(actor.anim.has("normal") ? "normal" : "flying"); actor.cur = actor.anim.frame;
  actor.active = true; actor.ground = grounded;
  g.enemies = [actor]; g.booms = []; g.shots = []; g.parts = []; g.effects = [];
  g.infos = []; g.items = []; g.saves = []; g.events = []; g.win = null; g.won = false; g.dlg = null; g.tip = ""; g.tipT = 0;
  g.time = 0; g.energy = 100; g.lives = 5;
  Object.assign(g.player, { x: 480, y: 384, vx: 0, vy: 0, inv: 1e6, damage: null, ground: true, attack: null, fireCd: 0,
    run: false, face: 1, buffer: 0, crouch: false, animName: "stand" });
  g.player.anim.restart("stand"); g.player.cur = g.player.anim.frame;
  if (mode === "boomerang") g.booms.push(createBoomerang({ x: 440, y: 384, face: 1, crouch: false }, null));
  trace = []; Input.reset(); render();
}
function ticks(count, dt = 1 / 60) {
  for (let i = 0; i < count; i++) {
    const p = g.player;
    p.x = scenario === "far-left" || scenario === "boomerang" ? 100 : scenario === "far-right" ? 1020
      : scenario === "cross" && g.time > .35 ? 640 : 480;
    p.y = 384; p.vy = 0; Input.reset();
    gameUpdate(dt);
    trace.push({ t: g.time, x: actor.x, y: actor.y, vx: actor.vx, vy: actor.vy, dir: actor.dir,
      state: actor.state, ground: actor.ground, hp: actor.hp, animation: actor.anim.cur?.name,
      frame: actor.anim.i, playerX: p.x, shots: g.shots.map(s => ({ x: s.x, y: s.y, kind: s.kind })) });
  }
  render();
}
window.Lab = { ready: true, setup, ticks, trace: () => ({ kind: actor.kind, scenario, seed, samples: trace }) };
setup("Frog");
