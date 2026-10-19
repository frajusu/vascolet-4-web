// AudioLibrary::initAudioLibrary (ELF 0x08067980). Per-effect gains, separate
// from the user's music/effects sliders and from menu sounds.
import { Audio2 } from "./audio.js";
const ROOT = "assets/audio/fx/win/";
export const LEVEL_SOUNDS = Object.freeze({
  boomerang: .7, boomerang2: .7, boomerang3: .7,
  jumpAir: .4, jumpWater: .7, double_jump: .8,
  footStep1: .1, footStep2: .1, fall1: .5, fall2: .5, fall3: .5,
  energy: .4, extraLife: .4, vascolet: 1, key: 1, save: .5, help: .5,
  enemy_boomerang_hit: .5, enemy_hit: 1, v_death1: .25, vasco_death: .25,
  boss_death: .8, boomerang_wall_hit: .5, willyFire: 1, v_explosion: 1,
  wings: 1, swim: .8,
});
export function levelSound(name) {
  return Audio2.sfx(ROOT + name.replace(/\.ogg$/, "") + ".ogg", LEVEL_SOUNDS[name.replace(/\.ogg$/, "")] ?? 1);
}
