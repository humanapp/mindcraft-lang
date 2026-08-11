---
applyTo: "apps/ecosim-rbx/**"
---

<!-- Last reviewed: 2026-08-07 -->

# Ecosim-RBX -- Rules & Patterns

`apps/ecosim-rbx` is a **Roblox (roblox-ts + Rojo)** projection of `apps/ecosim`.
The ecosim webapp is the reference implementation. This app mirrors ecosim's
brain ABI -- tile ids, abi ids, call specs, type system -- so a brain authored
in the ecosim webapp runs here unmodified. The arena world is built entirely
from code; there is no Studio-authored content and no place file in the repo.

The player is not a brain-visible actor. Ecosim has no player sensor, so
creatures perceive the player only through physics: a character can shove a
creature, and the shove shows up as a change in the creature's simulation
position and velocity.

## Tech Stack

roblox-ts 3.0 (TypeScript -> Luau), Rojo 7.4.1 (pinned in the root
`aftman.toml`), `@rbxts/services`, `@rbxts/types`, `@mindcraft-lang/core` via a
`file:` dependency, Biome.

## Mirroring Discipline

Files under `src/server/brain/` are a file-for-file mirror of
`apps/ecosim/src/brain/`, with the same file names and the same exported symbol
names:

```
abi-ids.ts  tileids.ts  type-system.ts  engine-context.ts  brain-context.ts
execution-context-types.ts  migrations.ts  index.ts  archetypes.ts
movement.ts  vision.ts  actor.ts  engine.ts  blip.ts
actions/{see,bump,eat,move,turn,shoot,say,utils}.ts
tiles/{index,literals}.ts
```

Rules:

- **ABI-bearing values never diverge.** Enum values, action keys and ids, tile
  id strings, `callDef` structures, `getSlotId` lookups, and every gameplay
  threshold (nearby 100 px, far away 300 px, vision range and FOV, eat cooldown
  and bite, shoot rates / cost / kickback, quickly and slowly multipliers,
  priority default 0.5, wander expiry, `VISION_PHASES`,
  `MAX_SPAWNS_PER_TICK`, respawn delays, energy configs) are copied exactly.
- `abi-ids.ts` and `tileids.ts` are **byte-identical** to ecosim's. Verify with
  `diff` after touching either side.
- The module id in `index.ts` is `"mindcraft.ecosim"` -- identical to ecosim's,
  because persisted brain JSON references it.
- Registration order in `createEcosimModule` matches ecosim's exactly.
- When ecosim changes an ABI value, change it here in the same slice.

### The parity test

`test/abi-parity.spec.ts` checks the mirror automatically. Run it with
`npm test` in this app after touching any mirrored file or `apps/ecosim`'s brain
module. It runs on Node (`tsx --test`) from `test/`, which sits outside the
`src`-only `tsconfig.json` include, so it never enters the rbxtsc program.

It builds one Mindcraft environment from each app's `createEcosimModule` in a
single process and compares the registered artifacts -- tile catalogs, host
actions and their resolved call-definition slot layouts, the type registry,
host functions, operators, conversions, `migrateBrainJson`, and the three
shipped brain assets deserialized through both -- plus the byte identity of
`abi-ids.ts`, `tileids.ts`, and the brain assets. Comparisons use machine ids
only; labels, sentence language forms, and icon urls are excluded by design, so
the mirror's dropped `iconUrl` is not a failure.

**Mirror edits that keep the parity test green are the definition of done for
an ABI change.** An ABI change in `apps/ecosim` is not finished until this test
passes again.

### The Luau harness

`test-luau/` runs the app's compiled output and `packages/core`'s Roblox target
on [Lune](https://github.com/lune-org/lune), pinned in the root `aftman.toml`.
It sits outside `src/`, so `rbxtsc` never sees it, and it is written in Luau for
Lune -- Biome does not lint `.luau`, so keep it readable and ASCII-only by hand.

```
npm run test:luau    # rebuilds core's rbx target and the app, then runs the harness
```

`test-luau/lib/roblox-env.luau` mounts `packages/core/dist/rbx`, `out/server`,
`out/shared`, and `include/` as a virtual instance tree the way Rojo would, then
loads each emitted module through the real `include/RuntimeLib.lua`, so
`TS.import` and the `_G[script]` handshake are exercised unmodified. The host
half is stubbed in `test-luau/stubs/host.luau`: the mirror's brain closure is
Roblox-instance-free, so only `src/server/world/` needs standing in. The real
`Actor`, `Mover`, and `vision` modules are loaded from `out/` and run unchanged.

What it covers: the three shipped brains deserialized through
`deserializeBrainJsonFromPlain`, 660 scripted frames across four stimulus
windows, and assertions that a bump landed a bite, that a child rule raised a
speech bubble, that vision-gated rules queued steering, and that a plant fired a
blip -- plus zero fiber faults, zero logged errors, and direct sentinels for
each Luau-only core defect found so far.

Run it after **any** change to `packages/core`, and before trusting a Studio
session. The Node suites cannot see this class of defect: `npm test` compares
registrations and never executes brain code, and core's own 1454 tests run on
JavaScript, where module-init cycles are tolerated, element access never becomes
string arithmetic, colon and dot calls are the same thing, and shift counts wrap
instead of flushing to zero.

## Sim Space and Units

The brain-visible world is ecosim's 2D pixel space, not studs:

- `SIM_WORLD_WIDTH = 1600`, `SIM_WORLD_HEIGHT = 1200`, in pixels.
- Simulation x maps to world X; simulation y maps to world Z. The arena is
  centred on the world origin and its ground surface is world Y = 0.
- `STUDS_PER_PIXEL = 1 / 15`. Conversion happens **only** in
  `src/server/world/scale.ts`. No other file multiplies or divides by it.
- Heading is radians with 0 = +x (world +X) and positive values rotating toward
  +y (world +Z), so the facing vector in world space is `(cos h, 0, sin h)`.
  `headingToYaw(h) = -h - pi/2` is the yaw that points a part's front along it.
  The same heading drives the vision cone, the thrust direction, and the part's
  rendered orientation.

### The sprite facade

`src/server/world/sprite.ts` gives each actor a `sprite` object with the surface
ecosim's brain code reads (`x`, `y`, `rotation`, `body`, `setPosition`,
`setRotation`, `setVelocity`), so mirrored expressions such as
`self.sprite.x - target.sprite.x` survive verbatim. Units inside the facade are
Matter units so the reference constants stay unchanged:

- position in pixels;
- rotation in radians, and it is **authoritative simulation state held in the
  facade** -- the part's yaw follows it, never the reverse;
- velocity in pixels per simulation step, one step being 1/60 s. Multiply by
  `PX_PER_STEP_TO_STUDS_PER_SECOND` when touching the part.

`x`, `y`, and `body.velocity` are a snapshot refreshed by `sprite.sync()` at the
top of every `Engine.tick`, and kept current by each write on the facade. The
sync is what makes a player's shove visible to the simulation, so a new
per-frame entry point must call it before anything reads a facade.

`body` is `undefined` after `destroy()`; ecosim code tests that (`see.ts` filters
sightings on it).

### Frame ordering

`Engine.tick(time, dtMs)` is driven from a single `RunService.Heartbeat`
connection and runs, in order: facade sync, `physicsTick` (plant springs),
`tickCount++`, per-actor `tick`, death sweep and respawns, deficit spawning,
`simTime += dt`, energy visuals, blips. Ecosim splits physics and gameplay
across two Matter callbacks; here both phases run inside the same Heartbeat, so
the plant spring integrates once per rendered frame rather than once per physics
sub-step.

## roblox-ts Substitutions

Apply these mechanically when mirroring. See also the Roblox-TS Gotchas section
of `core.instructions.md`.

- `Math.*` -> `math.*`; `Math.PI` -> `math.pi`; two-argument arctangent is
  `math.atan2(y, x)`.
- `Number.POSITIVE_INFINITY` -> `math.huge`.
- `x.toFixed(2)` -> `string.format("%.2f", x)`.
- **`self` is reserved by the compiler.** Every ecosim local or parameter named
  `self` is `selfActor` here.
- **No class getters or setters.** Ecosim's `get simTime()`, `get obstacles()`,
  and the facade's `get x()` are plain fields kept current by their writers;
  `Actor.age` and `Engine.hasLoadedBrains` are methods.
- Arrays: `.length` -> `.size()`, `arr.length = 0` -> `arr.clear()`,
  `arr.splice(i, 1)` -> `arr.remove(i)`. `Set.size` / `Map.size` -> `.size()`.
- No global `Error`: `throw new Error(msg)` -> `throw msg`. `try` / `catch`
  works; `tostring(err)` formats the caught value.
- No `typeof` narrowing: `typeof x === "object"` -> `typeIs(x, "table")`,
  `typeof x === "string"` -> `typeIs(x, "string")`.
- No `null`: `x === null` checks collapse into the `undefined` check.
- No `Symbol.iterator`, no `Array.from(set)`: iterate with `for..of` and push,
  or `break` after the first element.
- No `Array.isArray`: the migration guards are `!== undefined` checks against
  the known JSON shape.
- Strings expose only the Luau library -- `size()`, `sub()`, `find()`,
  `split()`, `format()`. There is no `startsWith`, `indexOf`, or `substring`,
  and `sub` indices are 1-based and inclusive.
- Set, Map, spread, `satisfies`, enums, template literals, `**`, `??`, and `?.`
  all work.
- Luau reserved words cannot be identifiers, and value-level circular imports
  are unsafe. `actor.ts` and `engine.ts` would form one, so the two constants
  they share (`VISION_PHASES`, `MAX_SPAWNS_PER_TICK`) live in
  `engine-constants.ts` and `actor.ts` imports `Engine` as a type only.
- Tile metadata keeps `label` and `language` verbatim and **drops `iconUrl`**:
  there is no UI package on Roblox and the field is optional.

## Roblox-Side Code

`src/server/world/` holds everything that touches Roblox instances, so the
mirror stays free of them:

- `scale.ts` -- the pixel/stud and heading conversions.
- `sprite.ts` -- the `CreatureSprite` facade, the `ActorId` attribute, the
  `EcosimActor` CollectionService tag, and the `Touched` binding.
- `creature.ts` -- builds a creature part. Density is scaled by
  `mass / radius^3` so the three archetypes keep ecosim's 1:5:1 mass ratio;
  `SetNetworkOwner(undefined)` keeps physics server-authoritative.
- `visuals.ts` -- the BillboardGui energy bar and speech bubble.
- `color.ts` -- `heatColor`, ported from ecosim's `src/lib/color.ts`, plus the
  packed-int to `Color3` conversion.
- `arena.ts` -- ground, walls, crates, spawn. The crate rectangles are the
  single source for the rendered parts, the line-of-sight obstacles, and
  `steerAvoidObstacles`.

Bump detection is `part.Touched`: both parts' `ActorId` attributes are resolved
and only actor-to-actor touches reach `Engine.handleActorCollision`. Touches
from walls, ground, and player characters are ignored.

Speech-bubble and eat/shoot cooldowns run off `engine.simTime`, never
`task.delay`, so they stay coherent with the simulation clock.

## Movement

`movement.ts` ports every steering helper exactly -- they are pure math. Only
`Mover.step` is rewritten, preserving the observable envelope: intent blending,
EMA smoothing, and the turning-throttle reduction are identical; heading
integration writes through `sprite.setRotation`; the lateral-damping block and
the max-speed cap are verbatim ports operating on px/step velocity.

Thrust is the one substantive change. Instead of accumulating Matter forces, the
mover accelerates the live velocity toward `maxSpeed * speedMultiplier *
throttle` along the heading and then applies an air-drag decay, both building on
the current velocity so an external shove persists and decays. `step` still
returns `throttle * thrustForce * speedMultiplier`, so `AnimalComp.gameplayTick`
drains energy on ecosim's numbers (carnivore 1.0, herbivore 2.5 energy/s at full
throttle).

`PlantComp`'s damped spring is a verbatim port (k=200, c=12, 4 ms sub-steps,
300 px/s velocity cap) operating in pixels through the facade.

## Deliberately Not Ported

- `spatial-grid.ts` -- `queryVisibleActors` iterates the engine's actor list
  directly. Demo populations are around a dozen actors, so the O(N^2) per phase
  cost is irrelevant; reintroduce a grid only if populations grow.
- `score.ts` -- no score HUD on Roblox.
- All debug drawing: `drawMovementIntent`, `drawVisionCone`, `lerpColor`, the
  grid overlay, `Actor.debugGraphics` / `healthBarGfx` / `lastIntent`.
  `Actor.debugTargetPositions` **is** kept, because sensors write to it.
- `brain/editor/` -- there is no brain editor in this app.
- `Actor.isBeingDragged` -- there is no pointer drag; the player shoves
  creatures physically instead.

## Brain Assets

The three shipped brains live in `src/shared/brains/*.json`, byte-identical
copies of `apps/ecosim/public/assets/brain/defs/*.brain`. They are excluded from
Biome in the app's `biome.json` so formatting cannot alter them. They are
imported as JSON modules (`resolveJsonModule`), which Rojo materialises as
ModuleScripts. Module tables are shared across requires and migrations mutate
what they are given, so `Engine.loadBrains` deep-copies each table before
calling `env.deserializeBrainJsonFromPlain(copy, "ecosim-rbx")`. A brain that
fails to deserialize falls back to `createArchetypeFallbackBrain`.

## Build & Verify

```
npm run build:deps  # builds the local package dependencies, rbx variant included
npm run build       # build:deps, then rbxtsc --type game
npm run watch       # build:deps, then incremental compile alongside `rojo serve`
npm test            # build:deps, then the ABI parity test
npm run test:luau   # rebuilds, then runs the Luau harness on Lune
npm run check       # Biome (lint + format), autofix, over ./src and ./test
npm run check:only  # Biome, read-only -- must print only the summary line
```

`build:deps` runs `scripts/build-packages.js`, which walks this app's `file:`
dependencies and builds each in dependency order. This app declares
`mindcraftBuild.needs: ["rbx"]`, so the driver also runs the `rbx` variant of
every dependency that declares one -- `packages/core`'s `build:rbx`. Consumers
that do not name the variant never build it.

`rbxtsc` type-checks as it compiles, so `npm run build` is the typecheck. Plain
`tsc --noEmit` is not usable: roblox-ts supplies its own lib and transforms.

To produce a place file for inspection, write it **outside the repo**:

```
rojo build default.project.json -o /tmp/ecosim-rbx.rbxlx
```

The compile, `npm test`, and `npm run test:luau` are the automated bar. The
parity test does not execute brain code -- it compares registrations, so it
catches ABI drift; the Luau harness executes it, so it catches emit and
module-init faults. Physics feel, part orientation, and Touched coalescing
remain Studio-only.
