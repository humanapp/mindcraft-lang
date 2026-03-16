---
applyTo: "apps/lbb/**"
---

<!-- Last reviewed: 2026-03-14 -->

# "Little Big Brains" (LBB) App -- Rules & Patterns

The LBB app (`apps/lbb/`) is a **Vite + React + React-Three-Fiber** 3D terrain editor.

This is a **long-lived, production-quality codebase**, not a prototype. Changes should
prioritize **clarity, robustness, and maintainability**.

Guidelines:

- Prefer **clean architectural fixes** over quick patches.
- Integrate changes into existing systems (terrain pipeline, input system, stores).
- Avoid one-off hacks or parallel logic paths.
- Preserve system invariants (terrain seams, determinism, state ownership).
- Keep implementations **simple, explicit, and stable**.

## Tech Stack

Vite, React 19, Three.js (via @react-three/fiber + @react-three/drei), Rapier 3D
(@dimforge/rapier3d-compat), Zustand (state), Tailwind CSS, Biome.

## Path Aliases

- `@/*` -> `./src/*`
- `@mindcraft-lang/ui` -> `../../packages/ui/src` (source-only, no build step)
- `@mindcraft-lang/docs` -> `../../packages/docs/src` (source-only, no build step)

Prefer path aliases over relative paths for all imports that cross directory boundaries.
Use a relative path only when importing from the same directory (e.g., `"./utils"`).

Exception: test files under `test/` are run directly with `tsx` outside the Vite build
and cannot use `@/` aliases. They must use relative paths to reach `src/` (e.g.,
`"../../src/world/voxel/types"`).

## Build & Scripts

```
npm run dev       # Vite dev server
npm run build     # Builds core (prebuild), then Vite production build
npm run test      # Node test runner: node --import tsx --test test/terrain/*.test.ts
npm run check     # Biome check (lint + format)
npm run check:fix # Biome check + auto-fix
```

## Directory Layout

```
src/
  app/          # Layout, Toolbar, InspectorPanel (UI shell)
  editor/       # EditorState (Zustand), undo/redo, commands
  input/        # InputManager, GestureRouter, gesture handlers
  render/       # R3F Scene, TerrainChunkMesh, BrushCursor, debug overlays
  session/      # SessionStore (pointer state, hover position)
  world/        # WorldStore (chunks, meshes, physics), entities
    terrain/    # Core terrain system (see below)
test/
  terrain/      # Terrain unit tests (node:test)
```

## Terrain System (`src/world/terrain/`)

Core subsystem of the editor.

Key files:

- `types.ts` -- constants (CHUNK_SIZE=32, FIELD_PAD=2, SAMPLES=38), ChunkData, MeshData
- `generator.ts` -- procedural density field via fBm noise
- `field.ts` -- density sampling helpers
- `mesher.ts` -- Surface Nets extraction + tricubic gradient normals
- `edit.ts` -- brush sculpting
- `halo.ts` -- padding sync across neighbors
- `collider.ts` -- Rapier trimesh collider
- `terrain.worker.ts` -- worker entry
- `terrain-worker-bridge.ts` -- worker pool

### Key Constants

- `CHUNK_SIZE = 32`
- `FIELD_PAD = 2`
- `SAMPLES = 38`
- Density: **positive = solid**, **negative = air**
- Surface at **density = 0**

### Normal Computation

Normals come from the **density gradient** using tricubic Catmull-Rom interpolation
(`sampleGradientTricubic()`).

Normal = `-gradient` normalized.

Never mix trilinear and tricubic sampling.

### Density Clamping Caveat

Clamping density values before gradient evaluation introduces discontinuities and causes
**starburst/pinwheel normal artifacts**.

`clampDensity` exists only as a debug option and should normally remain **OFF**.

### Meshing Pipeline

1. `applyFieldValues()` writes density patches, marks chunks dirty
2. `remeshDirtyChunks()` syncs halo and dispatches worker jobs
3. Worker runs `extractSurfaceNets()`
4. `applyMeshResult()` stores mesh, marks collider stale
5. `flushStaleColliders()` rebuilds Rapier trimesh colliders

### Halo Sync

`syncChunkPadding()` copies padding from **26 neighbors** before meshing.

After brush edits, both **affected chunks and neighbors** must be marked dirty.

## Input System

Gesture-based via `GestureRouter`.

- Left-click -> `SculptGesture`
- Shift + left-click -> `OrbitGesture`
- Ctrl/Cmd + left-click -> `DollyPanGesture`

`InputManager` handles raw DOM events.

Keep input logic centralized here.

## State Management

Three Zustand stores:

- `useEditorStore` -- tools, brush params, render options
- `useWorldStore` -- chunk data, meshes, physics
- `useSessionStore` -- transient pointer/hover state

Maintain clear ownership boundaries between stores.

## Undo/Redo

Command pattern via `TerrainPatchCommand`.

`UndoStack` (capacity 100) stores history.

Brush strokes accumulate voxel edits during drag and commit on pointer-up.

Commands must remain reversible and deterministic.

## Test Suite

Uses Node's built-in runner (`node:test`) with `tsx`.

Fixtures in `test/terrain/fixtures.ts` include flat plane, sphere, sloped hill, tunnel.

Tests focus on:

- chunk seam correctness
- normal boundary agreement
- halo sync after edits
- deterministic meshing
- vertex relaxation preserving seams

Run tests:

```
npm run test
```

from `apps/lbb/`.
