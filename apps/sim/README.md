# Ecology Sim

A demo application for the [Mindcraft language](../../README.md). Actors -- carnivores, herbivores, and plants -- move and interact in a 2D physics world, each driven by a user-editable Mindcraft brain.

This app serves as a reference integration showing how to register custom types, sensors, and actuators, and how to embed the visual brain editor into a React UI.

**Live demo:** <https://mindcraft-sim.humanappliance.io>

## Tech Stack

- **Vite** -- bundler
- **React 19** -- UI (sidebar, brain editor)
- **Phaser 3** -- game canvas with Matter.js physics
- **Tailwind CSS v4** -- styling
- **Radix UI / shadcn/ui** -- UI primitives
- **miniplex** -- ECS for actor management
- **@mindcraft-lang/core** -- Mindcraft language runtime (local dependency)

## Getting Started

From the monorepo root:

```bash
npm install
```

Then start the dev server:

```bash
cd apps/sim
npm run dev
```

Opens at `http://localhost:8080`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (`--force` cache bypass) |
| `npm run build` | Build `packages/core` first, then Vite production build |
| `npm run clean` | Remove `dist/` and Vite cache |
| `npm run lint` | Biome lint |
| `npm run format` | Biome format |
| `npm run check` | Biome check (lint + format) |

## Project Structure

```
src/
  main.tsx              React entry point
  App.tsx               Root layout: Phaser canvas + sidebar + brain editor
  PhaserGame.tsx        React <-> Phaser bridge
  bootstrap.ts          Startup: logger, services, brain registration
  globals.css           Tailwind, fonts, theme tokens

  brain/                Simulation engine + brain language integration
    actor.ts              Actor entity (brain, mover, vision, queues)
    archetypes.ts         Carnivore/herbivore/plant config
    engine.ts             ECS world, tick loop, spawning, collisions
    score.ts              Score tracker + snapshot types
    movement.ts           Mover + steering helpers (Matter.js)
    vision.ts             Cone-based, obstacle-occluded sight queries
    type-system.ts        App-specific types (ActorRef, Vector2)
    tileids.ts            Tile ID string constants
    fns/                  Host function implementations
      sensors/              Bump, See, Timeout
      actuators/            Move, Eat, Say, Turn, Shoot
    tiles/                Tile definitions + visual config

  game/                 Phaser game layer
    main.ts               Phaser Game config + StartGame factory
    scenes/               Boot -> Preloader -> Playground

  components/           React UI
    Sidebar.tsx             Dashboard (stats, time scale, population)
    brain-editor/           Brain editor subsystem (editor, tile picker, undo/redo)
    ui/                     shadcn/ui primitives

  services/             Platform services
    brain-persistence.ts    localStorage save/load (binary + base64)

  lib/                  General utilities
```

## Brain Integration

The sim registers app-specific brain components in three layers:

1. **Types** (`brain/type-system.ts`) -- custom `ActorRef` and `Vector2` struct types
2. **Host functions** (`brain/fns/`) -- sensor and actuator implementations that read/write actor state
3. **Tiles** (`brain/tiles/`) -- tile definitions with visual metadata (labels, icons, colors) for the editor

Registration happens in `bootstrap.ts` at startup. The core library's `registerCoreBrainComponents()` runs first, then the sim's `registerBrainComponents()`.

### Adding a Sensor or Actuator

1. Create the host function in `brain/fns/sensors/` or `brain/fns/actuators/`
2. Register it in the corresponding `index.ts`
3. Add the tile definition in `brain/tiles/sensors.ts` or `brain/tiles/actuators.ts`
4. Add tile ID constants to `brain/tileids.ts`

Each sensor/actuator exports an `ActionDef` containing the tile ID, argument grammar (`callDef`), host function, return type, and visual metadata.
