# Bosses: native evidence and direct arena verification

The boss-only revision replaces the campaign's approximate patterns with state,
action and animation evidence from the original. There are **12 boss types and
14 encounters**: level 4 contains three BigBirds. BigScorpion retains its separate
controller; the other eleven use `js/bosses.js`.

## Reproducible sources

Original symbolized i386 ELF SHA256:
`95f3798f7e1be2bb75a85d637e74750beb41787cbd260549232f88f5cd759573`.

```sh
python tools/extract-enemy-evidence.py --subject BossStates
python tools/extract-enemy-evidence.py --subject BossActions
python tools/extract-enemy-evidence.py --subject BigScorpion
```

These are bounded disassembly ranges, not global auto-analysis:

- `0x08141e9d–0x081510e0`: later boss state definitions, including helper spawns.
- `0x08178c80–0x08179e90`: BigBird group flags, waiting and attack states.
- `0x08171e78–0x08172580`: StandarFireball/Malmark projectile states.
- `0x08079e95–0x08079fe9`: StandarFireball factory, selecting **fireball2**.
- `0x081eeb70`: SetTimer implementation.
- `0x08201b20`: SeekObject implementation.
- `0x081e7680`, `0x081e9a70`: GameD defaults and application to physics.
- `0x082a4fa0`: native per-axis integration; `0x0819fa70`/`0x0819ffe0`:
  bounded tile-collision routines used to interpret bounce coefficients.

Existing indexed excerpts `analysis/states2-behavior.txt` and
`analysis/states3-behavior.txt` are convenient local research outputs. The commands
above regenerate the relevant evidence without depending on those ignored files.
Original TMX, descriptor/catalog data and animation XML supply placements, HP,
body dimensions, animation duration, flags and per-frame displacement.

### Two important corrections to the earlier interpretation

1. **SetTimer(base, spread)** stores `base + randomBetween(0, spread)`. For example,
   `(3,2)` means **3–5 seconds**, not a reversed min/max interval.
2. **SeekObject(..., true)** applies separate **accelerations**, not an instant
   normalized chase velocity. GameD's `+0x0c` field is **horizontal friction**:
   bird waiting uses 100, ghost uses 60. The negative fields following maximum
   velocities are **collision bounce coefficients**, not negative friction.

## Per-boss correction

| Level | Boss / HP | Behavior now reconstructed from the source |
|---|---|---|
| 1 | BigScorpion / 20 | Existing walk/jump/reinforcement pattern preserved; death emits all 30 periodic and 5 final explosions. |
| 3 | TopoNinja / 30 | Stand wait `0.1+random(1.4)`; weighted attack/jump/kick choice; roll preparation launches at `PhysicEvent`, `vy=-960`, airborne horizontal force480. Kick launches at its own flag with `vx=640`, `vy=-300`, gravity960 and wall bounce. |
| 4 | BigBird ×3 / 25 each | Shared fight activation and **one attacker at a time**. Waiting3s, nearby retreat/vertical alignment, friction100. Pursuit lasts `5+random(3)` with force120 and axis caps240. Other birds wait for the shared attack turn. |
| 6 | FurryCritter / 100 | Three-second nearby wait; original `moving` frame displacement; close-player/boomerang trigger; fire after `1+random(1)` and return after2.1s. Each smash `MakeEffect` shakes and can drop one randomly positioned child from300px above. Native child-count gate is `count<=5`. |
| 7 | BigUglyDragon / 30 | Axis forces/caps120, vertical target96px above player, camera guard while normal. Fire timer `1+random(2)`; **0.2-second continuous flame stream while steering**, rather than three stationary aimed fireballs. Tile bounce coefficient−1. |
| 9 | GiantDragonfly / 25 | Retreat inside600px, align72px above player, then commit to a pass with horizontal force240. Keep launch facing until past player and outside camera. Close-range bullet trigger32px. Can leave the map edge during retreat. |
| 10 | BigAnguila / 50 | Swimming force/caps60. After `1+random(2)`, choose a pair of eels, aimed bullet, diagonal pair or four-way cross; pause in attack for1s. No unrelated recurring child timer. |
| 12 | BigPirana / 30 | Protected `normalSkinned` phase lasts `8+random(2)`. Release five helpers at native offsets; exposed `normal` pose remains stationary and vulnerable for10s. Repeat. Helpers wait0.25s, aim at speed100 and retarget every `1+random(1)`. |
| 13 | BigBat / 30 | Continuous steering with forces48/60 toward player−120px, initial horizontal speed100, caps240/120, tile bounce−0.5. Spawn owned bats every5s while native count gate allows it. Removed invented timed seek phase. |
| 15 | BigSpider / 70 | Normal wait `1+random(1)`; two opposite-facing child spawns and a shot on cycle entry. Descend192px at240; shoot for `2+random(1)`; initial shot delay `0.2+random(0.5)`, repeats `0.3+random(0.1)`; climb at60. |
| 16 | BigGhost / 30 | Vertical force240 toward player−64px, horizontal friction60 and close retreat; outside-camera return speed60. Normal shots start after `1+random(0.5)` and repeat `0.4+random(0.2)`. After `3+random(3)`, recoil and chase with forces320/120 for `3+random(2)`. |
| 18 | Malmark2 / 100 | Wait `3+random(2)`, select a random Spot and **fly there at180**, stopping within32px. No teleport. Two-second attack state changes from `attack1` to `attack2` after1s; choose Bat, DragonFly, Bee or native Fireball2 above the hands. Fireball2 accelerates toward player during seconds1–6. |

### Animation-linked behavior

- Topo's `shot` lasts `23/12` seconds. Custom flags occur after **11/12,
  13/12 and 15/12 seconds**, accounting for long XML frame durations. Stars use
  the Topo atlas, steer at320 and keep their one-second `starDead` stick effect.
- Roll launch occurs after `10/30` seconds; entering jump preserves the current
  roll animation rather than replaying its preparation frames.
- Smash follows all three MakeEffect flags, not two arbitrary spawn timers.
- Living damage blinks/shakes the current pose. Exported `damage` images are
  not substituted for living animations; several look like dead characters.
- Retreating bosses retain their native facing independently of backward speed.

### Lifecycle and integration

Activation is camera-driven; the bird group additionally shares activation.
An active fight continues updating outside the ordinary enemy-culling distance.
This matters for retreat/passes and distant Malmark destinations. Free-flight
bosses retain native map-collision bypass: a hard map-edge clamp made the
level-9 dragonfly incapable of reaching its600px retreat distance.

Topo, Bat and Scorpion request their energy bar on entry. Other bosses request
it on damage. With the three birds, the most recently hit boss owns the bar.
This avoids showing another bird's untouched HP while the player attacks one.

Damage cooldown is0.25s. Pirana's protected phase rejects damage. Defeat freezes
movement/contact, emits30 explosions at0.1s intervals through3s, then5 final
explosions and one defeat callback at4s. The renderer supplies the final white
flash. Stage completion waits for every relevant boss's defeat callback.

## Direct verification

```sh
npm test
npm run test:bosses
npm run test:campaign
# Requires Windows and the isolated native adapter:
python tools/native-isolated/bosses.py
```

`test:bosses` opens only boss maps, places a protected player in each arena,
observes30 simulated seconds without attacking, then fights using actual input,
player throw animations, boomerang trajectories and collision/damage rules.
It grants the fruits/snorkel appropriate to that chapter in its isolated save.
**It never assigns boss HP or calls the damage function directly.** Fleeing
bosses receive a fixed target so fixture teleporting cannot force an endless
chase. It checks all14 encounters, bird turn exclusion, death and stage victory,
and writes snapshots/report under `%TEMP%/opencode/vascolet-bosses-*`.

The Windows observer uses a TEMP copy with Start moved into each original arena.
It captures the real renderer on an unselected desktop with private input;
the original executable, assets and real save are not edited. Native references
were collected for all12 boss maps. They are observations, not frame-synchronized
comparisons or native victories.

### Remaining fidelity limits

Recovered patterns, action parameters and animation timings are distinct from
a bit-identical simulation. The shared Canvas collision/sweep engine, JavaScript
numeric precision, exact frame ordering, projectile contact boxes and minion
steering retain port differences. Seeded xorshift makes tests reproducible but
does not reproduce the native RNG stream. These fixtures certify direct combat
and progression, not natural unaided victories or pixel/frame-perfect Windows
equivalence.
