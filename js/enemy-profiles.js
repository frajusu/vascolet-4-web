// Recovered descriptors plus calibrated script-family parameters. Exact versus
// provisional values are separated in docs/presentation-and-content.md.
import { CHARACTER_CATALOG } from "./character-catalog.js";
const later = {
  Bee: { behavior:"fly",hp:1,speed:240,patrolTurn:32,acceleration:480,verticalAcceleration:600 },
  Panal: { behavior:"hive",speed:0,attackDelay:2,attackSpread:0,pose:"panal" },
  Mosquito: { behavior:"flying-shooter",speed:120,acceleration:600,attackDelay:2,attackSpread:0 },
  DragonFly: { behavior:"flying-seek",speed:120,acceleration:100 },
  Bat: { behavior:"flying-seek",hp:1,speed:100,acceleration:320 },
  LittleSpider: { behavior:"spider",speed:30,attackDelay:2,attackSpread:1,jumpSpeed:200 },
  Mouse: { behavior:"mouse",speed:180,acceleration:640,jumpSpeed:360 },
  VolcanoFlower: { behavior:"volcano",speed:30,gravity:900,attackDelay:2,attackSpread:1 },
  BigSnake: { behavior:"snake",speed:0,triggerRange:96,attackDelay:2,attackSpread:1 },
  SideColumn: { behavior:"side-column",speed:0,attackDelay:2,attackSpread:1 },
  FrontColumn: { behavior:"front-column",speed:0,attackDelay:2,attackSpread:1,contact:false },
  Axe: { behavior:"falling-trap",hp:1,speed:0,triggerRange:250 },
  Fork: { behavior:"falling-trap",hp:1,speed:0,triggerRange:250 },
  Knife: { behavior:"falling-trap",hp:1,speed:0,triggerRange:250 },
  Fish: { behavior:"swim-patrol",hp:1,speed:100 },
  Piranha: { behavior:"piranha",hp:1,speed:60 },
  Pirana2: { behavior:"piranha",speed:60 },
  Blowfish: { behavior:"blowfish",hp:1,speed:80 },
  BigPiranaBlowFish: { behavior:"swim-patrol",speed:60 },
  Shell: { behavior:"shell",speed:0,attackDelay:2,attackSpread:0 },
};
export const ENEMY_PROFILES = Object.freeze({
  ...Object.fromEntries(Object.entries(CHARACTER_CATALOG).map(([kind,desc])=>[kind,{
    ...desc,behavior:"boss-pending",speed:0,...later[kind],
  }])),
  Fly: { behavior: "fly", hp: 1, w: 40, h: 48, speed: 240, gravity: 0,
    patrolTurn: 32, acceleration: 480, verticalAcceleration: 600 },
  Frog: { behavior: "frog", hp: 4, w: 52, h: 42, speed: 240, gravity: 900,
    triggerRange: 128, jumpSpeed: 500 },
  Flower: { behavior: "flower", hp: 5, w: 40, h: 48, speed: 0, gravity: 0,
    attackDelay: 1, attackSpread: 2 },
  Beetle: { behavior: "patrol", hp: 10, w: 40, h: 48, speed: 30, gravity: 900 },
  Snail: { behavior: "snail", hp: 10, w: 72, h: 52, speed: 30, gravity: 900,
    attackDelay: 1, attackSpread: 1, attackDuration: .5 },
  Scorpion: { behavior: "patrol", hp: 2, w: 40, h: 20, speed: 120, gravity: 900 },
  BigScorpion: { behavior: "scorpion-boss", hp: 20, w: 80, h: 40, speed: 7, gravity: 900 },
});

// Each lab run uses the same sequence; a seed can be supplied for timer sweeps.
export function enemyRandom(e) {
  let x = e.seed | 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  e.seed = x >>> 0;
  return e.seed / 4294967296;
}
