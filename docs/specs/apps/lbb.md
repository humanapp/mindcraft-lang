# Little Big Brains (LBB) -- Design Specification

## Status

Draft

---

## 1. Overview

Little Big Brains (LBB) is a browser-based 3D game creation sandbox where users sculpt
worlds, build creatures and objects, and program entity behavior -- all within a single
creative environment. It is a full-featured application within the Mindcraft system,
combining voxel-based sculpting with the Mindcraft visual brain language to let users
create living, interactive 3D worlds without traditional coding or modeling tools.

The creation experience spans several interconnected systems:

- **Terrain sculpting** -- Users shape landscapes in real time using brush tools applied
  to a volumetric density field. The terrain system supports raise, lower, smooth,
  roughen, and flatten operations with configurable brush shapes and falloff.

- **Creature creation** -- Users build creatures from high-resolution voxel fields,
  defining articulated spines, attaching limbs and joints, adding senses and mouths, and
  controlling body shape through spline-based thickness curves. Inspired by the Spore
  Creature Creator.

- **Object sculpting** -- A general-purpose sculpt system (inspired by Media Molecule's
  Dreams) lets users create trees, buildings, props, and decorations using voxel-field
  editing with advanced tools like mirror sculpting, kaleidoscope patterns, and radial
  symmetry.

- **Programmable entities** -- Creatures and objects receive Mindcraft brains -- visual
  programs that control behavior through sensors and actuators. Archetypes define shared
  default behaviors; individual instances can override them.

- **Programmable environment** -- Lighting environments, placed lights, and atmospheric
  effects are user-editable and accessible through brain tiles for dynamic control.

Terrain, creatures, and sculpted objects all share a unified editing model built on
voxel-field density manipulation, brush tools, and symmetry operations.

The application is built with Vite, React 19, Three.js (via React Three Fiber), and
Rapier 3D physics. Heavy computation (mesh extraction, field generation) runs on Web
Workers. The current implementation establishes the terrain sculpting foundation; the
creature creator, sculpt system, and entity programming are planned future systems.

The app lives at `apps/lbb/` within the `mindcraft-lang` monorepo.

---

## 2. Design Goals

- **Intuitive sculpt-based creation** -- Terrain editing should feel responsive and
  direct. Brush-based sculpting with real-time feedback is the primary interaction model.

- **Deterministic terrain behavior** -- Identical density fields must produce identical
  meshes. The meshing pipeline is repeatable and testable offline.

- **Seam-safe voxel meshing** -- Chunk boundaries must be invisible. Vertices, normals,
  and relaxation at chunk edges are constrained to produce seamless results.

- **Worker-based heavy computation** -- Mesh extraction and field generation run on Web
  Workers to keep the main thread responsive during sculpting.

- **Scalable editing systems** -- Brush tools, undo/redo, and the terrain pipeline are
  designed for extensibility. Future systems (creatures, sculpted objects, programmable
  entities) will build on the same patterns.

- **Maintainable subsystem boundaries** -- State, rendering, input, and terrain are
  separated into distinct modules with clear ownership. Zustand stores enforce data
  boundaries between subsystems.

- **Strong regression testing** -- The terrain pipeline has an extensive test suite
  covering determinism, seam correctness, halo synchronization, and boundary normals.
  Tests run outside the browser using Node's built-in test runner.

---

## 3. System Architecture

### Tech Stack

| Dependency            | Role                                                 |
| --------------------- | ---------------------------------------------------- |
| Vite                  | Bundler, dev server, HMR                             |
| React 19              | UI layer (toolbar, inspector, providers)             |
| Three.js / R3F / Drei | 3D rendering, scene graph, camera, lighting          |
| Rapier 3D             | Physics engine (trimesh colliders for hit testing)   |
| Zustand               | State management (3 stores)                          |
| Tailwind CSS          | Utility-first styling for UI panels                  |
| Web Workers           | Off-main-thread mesh extraction and field generation |
| Biome                 | Linter and formatter                                 |
| TypeScript            | Type checking                                        |

### Directory Layout
```

apps/lbb/
src/
App.tsx Application root; initializes Rapier and terrain
main.tsx React entry point
app/ UI shell: Layout, Toolbar, InspectorPanel
editor/ EditorStore (Zustand), undo/redo, commands
input/ InputManager, GestureRouter, gesture handlers
render/ R3F Scene, TerrainChunkMesh, BrushCursor, debug overlays
session/ SessionStore (transient pointer/hover state)
world/ WorldStore (chunks, meshes, physics), entities
terrain/ Core terrain system (density field, mesher, brushes, workers)
test/
terrain/ Terrain unit tests (node:test + tsx)

```

### Subsystem Diagram

```

Toolbar / Inspector (React UI)
|
| reads/writes
v
EditorStore <--------- SessionStore
(tools, brush, (hover pos,
undo, render) pointer state)
| ^
| commitStroke | setHoverWorldPos
v |
WorldStore <------ InputManager + GestureRouter
(chunks, meshes, |
physics, dirty) | sculpt / orbit / dolly-pan
| v
| remeshDirtyChunks SculptGesture, OrbitGesture, DollyPanGesture
v
TerrainWorkerBridge -----> Web Workers (mesh extraction)
|
| applyMeshResult
v
R3F Scene
(TerrainChunkMesh, BrushCursor, Lighting, Debug Overlays)

```

### Initialization

1. `main.tsx` mounts the React app inside `StrictMode`.
2. `App.tsx` lazy-loads the Rapier WASM module (`ensureRapierInit()`).
3. Once Rapier is ready, `initPhysics()` creates a gravity world and `initTerrain({x:8, y:4, z:8})` dispatches chunk generation to workers.
4. Workers generate density fields via fBm noise and return them to the main thread.
5. When all 256 chunks are generated, halo padding is synced across neighbors and all chunks are marked dirty.
6. `TerrainUpdater` (a `useFrame` callback) drains dirty chunks each frame, dispatching meshing jobs to workers and flushing stale colliders.
7. Keyboard shortcuts for undo/redo (`Cmd/Ctrl + Z/Y`) are registered at the `App` level.

---

## 4. Terrain System

The terrain system is the core subsystem of LBB. It manages a volumetric density field,
extracts a polygonal surface from it, and keeps the rendered mesh synchronized with edits.

### 4.1 Density Field

Terrain geometry is defined by a 3D scalar density field. Each point in space has a
density value:

- **Positive** = solid material
- **Negative** = air
- **Zero** = the surface boundary (isosurface)

The field is subdivided into a regular grid of **chunks**. Each chunk covers a
32x32x32 voxel region (`CHUNK_SIZE = 32`).

### 4.2 Chunk Structure and Halo Padding

Each chunk stores a padded density array of 38x38x38 samples (`SAMPLES = 38`). The
extra samples form a **halo** of width 2 (`FIELD_PAD = 2`) around the core 32x32x32
region:

```

[pad=2] [-------- core 32+1 --------] [pad=2+1]
| 2 | 33 samples | 3 | = 38 per axis

```

The +1 accounts for the fence-post: meshing evaluates cells, and a 32-cell grid requires
33 sample points, plus padding on both sides.

The halo stores copies of neighboring chunks' density values. This allows the mesher
to evaluate gradients and place vertices near chunk boundaries without cross-chunk
lookups at runtime.

**Halo synchronization** (`syncChunkPadding`) copies density values from all 26
neighbors (faces, edges, corners) into the padding region before meshing. After a brush
edit, both the edited chunk and its neighbors must be marked dirty so their halos are
re-synced before remeshing.

### 4.3 Procedural Generation

Initial terrain is generated procedurally using 2D fractal Brownian motion (fBm) noise:

```

density(wx, wy, wz) = BASE_HEIGHT + fBm(wx, wz) \* HEIGHT_AMPLITUDE - wy

```

- `BASE_HEIGHT = 32` -- nominal surface height in world units
- `HEIGHT_AMPLITUDE = 12` -- vertical variation range
- `fBm` -- 4-octave 2D noise with smoothstep interpolation; frequency scaled by `NOISE_SCALE = 0.02`

The result is a gently rolling terrain surface near Y=32. Generation runs on Web Workers
via the `"generate"` message type.

### 4.4 Surface Nets Mesh Extraction

The mesher converts the density field into a triangle mesh using the **Surface Nets**
algorithm. Surface Nets is a dual contouring method that produces smoother meshes than
Marching Cubes with lower computational cost than Dual Contouring.

**Phase 1 -- Vertex placement:**

For each voxel cell whose 8 corners have mixed density signs (some positive, some
negative), the algorithm:

1. Identifies all 12 cube edges that cross zero density.
2. Linearly interpolates the zero-crossing position along each edge: `t = dA / (dA - dB)`.
3. Averages all crossing positions to determine the cell's vertex location.

Vertices on chunk boundaries are flagged so they can be excluded from relaxation and
normal smoothing, preserving cross-chunk seam alignment.

**Phase 2 -- Quad generation:**

For each grid edge where density changes sign, the mesher connects the four cells sharing
that edge into a quad (two triangles). Winding order is determined by the sign direction
to ensure outward-facing normals.

**Vertex relaxation** (optional, 2 iterations at factor 0.5):

Interior vertices are averaged toward their 6 face-adjacent neighbors. Boundary vertices
are pinned (never relaxed) to preserve seams.

### 4.5 Normal Computation

Normals are derived from the density field gradient using **tricubic Catmull-Rom
interpolation**. The interpolator evaluates a 4x4x4 neighborhood of samples and computes
analytical partial derivatives via Catmull-Rom basis weights.

The surface normal is `-gradient / ||gradient||` (negated because normals point away from
solid material, which has positive density).

Normals may be optionally smoothed over multiple iterations using vertex adjacency
averaging. Boundary normals are pinned during smoothing to preserve seam agreement.

Trilinear and tricubic sampling are never mixed within a single operation. Density
clamping before gradient evaluation introduces discontinuities and causes starburst
normal artifacts; it exists only as a debug option and is normally disabled.

### 4.6 Brush Editing

Brushes modify density values within a region defined by shape, radius, and falloff.

**Brush shapes:**

- **Sphere** -- distance from center; `t = dist / radius`
- **Cube** -- Chebyshev distance; `t = max(|dx|, |dy|, |dz|) / radius`
- **Cylinder** -- radial + vertical; `t = max(radial/r, |dy|/r)`

**Falloff:** Smoothstep function `1 - t^falloff * (3 - 2*t^falloff)` maps normalized
distance to intensity.

**Brush modes:**

| Mode    | Behavior                                                   |
| ------- | ---------------------------------------------------------- |
| Raise   | Increases density by `delta * falloff`                     |
| Lower   | Decreases density by `delta * falloff`; clamps at baseline |
| Smooth  | Blends toward 6-neighbor Laplacian average                 |
| Roughen | Adds 3D Perlin noise weighted by surface proximity         |
| Flatten | Drives density toward a target Y-plane set on first stroke |

Brush strength is frame-rate independent: `delta = effectiveStrength(strength) * dt`.
The effective strength uses a non-linear ramp (`raw + raw^3/45`) so high strength
values feel progressively more aggressive.

Each brush application produces a set of `TerrainPatch` records containing `{chunkId,
index, before, after}` values. These patches are the basis for undo/redo.

### 4.7 Edit -> Remesh -> Render Pipeline

The full pipeline from brush stroke to rendered mesh:

1. **`computeBrushPatches()`** -- Calculates density deltas for all affected voxels.
   Returns patches with before/after values.

2. **`applyFieldValues()`** -- Writes new density values into chunk fields. Increments
   chunk version counters. Marks the edited chunk and all 26 neighbors as dirty.

3. **`addPendingPatches()`** -- Accumulates patches in the editor store for the duration
   of the stroke (pointer-down to pointer-up).

4. **`remeshDirtyChunks(budget)`** -- Called each frame by `TerrainUpdater` (budget: 4
   chunks/frame). For each dirty chunk:
   a. Syncs halo padding from neighbors.
   b. Removes from dirty set, adds to inflight set.
   c. Records the chunk's version at dispatch time.
   d. Sends field to a worker for mesh extraction.

5. **Worker `extractSurfaceNets()`** -- Runs Surface Nets, computes tricubic normals,
   optionally relaxes vertices and smooths normals. Returns mesh data via transferable
   buffers (zero-copy).

6. **`applyMeshResult()`** -- Receives mesh from worker. Checks whether the chunk's
   current version matches the version at dispatch time. If the chunk was edited while
   the mesh was in flight (stale), the chunk is re-marked dirty for another pass. Marks
   the collider as stale.

7. **`flushStaleColliders(budget)`** -- Called each frame (budget: 2 chunks/frame).
   Rebuilds Rapier trimesh colliders from updated mesh geometry.

8. **React re-render** -- `TerrainChunkMesh` components read the updated `chunkMeshes`
   map and update Three.js buffer geometry.

### 4.8 Stale Mesh Handling

When a brush edits a chunk that already has an inflight meshing job, the returned mesh
will be based on outdated density data. The system detects this by comparing the chunk's
current version against the version recorded at dispatch time. If they differ, the result
is still applied (to avoid flicker) but the chunk is immediately re-marked dirty so a
fresh mesh will be generated.

This prevents visible seams that would occur if a stale mesh for one chunk was paired
with a fresh mesh for its neighbor.

---

## 5. Editor Interaction Model

### 5.1 Camera Control

The camera is positioned in 3D space and orbits around a world-space pivot point.

**Orbit** (Shift + left drag):

- Rotates the camera around the pivot using azimuth (world Y) and elevation (camera right
  axis) rotations.
- The pivot position is set to the terrain point under the cursor at drag start.
- Polar angle is clamped to avoid gimbal lock.
- Post-release velocity damping provides smooth inertia.

**Dolly/Pan** (Ctrl/Cmd + left drag):

- Horizontal drag pans camera and pivot along the camera's local X axis.
- Vertical drag dollies the camera toward/away from the pivot (or anchor point).
- Movement speed scales with camera-to-target distance.

**Wheel zoom:**

- Dollies toward/away from the orbit pivot.
- Distance clamped to [2, 1000].

**WASD + Q/E keyboard movement:**

- WASD translates camera and pivot in the horizontal plane (camera-relative forward/right).
- Q/E moves vertically.
- Speed scales with camera elevation.
- Smooth acceleration and deceleration.
- Disabled when a text input is focused.

### 5.2 Gesture Routing

Input is managed by a three-layer system:

1. **`InputManager`** -- Owns all raw DOM event listeners on the canvas. Translates
   pointer events into typed `PointerInput` values. Handles `setPointerCapture` for
   reliable drag tracking. Detects mid-drag modifier changes and swaps handlers without
   requiring a pointer-up/down cycle.

2. **`GestureRouter`** -- Maps modifier state to gesture handlers:
   - No modifier -> `SculptGesture`
   - Shift -> `OrbitGesture`
   - Ctrl/Cmd -> `DollyPanGesture`

3. **Gesture handlers** -- Each handler implements `begin()`, `move()`, `end()`, and
   `modifierChanged()`. Handlers can hand off to another handler mid-gesture via the
   reroute mechanism.

**`SpaceSculptController`** -- Allows spacebar to act as a virtual primary button for
sculpting, synthesizing pointer events from keyboard input.

### 5.3 Terrain Brushes

Brush parameters are controlled via the Toolbar:

- **Tool:** Raise, Lower, Smooth, Roughen, Flatten
- **Radius:** 1-16 voxels
- **Strength:** 0.5-20 voxels/second
- **Shape:** Sphere, Cube, Cylinder
- **Falloff:** 0.1-5 (exponent controlling edge softness)

The `SculptGesture` handler calls `applyBrush()` every frame during a drag. Brush
application is time-scaled by the R3F frame delta (capped at 1/15s to avoid large jumps
after tab-away or debugger pauses).

### 5.4 Cursor Hit Testing

The brush cursor position is determined by R3F's built-in raycasting against the terrain
mesh geometry. Pointer events on the `<Terrain>` group update `hoverWorldPos` in the
session store. The `BrushCursor` component renders a wireframe shape (sphere, cube, or
cylinder) at the hover position.

Rapier trimesh colliders back the terrain mesh for physics-based hit testing, though the
primary hover position currently comes from R3F raycasting.

### 5.5 Undo/Redo Model

Undo/redo uses a command pattern:

1. During a brush stroke (pointer-down to pointer-up), all density patches are accumulated
   in `pendingPatches`.

2. On stroke commit (`commitStroke()`), patches are merged by `(chunkId, index)` key,
   keeping the original `before` and final `after` values. A `TerrainPatchCommand` is
   created and recorded on the `UndoStack`.

3. `UndoStack` maintains two stacks (undo/redo) with a capacity of 100 commands. Redo is
   cleared on any new command. Undo replays the `before` values; redo replays the `after`
   values.

4. Keyboard shortcuts: Cmd/Ctrl+Z for undo, Cmd/Ctrl+Y for redo.

Commands are designed to be reversible and deterministic. The `UndoStack` notifies the
editor store of state changes so the UI reflects undo/redo availability.

---

## 6. Rendering System

### 6.1 R3F Scene Structure

The `Scene` component sets up the R3F Canvas:

- **Shadows:** `PCFSoftShadowMap`
- **Camera:** Perspective, FOV 55, position [160, 50, 160], near 0.5, far 1500
- **Background:** Dark navy (#1a1a2e) with distance fog (250-500 range)

Scene children:

- `<Lighting>` -- Hemisphere, ambient, directional main + fill lights
- `<Terrain>` -- Group of `<TerrainChunkMesh>` components
- `<TerrainUpdater>` -- Frame callback driving remesh/collider flush
- `<BrushCursor>` -- Wireframe brush preview at hover position
- `<InputHandler>` -- Wires input system into the R3F lifecycle
- `<VoxelSamplesOverlay>` -- Conditional debug visualizations

### 6.2 Lighting

| Light            | Color/Config                         | Intensity |
| ---------------- | ------------------------------------ | --------- |
| Hemisphere       | Sky #b1c8e0 / Ground #3a3020         | 0.6       |
| Ambient          | White                                | 0.25      |
| Directional main | Position [160, 180, 120], shadows    | 1.0       |
| Directional fill | Position [-80, 100, -60], no shadows | 0.2       |

Shadow map: 2048x2048, camera bounds -200 to 200, bias -0.0005, normal bias 0.3.

### 6.3 Terrain Mesh Rendering

Each chunk's mesh is rendered by a `TerrainChunkMesh` component. It creates Three.js
`BufferGeometry` with position, normal, and index attributes from the `MeshData` produced
by workers.

**Shading modes:**

| Mode         | Material                                            |
| ------------ | --------------------------------------------------- |
| Default      | `MeshStandardMaterial`, green (#5a8f3c), PBR        |
| Plain        | `MeshStandardMaterial`, light gray, no flat shading |
| Normals      | `MeshNormalMaterial` (RGB = normal direction)       |
| Gradient mag | `MeshBasicMaterial` with vertex colors (grayscale)  |

All materials support wireframe toggle and double-sided rendering. Meshes cast and
receive shadows.

### 6.4 Debug Overlays

When enabled via the toolbar, `VoxelSamplesOverlay` renders point clouds for each chunk:

- **Density sign** -- All 38^3 sample points, colored blue (solid) or red (air).
- **Active cells** -- Amber points at centers of cells where the isosurface passes.
- **Edge intersections** -- Cyan points at linearly interpolated zero-crossings on cell
  edges (the raw surface intersection points).
- **Surface vertices** -- Green points at final mesh vertex positions (post-relaxation).

### 6.5 Frame Budget

`TerrainUpdater` runs at R3F priority -10 (early in the frame) and processes:

- Up to 4 dirty chunk remesh dispatches per frame
- Up to 2 stale collider rebuilds per frame

This budgeting prevents frame drops during large edits by spreading work across multiple
frames.

---

## 7. State Architecture

### 7.1 EditorStore

Owns tool and rendering configuration:

- Active tool (raise/lower/smooth/roughen/flatten)
- Brush parameters (radius, strength, shape, falloff)
- Pending patches for the current stroke
- Flatten target (set on first contact with terrain)
- Undo/redo state (counts, can-undo/can-redo flags)
- Render options (wireframe, shading mode, normal smoothing iterations)
- Debug options (voxel debug mode, density clamping, brush logging)

The editor store also hosts the `UndoStack` instance and exposes `commitStroke()`,
`undo()`, and `redo()` actions.

### 7.2 WorldStore

Owns all terrain and physics data:

- `chunks: Map<string, ChunkData>` -- Density fields keyed by `"cx,cy,cz"`
- `chunkMeshes: Map<string, ChunkRenderData>` -- Mesh + collider per chunk
- `dirtyChunks: Set<string>` -- Chunks needing remesh
- `inflightChunks: Set<string>` -- Chunks with pending worker jobs
- `staleColliders: Set<string>` -- Chunks needing collider rebuild
- `densityRange: {min, max}` -- Global density extremes
- `entities: Record<EntityId, Entity>` -- Entity registry (skeleton for future use)
- `rapierWorld` / `rapierModule` -- Physics engine references

Key actions: `initTerrain()`, `applyFieldValues()`, `remeshDirtyChunks()`,
`flushStaleColliders()`, `markChunkDirty()`.

The world store includes seam debug instrumentation (`seamDebug`) that tracks version
numbers at mesh dispatch time to detect and log stale mesh results. This is diagnostic
infrastructure that can be enabled at runtime via browser console.

### 7.3 SessionStore

Owns transient, frame-level state:

- `hoverWorldPos` -- World-space position under the cursor (from R3F raycasting)
- `isPointerDown` -- Whether the primary button is held
- `cameraTarget` / `cameraDistance` -- Camera parameters (reserved for future use)

### 7.4 Ownership Boundaries

Each store has exclusive ownership of its domain:

- **EditorStore** never reads or writes chunk data.
- **WorldStore** never reads brush parameters directly (they are passed in via action
  parameters).
- **SessionStore** is written by the input system and read by rendering/input; it holds
  no terrain or editor state.

The one cross-store dependency is `commitStroke()`, which reads `pendingPatches` from
the editor store and records a command that will call `WorldStore.applyFieldValues()`
on undo/redo. The editor store also reads `normalSmoothing` and passes it to the world
store's meshing actions.

---

## 8. Worker Pipeline

### 8.1 Worker Pool

`TerrainWorkerBridge` maintains a pool of 1-4 Web Workers (capped at
`navigator.hardwareConcurrency`). Jobs are distributed round-robin.

Each worker runs `terrain.worker.ts`, which handles two message types:

- **`"generate"`** -- Calls `generateChunkField(coord)` and returns the density field.
- **`"mesh"`** -- Calls `extractSurfaceNets(field, coord, options)` and returns mesh data.

### 8.2 Message Protocol

Requests carry a unique `id` for matching responses. The bridge uses `Promise`-based
async tracking with `pendingMesh` and `pendingGenerate` maps keyed by request ID.

**Zero-copy transfers:** Field and mesh data are sent as transferable `ArrayBuffer`
objects to avoid GC pressure. The bridge creates a fresh `Float32Array` copy of the field
before sending to avoid transferring the live chunk field.

### 8.3 Performance Rationale

Mesh extraction (Surface Nets + tricubic normals + relaxation + normal smoothing) is the
most expensive per-chunk operation. Running it on workers keeps the main thread free for
input handling and rendering. The frame-budgeted dispatch (4 chunks/frame) prevents
worker saturation during large edits.

Field generation at startup also runs on workers to parallelize the initial 256-chunk
grid construction.

---

## 9. Testing Strategy

The test suite uses Node's built-in test runner (`node:test`) with `tsx` for TypeScript.
Tests run outside the browser, importing terrain system modules directly.

### 9.1 Test Infrastructure

**Fixtures** provide deterministic density functions:

- `flatPlane(height)` -- Horizontal surface at a given Y level
- `sphere(center, radius)` -- Sphere of given radius
- `slopedHill(baseHeight, slopeX, slopeZ)` -- Linearly sloped terrain
- `tunnel(center, axis, radius, groundHeight)` -- Cylindrical tunnel

**Helpers** provide chunk construction, field filling, mesh vertex queries, and
approximate equality assertions.

### 9.2 Test Categories

**Determinism** -- Verifies that identical density fields produce byte-identical meshes
across multiple runs. Covers flat planes, spheres, and edited fields.

**Field continuity** -- Verifies that density values agree at chunk boundaries across
all three axes, including multi-axis edges and 8-chunk corners. Tests both flat and
curved (sphere) fields.

**Halo synchronization** -- Verifies that editing a chunk and re-syncing halos correctly
propagates density values to all 26 neighbors. Tests single-axis, multi-axis, and corner
propagation.

**Mesh seam correctness** -- Verifies that vertices at chunk boundaries coincide between
adjacent chunks. Tests flat planes and spheres across X, Y, and Z boundaries.

**Normal boundary agreement** -- Verifies that normals at co-located boundary vertices
agree between adjacent chunks. Tests with varying numbers of normal smoothing iterations.

**Vertex relaxation seams** -- Verifies that vertex relaxation (position smoothing) does
not break seam alignment. Tests all three axes with flat planes and curved surfaces.

**Brush operations** -- Verifies patch generation for all brush modes. Tests chunk
overlap at boundaries (1, 2, 4, 8 affected chunks). Verifies smooth reduces variation,
roughen introduces continuous variation, flatten drives toward target, and roughen is
deterministic.

**Stale mesh detection** -- Demonstrates that meshing a chunk with a stale neighbor field
produces seams, validating the version-tracking mitigation in the production pipeline.

**Overlap field divergence** -- Verifies that overlap-region field values remain
consistent during boundary edits, and that overlap vertices align after edits.

### 9.3 Design Invariants Under Test

The test suite is specifically designed to catch:

- **Chunk seam errors** -- Vertices or normals misaligned at boundaries
- **Halo sync errors** -- Stale padding data producing incorrect mesh near edges
- **Non-deterministic meshing** -- Any runtime state leaking into mesh output
- **Gradient discontinuities** -- Normals jumping at boundaries due to sampling errors
- **Relaxation/smoothing boundary leaks** -- Smoothing operations moving boundary
  vertices out of alignment

---

## Future Systems

The following systems are planned but not yet implemented. They represent the long-term
creative direction of LBB.

---

### F1. Creature Creator

Inspired by the Spore Creature Creator.

Creatures are represented as high-resolution voxel fields (finer grid than terrain).
The body is structured around an articulated spine with a variable number of segments.
Spline nodes control body thickness along the spine's length.

**Limbs** attach to spine nodes and contain joints for articulation. **Senses** (eyes,
ears) and **mouths** attach to specific body regions. **Accessories** can be placed
freely.

The creature editor will share tooling with the sculpt system (brush tools, symmetry,
voxel-field manipulation).

---

### F2. Sculpt System

A general-purpose sculpting system inspired by Media Molecule's Dreams (PS4).

Users sculpt arbitrary objects -- trees, buildings, props, decorations -- using
voxel-field editing and node-based shaping tools. Sculpted objects exist as independent
voxel fields that can be placed in the world.

**Advanced sculpt tools:**

- Mirror sculpting -- edit one side, the other mirrors automatically
- Kaleidoscope / faceted sculpting -- radial pattern replication
- Radial symmetry -- N-way rotational duplication of edits

The goal is expressive creation without the tedium of traditional 3D modeling.

---

### F3. Unified Editing Model

The creature creator and sculpt system share a common editing foundation:

- Voxel-field density editing
- Brush tools with shape/radius/falloff/strength
- Symmetry tools (mirror, radial, kaleidoscope)
- Node manipulation (spine nodes, attachment points)

This unification keeps the codebase smaller and gives users a consistent experience
across creation modes.

---

### F4. Programmable Entities

Creatures and sculpted objects will receive **Mindcraft brains** -- visual programs that
control entity behavior through sensors and actuators.

- **Archetypes** define default behaviors shared by a class of entities.
- **Instances** can override archetype behaviors with custom logic.
- Brains interact with the simulation through a sensor/actuator API.

The entity system skeleton (`entities.ts`) already defines `EntityId`, `Transform`, and
stub component slots for render, brain, and physics components.

---

### F5. Programmable Lighting

Lighting will become a user-controllable creative tool:

- Editable lighting environments (sky color, sun direction, fog)
- Programmable lights that can be placed in the world
- Brain API access to lighting parameters for dynamic effects

---

### F6. Entity Infrastructure

The `commands.ts` file lists planned command types for the undo system:

- `EntityCreateCommand`
- `EntityDeleteCommand`
- `EntityTransformCommand`
- `PropertyChangeCommand`
- `BrainEditCommand`

These will extend the undo/redo system to cover entity manipulation, property editing,
and brain programming.
