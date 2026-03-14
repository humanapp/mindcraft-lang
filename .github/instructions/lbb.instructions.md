---
applyTo: "apps/lbb/**"
---

<!-- Last reviewed: 2026-03-14 -->

# LBB App -- Rules & Patterns

The LBB app (`apps/lbb/`) is a **Vite + React + React-Three-Fiber** 3D terrain editor.
It renders voxel-based terrain that users sculpt with raise/lower brushes. Physics use
Rapier 3D. Terrain meshing runs in a Web Worker pool.

## Tech Stack

Vite, React 19, Three.js (via @react-three/fiber + @react-three/drei), Rapier 3D
(@dimforge/rapier3d-compat), Zustand (state), Tailwind CSS, Biome.

## Path Aliases

- `@/*` -> `./src/*`
- `@mindcraft-lang/ui` -> `../../packages/ui/src` (source-only, no build step)
- `@mindcraft-lang/docs` -> `../../packages/docs/src` (source-only, no build step)

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

The core of the app. Key files:

- `types.ts` -- Constants (CHUNK_SIZE=32, FIELD_PAD=2, SAMPLES=38), ChunkData, MeshData,
  sampleIndex()
- `generator.ts` -- Procedural density field via fBm noise. Density = height - wy (positive
  = solid).
- `field.ts` -- Low-level field helpers: getSample, setSample, computeGradient (central
  differences, used only in tests)
- `mesher.ts` -- Surface Nets isosurface extraction + tricubic gradient normals. Two-phase
  algorithm: Phase 1 computes cell vertices, Phase 2 emits quads. Includes optional vertex
  relaxation and normal smoothing.
- `edit.ts` -- Brush sculpting: computeBrushPatches() with smoothstep falloff
- `halo.ts` -- syncChunkPadding() copies padding from 26 neighbors for gradient continuity
- `collider.ts` -- Rapier trimesh collider from MeshData
- `terrain.worker.ts` -- Web Worker entry: handles "mesh" and "generate" requests
- `terrain-worker-bridge.ts` -- Worker pool (up to 4 workers), round-robin dispatch

### Key Constants

- `CHUNK_SIZE = 32` -- voxels per chunk side
- `FIELD_PAD = 2` -- halo padding for tricubic gradient sampling
- `SAMPLES = 38` -- CHUNK_SIZE + 2 + 2\*FIELD_PAD (total samples per axis)
- Density convention: positive = solid, negative = air. Surface at density = 0.

### Normal Computation

Normals are computed from the **density gradient** using Catmull-Rom tricubic interpolation
(`sampleGradientTricubic()` in mesher.ts). The gradient is analytically derived from the
interpolation weights and their derivatives. Normal = -gradient (normalized). Boundary
vertices are excluded from normal smoothing to preserve chunk-seam consistency.

Do NOT mix trilinear and tricubic sampling -- inconsistency causes visible shading artifacts.

### Density Clamping Caveat

Clamping density values (e.g. to [-1, 1]) before gradient computation creates
discontinuities that produce starburst/pinwheel normal artifacts. The `clampDensity` toggle
exists as a debug option but should default to OFF.

### Meshing Pipeline

1. `applyFieldValues()` writes density patches, marks affected + neighbor chunks dirty
2. `remeshDirtyChunks()` (called per-frame) syncs halo, sends field to worker
3. Worker runs `extractSurfaceNets()`, transfers MeshData back
4. `applyMeshResult()` stores mesh, marks collider stale
5. `flushStaleColliders()` rebuilds Rapier trimesh colliders

### Halo Sync

`syncChunkPadding()` must be called before meshing a chunk. It copies the padding region
from all 26 neighbors. The world-store calls it in `remeshChunk()` and
`remeshDirtyChunks()`. After brush edits, all affected chunks AND their neighbors are
marked dirty.

## Input System

Gesture-based: `GestureRouter` maps pointer events to handlers based on button + modifiers:

- Left-click -> SculptGesture (raise/lower terrain)
- Shift + left-click -> OrbitGesture (camera orbit)
- Ctrl/Cmd + left-click -> DollyPanGesture (camera dolly/pan)

`InputManager` handles raw DOM events; `useInputManager` hook wires it into R3F.

## State Management

Three Zustand stores:

- `useEditorStore` -- tool selection, brush params, undo/redo, render options
- `useWorldStore` -- chunk data, meshes, dirty tracking, physics, field mutations
- `useSessionStore` -- transient pointer/hover state

## Undo/Redo

Command pattern: `TerrainPatchCommand` records before/after density values. `UndoStack`
(capacity 100) manages history. Strokes are accumulated in `pendingPatches` during a drag,
then committed on pointer-up via `commitStroke()` which merges per-voxel patches.

## Test Suite

Tests use Node's built-in test runner (`node:test`) with `tsx` loader. Test fixtures in
`test/terrain/fixtures.ts` provide standard density fields (flat plane, sphere, sloped
hill, tunnel). Key test themes:

- Seam correctness across chunk boundaries
- Normal boundary agreement
- Halo sync after edits
- Deterministic meshing
- Vertex relaxation preserving seams

Run tests: `npm run test` from `apps/lbb/`.
