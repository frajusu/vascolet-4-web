# Native boss evidence and calibration

This document separates facts recovered from the native game data from timings
and movement values that were calibrated for the Canvas port. The implementation
lives in `js/bosses.js`; deterministic coverage lives in `tools/bosses.test.mjs`.

## Sources

- `analysis/states2-behavior.txt`
  - generic boss death: lines 13337-13980
  - `BigBird`: lines 15229-16200
- `analysis/states3-behavior.txt`
  - `BigAnguila`: lines 141-1535
  - `BigBat`: lines 1548-2250
  - `TopoNinja`: lines 2304-5300
  - `FurryCritter`: lines 5372-6700
  - `BigUglyDragon`: lines 7024-7727
  - `GiantDragonfly`: lines 7727-8444
  - `BigGhost`: lines 8444-9600
  - `BigPirana`: lines 9607-10884
  - `BigSpider`: lines 10884-11987
  - `Malmark2`: lines 11987-13330
- `js/character-catalog.js`, `assets/chars.json`, and the shipped character
  libraries supplied HP, body size, gravity, animations, and art.
- `assets/data/maps/level3.tmx`, `level4.tmx`, `level6.tmx`, `level7.tmx`,
  `level9.tmx`, `level10.tmx`, `level12.tmx`, `level13.tmx`, `level15.tmx`,
  `level16.tmx`, and `level18.tmx` supplied placements and `Spot1`-`Spot5`.

The analysis files are symbolized disassembly. String labels are evidence of
native state names and actions. Numeric immediates described as recovered below
are quoted from that disassembly. Any timing not stated as recovered is an
explicit port calibration.

## Recovered constants

| Boss | HP | Body | Gravity | Recovered motion |
| --- | ---: | --- | ---: | --- |
| `TopoNinja` | 30 | 80x100 | 1800 | jump impulse `-960` |
| `BigBird` | 25 | 80x40 | 0 | aerial pass at `320` |
| `FurryCritter` | 100 | 124x80 | 0 | base speed `60` |
| `BigUglyDragon` | 30 | 120x56 | 0 | base speed `120` |
| `GiantDragonfly` | 25 | 120x56 | 0 | attack/dash speed `240` |
| `BigAnguila` | 50 | 128x32 | 0 | base speed `60` |
| `BigPirana` | 30 | 92x96 | 0 | base speed `60`; five blowfish |
| `BigBat` | 30 | 90x42 | 0 | patrol speed `100`; child timer `5` |
| `BigGhost` | 30 | 62x64 | 0 | base speed `60`; shoot interval `0.5`-`1.0` |
| `BigSpider` | 70 | 92x108 | 0 | descend `192` at `240`; climb at `60` |
| `Malmark2` | 100 | 30x120 | 0 | `Spot1`-`Spot5` teleport markers |

`BigScorpion` is intentionally absent. It remains implemented by
`js/scorpion-boss.js` and is not re-created by the new module.

## Recovered state labels

The native state machines use named states and some uppercase internal labels.
The Canvas port keeps short lower-case state names where the behavior maps
one-to-one. This table records the relationship instead of pretending the port
has the native scripting engine.

| Boss | Native evidence | Controller states |
| --- | --- | --- |
| `TopoNinja` | `wait`, `prepareJump`, `kick`, `attack`, `jump`; labels `TOPO_NINJA_PREPARE_JUMP`, `TOPO_NINJA_JUMP` | `stand` (native `wait`), `prepareJump`, `jump`, `kick`, `attack` |
| `BigBird` | `BIG_BIRD_WAITING`, `waitingForAttack`, `attacking` | `normal` (wait), `attack` (pass) |
| `FurryCritter` | `normal`, `moving`, `attack`, `smash` | `normal`, `seek` (native `moving`), `attack`, `smash` |
| `BigUglyDragon` | `BIG_UGLY_DRAGON_NORMAL`, `BIG_UGLY_DRAGON_ATTACK` | `normal`, `attack` |
| `GiantDragonfly` | `GIANT_DRAGONFLY_NORMAL`, `GIANT_DRAGONFLY_ATTACK` | `normal`, `attack` |
| `BigAnguila` | `normal`, `attack` | `normal`, `attack` |
| `BigPirana` | `BIG_PIRANA_NORMAL`, `BIG_PIRANA_ATTACK`, `normalSkinned` | `normal`, `attack` |
| `BigBat` | `BIG_BAT_INITIAL_WAIT`, `BIG_BAT_NORMAL` | `normal`; optional seek phase |
| `BigGhost` | `BIG_GHOST_NORMAL`, `BIG_GHOST_ATTACK`, `shoot` | `normal`, `attack` |
| `BigSpider` | `BIG_SPIDER_NORMAL`, `BIG_SPIDER_ATTACK` | `normal`, `down`, `attack`, `up` |
| `Malmark2` | `normal`, `attack1`, `attack2`, teleport through `Spot` markers | `normal`, `teleport`, `attack1`, `attack2` |

The common wrapper states are port-level names: `waiting`, `dying`, and
`defeated`. The native engine uses camera activation and generic boss states for
the same phases.

## Recovered animation sets

Only names that exist in the shipped XML are requested. If a library lacks a
dedicated pose, the controller falls back to `normal` rather than inventing a
name.

| Boss | Animation names |
| --- | --- |
| `TopoNinja` | `stand`, `shot`, `roll`, `star`, `starDead`, `dead`, `kick` |
| `BigBird` | `damage`, `dead`, `normal` |
| `FurryCritter` | `damage`, `dead`, `moving`, `attack`, `smash`, `normal` |
| `BigUglyDragon` | `damage`, `dead`, `normal`, `attack` |
| `GiantDragonfly` | `damage`, `dead`, `normal` |
| `BigAnguila` | `normal`, `attack` (no `dead` in this library) |
| `BigPirana` | `damage`, `dead`, `normal`, `normalSkinned` |
| `BigBat` | `damage`, `dead`, `normal` |
| `BigGhost` | `damage`, `dead`, `normal` |
| `BigSpider` | `damage`, `dead`, `normal`, `shooting` |
| `Malmark2` | `damage`, `dead`, `normal`, `attack1`, `attack2` |
| `FurryCritterChild` | `damage`, `dead`, `walk`, `normal` |
| `Anguila` child | `normal`, `attack`, `dead` |
| `BigPiranaBlowFish` | uses its own non-boss profile |
| `LittleSpider` | `normal` |
| `Bat` child | `damage`, `dead`, `normal` |

## Generic boss lifecycle

Recovered from `GENERIC_BOSS_INITIAL_WAIT`, `GENERIC_BOSS_DEAD`, and the
`GENERIC_BOSS_STATIC_DEAD` section:

- Bosses begin in an initial wait and start the boss music when they become
  active.
- The fight starts on entering the camera. `api.bossStart(e)` is emitted once.
- `hp <= 0` enters a dying state; movement, gravity, and contact are disabled.
- Regular explosions occur every `0.1` seconds through `3.0` seconds.
- At `4.0` seconds the native script makes five more explosions, shakes the
  screen, and calls `Die`.
- The port emits 30 regular explosions, then 5 final explosions, then
  `bossDefeated` once. It does not reproduce the native white tint because the
  Canvas API has no tint callback in this module.
- Dying and defeated bosses ignore player distance. They cannot be damaged
  again.

## Per-boss behavior and calibrated values

### `TopoNinja`

Recovered: `wait` chooses among `kick`, `prepareJump`, and `attack`; the jump
uses gravity `1800` and impulse `-960`; `kick`, `roll`, `shot`, `star`, and
`starDead` are the native poses/actions.

Port calibration:

- wait time `0.1`-`1.4` seconds;
- kick movement `180` for `0.18` seconds and a `0.58` second state;
- prepare-jump delay `0.24` seconds, horizontal jump `120`-`220`;
- attack fires three aimed shots at `0.14`, `0.40`, and `0.66` seconds, then
  returns after `1.05` seconds.

The three-shot spread and the exact state durations were not recovered. The
native star child type is recorded in `BOSS_MINIONS`, but the port emits the
stars through `api.shoot` so they use the existing projectile pipeline.

### `BigBird`

Recovered: gravity `0`, pass speed `320`, initial wait and
`waitingForAttack`/`attacking` states.

Port calibration: wait `0.8`-`1.8` seconds, pass `1.15` seconds, vertical
correction limited to `120` pixels/second, hover bob `5` pixels.

### `FurryCritter`

Recovered: `normal`, `moving`, `attack`, `smash`; child type
`FurryCritterChild`; base speed `60`.

Port calibration: normal wait `2.5`-`3.5` seconds, seek window `0.7`-`1.1`
seconds, attack/smash split `55/45`, one aimed fireball, up to two children per
smash, and child cap `2`.

### `BigUglyDragon`

Recovered: `normal`/`attack`, speed `120`, fireball attack.

Port calibration: attack volley at `0.08`, `0.36`, and `0.64` seconds;
`1.05` second attack; wait `1.0`-`2.0` seconds.

### `GiantDragonfly`

Recovered: `normal`/`attack`, attack speed `240`.

Port calibration: retreat speed `320` inside `180` pixels, approach speed
`120`, three aimed shots, `0.95` second attack, wait `0.8`-`1.5` seconds.

### `BigAnguila`

Recovered: `normal`/`attack`, speed `60`, child type `Anguila`, two-shot fan.

Port calibration: child spawn every `3.5` seconds with a cap of `2`; fan
vertical velocities `-50` and `50`; `1.0` second attack; wait `1.0`-`2.0`
seconds. The source library has no `dead` animation, so death uses `normal`.

### `BigPirana`

Recovered: normal/attack, speed `60`, five `BigPiranaBlowFish` in a charge.

Port calibration: spawn fan positions, lunge speed `100`, `1.25` second attack,
wait `1.3`-`2.3` seconds.

### `BigBat`

Recovered: normal state, patrol speed `100`, child timer `5` seconds, bat child
type.

Port calibration: hover wave `24` pixels/second, optional seek phase of `1.0`
second every `2.4`-`3.6` seconds, child cap `3`.

### `BigGhost`

Recovered: normal/attack/shoot, speed `60`, `0.5`-`1.0` second shoot timer,
two-shot attack.

Port calibration: retreat inside `200` pixels, approach speed `120`, attack
speeds `-120` then `240`, both shots aimed, `1.0` second attack, attack every
`3.0` seconds.

### `BigSpider`

Recovered: normal/attack, descend `192` pixels at `240`, climb at `60`.

Port calibration: normal wait `1.0` second, attack `2.4` seconds, aimed shots
every `0.2`-`0.5` seconds, one `LittleSpider`, child cap `1`.

### `Malmark2`

Recovered: `normal`, `attack1`, `attack2`, teleport through five `Spot` markers,
and minion summoning.

Port calibration: fireball at `0.85` seconds; teleport after `2.0`-`3.0`
seconds; marker visit order; one minion per teleport; attack1/attack2 durations
`0.9`/`1.1` seconds. Marker centers use TMX object width/height when present and
fall back to the object origin for plain test markers.

## Integration contract

```js
updateBoss(enemy, player, dt, api) // true when the kind is handled
damageBoss(enemy, direction = 1, damage = 1) // true when damage was accepted
```

All callbacks are optional:

- `moveBody(e, dt, gravity)`
- `tileAt(x, y)`
- `inCamera(e)`
- `spawn(kind, x, y, direction, owner)`
- `nearby(kind, owner)`
- `shoot(owner, options)`
- `markers`: array or `(e) => array`
- `bounds`: object or `(e) => object`
- `shake(seconds)`
- `explosion(e)`
- `bossStart(e)`
- `bossDefeated(e)`
- `sound(name)`

The parent integration now routes all `BOSS_KINDS` through this module from
`js/enemies.js`, before generic damage/death handling. The runtime uses
`native-boss`, supplies arena bounds/markers/callbacks, preloads child libraries,
and waits for `defeated` before completing the stage. Topo stars use their own
library; BigPirana's living helper group is capped at five. See
`campaign-status.md` for the combined verification and its explicit fixture scope.

## Verification

```powershell
node --test tools/bosses.test.mjs
node --test tools/integration.test.mjs
```

The boss suite parses the real character XML with `jsdom`, drives the real
`AnimPlayer`, and covers all eleven controllers, fight gating, damage gating,
hurt-pose recovery, death timing, explosions, bounds, projectiles, minions,
markers, and missing optional APIs.
