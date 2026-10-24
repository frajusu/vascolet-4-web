// CharacterFactory descriptors from the symbolized V4 ELF (SHA/ranges recorded
// by tools/extract-character-catalog.py). Factory life is not always effective
// life: some scripts replace it or enter a death state on the first interaction.
const rows = [
  ["Fly","fly",999999,40,48,0], ["Bee","bee",999999,40,48,0],
  ["Panal","bee",4,40,128,0], ["Mosquito","mosquito",2,40,48,0],
  ["DragonFly","dragon-fly",2,40,58,0], ["Bat","big-bat-child",999999,30,14,0],
  ["Frog","frog",4,52,42,900], ["Flower","flower",5,40,48,0],
  ["Beetle","beetle",10,40,48,900], ["Snail","snail",10,72,52,900],
  ["LittleSpider","little-spider",10,28,20,900], ["Mouse","mouse",2,30,32,900],
  ["VolcanoFlower","volcano-flower",6,46,48,0], ["BigSnake","big-snake",6,46,200,0],
  ["SideColumn","side-column",6,46,64,0], ["FrontColumn","center-column",6,60,64,0],
  ["Axe","axe",999999,20,10,0], ["Fork","fork",999999,20,10,0], ["Knife","knife",999999,20,10,0],
  ["Piranha","pirana",999999,40,32,0], ["Pirana2","pirana2",4,40,48,0],
  ["Fish","fish",999999,30,14,0], ["Blowfish","blowfish",999999,28,30,0],
  ["Shell","shell",3,40,48,0], ["BigPiranaBlowFish","blowfish2",4,44,32,0],
  ["Scorpion","escorpion",2,40,20,900], ["BigScorpion","big-scorpion-v02",20,80,40,900],
  ["TopoNinja","topo-ninja",30,80,100,1800], ["BigBird","big-bird",25,80,40,0],
  ["FurryCritter","furry-critter",100,124,80,0], ["BigUglyDragon","ugly-dragon",30,120,56,0],
  ["GiantDragonfly","giant-dragonfly",25,120,56,0], ["BigAnguila","anguila2",50,128,32,0],
  ["BigPirana","big-pirana",30,92,96,0], ["BigBat","big-bat",30,90,42,0],
  ["BigGhost","ghost2",30,62,64,0], ["BigSpider","big-spider",70,92,108,0],
  ["Malmark2","malmark2",100,30,120,0],
  ["FurryCritterChild","furry-critter-child",5,40,20,900],
  ["Anguila","anguila-child",2,64,16,0],
];
export const CHARACTER_CATALOG = Object.freeze(Object.fromEntries(rows.map(([kind,asset,hp,w,h,gravity]) =>
  [kind,Object.freeze({asset,hp,w,h,gravity})])));
