// Parallel name/item arrays and layout recovered from AchievementsState C2,
// ELF 0x08258790: origin (13,120), pitch 45, group gap 22, row pitch 113.
const groups = [
  [["saltarMas", "&P-SustainJump"], ["dobleSalto", "&P-DoubleJump"], ["correr", "&P-Run"], ["pisar", "&P-JumpAttack"], ["nadar", "&P-Swim"]],
  [["manzana", "&B-Item1"], ["naranja", "&B-Item2"], ["banana", "&B-Item3"], ["pera", "&B-Item4"], ["uvas", "&B-Item5"]],
  [["zanahoria", "&Life1"], ["tomate", "&Life2"], ["lechuga", "&Life3"], ["cebolla", "&Life4"], ["papa", "&Life5"]],
  [["agua", "&Key1"], ["cereal", "&Key2"], ["leche", "&Key3"], ["queso", "&Key4"], ["yoghurt", "&Key5"]],
];
export const TROPHIES = Object.freeze(groups.flatMap((group, gi) => group.map(([key, item], i) => Object.freeze({
  key, item, x: 13 + (gi % 2) * 247 + i * 45, y: 120 + Math.floor(gi / 2) * 113,
}))));
export const trophyForItem = item => TROPHIES.find(t => t.item === item);
