# Native later-enemy evidence and calibration

This document separates facts recovered from the native data from timings and
motion values that are port calibrations. The implementation lives in
`js/later-enemies.js`; deterministic coverage lives in
`tools/later-enemies.test.mjs`.

## Scope and integration contract

`updateLaterEnemy(e, player, dt, api)` returns `true` for every family handled
here and `false` for ordinary first-area actors and unimplemented bosses.
Bosses now dispatch directly to `js/bosses.js`; they do not use this module.

The parent still owns the generic frame order:

- increments `e.t`/`e.stateTime` and decrements `e.hurtT`/`e.cooldown` before
  calling the controller;
- updates `e.anim` and drains animation events after the controller returns;
- forces the normal animation when `e.state === "normal"`.

Consequently this module reads animation flags from `e.anim.frame.flags` and
uses one-shot latches; it does not consume `drainEvents()`.

`canDamageLaterEnemy(e)` is exported for the parent's boomerang/stomp checks.
It returns `false` while a Shell is closed and `true` otherwise. Shell contact
stays enabled (changing `contact` would also disable the boomerang collision),
and the parent calls this predicate before accepting a hit.

Optional services: `waterAt(x, y)` enables Piranha/Pirana2 water-out behavior;
without it those actors assume they are in water. `inCamera(body)` gates the
SideColumn shot. `spawn`, `nearby`, `shoot`, `moveBody`, and `tileAt` follow the
existing parent signatures.

## Sources

- `analysis/states0-behavior.txt`
  - Blowfish: 605 (`BLOWFISH_NORMAL`), 827 (`BLOWFISH_ACTIVATED`),
    1015 (`BLOWFISH_DEACTIVATED`), 1092 (`BLOWFISH_DAMAGE`)
  - Fish: 1193 (`FISH_NORMAL`)
  - Bat: 1485 (`BAT_NORMAL`)
  - Axe/Fork/Knife: 2831, 2973, 3108, 3273
  - Piranha: 4943, 5341, 5549
- `analysis/states2-behavior.txt`
  - Panal: 5344 (`PANAL_NORMAL`)
  - Shell: 5636 (`SHELL_NORMAL`)
  - LittleSpider: 7177, 7316
  - Mouse: 8170 (`MOUSE_SEEK`), 8460 (`MOUSE_JUMP`)
  - VolcanoFlower: 8573, 8904
  - Mosquito: 9625
  - SideColumn: 9936, 10118
  - BigSnake: 10323-10884
  - FrontColumn: 11101
  - Pirana2: 11628, 11949, 12187
- `assets/characters/*/animData/*.xml`: animation names, frame durations and
  `PhysicEvent`/`Custom` flags.
- `js/character-catalog.js`, `js/enemy-profiles.js`: factory HP/body/gravity,
  speeds, accelerations, and trigger distances.
- DragonFly is registered against the shared `Witch` script in the character
  factory; searching only for a `DragonFly` state name misses that alias.

## Recovered constants

| Family | Recovered values |
| --- | --- |
| Shell | Normal sequence `shell00` 20f, `shell01` `PhysicEvent`, `shell02` `Custom`, `shell03` 12f, `shell04` `PhysicEvent`; aimed `GenericBullet`; three bubbles at roughly `(10,-20)`, `(8,-30)`, `(0,-16)` |
| Axe/Fork/Knife | stale at 250 range; appear until animation end; gravity `960` after `0.5s`; seek speed `180`; disappear after `7s`; damage shake `0.1` |
| Piranha | patrol `60`; bounce at walls; normal timer `2s`; attack after `1s` within `128`; attack `-30` then seek `180`; return at `1s`; water-out gravity `400`, jump `-120` |
| Pirana2 | Same family with attack seek `180` and its own `damage`/`dead` animations |
| Blowfish | normal velocity `(0,0)`; activate within `200`, deactivate beyond `250`; active seek force `50`; deactivated gravity `400` for `1s` |
| Bat | speed `100`; seek force `120`, spread `60`; face player; floor unsnap `200` |
| Mosquito | face/seek player; floor unsnap `-60`; shoot timer + blink `0.25`/`0.033`; aimed `GenericBullet` |
| DragonFly | Shared Witch registration; flying steering remains calibrated |
| Fish | speed `100`; wall bounce; no land gravity |
| LittleSpider | walk `30`; jump timer `1.0`; jump `-200`; land returns to normal |
| Mouse | seek + face; jump on wall bounce or fast airborne state; jump `-360`; land returns to normal |
| VolcanoFlower | walk `30`; turn at wall/cliff; attack timer; three `StandarFireball` with `randomJump`; blink `0.25`/`0.033` |
| SideColumn | normal timer `3 + rand*1`; needs camera bounds and facing; one `Fireball` on `Custom`; return on animation end |
| FrontColumn | normal timer `2 + rand*1`; three `GenericBullet`s `toPlayerUp`/`toPlayer`/`toPlayerDown` on `Custom` |
| BigSnake | wait hidden; emerge within `96`; upward `320`; stop after `0.5`; shoot timer `1 + rand*2`; aimed bullet then attack animation |
| Panal | spawn timer `2 + rand*1`; only when active and owner count is not `>3`, so the cap is four bees |

## State mapping used by the port

| Family | Native states | Port states |
| --- | --- | --- |
| Shell | `SHELL_NORMAL` with flag blocks | `normal`; `shellOpen`/`vulnerable` drive hit protection |
| Axe/Fork/Knife | `AXE_STALE`, `AXE_APPEAR`, `AXE_NORMAL`, `AXE_DISAPPEAR`, `AXE_DAMAGE` | `stale`, `appear`, `falling`, `disappear` |
| Piranha/Pirana2 | `PIRANHA_NORMAL`, `PIRANHA_ATTACK`, `PIRANHA_WATER_OUT` | `normal`, `attack`, `waterOut` |
| Blowfish | normal/activated/deactivated/damage | `normal`, `activated`, `deactivated` |
| Bat/Mosquito/DragonFly | `BAT_NORMAL`; Mosquito normal; no DragonFly controller | `normal` |
| Fish | `FISH_NORMAL` | `normal` |
| LittleSpider | normal, jump | `normal`, `jump` |
| Mouse | seek, jump | `normal`, `jump` |
| VolcanoFlower | normal, attack | `normal`, `attack` |
| SideColumn | normal, attack | `normal`, `attack` |
| FrontColumn | normal, attack | `normal`, `attack` |
| BigSnake | wait, normal, attack | `wait`, `normal`, `attack` |
| Panal | `PANAL_NORMAL` | `normal` |

## Deliberate approximations

- **Shell flag ordering.** The two native flag blocks both test
  `PhysicEvent` with a shared `once` flag, which is ambiguous in the
  disassembly. The shipped animation order (`open`, `shoot`, `close`) and the
  intended vulnerability window are used instead: the first active
  `PhysicEvent` opens the Shell, `Custom` fires the aimed projectile, and the
  second `PhysicEvent` closes it. Bubbles use `api.shoot` with an explicit
  cosmetic flag, their native bubble animation and finite lifetime; they cannot
  damage the player or play the firing sound. The integration enforces this.
- **Native 3D/2D seek forces.** Bat/Mosquito/DragonFly use the calibrated
  `acceleration` values in `js/enemy-profiles.js`; the native `SeekObject`
  force/spread pair is not exposed by the parent API. They never call
  `moveBody`, so they cannot acquire terrestrial gravity. Floor unsnapping is
  approximated by a solid tile at the foot (`tileAt`) and the recovered
  impulses.
- **DragonFly.** Its shared Witch motion is not fully recovered. It uses a flying seek distinct
  from the shared Bee patrol, with speed/acceleration from its descriptor and a
  small `-60` floor unsnap.
- **BigSnake vertical sign.** Native `SetVelY 320` is mapped to `-320` in this
  port because canvas Y grows downward; the snake still emerges upward for
  half a second and then stops.
- **Trap collision and damage.** The falling trap uses its own gravity/seek
  motion rather than `moveBody`, so it does not land on terrain. The native
  `AXE_DAMAGE` invisibility cannot run because the parent handles `hp <= 0`
  before this controller; death uses the generic parent path. The disappearance
  animation has a `0.5s` fallback for libraries whose animation loops.
- **Blowfish sleep art.** The shipped `blowfish` library lacks `sleep`; the
  deactivated state requests it and falls back to `normal`.
- **Mouse jump trigger.** The port jumps on wall contact or when fast and
  airborne with the player not above, which is a simplification of the native
  condition chain. Jump impulse and landing transition are recovered.
- **Piranha water detection.** The runtime supplies `waterAt` from the original
  dataExt rectangles; without the optional service, isolated controllers remain in water. The water-out
  transition behavior is exercised with an explicit service in tests.
- **Column timing.** SideColumn uses the recovered `3 + rand*1` internal timer.
  FrontColumn uses the parent-decremented `cooldown` (initialized as
  `2 + rand*1` by `createEnemy`) so it cooperates with existing parent tests.
- **Hive ownership.** Bees are spawned with the hive object as `owner`, matching
  the parent's `nearby(kind, owner)` counter; native uses the `panalBee` owner
  tag.
- **Trap/water/floor callbacks.** All services are optional and guarded. A
  missing `tileAt` means no wall or floor, never an implicit solid world.

## Test coverage

`node --test tools/later-enemies.test.mjs` covers:

- dispatch for every recovered family, with `false` for bosses and
  ordinary actors;
- real animation XML/`AnimPlayer` timing;
- Shell open/close windows, three bubbles and one aimed `Custom` shot, with no
  repeated shot while the flag frame remains current;
- hidden/appear/fall/disappear lifecycle for Axe, Fork and Knife;
- Piranha/Pirana2 patrol, attack trigger and water-out gravity;
- Blowfish activation, chase, deactivation gravity and sleep completion;
- Bat/DragonFly/Mosquito steering with zero land physics, floor unsnap and the
  Mosquito timer;
- Fish and BigPiranaBlowFish constant-height wall patrol;
- LittleSpider one-second jump and Mouse wall jump;
- VolcanoFlower three-fireball burst fired once, not per frame;
- BigSnake hidden wait, upward emergence, stop and timed aimed shot;
- SideColumn facing/camera gate and single fireball;
- FrontColumn three-angled aimed volley and single `Custom` event;
- Hive four-bee cap and `2-3s` reset.
