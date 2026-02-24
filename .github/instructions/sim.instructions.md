---
applyTo: 'apps/sim/**'
---
<!-- Last reviewed: 2026-02-22 -->

# Sim App -- Architecture & Conventions

The sim app (`apps/sim/`) is a **Vite + React + Phaser 3** web application that serves as a demo for the brain programming language implemented in `packages/core`. It renders an ecology simulation where actors (carnivores, herbivores, plants) move and interact in a 2D physics world, each driven by a user-editable brain program.

## Tech Stack

- **Vite** -- bundler (configs in `vite/config.dev.mjs` and `vite/config.prod.mjs`)
- **React 19** -- UI layer (brain editor, controls panel)
- **Phaser 3** -- game canvas and Matter.js physics
- **Tailwind CSS v4** -- styling (via `@tailwindcss/postcss`)
- **Radix UI** -- dialog, dropdown, slider primitives
- **shadcn/ui** -- base UI components in `components/ui/`
- **Biome** -- formatter and linter (`biome.json`, 120-char line width, 2-space indent)
- **miniplex** -- ECS (entity-component-system) for actor management

## Path Alias

`@/*` maps to `./src/*` (configured in `tsconfig.json`). Always prefer `@/` paths over deep relative paths when importing across directory boundaries. Use relative paths only within the same directory or for sibling files.

## Build & Scripts

```
npm run dev          # Vite dev server (--force)
npm run build        # Builds core first (prebuild), then Vite production build
npm run format       # Biome format
npm run lint         # Biome lint
npm run check        # Biome check (lint + format)
```

The `prebuild` script automatically rebuilds `packages/core` before building the sim app.

## Directory Structure

```
src/
|-- main.tsx              # React entry point (renders <App>, imports bootstrap)
|-- App.tsx               # Root layout: Phaser canvas + sidebar + brain editor dialog
|-- PhaserGame.tsx        # React <-> Phaser bridge component
|-- bootstrap.ts          # Side-effect module: logger, services, brain registration
|-- globals.css           # Tailwind import, fonts, theme tokens (oklch)
|
|-- brain/                # Simulation engine + brain language integration
|   |-- index.ts          # Barrel: registerBrainComponents()
|   |-- actor.ts          # Actor class (entity with brain, mover, vision, queues)
|   |-- archetypes.ts     # Static config for carnivore/herbivore/plant
|   |-- engine.ts         # Engine class (ECS world, tick loop, spawning, collisions)
|   |-- execution-context-types.ts  # Type guards for Actor in ExecutionContext
|   |-- movement.ts       # Mover class + steering helpers (Matter.js locomotion)
|   |-- tileids.ts        # Centralized tile ID string constants
|   |-- type-system.ts    # App-specific types (ActorId, Vector2) + registration
|   |-- vision.ts         # Vision queries (cone-based, obstacle-occluded)
|   |-- score.ts          # ScoreTracker class + ScoreSnapshot type (ecosystem scoring)
|   |-- blip.ts           # Blip effect system
|   |-- spatial-grid.ts   # Spatial grid for efficient queries
|   |-- fns/              # Host function implementations
|   |   |-- index.ts      # Barrel: registerFns()
|   |   |-- utils.ts      # Shared host function helpers
|   |   |-- action-def.ts # ActionDef type (shared by all sensors/actuators)
|   |   |-- actuators/    # Move, Eat, Say, Turn, Shoot actuators
|   |   \-- sensors/      # Bump, See, Timeout sensors
|   \-- tiles/            # Tile definitions and visual config
|       |-- index.ts      # Barrel: registerTiles()
|       |-- types.ts      # TileVisual and TileColorDef types
|       |-- actuators.ts  # Actuator tile registration
|       |-- sensors.ts    # Sensor tile registration
|       |-- modifiers.ts  # Modifier tile registration
|       |-- parameters.ts # Parameter tile registration
|       |-- tile-colors.ts    # Tile kind -> color mapping
|       |-- tile-visuals.ts   # Tile ID -> visual (label, icon) mapping
|       |-- visual-provider.ts # genVisualForTile() -- assembles complete TileVisual
|       |-- data-type-icons.ts # Type ID -> SVG icon mapping
|       |-- accessors.ts   # Accessor tile registration
|       |-- literals.ts    # Literal tile registration
|       \-- variables.ts   # Variable tile registration
|
|-- game/                 # Phaser game layer
|   |-- main.ts           # Phaser Game config + StartGame factory (Matter physics, 1024x768)
|   \-- scenes/
|       |-- Boot.ts       # Boot scene (loads background)
|       |-- Preloader.ts  # Asset loading with progress bar
|       \-- Playground.ts # Main game scene (spawning, collisions, obstacles)
|
|-- services/
|   |-- index.ts              # Barrel exports
|   \-- brain-persistence.ts  # Save/load brain defs to localStorage (binary+base64)
|
|-- lib/                  # General utilities
|   |-- index.ts          # Barrel exports
|   |-- utils.ts          # cn() -- Tailwind class merge (shadcn standard)
|   |-- color.ts          # adjustColor(), saturateColor() + internal HSL helpers
|   \-- glass-effect.ts   # CSS glass/glint effect generator
|
\-- components/           # React UI components
    |-- Sidebar.tsx                # Dashboard sidebar (stats, time scale, population, debug)
    |-- brain-editor/              # Brain editor subsystem
    |   |-- BrainEditorDialog.tsx      # Full brain editor (pages, undo/redo, toolbar)
    |   |-- BrainPageEditor.tsx        # Page rules list with depth flattening
    |   |-- BrainRuleEditor.tsx        # WHEN/DO rule row with glass effects
    |   |-- BrainTile.tsx              # Individual tile button with marquee overflow
    |   |-- BrainTileEditor.tsx        # Tile with dropdown (insert/replace/delete)
    |   |-- BrainTilePickerDialog.tsx  # Available tiles grouped by kind
    |   |-- BrainPrintDialog.tsx       # Print preview dialog (visual + text modes)
    |   |-- BrainPrintView.tsx         # Visual print layout for brain definitions
    |   |-- BrainPrintTextView.tsx     # Plain-text print layout for brain definitions
    |   |-- CreateLiteralDialog.tsx    # Dialog for creating number/string/vector2
    |   |-- CreateVariableDialog.tsx   # Dialog for naming a new variable
    |   |-- TileValue.tsx              # Renders literal values or variable names
    |   |-- rule-clipboard.ts          # Copy/paste rules between editor instances
    |   |-- commands/                  # Command pattern for undo/redo
    |   |   |-- index.ts               # Barrel re-export
    |   |   |-- BrainCommand.ts        # BrainCommand interface + BrainCommandHistory
    |   |   |-- PageCommands.ts        # Add/Remove/ReplaceLast page commands
    |   |   |-- RenameCommands.ts      # Rename brain/page commands
    |   |   |-- RuleCommands.ts        # Add/Delete/Move/Indent/Outdent rule commands
    |   |   \-- TileCommands.ts        # Add/Insert/Replace/Remove tile commands
    |   |-- tile-badges.ts          # Tile badge rendering
    |   |-- tile-clipboard.ts       # Copy/paste individual tiles
    |   \-- hooks/
    |       |-- useRuleCapabilities.ts # Rule capability detection hook
    |       \-- useTileSelection.ts    # Tile selection flow + factory handoff hook
    \-- ui/                        # shadcn/ui primitives (button, card, dialog, etc.)
```

## Initialization Flow

1. `main.tsx` imports `bootstrap.ts` (side-effect) then renders `<App>`
2. `bootstrap.ts`:
   - Configures logger
   - Sets tile visual provider (`genVisualForTile`)
   - Calls `registerCoreBrainComponents()` (from core) then `registerBrainComponents()` (sim-specific)
3. `App.tsx` mounts `<PhaserGame onSceneReady={...}>` which creates the Phaser `Game` instance
4. Phaser scene sequence: `Boot` -> `Preloader` -> `Playground`
5. `Playground.create()` instantiates `Engine`, generates actor textures, creates obstacles, spawns actors, then fires the `onSceneReady` callback

## Key Architectural Patterns

### Actor System

`Actor` (in `brain/actor.ts`) is the central entity. Each actor has:
- An `Archetype` (`"carnivore" | "herbivore" | "plant"`)
- A `Mover` (physics-based steering, Matter.js)
- A brain runtime (`IBrain` from core)
- Queues: `bumpQueue` (collision events), `sightQueue` (vision results)
- Components: `AnimalComp` (for moving actors) or `PlantComp` (spring-anchored)

The `Engine` wraps a miniplex ECS `World<Actor>`, handling spawning, tick updates, collision events, and brain def management.

### Brain Integration

The sim registers app-specific brain components through a layered registration:

1. **Types** (`type-system.ts`): `ActorId` and `Vector2` custom types
2. **Host Functions** (`fns/`): Sensor/actuator implementations (move, bump, see, timeout)
3. **Tiles** (`tiles/`): Tile definitions with visual metadata for the UI

Each sensor/actuator follows the `ActionDef` pattern:
```typescript
export default {
  tileId: string,        // from TileIds constants
  callDef: BrainActionCallDef,  // argument grammar (from mkCallDef)
  fn: HostFn,            // { exec: (ctx, args) => Value }
  isAsync: boolean,
  returnType: TypeId,
  visual: TileVisual,    // { label, iconUrl }
} satisfies ActionDef;
```

### Adding New Sensors/Actuators (Sim-Specific)

To add a new sensor or actuator to the sim app:

1. **Create the host function** in `brain/fns/sensors/<name>.ts` or `brain/fns/actuators/<name>.ts`:
   - Define the `callDef` using `mkCallDef()` with the argument grammar
   - Implement the exec function using `getSelf(ctx)` to access the `Actor`
   - Export a default `ActionDef` object
2. **Register the function** in `brain/fns/sensors/index.ts` or `brain/fns/actuators/index.ts`
3. **Register the tile** in `brain/tiles/sensors.ts` or `brain/tiles/actuators.ts`
4. **Add tile ID constants** to `brain/tileids.ts`
5. **Add modifier/parameter tile IDs** if the function uses custom modifiers/parameters, and register them in `brain/tiles/modifiers.ts` or `brain/tiles/parameters.ts`

### Modifier vs Parameter Tiles

- **Modifiers** are boolean flags (present or absent). Use `mod()` from `call-spec.ts` (wraps `mkModifierTileId()`).
- **Parameters** accept a typed value. Use `param()` from `call-spec.ts` (wraps `mkParameterTileId()`).
- Do NOT mix these up -- using the wrong helper will cause slot lookups to fail at startup.

### Call Spec Builder Helpers

Use the composable helpers from `@mindcraft-lang/core/brain` (`interfaces/call-spec.ts`) to define argument grammars. These replace deeply nested object literals with concise function calls:

```typescript
import { mkCallDef, getSlotId, bag, choice, mod, param, optional, conditional } from "@mindcraft-lang/core/brain";

// Define arg specs as named constants (reused for getSlotId lookups)
const Forward = mod(TileIds.Modifier.MovementForward);
const Toward = mod(TileIds.Modifier.MovementToward);
const Priority = param(TileIds.Parameter.Priority);

// Compose the grammar
const callDef = mkCallDef(bag(choice(Forward, Toward), Priority));

// Look up slot IDs by passing the arg spec directly
const kForwardSlotId = getSlotId(callDef, Forward);
const kPrioritySlotId = getSlotId(callDef, Priority);
```

Available helpers: `mod()`, `param()`, `bag()`, `choice()`, `seq()`, `optional()`, `repeated()`, `conditional()`.

`getSlotId()` accepts either a raw tileId string or a `BrainActionCallArgSpec` object, and throws if the tileId is not found in the call def (fail-fast on misconfiguration).

### ExecutionContext -> Actor Access

Host functions access the current actor through the `ExecutionContext.data` field:
```typescript
const self = getSelf(ctx);  // Returns Actor | undefined
const other = getActor(ctx, otherActorId);  // Lookup by ID via engine
```
These helpers are in `brain/execution-context-types.ts`.

### React <-> Phaser Communication

`PhaserGame.tsx` is a plain React component that accepts an `onSceneReady` callback prop. `StartGame()` in `game/main.ts` stores this callback in `game.registry`. When a scene finishes `create()`, it reads the callback from the registry and invokes it, passing itself to React.

`App.tsx` stores the `Playground` scene in state via the callback, then calls scene methods directly: `getBrainDef()`, `updateBrainDef()`, `setTimeSpeed()`, `toggleDebugMode()`, `getScoreSnapshot()`.

### Scoring System

The sim tracks per-archetype survival statistics and computes a composite **ecosystem score** displayed in a live scoreboard overlay (bottom-right corner).

**Tracked stats** (per archetype):
- Average lifespan (seconds survived before death)
- Longest single life
- Alive count and average energy
- Total deaths

**Ecosystem score**: geometric mean of all three archetypes' average lifespans. Uses `((avgC + 1) * (avgH + 1) * (avgP + 1)) ** (1/3) - 1` so all species must thrive for a high score -- optimizing only one archetype yields diminishing returns.

**Data flow**: `Engine.tick()` updates the `ScoreTracker` each frame with alive counts, energy sums, and elapsed time. `Engine.killActor()` records death lifespans. The React `Sidebar` component displays stats polled from `App.tsx`, which reads `Playground.getScoreSnapshot()` at 4Hz via `setInterval`.

### Brain Persistence

Brain definitions are serialized to `localStorage` as base64-encoded binary data (using core's stream serialization). See `services/brain-persistence.ts`.

### UI Component Architecture

The brain editor lives in `components/brain-editor/` as a self-contained subsystem. Its component hierarchy:
```
BrainEditorDialog (toolbar, page nav, save/load)
  \-- BrainPageEditor (flattens rules, manages reparsing)
       \-- BrainRuleEditor (WHEN/DO row, glass effects)
            \-- BrainTileEditor (tile + dropdown context menu)
                 \-- BrainTile (visual tile button)
```

The `Sidebar` component (`components/Sidebar.tsx`) owns the dashboard panel: ecosystem score, time-scale slider, per-archetype stats and population sliders, and the "Edit Brain" / "Toggle Debug" buttons.

All edits go through the **Command Pattern** (`commands/`) with undo/redo via `BrainCommandHistory`.

## Code Style (Biome)

The sim app uses Biome for formatting and linting. Generate code that matches these rules to avoid producing noisy diffs:

- **Quotes**: double quotes for strings and JSX attributes
- **Semicolons**: always required
- **Indentation**: 2 spaces
- **Line width**: 120 characters max
- **Trailing commas**: ES5 style (objects, arrays, function params)
- **Import types**: always use `import type` for type-only imports:
  ```typescript
  // correct
  import type { Foo } from "./foo";
  import { bar } from "./bar";

  // wrong - will trigger useImportType error
  import { Foo } from "./foo";
  ```
- **Number namespace**: use `Number.isNaN`, `Number.isFinite`, `Number.parseInt`, etc. instead of the global versions
- **Arrow function parens**: always include parens around single params: `(x) => x`
- **Bracket spacing**: spaces inside object braces: `{ key: value }`

## Styling Conventions

- Use Tailwind CSS utility classes
- The `components/ui/` directory contains shadcn/ui primitives -- these are standard generated components
- Glass effects use `glassEffect()` from `lib/glass-effect.ts`
- Color manipulation uses `adjustColor()` and `saturateColor()` from `lib/color.ts`
- Theme tokens use oklch color space (defined in `globals.css`)

## Important Notes

- The `@mindcraft-lang/core` package is a **local dependency** (`file:../../packages/core`) -- changes to core require rebuilding it (`npm run build` in packages/core, or the sim's `prebuild` handles this)
- Tile visuals (icons) are SVGs stored in `public/assets/brain/icons/`
- The Phaser game uses Matter.js physics with zero gravity (top-down 2D)
- Collision categories use bitmasks: `CATEGORY_WALL = 0x0001`, `CATEGORY_ACTOR = 0x0002`
- Actors use the `Mover` class for physics steering -- all movement goes through steering intents that are blended by weighted average
