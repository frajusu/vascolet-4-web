// V4 flags are inventory-derived. New games do not start with Run/DoubleJump.
export const PLAYER_PHYSICS = Object.freeze({
  gravity: 900, walk: 160, run: 280, acceleration: 3200, friction: 1600,
  jump: 400, cutJump: 240, secondJump: 380,
});
export function progressFromItems(items = []) {
  const owned = new Set(Array.isArray(items) ? items : []);
  const count = prefix => [1, 2, 3, 4, 5].filter(i => owned.has(`${prefix}${i}`)).length;
  const fruits = count("&B-Item"), vegetables = count("&Life");
  return {
    run: owned.has("&P-Run"), sustainJump: owned.has("&P-SustainJump"), doubleJump: owned.has("&P-DoubleJump"),
    jumpAttack: owned.has("&P-JumpAttack"), swim: owned.has("&P-Swim"),
    maxHearts: 5 + vegetables, fruits, maxBoomerangs: 1 + fruits,
  };
}
const powers = {
  "&P-SustainJump": "longJump", "&P-DoubleJump": "doubleJump", "&P-Run": "run",
  "&P-JumpAttack": "jumpAttack", "&P-Swim": "swim",
};
export function itemDefinition(kind) {
  if (powers[kind]) return { animation: powers[kind], permanent: true, effect: "power", sound: "key.ogg" };
  let match = /^&B-Item([1-5])$/.exec(kind);
  if (match) return { animation: `boomerang${match[1]}`, permanent: true, effect: "fruit", sound: "key.ogg" };
  match = /^&Life([1-5])$/.exec(kind);
  if (match) return { animation: `life${match[1]}`, permanent: true, effect: "vegetable", sound: "energy.ogg" };
  match = /^&Key([1-5])$/.exec(kind);
  if (match) return { animation: `key${match[1]}`, permanent: true, effect: "food", sound: "key.ogg" };
  return ({
    Energy: { animation: "energy", effect: "energy", sound: "energy.ogg" },
    FullEnergy: { animation: "fullEnergy", effect: "full", sound: "energy.ogg" },
    ExtraLive: { animation: "extraLive", effect: "life", sound: "extraLife.ogg" },
  })[kind] || null;
}
