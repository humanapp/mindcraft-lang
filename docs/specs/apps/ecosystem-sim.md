# Ecosystem Sim -- Implementation Spec

## Status

Draft

## Overview

The Ecosystem Sim is a browser-based 2D ecosystem simulation built with Vite, React 19, Phaser 3, and Matter.js physics. It serves as the flagship demo for the Mindcraft brain programming language (implemented in `packages/core`). Users observe and control a top-down world populated by three actor archetypes -- carnivores, herbivores, and plants -- each driven by a user-editable visual brain program. A React sidebar provides live statistics, population controls, and a time-scale slider. A modal brain editor (from `@mindcraft-lang/ui`) lets users visually program each archetype's behavior by placing tiles together forming rules. An integrated docs sidebar provides contextual help for tiles and programming patterns.

The app lives at `apps/sim/` within the `mindcraft-lang` monorepo.

## Product Goals

- Demonstrate that the Mindcraft brain language can drive per-entity AI in a live simulation.
- Let users program predator/prey/plant behaviors through a visual brain editor and immediately see results.
- Provide a legible ecosystem with scoring that rewards balanced predator-prey dynamics.
- Keep the rendering simple (procedural circles, no sprite assets) so the codebase focus stays on mindcraft integration.

## Non-Goals

- No networking or multiplayer.
- No procedural terrain or tile maps.
- No inventory, progression, or save-game systems beyond brain persistence.
- No pathfinding algorithm -- actors use steering behaviors only.

---

## Tech Stack

| Dependency                    | Version                 | Role                                                   |
| ----------------------------- | ----------------------- | ------------------------------------------------------ |
| Vite                          | ^6.3                    | Bundler, dev server, HMR                               |
| React                         | ^19.0                   | UI layer (sidebar, dialogs, brain editor)              |
| React DOM                     | ^19.0                   | DOM rendering                                          |
| Phaser                        | ^3.90                   | Game canvas, scene management, texture generation      |
| Matter.js                     | (bundled with Phaser)   | 2D physics (forces, collisions, bodies)                |
| miniplex                      | ^2.0                    | Lightweight ECS (entity-component-system)              |
| Tailwind CSS                  | ^4.1                    | Utility-first styling                                  |
| @tailwindcss/postcss          | ^4.1                    | PostCSS integration for Tailwind                       |
| @radix-ui/react-dialog        | ^1.1                    | Accessible modal dialog primitive                      |
| @radix-ui/react-dropdown-menu | ^2.1                    | Dropdown menu primitive                                |
| @radix-ui/react-slider        | ^1.3                    | Range slider primitive                                 |
| @radix-ui/react-slot          | ^1.2                    | Composition primitive                                  |
| class-variance-authority      | ^0.7                    | CSS variant composition                                |
| clsx                          | ^2.1                    | Conditional class names                                |
| tailwind-merge                | ^3.4                    | Tailwind class deduplication                           |
| lucide-react                  | ^0.561                  | SVG icon library                                       |
| sonner                        | ^2.0                    | Toast notifications                                    |
| @mindcraft-lang/core          | workspace               | Brain language compiler, runtime, and tile definitions |
| @mindcraft-lang/ui            | workspace (source-only) | Brain editor UI components, shadcn primitives          |
| @mindcraft-lang/docs          | workspace (source-only) | Documentation framework and markdown renderer          |
| Biome                         | 2.3 (dev)               | Linter and formatter                                   |
| TypeScript                    | ~5.7                    | Type checking                                          |
| terser                        | ^5.28 (dev)             | Production minification                                |

## Build and Dev Scripts

```bash
npm run dev          # Vite dev server (port 8080, --force)
npm run build        # Builds packages/core first (prebuild), then Vite prod build
npm run clean        # rm -rf dist && rm -rf node_modules/.vite
npm run check        # Biome lint + format (auto-fix)
```

The dev server watches `packages/core` ESM output for live reload. The prod build splits Phaser into a separate chunk and minifies with Terser (2-pass, mangle enabled).

---

## Architecture

### Directory Layout

```
apps/sim/
  index.html                     # SPA entry point
  biome.json                     # Biome config (120 char, 2-space indent)
  postcss.config.js              # Tailwind PostCSS plugin
  vite/
    config.dev.mjs               # Dev server config (port 8080, aliases, HMR)
    config.prod.mjs              # Prod build config (Terser, manual chunks, dedup)
  public/
    assets/
      brain/
        defs/
          default-carnivore.brain   # Pre-built default brain (binary)
          default-herbivore.brain
          default-plant.brain
      favicon.png
  src/
    main.tsx                     # React entry; routes /docs -> DocsPage, else -> App
    App.tsx                      # Root layout: game canvas + sidebar + editor dialog
    PhaserGame.tsx               # React <-> Phaser bridge (refs, lifecycle, callbacks)
    bootstrap.ts                 # Side-effect: logger, brain registration, tile visuals
    brain-editor-config.tsx      # BrainEditorConfig factory + Vector2 custom literal
    DocsPage.tsx                 # Standalone /docs page wrapper
    globals.css                  # Tailwind imports, OKLch theme tokens, scrollbar styles
    vite-env.d.ts                # Vite client types

    brain/                       # Simulation engine layer
      index.ts                   # Barrel: registerBrainComponents()
      actor.ts                   # Actor class (entity with brain, mover, vision, queues)
      archetypes.ts              # Static config for carnivore/herbivore/plant
      engine.ts                  # Engine class (ECS world, tick loop, spawning, collisions)
      execution-context-types.ts # Type guards for Actor in ExecutionContext
      movement.ts                # Mover class + steering behaviors (Matter.js locomotion)
      vision.ts                  # Cone-based vision queries with LOS checks
      spatial-grid.ts            # Uniform grid for O(K) proximity queries
      score.ts                   # ScoreTracker class + ScoreSnapshot type
      blip.ts                    # Pooled projectile system
      tileids.ts                 # Centralized tile ID string constants
      type-system.ts             # App-specific types: ActorRef, Vector2
      fns/                       # Host function implementations
        index.ts                 # Barrel: registerFns()
        utils.ts                 # Target resolution helpers
        action-def.ts            # ActionDef type (shared by actuators/sensors)
        actuators/
          move.ts                # Steering: forward, toward, away, avoid, wander
          eat.ts                 # Energy transfer with cooldown and diet rules
          say.ts                 # Chat bubble display
          turn.ts                # Rotation: toward, away, compass, spin
          shoot.ts               # Blip projectile with recoil and energy cost
        sensors/
          bump.ts                # Collision event with archetype filter
          see.ts                 # Vision query with distance/archetype filters
      tiles/                     # Tile definitions and visual config
        index.ts                 # Barrel: registerTiles()
        types.ts                 # TileVisual, TileColorDef types
        actuators.ts             # Actuator tile registration
        sensors.ts               # Sensor tile registration
        modifiers.ts             # Modifier tile registration (18 tiles)
        parameters.ts            # Parameter tile registration (5 tiles)
        accessors.ts             # Accessor tile registration (5 tiles)
        literals.ts              # Literal tile registration ("me", "it")
        variables.ts             # Variable factory tile registration (Vector2, ActorRef)
        tile-colors.ts           # Tile kind -> color mapping
        tile-visuals.ts          # Tile ID -> visual (label, icon) mapping
        visual-provider.ts       # genVisualForTile() assembler
        data-type-icons.ts       # Type ID -> SVG icon + display name maps

    game/                        # Phaser game layer
      main.ts                    # Phaser Game config factory (1024x768, Matter, FIT scaling)
      scenes/
        Boot.ts                  # Minimal boot -> starts Preloader
        Preloader.ts             # Loads .brain assets, progress bar, starts Playground
        Playground.ts            # Main scene: spawning, rendering, collisions, input

    services/
      index.ts                   # Barrel exports
      brain-persistence.ts       # Save/load brain defs (binary + base64, localStorage)

    lib/
      color.ts                   # heatColor(), energyTint(), color space helpers

    components/
      Sidebar.tsx                # Dashboard: stats, time slider, population, edit buttons

    docs/
      docs-registry.ts           # Builds docs registry from manifest + globbed markdown
      manifest.ts                # Metadata for all tile/pattern docs
      content/en/
        tiles/                   # Per-tile markdown docs (see.md, move.md, etc.)
        patterns/                # Pattern docs (flee-predator.md, hunt-and-eat.md, etc.)
```

### Path Aliases

- `@/*` -> `./src/*` (tsconfig + Vite alias)
- `@mindcraft-lang/ui` -> `../../packages/ui/src` (source-only, no build step)
- `@mindcraft-lang/docs` -> `../../packages/docs/src` (source-only, no build step)

### Module Dependency Flow

```
main.tsx
  |-- bootstrap.ts (side-effect: registers core + app brain components)
  |-- App.tsx
  |     |-- PhaserGame.tsx -> game/main.ts -> scenes/Boot -> Preloader -> Playground
  |     |-- components/Sidebar.tsx
  |     |-- brain-editor-config.tsx -> @mindcraft-lang/ui (BrainEditorDialog)
  |     |-- docs integration -> @mindcraft-lang/docs (DocsSidebar)
  |-- DocsPage.tsx (alternate route: /docs/*)
```

### React <-> Phaser Bridge

The `PhaserGame` component creates the Phaser game instance in a `useLayoutEffect` and registers a `SCENE_READY_KEY` callback in Phaser's registry. When the Playground scene initializes, it invokes this callback, passing a reference to itself back to React. App.tsx then holds this scene reference in state and uses it to:

- Call `scene.setTimeSpeed(speed)` when the time slider changes
- Call `scene.getBrainDef(archetype)` / `scene.updateBrainDef(archetype, def)` for brain editing
- Call `scene.setDesiredCount(archetype, count)` for population sliders
- Call `scene.toggleDebugMode()` for debug visualization
- Poll `scene.getScoreSnapshot()` every 250ms with dedup logic

Communication is unidirectional: React calls methods on the Playground scene. The scene never pushes state to React.

---

## Core Package Integration

The sim app depends on `@mindcraft-lang/core` for the brain language runtime. This section describes the integration surface.

### Initialization

At app startup, `bootstrap.ts` runs:

1. `registerCoreBrainComponents()` -- registers core types (Number, String, Boolean), operators (+, -, \*, /, comparisons), core sensors (OnPageEntered, Timeout), core actuators (SwitchPage), and core tile definitions.
2. `registerBrainComponents()` -- registers the sim app's custom types (Vector2, ActorRef), host functions (Move, Eat, Say, Turn, Shoot, Bump, See), and tile definitions (modifiers, parameters, accessors, literals, variable factories).
3. Registers `genVisualForTile()` as the tile visual provider for the brain editor UI.

### Brain Lifecycle

Each actor owns a compiled `IBrain` instance:

1. **Compile**: `BrainDef.compile()` produces an `IBrain` from the tile-based program definition.
2. **Initialize**: `brain.initialize(actor)` attaches the actor as `ctx.data` so host functions can access the entity.
3. **Startup**: `brain.startup()` activates the first page.
4. **Think**: `brain.think(simTime)` is called each tick. The brain VM evaluates rules on the active page. When a sensor condition (When-side) is true, the corresponding actuators (Do-side) execute, queuing steering commands or triggering effects.
5. **Shutdown**: `brain.shutdown()` on actor death.

### Host Function Contract

Host functions receive `(ctx: ExecutionContext, args: MapValue) -> Value`:

- `ctx.data` is the executing `Actor` instance.
- `args` is a map of slot IDs to argument values, populated from parameter and modifier tiles attached to the action tile.
- Functions can access per-call-site persistent state via `getCallSiteState(ctx)` / `setCallSiteState(ctx, state)` for cooldowns, wander targets, and memory.
- Rule-scoped variables (e.g., `targetActor`, `targetPos`, `targetPositions`) are set by sensors and consumed by downstream actuators within the same rule.

### BrainEditorConfig

The brain editor UI (`@mindcraft-lang/ui`) is decoupled from app-specific data via a config object built by `brain-editor-config.tsx`:

- `dataTypeIcons`: maps type IDs to SVG icon paths (Boolean, Number, String, Vector2, ActorRef)
- `dataTypeNames`: maps type IDs to display names ("boolean", "number", "text", "vec2", "actor")
- `isAppVariableFactoryTileId`: predicate identifying app-specific variable factory tiles
- `customLiteralTypes`: array containing the Vector2 custom literal type (X/Y number inputs, validation, parsing)
- `getDefaultBrain()`: loads default brain from localStorage or pre-loaded `.brain` asset

---

## Simulation Spec

### World

- Canvas: 1024x768 pixels, dark blue background (#2d3561)
- Scale mode: `FIT` with `CENTER_BOTH` (responsive, maintains aspect ratio)
- Physics: Matter.js with zero gravity (top-down 2D)
- World bounds: 32px wall margin on all 4 sides (static boundary bodies)
- 4 randomly placed rectangular obstacles (30-120px each dimension, brown at 80% opacity)

### Collision Categories

Three bitmask categories control what collides with what:

| Category | Value  | Collides With     |
| -------- | ------ | ----------------- |
| WALL     | 0x0001 | ACTOR, BLIP       |
| ACTOR    | 0x0002 | WALL, ACTOR, BLIP |
| BLIP     | 0x0004 | WALL, ACTOR       |

### Entity-Component-System

The simulation uses miniplex as a lightweight ECS. The `Actor` class itself is the entity. Each actor has:

- `archetype`: "carnivore" | "herbivore" | "plant"
- `brain`: compiled IBrain instance
- `mover`: Mover instance for locomotion
- `sprite`: Phaser.Physics.Matter.Sprite (circular physics body)
- `energy` / `maxEnergy` / `bornAt`
- `hasVision` / `visionRange` / `visionFOV`
- `bumpQueue`: Set of actor IDs collided with this tick
- `sightQueue`: array of SightResult (visible actors from last vision check)
- `animalComp` (carnivore/herbivore) or `plantComp` (plant)

The engine creates typed queries for each archetype: `world.where(a => a.archetype === "carnivore")` etc.

### Archetypes

#### Carnivore (color: 0xe63946, red)

| Property             | Value                                               |
| -------------------- | --------------------------------------------------- |
| Physics radius       | 15px, scale 0.95                                    |
| Mass                 | 1                                                   |
| Friction air         | 0.08                                                |
| Restitution          | 0.3                                                 |
| Max turn rate        | 7.0 rad/sec                                         |
| Thrust force         | 0.002                                               |
| Max speed            | 2 px/sec                                            |
| Forward-when-turning | 0.25 (heavy penalty)                                |
| Smoothing Hz         | 12                                                  |
| Lateral damping      | 0.92                                                |
| Weight exponent      | 2                                                   |
| Max energy           | 100                                                 |
| Initial energy       | 80                                                  |
| Regen rate           | 0 (must hunt)                                       |
| Decay rate           | 4 energy/sec                                        |
| Movement cost        | 500 per force unit (~1 energy/sec at full throttle) |
| Prey                 | ["herbivore"]                                       |
| Vision range         | 600px                                               |
| Vision half-FOV      | pi \* 0.65 (~234 deg total)                         |
| Initial spawn count  | 2                                                   |
| Respawn delay        | 8000ms                                              |

#### Herbivore (color: 0xf4a261, orange)

| Property             | Value                               |
| -------------------- | ----------------------------------- |
| Physics radius       | 15px, scale 1.0                     |
| Mass                 | 5 (heavier)                         |
| Friction air         | 0.1                                 |
| Restitution          | 0.2                                 |
| Max turn rate        | 5.0 rad/sec                         |
| Thrust force         | 0.01 (5x carnivore)                 |
| Max speed            | 5 px/sec (2.5x carnivore)           |
| Forward-when-turning | 0.45 (less penalty)                 |
| Smoothing Hz         | 12                                  |
| Lateral damping      | 0.92                                |
| Max energy           | 100                                 |
| Initial energy       | 80                                  |
| Regen rate           | 0                                   |
| Decay rate           | 1 energy/sec (4x slower starvation) |
| Movement cost        | 250 per force unit                  |
| Prey                 | ["plant"]                           |
| Vision range         | 600px                               |
| Vision half-FOV      | pi \* 0.65                          |
| Initial spawn count  | 5                                   |
| Respawn delay        | 6000ms                              |

#### Plant (color: 0x52b788, green)

| Property            | Value                                       |
| ------------------- | ------------------------------------------- |
| Physics radius      | 15px, scale 0.5 (half size)                 |
| Mass                | 1                                           |
| Friction air        | 0.2                                         |
| Restitution         | 0.5                                         |
| Movement            | ALL ZEROS (immobile)                        |
| Max energy          | 100                                         |
| Initial energy      | 60                                          |
| Regen rate          | 2 energy/sec (photosynthesis)               |
| Decay rate          | 0                                           |
| Movement cost       | 0                                           |
| Prey                | []                                          |
| Vision range        | 600px                                       |
| Vision half-FOV     | pi (360 deg omnidirectional)                |
| Initial spawn count | 5                                           |
| Respawn delay       | 4000ms                                      |
| Special physics     | Damped harmonic spring anchor (k=200, c=12) |

### Actor Rendering

All actor textures are procedurally generated via Phaser Graphics (no image assets):

- **Carnivore/Herbivore**: Filled circle in archetype color + two white eye circles near the front + two black pupils (1.5px radius) inside the eyes. Pupils animate to track gaze direction (smoothed turn intent).
- **Plant**: Filled circle in archetype color, no eyes.
- Each archetype's texture is generated once and shared across all instances.

Additional per-actor visuals:

- **Health bar**: 26x4px bar floating 5px above actor. Background: dark gray (0x222222, 75% alpha). Fill color interpolated via `heatColor(1 - energyRatio)`: green (full) -> yellow (half) -> red (empty). Fill width proportional to energy ratio. Redrawn every frame.
- **Energy tint**: Sprite tint shifts from white (full energy) to dark gray (0x444444, zero energy) via `energyTint()`.
- **Chat bubble**: White rounded-rect with text + triangle pointer below. Positioned above sprite. Auto-dismisses after 5 seconds (or custom duration). Triggered by the Say actuator.

### Tick Loop

The engine tick runs each frame with time scaled by the UI's time-speed slider:

```
Engine.tick(time, scaledDelta):
  1. Rebuild spatial grid (clear + re-insert all actors, O(N))
  2. Increment tickCount (monotonic, for vision phase staggering)
  3. For each actor, call actor.tick(time, dt):
     a. Update energy: apply passive regen/decay based on archetype rates
     b. Vision check (IF tickCount % VISION_PHASES === actorId % VISION_PHASES):
        Run queryVisibleActors() -> populate sightQueue
     c. brain.think(simTime): execute brain VM -> sensors read queues,
        actuators queue steering/effects
     d. Inject obstacle-avoidance steering (animals only)
     e. Component tick:
        - AnimalComp: Mover.step(steeringQueue) -> apply forces
        - PlantComp: spring oscillator tick
     f. Clear bumpQueue and sightQueue
  4. Death detection: snapshot entities, remove those with energy <= 0,
     record death stats, schedule respawns
  5. Process respawn queue: fire delayed respawns after archetype's respawnDelay
  6. Immediate spawn: if archetype below desired count and no pending
     respawns cover deficit, spawn up to MAX_SPAWNS_PER_TICK (3)
  7. Score tracker update: tally alive counts, energy sums, elapsed time
  8. Blip tick: expire blips older than BLIP_MAX_LIFETIME_MS (3000ms)
```

After `engine.tick()`, the Playground scene calls:

- `engine.updateEnergyVisuals()` -- redraws all health bars
- `engine.drawDebugVisionCones()` -- renders debug overlays if enabled

### Vision System

Cone-based sight with line-of-sight occlusion:

1. **Spatial grid acceleration**: World divided into 150px cells. `rebuild()` called each tick. Vision queries iterate only cells overlapping the vision circle.
2. **Per-candidate checks** (in order):
   - Distance: squared distance <= range squared
   - Cone: `dot(facing, directionToTarget) >= cos(halfAngle)`
   - Line-of-sight: parametric ray-AABB slab intersection against precomputed obstacle bounds. If any obstacle blocks the ray, the target is not visible.
3. **Phase staggering**: `VISION_PHASES = 3`. Actor i runs vision on ticks where `tickCount % 3 === i % 3`. At 60fps, each actor refreshes vision every ~50ms.
4. **Output**: Unsorted array of `SightResult { actor, distanceSq }`.

### Steering and Movement

The `Mover` class implements a blended steering system on top of Matter.js:

**Per-frame step:**

1. Collect all steering contributions queued by the brain this tick.
2. **Arbitrate**: If any contribution is `exclusive`, pick the highest-weight exclusive. Otherwise, blend all contributions using exponentiated weights (`weight^weightExponent`, default exponent=2, so priority 10 vs 0.5 gives ~400:1 influence).
3. **Smooth**: Apply EMA filter (cutoff frequency = smoothingHz) to reduce jitter.
4. **Throttle reduction**: `throttle *= lerp(1.0, forwardWhenTurning, |turn|)` -- turning hard reduces forward thrust.
5. **Speed modifier**: Apply `quickly`/`slowly` multiplier.
6. **Set rotation**: `sprite.rotation += turn * maxTurnRate * speedMul * dt`.
7. **Apply thrust**: Force along heading direction.
8. **Lateral damping**: Decompose velocity into forward/lateral components, dampen lateral by `lateralDamping` factor. Prevents sideways sliding.
9. **Max speed cap**: Clamp velocity magnitude.
10. **Return applied force** (used for energy cost calculation by AnimalComp).

**Built-in steering behaviors** (called by brain actuators):

| Function                                       | Behavior                                      |
| ---------------------------------------------- | --------------------------------------------- |
| steerToward(target, weight)                    | Face and move toward position                 |
| steerAwayFrom(target, weight)                  | Face and move away from position              |
| steerAvoid(target, weight)                     | Soft avoidance with ramp (inner/outer radius) |
| steerAvoidObstacles(obstacles, worldW, worldH) | Repulsion from AABBs + world walls            |
| steerForward(weight, speedMul)                 | Move along current heading                    |
| turnToward(target, weight)                     | Face target, no forward movement              |
| turnAwayFrom(target, weight)                   | Face away from target, no forward movement    |
| turnToAngle(angle, weight)                     | Face compass direction, no forward movement   |

**Obstacle avoidance** is injected automatically for all animals each tick (independent of brain), using accumulated repulsion vectors from nearby AABB edges and world walls.

### Blip System (Projectiles)

Blips are fast, pooled projectiles fired by the Shoot actuator.

| Constant             | Value     |
| -------------------- | --------- |
| BLIP_DAMAGE          | 10 energy |
| BLIP_SPEED           | 6 px/sec  |
| BLIP_RADIUS          | 4px       |
| BLIP_MAX_LIFETIME_MS | 3000ms    |
| MAX_ACTIVE_BLIPS     | 2000      |

**BlipPool**: Fixed-capacity object pool. Sprites are created once and toggled active/inactive via visibility and collision filter changes. `acquire()` pulls from a free list or allocates (up to cap). `release()` hides sprite, disables body, returns slot.

**Lifecycle**: Brain calls shoot -> engine spawns blip at actor position with velocity along facing or toward target -> blip travels straight -> on collision with actor (not shooter), drains BLIP_DAMAGE energy and releases to pool -> on collision with wall, releases to pool -> if lifetime exceeded, releases to pool.

**Recoil**: Shooting applies a backwards impulse of `1.5 / body.mass` to the shooter. For plants, this routes through the spring integrator.

### Scoring

**Per-archetype stats tracked:**

- `deaths`: total actors killed
- `totalLifespan`: sum of lifespans (for averaging)
- `longestLife`: record longest-lived actor
- `aliveCount`: current population
- `totalEnergy`: sum of current energy across living actors

**Ecosystem score**: Geometric mean of animal average lifespans:

```
sqrt((avgCarnivoreLifespan + 1) * (avgHerbivoreLifespan + 1)) - 1
```

Plants are excluded (passive regen makes their lifespans incomparable). The score rewards both predator AND prey thriving together -- true ecosystem health.

**ScoreSnapshot** emitted each tick contains per-archetype stats, the ecosystem score, and elapsed simulation time.

### Population Management

- `desiredCounts` per archetype stored in Engine, synced to/from localStorage.
- UI population sliders (0-100 range) update desired counts with 200ms debounce.
- When an actor dies, a respawn is scheduled after the archetype's `respawnDelay`.
- If population is below target and no pending respawns cover the deficit, up to `MAX_SPAWNS_PER_TICK = 3` actors are spawned immediately.
- Spawn positions are chosen randomly, avoiding overlap with obstacles.

### Energy System

| Mechanic      | Implementation                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Passive regen | `energy += regenRate * dt` (plants only)                                                                                                                       |
| Passive decay | `energy -= decayRate * dt` (animals only)                                                                                                                      |
| Movement cost | `energy -= appliedForce * movementCostPerForce * dt`                                                                                                           |
| Eating        | Target loses up to 30 HP (BITE_ENERGY). Eater gains what was drained. 1-second cooldown. Diet rules enforced (carnivore eats herbivore, herbivore eats plant). |
| Being shot    | `drainEnergy(BLIP_DAMAGE)` -- lose 10 energy                                                                                                                   |
| Shooting cost | Shooter loses 5 energy (SHOOT_ENERGY_COST)                                                                                                                     |
| Death         | Energy <= 0: actor marked as dying, removed from world, stats recorded, respawn scheduled                                                                      |
| Cap           | Energy capped at maxEnergy on gain                                                                                                                             |

---

## Host Functions

### Actuators

#### Move

Queues steering commands for locomotion. Direction selected by modifier tiles:

| Modifier          | Behavior                                                                          |
| ----------------- | --------------------------------------------------------------------------------- |
| Forward           | Move along current heading                                                        |
| Toward [target]   | Steer toward target position                                                      |
| AwayFrom [target] | Steer away; prefers center-of-mass of 2 nearest targets from targetPositions list |
| Avoid [target]    | Soft avoidance with inner/outer radius ramp                                       |
| Wander            | Random target that persists 2-7 seconds, then re-picks                            |
| (none)            | Defaults to Wander                                                                |

Parameters: `Priority` (weight in steering blend, default 0.5). Speed modifiers: `Quickly` (stackable 0-3x, 50% boost per) / `Slowly` (stackable 0-3x, 50% reduction per). Returns void.

#### Eat

Attempts to consume a target actor. Resolves target from explicit argument, or rule's `targetActor` variable. Checks diet rules (predator's prey list must include target archetype). Transfers up to 30 energy on 1-second cooldown. Returns Boolean (success/failure).

#### Say

Displays a chat bubble above the actor. Takes an optional text string and optional duration (seconds, default 5). Returns void.

#### Turn

Queues rotation steering without forward movement. Direction options:

| Modifier                    | Behavior                                                          |
| --------------------------- | ----------------------------------------------------------------- |
| Toward [target]             | Face target position                                              |
| AwayFrom [target]           | Face away from target                                             |
| Around                      | 180-degree turn from current facing                               |
| Left / Right                | Pure rotation (clockwise/counter-clockwise)                       |
| North / South / East / West | Face compass direction (North=-pi/2, East=0, South=pi/2, West=pi) |
| (none)                      | Continuous clockwise spin                                         |

Parameters: Priority, Quickly/Slowly. Returns void.

#### Shoot

Fires a blip projectile. Checks rate-based cooldown (default 2/sec, configurable 0-5 via Rate parameter). Costs 5 energy. Direction: toward target if specified, else along facing. Applies recoil impulse. Returns Boolean (success/failure: rate limit, insufficient energy, or blip cap reached).

### Sensors

#### Bump

Fires when the actor's bumpQueue is non-empty (collision occurred this tick). Optional archetype filter modifier (Carnivore/Herbivore/Plant). Sets rule variable `targetActor` to the first matching bumped actor. Returns Boolean. Provides TargetActor capability to downstream tiles.

#### See

Fires when the actor's sightQueue contains matching entries (visible actors from last vision check). Optional archetype filter modifier and optional distance filter (Nearby: 0-3x repetition narrows threshold from 100px down; FarAway: 0-3x repetition expands threshold from 300px up).

Finds nearest matching actor. Maintains memory of last-seen actor for 0.5-2.5 seconds (random window). Sets rule variables:

- `targetActor`: nearest seen actor ID
- `targetPos`: nearest seen actor position
- `targetActors`: list of all matching actor IDs
- `targetPositions`: list of all matching actor positions

Returns Boolean. Provides TargetActor capability.

---

## Tile Manifest

### Actuator Tiles (5)

Move, Eat, Say, Turn, Shoot

### Sensor Tiles (2)

Bump, See

### Modifier Tiles (22)

**Movement direction**: Forward, Toward, AwayFrom, Avoid, Wander, TurnAround, TurnLeft, TurnRight, DirectionNorth, DirectionSouth, DirectionEast, DirectionWest

**Actor kind filter**: Carnivore, Herbivore, Plant

**Distance filter**: Nearby, FarAway

**Speed**: Quickly, Slowly

**Time units**: Milliseconds, Seconds

### Parameter Tiles (5)

AnonymousActorRef (hidden), DelayMs, Duration, Priority, Rate

### Literal Tiles (2)

- `me` -- returns the executing actor as ActorRef
- `it` -- returns the rule's target actor (requires TargetActor capability from Bump/See sensor)

### Variable Factory Tiles (2)

Vector2 (user-creatable), ActorRef (user-creatable)

### Accessor Tiles (5)

**Vector2 fields**: x (Number), y (Number)

**ActorRef fields**: id (Number, read-only), position (Vector2), energy pct (Number, read-only)

---

## Custom Type System

### Vector2

Struct type with fields `x: Number`, `y: Number`. Represents world positions. Used as move targets, accessor results, and variable type.

Conversions: Vector2 -> String yields "(x.xx, y.yy)".

Custom literal editor in brain editor: two number input fields in a grid, validation (both non-empty, valid floats), creates `new Vector2(x, y)`.

### ActorRef

Struct type with fields `id: Number`, `position: Vector2`, `energy pct: Number`. References another actor in the world.

Can be backed by either:

- **Function resolver**: lazy, always resolves to current actor state
- **Direct reference**: snapshot at assignment time

Conversions: ActorRef -> Number yields actor ID (or 0). ActorRef -> Vector2 yields position (or origin).

---

## Brain Persistence

Brain programs are saved per-archetype to localStorage.

**Storage key format**: `brain-archetype-{archetype}` (e.g., `brain-archetype-carnivore`)

**Serialization**: `BrainDef.serialize(MemoryStream)` produces compact binary -> encoded as base64 for localStorage. Legacy JSON format detected and supported for reading (first byte 0x7B = '{').

**Load chain**: localStorage -> pre-loaded `.brain` asset from Preloader -> empty BrainDef fallback.

---

## UI Layer

### App Layout

Full-height flex container with dark background:

```
+----------------------------------------------+------------+
|                                               |            |
|            Phaser Game Canvas                 |  Sidebar   |
|            (flex-1, min-w-0)                  |  (w-64)    |
|                                               |            |
+----------------------------------------------+------------+

[BrainEditorDialog -- modal overlay at root level]
[DocsSidebar -- fixed overlay on right side]
[Toaster -- notification popups]
```

On mobile (below md breakpoint): Sidebar is a fixed right-side panel (z-50) with slide animation. Toggle button overlays the game canvas. Backdrop overlay (z-40) closes sidebar on tap.

### Sidebar Content

Top to bottom:

1. **Toolbar**: Docs toggle button (BookOpen icon)
2. **Header**: "Dashboard" title + ecosystem score display
3. **Time Scale**: Slider 0-2x (0.1 steps) with current multiplier label
4. **Per-Archetype Sections** (carnivore, herbivore, plant):
   - Colored icon + label + alive count
   - Stats grid (3 columns): avg lifespan (sec), best lifespan, avg energy
   - Population slider (0-100, 200ms debounce)
   - "Edit Brain" button
5. **Footer Stats**: Elapsed time (M:SS format), total death count
6. **Toggle Debug** button
7. **GitHub link** (pinned to bottom)

### Brain Editor Dialog

Opens as a modal overlay when "Edit Brain" is clicked for an archetype. Uses `BrainEditorDialog` from `@mindcraft-lang/ui`, configured via `BrainEditorConfig`. The editor displays the full brain program as pages of rules, each rule having When-side (sensors/conditions) and Do-side (actuators/actions) tiles. Users drag tiles from a picker, snap them together, set parameters, and see changes reflected immediately in the simulation.

### Score Snapshot Polling

App.tsx polls `scene.getScoreSnapshot()` every 250ms. Uses smart dedup: only triggers React re-render if any rounded display value differs from the previous snapshot (comparing formatted strings for avg lifespan, best life, avg energy per archetype, plus alive counts, deaths, elapsed time, and ecosystem score).

### Theme

OKLch color space tokens for light/dark modes. Key tokens: background, foreground, primary, secondary, muted, accent, destructive, border, plus 5 chart colors. Font: Roboto Mono with system monospace fallbacks. Border radius: 0.5rem.

---

## Docs Integration

### Routing

`main.tsx` checks the URL path. If it starts with `/docs`, the standalone `DocsPage` component renders instead of the simulation `App`. URL pattern: `/docs/{tab}/{entryKey}` (e.g., `/docs/tiles/see`).

### Docs Registry

`docs-registry.ts` uses Vite's `import.meta.glob()` to eagerly load all markdown files from `content/en/tiles/` and `content/en/patterns/`. A manifest (`manifest.ts`) maps tile IDs and pattern IDs to content keys. The `buildDocsRegistry()` factory from `@mindcraft-lang/docs` merges app-specific docs with core docs.

### Docs Sidebar

The `DocsSidebarProvider` context manages sidebar visibility, active tab, and navigation state. The BookOpen button in the Sidebar toolbar toggles it. The sidebar renders as a fixed overlay on the right side of the screen.

### Brain Editor Integration

Two connection points:

1. **Tile help (right-click)**: The brain editor config includes `onTileHelp` callback. Right-clicking a tile and selecting "Help" opens the docs sidebar to that tile's documentation page.
2. **Docs toggle in editor toolbar**: `docsIntegration: { isOpen, toggle, close }` adds a docs toggle button to the brain editor toolbar and auto-closes docs when the editor dialog closes.

### Content Format

Markdown files support:

- ` ```brain ` fences that render visual tile/rule blocks
- `` `tile:tile.op->add` `` inline syntax for tile chips
- `` `tag:Operator;color:#FFE500` `` for colored badges

---

## Debug Visualization

When debug mode is toggled:

- **Vision cones**: Filled wedge from each actor's position spanning their FOV arc (20-point arc approximation), colored per archetype.
- **Movement intent arrows**: Arrow from Actor showing desired heading and throttle magnitude. Arrow length scales with `throttle * speedMultiplier`. Color: red if slowed, cyan if quickened. Arc indicator for turn direction/magnitude.
- **Spatial grid heatmap**: Cell density overlay with `heatColor(count / maxCount)`. White grid lines at 12% opacity.
- **Matter.js debug**: Physics body outlines when Phaser debug rendering is enabled.

---

## Implementation Phases

Each phase produces a working, verifiable artifact. Phases are sequential unless noted. Present each completed phase for review before proceeding.

### Phase 1: Project Scaffolding

**Goal**: Empty Vite + React + Phaser app that renders a canvas with a dark background.

**Deliverables**:

- Vite config (dev + prod) with React plugin, path aliases (`@/*`, `@mindcraft-lang/ui`, `@mindcraft-lang/docs`)
- `index.html` with `#root` div
- `main.tsx` rendering an `App` component
- `globals.css` with Tailwind imports and OKLch theme tokens
- `postcss.config.js` with Tailwind plugin
- `biome.json` configured (120 char, 2-space indent)
- `PhaserGame.tsx` creating a Phaser game instance (1024x768, Matter.js, FIT scaling, dark blue background)
- Boot scene that transitions to an empty Playground scene
- App.tsx layout: game canvas fills available space
- `package.json` with all dependencies and scripts

**Verification**:

- `npm run dev` starts without errors
- Canvas renders at correct resolution with dark blue background
- Resizing the browser window scales the canvas proportionally
- `npm run check` passes (Biome)
- `npm run build` succeeds

### Phase 2: Simulation Engine Foundation

**Goal**: Actors spawn, tick, and move in the physics world with configurable archetypes but no brain integration.

**Deliverables**:

- `archetypes.ts` with all three archetype configs (physics, mover, energy, vision, spawn counts)
- `actor.ts` with Actor class: sprite creation, energy system (regen/decay), health bar rendering, death detection. Brain-related fields exist as stubs (no brain compilation yet).
- `movement.ts` with Mover class: full steering arbitration, force application, lateral damping, speed capping. Include all steering behavior functions (steerToward, steerAwayFrom, steerAvoid, steerAvoidObstacles, steerForward, turnToward, turnAwayFrom, turnToAngle).
- `engine.ts` with Engine class: miniplex ECS world, typed archetype queries, tick loop (energy update, mover step, death/respawn), spawn/kill lifecycle, desired count management, obstacle avoidance injection.
- `spatial-grid.ts` with SpatialGrid: 150px cells, clear/insert/rebuild.
- `score.ts` with ScoreTracker: per-archetype stats, ecosystem score formula, snapshot emission.
- Playground scene: random obstacle generation (4 obstacles), collision category setup, dynamic texture generation (circles + eyes), actor spawning, collision events (actor-actor bump queuing), calling engine.tick() each frame, energy visual updates.
- `lib/color.ts` with heatColor() and energyTint().

**Verification**:

- Actors spawn as colored circles (red carnivores, orange herbivores, green plants)
- Herbivores/carnivores have animated eyes
- Plants are half-size with no eyes
- Actors with no brain wander randomly or stand still
- Energy bars render above each actor (green -> yellow -> red)
- Actors die when energy hits zero (carnivores starve first due to decay rate 4)
- Dead actors respawn after their archetype's respawn delay
- Obstacles render as brown rectangles; actors collide with them and walls
- Score tracking produces valid snapshots

### Phase 3: Brain Integration -- Core + Custom Types

**Goal**: Brain language runtime boots, actors execute brain programs, but only core tiles work (no app-specific sensors/actuators yet).

**Deliverables**:

- `bootstrap.ts`: calls `registerCoreBrainComponents()`, registers tile visual provider
- `type-system.ts`: Vector2 and ActorRef struct types with field getters, assignment overloads, conversions (ActorRef->Number, ActorRef->Vector2, Vector2->String)
- `execution-context-types.ts`: type guards `hasActorData()`, `getSelf()`, `getActor()`, `getTargetActor()`
- `tileids.ts`: all tile ID string constants
- Actor class: compile BrainDef, initialize brain with actor as ctx.data, call brain.think() each tick, brain.shutdown() on death
- `brain/index.ts` barrel: `registerBrainComponents()` calling registerFns() then registerTiles()
- Brain compiles and runs core tiles (OnPageEntered, Timeout, SwitchPage) on actors

**Verification**:

- `registerCoreBrainComponents()` and `registerBrainComponents()` complete without errors
- An actor given a brain with an OnPageEntered sensor + SwitchPage actuator correctly switches pages
- An actor given a Timeout sensor triggers after the specified delay
- Actor type guards correctly extract Actor from ExecutionContext
- Vector2 and ActorRef types resolve fields correctly

### Phase 4: Sensors -- Bump and See

**Goal**: Actors can sense their environment through collision and vision.

**Deliverables**:

- `vision.ts`: cone-based visibility queries with spatial grid acceleration and AABB ray-cast LOS checks
- `brain/fns/sensors/bump.ts`: Bump sensor with archetype filter, targetActor variable setting, TargetActor capability
- `brain/fns/sensors/see.ts`: See sensor with archetype filter, Nearby/FarAway distance filters (stackable), nearest-actor selection, last-seen memory (0.5-2.5s window), rule variable setting (targetActor, targetPos, targetActors, targetPositions)
- `brain/fns/utils.ts`: resolveTargetPosition(), resolveTargetActor(), resolveAwayFromTarget()
- `brain/fns/action-def.ts`: ActionDef type
- Sensor tile registrations in `tiles/sensors.ts`
- Actor vision phase staggering in engine tick (VISION_PHASES=3)

**Verification**:

- Bump sensor fires when two actors collide; archetype filter works correctly
- See sensor detects visible actors within range and FOV
- See sensor respects LOS -- actors behind obstacles are not visible
- Nearby/FarAway modifiers correctly narrow/expand detection distance
- Archetype filter on See correctly filters results
- Vision phase staggering distributes work across 3 ticks
- Rule variables (targetActor, targetPos) are set correctly for downstream use

### Phase 5: Actuators -- Move, Turn, Eat

**Goal**: Actors can move, turn, and eat using brain-programmed behaviors.

**Deliverables**:

- `brain/fns/actuators/move.ts`: Move actuator with Forward, Toward, AwayFrom, Avoid, Wander direction modes. Wander state persists via callSiteState (random target, 2-7s duration). Priority and speed (Quickly/Slowly) parameters.
- `brain/fns/actuators/turn.ts`: Turn actuator with Toward, AwayFrom, Around, Left, Right, N/S/E/W direction modes. Compass angles. Priority and speed parameters.
- `brain/fns/actuators/eat.ts`: Eat actuator with diet validation, 30 HP transfer, 1-second cooldown, Boolean return.
- Actuator tile registrations in `tiles/actuators.ts`
- Modifier tile registrations in `tiles/modifiers.ts` (all 22 modifiers)
- Parameter tile registrations in `tiles/parameters.ts` (all 5 parameters)

**Verification**:

- An actor with "See herbivore -> Move toward it" correctly chases herbivores
- An actor with "Move wander" roams with periodic target changes every 2-7 seconds
- Quickly/Slowly modifiers visibly change movement speed (stackable)
- Priority blending works: high-priority steering dominates low-priority
- Turn actuator rotates actor to face compass directions correctly
- Eat actuator transfers energy between predator and prey
- Eat respects diet rules (carnivore cannot eat plant)
- Eat cooldown prevents rapid consumption
- A complete predator-prey loop works: carnivore sees herbivore, chases, bumps, eats

### Phase 6: Shoot Actuator + Blip System

**Goal**: Actors can fire projectiles that damage other actors.

**Deliverables**:

- `brain/blip.ts`: Blip class and BlipPool (fixed capacity 2000, sprite recycling, lifetime management)
- `brain/fns/actuators/shoot.ts`: Shoot actuator with rate limiting (default 2/sec, Rate parameter 0-5), 5 energy cost, directional blip spawn, recoil impulse (1.5/mass), plant spring integration for recoil
- Blip texture generation in Playground (white 4px circle)
- Engine: `spawnBlip()`, blip tick/expiry, `handleBlipActorCollision()` (10 damage, self-immune), `handleBlipWallCollision()`
- Collision event routing for blips (CATEGORY_BLIP bitmask)
- PlantComp: spring anchor physics (k=200, c=12), `applyImpulse()` for recoil

**Verification**:

- Shoot actuator fires visible blip projectiles
- Blips travel in straight line at BLIP_SPEED (6 px/sec)
- Blip colliding with actor (not shooter) drains 10 energy
- Blip colliding with wall or obstacle despawns
- Blip expires after 3 seconds
- Rate limiting enforced (cannot exceed 5 shots/sec)
- Shooting costs 5 energy
- Recoil pushes shooter backward (visible on light actors)
- Plant recoil uses spring integrator (wobbles, then returns to anchor)
- Blip pool recycles sprites correctly (no allocation during steady-state)

### Phase 7: Say Actuator + Remaining Tiles

**Goal**: Complete tile manifest. All actuators, sensors, modifiers, parameters, literals, accessors, and variable factories registered.

**Deliverables**:

- `brain/fns/actuators/say.ts`: Say actuator with optional text and duration parameters
- Actor chat bubble rendering: white rounded-rect, triangle pointer, positioned above sprite, auto-dismiss (5s default or custom), timer reset on repeated text
- `tiles/literals.ts`: "me" (returns getSelf()) and "it" (returns getTargetActor(), requires TargetActor capability)
- `tiles/accessors.ts`: Vector2 (x, y) and ActorRef (id, position, energy pct) field accessors
- `tiles/variables.ts`: Vector2 and ActorRef variable factory tiles
- `tiles/tile-visuals.ts`: complete tile ID -> visual mapping (labels + icon URLs)
- `tiles/tile-colors.ts`: tile kind -> color mapping (when/do states)
- `tiles/visual-provider.ts`: genVisualForTile() with fallback chain
- `tiles/data-type-icons.ts`: type ID -> icon and display name maps
- SVG icon assets in `public/assets/brain/icons/` for all tiles

**Verification**:

- Say actuator displays chat bubble above actor with correct text and timing
- "me" literal resolves to executing actor's ActorRef
- "it" literal resolves to target actor from sensor (only available after Bump/See)
- Accessor tiles correctly extract fields: [actor].position returns Vector2, [vec2].x returns Number
- Variable factories create user-named variables of correct type
- All tiles render with correct labels and icons in the brain editor picker
- genVisualForTile() produces complete visuals for all registered tiles (no missing icons warnings)

### Phase 8: React UI -- Sidebar + Brain Editor

**Goal**: Full React sidebar with live stats and brain editor dialog.

**Deliverables**:

- `components/Sidebar.tsx`: complete dashboard with all sections (time slider, per-archetype stats, population sliders, edit brain buttons, footer stats, debug toggle, GitHub link). Mobile responsive (slide-in panel, backdrop).
- `brain-editor-config.tsx`: BrainEditorConfig builder with data type icons, names, variable factory predicate, Vector2 custom literal type (dual number inputs with validation), getDefaultBrain() loader
- App.tsx: full layout wiring -- scene ready callback, score polling (250ms + dedup), time speed sync, population count sync (load from localStorage on startup), brain editor open/close state, mobile sidebar toggle
- `services/brain-persistence.ts`: binary serialize -> base64 -> localStorage save/load, JSON legacy detection, default brain cache, clear functions
- Preloader scene: load `.brain` binary assets, deserialize, cache defaults
- `PhaserGame.tsx`: useLayoutEffect for game creation, SCENE_READY_KEY callback, cleanup on unmount

**Verification**:

- Sidebar displays live ecosystem score, per-archetype alive counts, avg lifespan, best life, avg energy
- Time slider (0-2x) correctly speeds up/slows down simulation
- Population sliders change desired counts; actors spawn/despawn to match
- Population counts persist across page reloads (localStorage)
- Edit Brain button opens the brain editor dialog for the correct archetype
- Brain changes in editor are applied to all actors of that archetype immediately
- Brain changes persist to localStorage
- Closing and reopening the editor restores the last saved brain
- Default `.brain` assets load correctly as fallbacks
- Mobile sidebar slides in/out with backdrop
- Score polling dedup prevents unnecessary React re-renders

### Phase 9: Docs Integration

**Goal**: Tile documentation sidebar and standalone docs page.

**Deliverables**:

- `docs/manifest.ts`: metadata entries for all 34+ tiles and 6+ pattern docs
- `docs/content/en/tiles/`: markdown documentation for each tile (see, bump, move, eat, say, turn, shoot, and modifiers/parameters)
- `docs/content/en/patterns/`: markdown documentation for programming patterns (flee-predator, hunt-and-eat, etc.)
- `docs/docs-registry.ts`: Vite glob imports, registry builder, merge with core docs
- `DocsPage.tsx`: standalone page at `/docs` route using SharedDocsPage from @mindcraft-lang/docs
- `main.tsx` routing: URL path check for `/docs` prefix
- DocsSidebarProvider + DocsSidebar integration in App.tsx
- Brain editor `onTileHelp` callback -> opens docs sidebar to tile page
- Brain editor `docsIntegration` -> docs toggle button in editor toolbar
- Sidebar BookOpen button -> toggles docs sidebar

**Verification**:

- Navigating to `/docs` shows the standalone documentation page
- Docs sidebar opens via BookOpen button in the simulation sidebar
- Right-clicking a tile in the brain editor and selecting "Help" opens its documentation
- Docs toggle button in brain editor toolbar shows/hides docs sidebar
- All tile documentation pages render correctly with brain-fence code blocks and inline tile chips
- Pattern documentation pages display correctly
- URL syncs with navigation state (`/docs/tiles/see`, etc.)
- Browser back/forward navigates docs history

### Phase 10: Debug Visualization + Polish

**Goal**: Debug overlays, visual polish, and production readiness.

**Deliverables**:

- Debug vision cone rendering: filled wedge per actor (20-point arc, archetype color)
- Debug movement intent arrows: direction + throttle + speed indicator, color coding
- Debug spatial grid heatmap: cell density overlay with heatColor, grid lines
- Actor pupil animation: smoothed gaze tracking based on turn intent
- Actor energy tinting: sprite darkens as energy drops
- Prod build config: Terser minification (2-pass), Phaser manual chunk, sonner dedup
- Performance: ensure 60fps with 100 actors + blips active

**Verification**:

- Toggle Debug button activates/deactivates all debug overlays
- Vision cones display correct FOV arc and range per archetype
- Movement arrows show intended heading, length scales with throttle \* speed
- Grid heatmap correctly reflects entity density (brighter cells = more actors)
- Pupil animation tracks smoothed gaze direction
- Low-energy actors visibly darken
- Production build succeeds and runs without errors
- No console warnings or errors in steady-state simulation
- Frame rate stays above 55fps with default population counts

---

## Appendix: Key Behavioral Constants

| Constant                     | Value           | Location        |
| ---------------------------- | --------------- | --------------- |
| VISION_PHASES                | 3               | engine.ts       |
| MAX_SPAWNS_PER_TICK          | 3               | engine.ts       |
| BITE_ENERGY                  | 30              | eat.ts          |
| EAT_COOLDOWN                 | 1000ms          | eat.ts          |
| SHOOT_ENERGY_COST            | 5               | shoot.ts        |
| BLIP_DAMAGE                  | 10              | blip.ts         |
| BLIP_SPEED                   | 6               | blip.ts         |
| BLIP_RADIUS                  | 4               | blip.ts         |
| BLIP_MAX_LIFETIME_MS         | 3000            | blip.ts         |
| MAX_ACTIVE_BLIPS             | 2000            | blip.ts         |
| RECOIL_IMPULSE               | 1.5 / body.mass | shoot.ts        |
| SPATIAL_GRID_CELL_SIZE       | 150             | spatial-grid.ts |
| WANDER_MIN_DURATION          | 2000ms          | move.ts         |
| WANDER_MAX_DURATION          | 7000ms          | move.ts         |
| SEE_MEMORY_MIN               | 500ms           | see.ts          |
| SEE_MEMORY_MAX               | 2500ms          | see.ts          |
| NEARBY_BASE_DISTANCE         | 100px           | see.ts          |
| FARAWAY_BASE_DISTANCE        | 300px           | see.ts          |
| CHAT_BUBBLE_DEFAULT_DURATION | 5s              | actor.ts        |
| PLANT_SPRING_K               | 200             | archetypes.ts   |
| PLANT_SPRING_C               | 12              | archetypes.ts   |
| SCORE_POLL_INTERVAL          | 250ms           | App.tsx         |
| POPULATION_DEBOUNCE          | 200ms           | Sidebar.tsx     |
| CANVAS_WIDTH                 | 1024            | main.ts         |
| CANVAS_HEIGHT                | 768             | main.ts         |
| WORLD_MARGIN                 | 32              | Playground.ts   |
| OBSTACLE_COUNT               | 4               | Playground.ts   |
| OBSTACLE_MIN_SIZE            | 30              | Playground.ts   |
| OBSTACLE_MAX_SIZE            | 120             | Playground.ts   |
