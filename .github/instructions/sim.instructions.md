---
applyTo: "apps/sim/**"
---

<!-- Last reviewed: 2026-03-12 -->

# Sim App -- Rules & Patterns

The sim app (`apps/sim/`) is a **Vite + React + Phaser 3** web application. It renders an
ecosystem simulation where actors (carnivores, herbivores, plants) are each driven by a
user-editable brain program from `packages/core`.

## Tech Stack

Vite, React 19, Phaser 3 (Matter.js physics), Tailwind CSS v4, miniplex (ECS),
`@mindcraft-lang/ui` (source-only), `@mindcraft-lang/docs` (source-only), Biome.

## Path Aliases

- `@/*` -> `./src/*` -- prefer over deep relative paths across directory boundaries
- `@mindcraft-lang/ui` -> `../../packages/ui/src` (source-only, no build step)
- `@mindcraft-lang/docs` -> `../../packages/docs/src` (source-only, no build step)

## Build & Scripts

```
npm run dev     # Vite dev server
npm run build   # Builds core (prebuild), then Vite production build
npm run check   # Biome check (lint + format)
```

Changes to `packages/core` require rebuilding it (the sim's `prebuild` handles this).

## Adding New Sensors/Actuators

1. Create host function in `brain/fns/sensors/<name>.ts` or `brain/fns/actuators/<name>.ts`
   - Define `callDef` using `mkCallDef()`, implement exec with `getSelf(ctx)`, export `ActionDef`
2. Register in `brain/fns/sensors/index.ts` or `brain/fns/actuators/index.ts`
3. Register tile in `brain/tiles/sensors.ts` or `brain/tiles/actuators.ts`
4. Add tile ID constants to `brain/tileids.ts`
5. Add modifier/parameter tile IDs + registration if needed

### Modifier vs Parameter Tiles

- **Modifiers** are boolean flags. Use `mod()` from `call-spec.ts`.
- **Parameters** accept a typed value. Use `param()` from `call-spec.ts`.
- Do NOT mix these up -- wrong helper causes slot lookup failures at startup.

### Call Spec Example

```typescript
import { mkCallDef, getSlotId, bag, choice, mod, param } from "@mindcraft-lang/core/brain";

const Forward = mod(TileIds.Modifier.MovementForward);
const Priority = param(TileIds.Parameter.Priority);
const callDef = mkCallDef(bag(choice(Forward, Toward), Priority));
const kForwardSlotId = getSlotId(callDef, Forward);
```

### ExecutionContext -> Actor Access

```typescript
const self = getSelf(ctx); // from brain/execution-context-types.ts
const other = getActor(ctx, otherActorId);
```

## Key Architecture Notes

- Initialization: `bootstrap.ts` calls `registerCoreBrainComponents()` then `registerBrainComponents()` (sim-specific)
- Brain editor config: `brain-editor-config.tsx` builds `BrainEditorConfig`, wrapped in `BrainEditorProvider` in `App.tsx`
- Brain persistence: `localStorage` with base64-encoded binary (see `services/brain-persistence.ts`)
- Phaser bridge: `PhaserGame.tsx` fires `onSceneReady` callback; `App.tsx` calls scene methods directly
- Physics: Matter.js, zero gravity, top-down 2D; actors use `Mover` class for steering
- Tile icons: SVGs in `public/assets/brain/icons/`
- All brain edits go through the Command Pattern with undo/redo
