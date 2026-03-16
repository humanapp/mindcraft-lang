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

- **Creature creation** -- Users build creatures using a sculpt field system based on
  composable signed distance fields. Creatures support articulated spines, attachable
  limbs and joints, senses and mouths, and organic body shapes built through brush-based
  sculpting. Inspired by the Spore Creature Creator.

- **Object sculpting** -- A general-purpose sculpt system (inspired by Media Molecule's
  Dreams) lets users create trees, buildings, props, and decorations using sculpt field
  editing with tools like mirror sculpting, kaleidoscope patterns, and radial symmetry.

- **Programmable entities** -- Creatures and objects receive Mindcraft brains -- visual
  programs that control behavior through sensors and actuators. Archetypes define shared
  default behaviors; individual instances can override them.

- **Programmable environment** -- Lighting environments, placed lights, and atmospheric
  effects are user-editable and accessible through brain tiles for dynamic control.

Terrain uses a voxel density-field system optimized for large continuous landscapes.
Creatures and sculpted objects use a sculpt field system based on composable signed
distance fields, supporting organic shapes, smooth blending, and high-resolution detail.
Both systems share brush tools, symmetry operations, and reversible edit infrastructure.

The application is built with Vite, React 19, Three.js (via React Three Fiber), and
Rapier 3D physics. Heavy computation (mesh extraction, field generation) runs on Web
Workers. The current implementation establishes the terrain sculpting foundation; the
creature creator, sculpt system, and entity programming are planned future systems.

---

## 2. Product Goals

- **Direct sculpt interaction** -- Editing should feel immediate, tactile, and readable.
  Brush-based sculpting is the primary creation model.

- **Deterministic terrain output** -- Identical density inputs must produce identical mesh
  outputs. Terrain meshing must be repeatable and testable outside the browser.

- **Invisible chunk seams** -- Chunk boundaries must remain visually continuous. Mesh
  positions, normals, and smoothing behavior must agree across chunk edges.

- **Responsive editing under load** -- Heavy computation must run off the main thread so
  input and camera interaction remain smooth during sculpting.

- **Shared editing foundation** -- Terrain, creatures, and sculpted objects should all
  build on common infrastructure: brush edits, meshing pipelines, symmetry tools, and
  reversible edit commands. Terrain uses a voxel density field; creatures and sculpt
  objects use a composable sculpt field (SDF-based).

- **Clear subsystem boundaries** -- Data ownership, system responsibilities, and cross-
  subsystem contracts must be explicit so the codebase can grow without turning into a
  monolith.

- **Scalability to larger worlds** -- The architecture should support chunk streaming,
  job prioritization, save/load, and multiple voxel-field types, even if the current
  implementation begins with a fixed terrain grid.

- **Strong regression protection** -- The terrain pipeline must be backed by automated
  tests that catch seam regressions, halo synchronization bugs, stale mesh behavior, and
  non-deterministic output.

---

## 3. Non-Goals for the Current Phase

The current phase does not attempt to fully solve:

- Infinite world streaming
- Level of detail (LOD) terrain
- Persistent world serialization
- Creature editing
- Freeform sculpt objects
- General entity gameplay systems
- Brain runtime integration
- Production lighting authoring tools

The architecture should leave room for these systems without requiring a full rewrite.

---

## 4. Architectural Principles

### 4.1 Separate data from presentation

Voxel field storage, meshing, rendering, physics, and editor UI are distinct layers.
No single store or module should own all of them.

### 4.2 Prefer explicit state transitions

Chunk lifecycle should be modeled as an explicit state machine rather than an implicit
sequence of booleans and sets.

### 4.3 Make edit history first-class

All user edits should be representable as reversible commands backed by deterministic
data patches.

### 4.4 Define stable subsystem contracts

Future systems should be able to reuse voxel editing and meshing without depending on
terrain-specific rendering or physics assumptions.

### 4.5 Bias toward testable pure functions

Density sampling, patch computation, halo synchronization, and mesh extraction should be
testable without React, R3F, or the browser.

---

## 5. Technology Stack

| Dependency            | Role                                                     |
| --------------------- | -------------------------------------------------------- |
| Vite                  | Bundler, dev server, HMR                                 |
| React 19              | UI shell, providers, inspector, toolbar                  |
| Three.js / R3F / Drei | 3D rendering, scene graph, camera, helpers               |
| Rapier 3D             | Physics and collision queries                            |
| Zustand               | App-level state stores                                   |
| Tailwind CSS          | Editor UI styling                                        |
| Web Workers           | Off-main-thread field generation and mesh extraction     |
| Biome                 | Formatting and linting                                   |
| TypeScript            | Static typing                                            |
| Node test runner      | Deterministic terrain pipeline tests outside the browser |

---

## 6. High-Level Architecture

### 6.1 Main subsystems

LBB is organized around the following major subsystems:

1. **Editor UI Layer**
   - Toolbar
   - Inspector panels
   - Debug controls
   - Undo/redo controls

2. **Input and Gesture Layer**
   - Pointer and keyboard input capture
   - Gesture routing
   - Sculpt / orbit / dolly-pan controllers

3. **Voxel Data Layer**
   - Density field storage
   - Chunk indexing
   - Halo synchronization
   - Patch application
   - Field versioning

4. **Meshing Pipeline**
   - Dirty chunk scheduling
   - Worker job dispatch
   - Surface Nets extraction
   - Normal generation
   - Stale result handling

5. **Rendering Layer**
   - R3F scene setup
   - Chunk mesh presentation
   - Brush cursor
   - Debug overlays

6. **Physics Layer**
   - Terrain colliders
   - Hit testing support
   - Future entity-body integration

7. **Edit History Layer**
   - Stroke accumulation
   - Command creation
   - Undo/redo replay

8. **Future Entity Layer**
   - Creature fields
   - Sculpt objects
   - Entities with transforms, render bindings, brain bindings, and physics bindings

### 6.2 Data flow

The intended data flow is:

```text
Input -> Gesture -> Brush Operation -> Field Patch Application -> Chunk Dirtiness
-> Meshing Scheduler -> Worker Extraction -> Mesh Result Application
-> Collider Update -> Rendered Scene
```

Undo and redo re-enter the pipeline at the field patch application step.

### 6.3 Ownership model

Ownership is intentionally split:

- **EditorStore** owns editing configuration and undo state.
- **SessionStore** owns transient interaction state.
- **WorldStore** owns world-level registries and orchestration.
- **Voxel field modules** own density storage and field operations.
- **Meshing pipeline modules** own worker jobs and chunk mesh lifecycle.
- **Render components** present current mesh state but do not compute terrain.

The architecture should resist the tendency to turn `WorldStore` into a catch-all owner of
every subsystem.

---

## 7. Coordinate Systems

LBB uses several coordinate spaces. These must remain explicit.

### 7.1 World space

Continuous 3D coordinates used by camera, rendering, physics, and entity transforms.

### 7.2 Chunk space

Integer chunk coordinates `(cx, cy, cz)` that identify a chunk in the world grid.

### 7.3 Local voxel space

Coordinates local to a chunk's editable cell region. A chunk with `CHUNK_SIZE = 32`
contains 32 x 32 x 32 editable cells.

### 7.4 Sample space

Coordinates into the chunk's padded density sample array. Sample space includes halo
padding and the fence-post sample row needed for cell extraction.

### 7.5 Render space

Currently identical to world space. This may diverge later if non-uniform scale, preview
modes, or specialized editors are introduced.

### 7.6 Conversion rules

The system must provide stable helpers for conversion between:

- world position <-> chunk coordinate
- world position <-> local voxel coordinate
- local voxel coordinate <-> sample index
- chunk coordinate + local voxel coordinate <-> world position

These conversions are part of the architecture, not incidental implementation detail.

---

## 8. Directory Layout

```text
apps/lbb/
  src/
    App.tsx              Application root
    main.tsx             React entry point

    app/                 Layout, toolbar, inspector, panels
    editor/              EditorStore, undo/redo, commands
    input/               InputManager, GestureRouter, gesture handlers
    session/             SessionStore
    render/              Scene, terrain mesh presentation, cursor, overlays
    world/               World orchestration and registries

    world/terrain/       Terrain system (all modules currently flat in this directory)

  test/
    terrain/             Deterministic terrain tests
```

A future refactoring may split `world/terrain/` into subdirectories (field, meshing,
generation, physics, editing) as the system grows. The current layout is flat.

---

## 9. Application Initialization

1. `main.tsx` mounts the React app inside `StrictMode`.
2. `App.tsx` initializes the UI shell and ensures Rapier is ready.
3. `WorldStore` initializes world registries and terrain configuration.
4. Terrain generation jobs are dispatched for the initial chunk region.
5. Generated chunk fields are inserted into the voxel data layer.
6. Halo synchronization is performed for all initialized chunks.
7. Initialized chunks enter the dirty pipeline for first mesh extraction.
8. Meshing results are applied and collider updates are scheduled.
9. The scene begins interactive updates through the frame loop.
10. Keyboard shortcuts and input event capture are registered.

Initialization should be robust to future streaming. The current fixed-grid startup is an
initial implementation, not a permanent world model.

---

## 10. Terrain Domain Model

### 10.1 Terrain representation

Terrain is represented as a scalar density field:

- Positive density = solid
- Negative density = air
- Zero density = surface boundary

The terrain field is subdivided into chunks.

### 10.2 Chunk dimensions

Current terrain chunks use:

- `CHUNK_SIZE = 32` cells per axis
- `FIELD_PAD = 2`
- `SAMPLES = 38` samples per axis

This layout supports:

- 33 core sample points needed for 32 cells
- 2 samples of halo padding on the negative side
- 3 samples of effective margin on the positive side due to fence-post and stencil needs

The asymmetry should be described by exact stencil requirements, not by casual shorthand.

### 10.3 Chunk contents

Each terrain chunk conceptually contains:

- Chunk coordinate
- Density sample storage
- Version counter
- Dirty state
- Optional mesh state
- Optional collider state
- Optional debug metadata

### 10.4 Density storage abstraction

Density storage should be treated as a subsystem interface, not just an implementation
detail.

Initial implementation:

- `Float32Array`

Future-compatible requirements:

- serialization
- compression
- pooling
- alternate resolutions
- shared field operations for creature and sculpt systems

Recommended conceptual interface:

```ts
interface DensityFieldStorage {
  getSample(index: number): number;
  setSample(index: number, value: number): void;
  cloneBuffer(): Float32Array;
}
```

The actual implementation may remain a raw `Float32Array` initially.

---

## 11. Chunk Topology and Halo Synchronization

### 11.1 Why halo padding exists

Meshing and gradient evaluation require samples outside the editable core region. Cross-
chunk runtime lookups inside hot loops are undesirable and complicate worker execution.

Halo padding solves this by copying neighbor data into each chunk's padded sample region
before meshing.

### 11.2 Halo synchronization contract

`syncChunkPadding` must guarantee:

- All face-neighbor overlap samples are copied correctly
- All edge-neighbor overlap samples are copied correctly
- All corner-neighbor overlap samples are copied correctly
- Halo contents match authoritative neighbor core samples at meshing time

### 11.3 Dirtying rules after edits

A field edit affecting chunk `C` must:

- mark `C` as field-modified
- mark `C` as mesh-dirty
- mark neighboring chunks as halo-dirty if their halo depends on changed values
- ensure neighboring chunks are remeshed when their surface output may change

The current practical rule is to dirty the edited chunk and all 26 neighbors. That is
safe and simple. Later optimization may narrow this to only affected neighbors.

### 11.4 Scalability note

Full 26-neighbor dirtying is correct but potentially expensive for heavy editing. The
architecture should permit future refinement such as:

- dirty-face tracking
- lazy halo refresh
- shared border caches
- edit-region-aware neighbor invalidation

---

## 12. Procedural Terrain Generation

### 12.1 Current generation model

Initial terrain is generated procedurally from 2D fractal Brownian motion (fBm):

```text
density(wx, wy, wz) = BASE_HEIGHT + fBm(wx, wz) * HEIGHT_AMPLITUDE - wy
```

Current parameters:

- `BASE_HEIGHT = 32`
- `HEIGHT_AMPLITUDE = 12`
- `NOISE_SCALE = 0.02`
- 4 octaves of 2D noise with smooth interpolation

### 12.2 Determinism requirements

Generation is currently deterministic via a fixed hash function but is not yet
seed-parameterized. Adding an explicit `worldSeed` input is a future requirement.

Deterministic generation is needed for:

- reproducible tests
- save/load
- replay
- streaming worlds
- collaborative editing in future systems

### 12.3 Current implementation note

The current app initializes a fixed `8 x 4 x 8` chunk region. This is an implementation
choice for the current phase, not a long-term architectural assumption.

---

## 13. Meshing Pipeline

### 13.1 Purpose

The meshing pipeline transforms authoritative density data into renderable geometry and
collision geometry.

### 13.2 Mesh algorithm

Terrain uses Surface Nets because it offers a strong balance between smooth output,
topological simplicity, and runtime cost.

### 13.3 Surface Nets extraction overview

For each chunk:

1. Identify active cells whose corner signs differ.
2. For each active cell, find zero-crossing points on cell edges.
3. Average those crossings to place a dual vertex.
4. Connect neighboring active cells into quads along sign-changing grid edges.
5. Emit triangles with consistent winding.

### 13.4 Vertex smoothing

Optional vertex relaxation may be applied to interior vertices only.

Rules:

- boundary vertices are pinned
- smoothing iterations are bounded
- smoothing must not change seam alignment

### 13.5 Normal generation

Normals are derived from the density field gradient using tricubic Catmull-Rom
interpolation over a 4 x 4 x 4 neighborhood.

Rules:

- a single operation must not mix trilinear and tricubic assumptions
- density clamping before gradient evaluation is not part of the normal path
- boundary normal smoothing must preserve chunk agreement

### 13.6 Mesh output contract

Each mesh result contains at minimum:

- chunk id
- vertex positions
- vertex normals
- gradient magnitude per vertex
- indices

This result is immutable once returned from the worker. Source field version tracking
is maintained on the main thread side, not in the worker response.

---

## 14. Chunk Mesh State Machine

Chunk mesh lifecycle should be modeled explicitly.

### 14.1 States

```text
Uninitialized
FieldReady
HaloDirty
MeshDirty
MeshingQueued
MeshingInFlight
MeshReady
ColliderDirty
Ready
```

### 14.2 State meanings

- **Uninitialized** -- no authoritative field exists yet
- **FieldReady** -- field exists and halo is believed current
- **HaloDirty** -- field exists but overlap data must be refreshed before meshing
- **MeshDirty** -- chunk requires a new mesh
- **MeshingQueued** -- eligible for worker dispatch
- **MeshingInFlight** -- a worker is processing a snapshot
- **MeshReady** -- a new mesh has been applied
- **ColliderDirty** -- collider should be updated from current mesh
- **Ready** -- mesh and collider match the authoritative field version

### 14.3 Transition examples

- field edit -> `HaloDirty`
- halo refresh -> `MeshDirty`
- job dispatch -> `MeshingInFlight`
- accepted mesh result -> `MeshReady` then `ColliderDirty`
- collider rebuild -> `Ready`
- stale mesh result -> apply provisional mesh, then return to `MeshDirty`

This state model should replace purely ad hoc combinations of dirty sets over time.

---

## 15. Worker Architecture

### 15.1 Worker responsibilities

Workers perform computationally heavy, deterministic tasks:

- terrain field generation
- mesh extraction
- normal computation
- optional smoothing steps

Workers do not own authoritative world state.

### 15.2 Worker pool

`TerrainWorkerBridge` maintains a small worker pool, currently bounded by
`navigator.hardwareConcurrency` with a cap of 4.

### 15.3 Message types

Initial protocol:

- `"generate"` -- create a density field for a chunk
- `"mesh"` -- extract a mesh from a field snapshot

Each request includes:

- unique job id
- chunk id and coordinate
- job-specific payload (field snapshot for mesh, nothing extra for generate)
- deterministic options (e.g. normal smoothing iterations)

Source field version is not included in the worker protocol. Version tracking for stale
result detection is handled on the main thread via a dispatch-time version snapshot.

### 15.4 Job queue model

The pipeline should explicitly support:

- queued jobs
- inflight jobs
- stale result rejection or requeue
- per-chunk deduplication
- bounded queue growth

### 15.5 Priority strategy

The scheduler should prefer:

1. recently edited chunks
2. chunks near the camera
3. chunks near visible interaction zones
4. background initialization work

This matters once the world grows beyond the current fixed startup region.

### 15.6 Cancellation model

Workers may still finish stale jobs. The main thread remains authoritative.

Result handling policy:

- compare returned source version with current chunk version
- accept if current
- if stale, optionally apply as provisional visual output, then requeue fresh meshing

The current policy of provisional apply + re-dirty is acceptable for this phase.

### 15.7 Memory movement

Fields and mesh buffers are transferred using transferable `ArrayBuffer`s.

Current implementation copies the live field before transfer. This is correct but may
become expensive at scale. The architecture should leave room for:

- pooled field snapshots
- shared memory
- buffer reuse
- incremental meshing inputs

---

## 16. Edit -> Remesh -> Render Pipeline

### 16.1 Brush edit path

1. Compute affected field samples from brush configuration and hit point.
2. Produce `TerrainPatch` records with `{chunkId, index, before, after}`.
3. Apply authoritative field mutations.
4. Increment chunk version counters.
5. Mark edited and dependent chunks dirty.
6. Accumulate patches for undo/redo if inside an active stroke.

### 16.2 Meshing path

1. Refresh halo data for eligible dirty chunks.
2. Snapshot current field data and version.
3. Queue or dispatch worker job.
4. Receive mesh result.
5. Compare versions and accept or requeue accordingly.
6. Update renderable mesh registry.
7. Mark collider update required.

### 16.3 Render path

1. `TerrainChunkMesh` reads current mesh data.
2. Three.js `BufferGeometry` updates are applied.
3. Material mode reflects editor settings.
4. Cursor and overlays render using current session/editor state.

### 16.4 Collider path

1. Mesh application marks collider dirty.
2. Collider update system rebuilds the chunk collider from current mesh.
3. Physics world swaps the old collider for the new one.
4. Collider version should track the mesh version it represents.

Collider updates should be treated as a separate system, not merely a postscript to
meshing.

---

## 17. Brush Editing System

### 17.1 Shared brush model

Brushes are reusable editing operators over voxel fields. Terrain is the first consumer.

Common brush parameters:

- mode
- shape
- radius
- strength
- falloff
- optional target parameters

### 17.2 Brush shapes

Supported shapes:

- sphere
- cube
- cylinder

Shape evaluation must be expressed in field-local coordinates.

### 17.3 Falloff model

The current falloff uses a smoothstep-derived curve controlled by an exponent-like input.
The spec should preserve the user-facing control and the invariant that intensity drops
smoothly toward the edge.

### 17.4 Brush modes

Current terrain modes:

- raise
- lower
- smooth
- roughen
- flatten

Each mode must define:

- affected sample selection
- patch computation rule
- determinism expectations
- whether the operation depends on existing neighboring sample values

### 17.5 Frame-rate independence

Brush strength is time-scaled. The system currently caps `dt` to avoid large jumps after
tab-away or debugging pauses. That is correct and should remain part of the contract.

### 17.6 TerrainPatch model

Brush output is a list of reversible sample edits:

```ts
type TerrainPatch = {
  chunkId: string;
  index: number;
  before: number;
  after: number;
};
```

This patch format is intentionally field-centric and should remain reusable across
terrain-like voxel editors.

### 17.7 Memory considerations

Large strokes can generate many patches. The architecture should allow future:

- patch coalescing
- run-length compression
- region compression
- command memory budgeting

---

## 18. Undo/Redo System

### 18.1 Command model

Undo/redo is command-based. Terrain editing creates a `TerrainPatchCommand` from all
patches accumulated during a stroke.

### 18.2 Stroke lifecycle

1. Pointer-down begins a stroke.
2. Brush applications accumulate pending patches.
3. Pointer-up commits a command.
4. Command is pushed onto the undo stack.
5. Redo stack is cleared on new user action.

### 18.3 Merge behavior

For repeated edits to the same sample during a stroke:

- preserve the original `before`
- preserve the final `after`

This merge rule is correct and should be stated as an invariant.

### 18.4 Capacity and budgeting

Current capacity of 100 commands is acceptable for the first phase, but the system should
be described in terms of memory budget rather than command count over time.

Future extensions may include:

- command byte-size estimation
- adaptive history truncation
- snapshot plus delta schemes

### 18.5 Future command families

The same command infrastructure should support:

- entity creation/deletion
- entity transforms
- property changes
- sculpt edits
- creature edits
- brain edits

---

## 19. Input and Gesture System

### 19.1 Input architecture

The input layer is split into:

1. `InputManager`
2. `GestureRouter`
3. gesture handlers

This is a good separation and should remain.

### 19.2 InputManager responsibilities

- own DOM event listeners
- normalize raw input
- manage pointer capture
- track modifier keys
- forward typed events to the gesture router

### 19.3 GestureRouter responsibilities

- choose active gesture handler from current mode + modifiers
- support gesture handoff during modifier changes
- keep tool logic out of raw DOM code

### 19.4 Gesture handlers

Current handlers:

- sculpt
- orbit
- dolly-pan

Each handler implements:

- `begin()`
- `move()`
- `end()`
- `modifierChanged()`

### 19.5 Virtual primary action

`SpaceSculptController` allows the spacebar to act as a virtual primary sculpt action.
This is an implementation convenience and should remain optional at the architecture
level.

---

## 20. Camera Model

### 20.1 Current controls

- Shift + left drag -> orbit
- Ctrl/Cmd + left drag -> dolly-pan
- wheel -> zoom
- WASD + Q/E -> free translation

### 20.2 Camera state

The camera orbits around a world-space pivot.

The architecture should store:

- pivot point
- yaw / pitch or equivalent orientation
- distance
- optional inertial velocity state

### 20.3 Long-term note

Camera control should eventually be its own subsystem rather than a side effect of
session state. Creature editing, object sculpting, and terrain editing may want distinct
camera defaults while sharing the same underlying controller.

---

## 21. Hit Testing and Cursor Placement

### 21.1 Current approach

Current hover position comes primarily from R3F raycasting against rendered terrain
geometry. Rapier terrain colliders also exist and may support physics-driven queries.

### 21.2 Architectural guidance

Hit testing should be treated as its own service with a stable contract:

```ts
type TerrainHit = {
  worldPos: Vector3Like;
  normal?: Vector3Like;
  chunkId?: string;
};
```

### 21.3 Future-proofing

Long term, the system may choose among:

- render mesh raycast
- physics collider query
- direct field raymarch / density intersection

The rest of the editor should not care which implementation is currently backing hits.

---

## 22. Rendering System

### 22.1 Scene contents

The R3F scene contains:

- camera and controls
- lighting
- terrain chunk meshes
- brush cursor
- debug overlays
- frame-driven update hooks

### 22.2 Terrain presentation

Each chunk mesh is rendered by a `TerrainChunkMesh` component that consumes current mesh
data and produces a Three.js `BufferGeometry`.

### 22.3 Material modes

Current material/debug modes:

- default terrain shading
- plain shaded
- normal visualization
- gradient magnitude visualization
- optional wireframe

These are rendering concerns only. They do not affect authoritative terrain data.

### 22.4 Rendering scalability concerns

Per-chunk mesh components are acceptable at current scale. Future larger worlds may need:

- geometry pooling
- aggressive disposal discipline
- chunk visibility culling
- instancing where applicable
- streaming-aware render registries

The spec should acknowledge this explicitly.

---

## 23. Physics System

### 23.1 Current role

Rapier is currently used for terrain colliders and supports terrain interaction needs.

### 23.2 Separation from terrain data

Physics does not own authoritative terrain state. It consumes mesh-derived collider data.

### 23.3 Collider update model

Terrain colliders should be updated by a dedicated collider system that listens for mesh
state changes.

### 23.4 Scalability risk

Frequent trimesh rebuilds can become expensive. Future options may include:

- cheaper temporary hit representations
- collider throttling
- lower-frequency collider updates
- alternate collider approximations in some modes

The architecture should not assume trimesh rebuilds remain cheap forever.

---

## 24. State Architecture

### 24.1 EditorStore

Owns:

- active tool
- brush parameters
- render options
- debug options
- pending stroke patches
- flatten target
- undo/redo state

It may issue edit commands, but it does not own terrain fields.

### 24.2 SessionStore

Owns:

- hover world position
- pointer-down state
- short-lived gesture/session values

This is transient state. It is not a model store.

### 24.3 WorldStore

Owns world-level registries and orchestration such as:

- loaded chunks
- current mesh registry
- worker bridge reference
- terrain initialization region
- entity registry
- physics world reference

### 24.4 Caution on WorldStore scope

`WorldStore` should not become the owner of every terrain algorithm, edit operation, mesh
scheduler, and physics detail. As the codebase grows, terrain-specific logic should live
in terrain modules and services.

### 24.5 Cross-store contracts

Allowed examples:

- editor initiates terrain edit with explicit brush parameters
- session provides hit location to gesture handlers
- world orchestrates system execution and registries

Avoid hidden reach-through where one store reads another store's private domain as a
convenience.

---

## 25. Testing Strategy

### 25.1 Test philosophy

Core terrain behavior must be testable outside the browser. Pure terrain modules should
be importable in Node-based tests.

### 25.2 Existing test categories

The current categories are good and should remain:

- determinism
- field continuity
- halo synchronization
- mesh seam correctness
- normal boundary agreement
- vertex relaxation seam safety
- brush operation behavior
- stale mesh detection
- overlap divergence detection

### 25.3 Additional recommended test categories

Add or formalize tests for:

- explicit chunk state machine transitions
- worker queue deduplication and stale result policy
- seeded terrain reproducibility
- undo/redo replay correctness across multi-chunk strokes
- serialization readiness of field data
- large-stroke patch memory behavior

### 25.4 Golden invariants

The spec should call out architectural invariants directly:

- authoritative terrain lives in density fields, not meshes
- halo data matches neighboring core data before meshing
- mesh output is deterministic from field input and options
- undo/redo replays identical field states
- chunk seam vertices and normals agree at shared boundaries

---

## 26. Current Performance Model

### 26.1 Present frame budgeting

Current frame loop budgets:

- up to 4 dirty chunk remesh dispatches per frame
- up to 2 collider rebuilds per frame

This is a practical first-pass budget, not a hard architectural constant.

### 26.2 Required future controls

The scheduler should eventually expose:

- max queued jobs
- max inflight jobs
- chunk prioritization policy
- collider rebuild throttling
- debug visibility into backlog depth

### 26.3 Performance risks

Known future pressure points:

- field snapshot copying to workers
- repeated neighbor dirtying during broad edits
- collider rebuild churn
- large undo patch memory
- per-chunk render overhead in large worlds

These are acceptable current tradeoffs but should be named.

---

## 27. Save/Load and Persistence Readiness

Persistence is not implemented yet, but the architecture should support it.

### 27.1 Required persistent concepts

- world seed
- terrain generation config
- edited chunk field deltas or full chunk snapshots
- entity data
- sculpt object data
- creature field data
- editor metadata as needed

### 27.2 Why it matters now

Persistence requirements influence:

- chunk identity
- deterministic generation
- storage abstraction
- command design
- future collaboration and replay

The spec should acknowledge persistence as a design pressure even if it is out of scope
for the current phase.

---

## 28. Future System Alignment

The following systems are planned but not yet implemented. They should align to the same
architectural foundation rather than bolt on ad hoc.

### 28.1 Creature creator

Creatures use the sculpt field system (see Section 29), layered with additional structure
that supports articulated bodies, limb attachment, sensors and actuators, and behavioral
brains.

Architectural implication:
the sculpt field system is a shared platform for creatures and sculpt objects.
Terrain-specific assumptions such as world-scale chunk sizing must not leak into the
sculpt field or creature systems.

### 28.2 Freeform sculpt objects

Sculpt objects use the sculpt field system (see Section 29). They are freeform authored
assets intended for props, environmental elements, and decorative structures.

Architectural implication:
the sculpt field system is a reusable platform layer shared by both creatures and sculpt
objects. Terrain is a separate, independent system using voxel density fields.

### 28.3 Unified editing model

Terrain, creatures, and sculpts should share:

- brush infrastructure
- command history
- hit testing patterns
- meshing service patterns

Terrain uses a voxel density field. Creatures and sculpt objects use the composable
sculpt field system. Each system manages its own field representation, but they share
the surrounding editing, history, and rendering infrastructure.

They should not be forced into one monolithic data model if their resolution and runtime
needs differ.

### 28.4 Programmable entities

Entities will eventually combine:

- transform
- render binding
- optional voxel-field binding
- optional physics binding
- optional brain binding

The current `entities.ts` skeleton is a placeholder. The spec should avoid implying that
the entity architecture is already established.

### 28.5 Programmable lighting

Lighting is a future creative system. It should be described as part of world authoring,
not terrain architecture.

### 28.6 Future undo command families

Planned command types include:

- `EntityCreateCommand`
- `EntityDeleteCommand`
- `EntityTransformCommand`
- `PropertyChangeCommand`
- `BrainEditCommand`

These belong to the edit history layer and should remain independent of terrain-specific
command types.

---

## 29. Sculpt Field System

Creatures and sculpted objects are defined by a **sculpt field system** based on
composable scalar fields (SDF-style). This is the shared modeling foundation for both
asset types. The difference between them lies in presentation, editing tools, and
downstream systems such as rigging and behavior.

The system is designed to support:

- Expressive, playful modeling suitable for a creative sandbox
- Both crisp shapes and soft clay-like forms
- Intuitive sculpting tools that feel physical and responsive
- Inspectable structures that can be understood and remixed

A major design inspiration is **Media Molecule's Dreams**, whose sculpting approach
demonstrates how field-based modeling can feel tactile, playful, and accessible while
supporting complex forms.

### 29.1 Scalar Fields

Creatures and sculpted objects are defined by a scalar field in a bounded modeling
volume. At any point in space, the field produces a scalar value representing the
distance-like relationship to the surface of the shape. The visible surface is the
implicit boundary where the field crosses the surface threshold.

Shapes are not defined as polygon meshes during editing. Instead, they are defined as a
continuous field constructed from composable elements and operations. This supports both
hard shape combinations and smooth clay-like blending.

Meshes are generated from the field for rendering.

### 29.2 Shape Composition

Shapes are constructed from primitives combined with field operations.

Example primitives:

- Sphere
- Ellipsoid
- Capsule
- Box
- Rounded Box
- Tubes or curve-based forms

Primitives can be positioned, rotated, scaled, and parameterized.

Field operations determine how primitives combine with existing geometry:

- Add
- Subtract
- Intersect
- Smooth blend
- Blobby blend

This allows shapes that range from crisp mechanical forms to organic clay-like bodies.

### 29.3 Soft Blending

The system supports controllable smooth blending between primitives and sculpt
operations. This enables effects similar to metaballs or clay fusion, where neighboring
shapes merge into a continuous form.

Examples:

- Limbs smoothly blending into a body
- Organic bulges and folds
- Soft transitions between sculpted regions

Blend behavior is adjustable through brush parameters such as hardness and falloff.
Blending is localized so that only nearby shapes influence one another, preventing the
entire model from collapsing into a single merged field.

### 29.4 Sculpt Brushes

Users interact with the sculpt field primarily through brush tools. Brushes apply
parametric field modifications along a stroke path or at a stamp location.

Typical brush behaviors:

- Add material
- Carve material
- Fuse shapes
- Blob or inflate regions
- Flatten or smooth surfaces
- Stamp primitives into the field

Brush parameters:

- Size
- Strength
- Hardness
- Falloff

### 29.5 Symmetry and Pattern Sculpting

Sculpt tools support procedural symmetry modes that replicate edits across the modeling
space.

**Mirror sculpting** -- Brush strokes can be mirrored across one or more axes. This
supports common modeling tasks such as sculpting symmetrical creatures, faces, or
mechanical parts.

**Radial symmetry** -- Brush strokes can be repeated around an axis using a configurable
number of segments. This is useful for circular structures, flowers, star-shaped forms,
and mechanical patterns.

**Kaleidoscope patterning** -- More advanced modes propagate sculpt strokes through
mirrored and rotated transforms simultaneously, producing kaleidoscopic patterns.

These modes encourage exploratory creation and allow visually rich forms to emerge
quickly from simple sculpt actions.

### 29.6 Creatures vs. Sculpt Objects

Creatures and sculpted objects share the same sculpt field foundation but are presented
differently in the editor.

**Sculpt Objects** are freeform creations intended for props, environmental assets, or
decorative elements. The sculpting workflow focuses on direct sculpting, shape stamping,
blending, and carving.

**Creatures** use the same sculpt field system but are layered with additional structure
that supports articulated bodies, limb attachment, sensors and actuators, and behavioral
brains. Creature editing tools emphasize building recognizable bodies and appendages
rather than purely freeform shapes.

Despite these differences, both ultimately produce geometry from the same sculpt field
modeling approach.

### 29.7 Relationship to Terrain

Terrain uses the voxel density-field system described in Sections 10 through 17,
optimized for large continuous landscapes.

The sculpt field system is designed for bounded authored assets such as creatures and
props.

Both are scalar-field-based modeling systems, but each is tuned for its specific role:

- Terrain: efficient editing and streaming for large landscapes
- Sculpt fields: higher-quality detail for individual authored assets

---

## 30. Concrete Current Implementation Notes

This section captures real implementation choices without pretending they are the final
architecture.

- Terrain currently initializes as a fixed `8 x 4 x 8` chunk grid.
- The terrain field uses `Float32Array` storage.
- Halo width is currently 2 samples.
- Surface Nets is the current mesh extraction algorithm.
- R3F raycasting currently provides the primary hover position.
- Rapier terrain colliders are rebuilt from chunk mesh results.
- Worker jobs currently use generate and mesh message types.
- Mesh staleness is currently handled by version comparison and re-dirtying.
- Undo history currently stores merged `TerrainPatchCommand`s per stroke.

These notes should be easy to update as implementation evolves.

---

## 31. Open Questions

The spec should explicitly track unresolved architectural questions.

### 31.1 Terrain scalability

- When should the fixed-grid terrain model become a streaming model?
- What chunk loading radius and persistence model will be used?

### 31.2 Voxel platform generalization

- Which field operations should be terrain-specific versus shared across all voxel
  editors?
- Should creature/sculpt fields use the same chunking model as terrain?

### 31.3 Collider strategy

- At what edit frequency does trimesh rebuild cost become unacceptable?
- Should collider updates lag behind visual mesh updates under heavy editing?

### 31.4 Hit testing source of truth

- Should terrain hit testing continue using render mesh raycasts?
- When should field-based or collider-based hit testing take over?

### 31.5 Persistence model

- Will saved worlds store full chunk snapshots, deltas from seed-generated terrain, or a
  hybrid representation?

### 31.6 Undo memory model

- Should undo capacity be command-count-based, byte-budget-based, or hybrid?

---

## 32. Summary

LBB is currently a terrain-focused 3D voxel editor with a strong deterministic terrain
pipeline, worker-based mesh extraction, and reversible brush editing. Its next challenge
is not raw correctness but architectural clarity as it grows beyond terrain.

The intended direction is:

- keep voxel field data authoritative
- keep meshing deterministic and off-thread
- keep rendering and physics as consumers of terrain state, not owners of it
- keep edit history reversible and reusable
- evolve toward a shared voxel editing platform that can support terrain, creatures,
  sculpt objects, and programmable entities without collapsing into a single monolithic
  store or service

That is the architectural target this spec defines.
