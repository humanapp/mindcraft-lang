# User Tile Compilation Pipeline -- Phased Implementation Plan

Wire filesystem changes from the VS Code bridge into the TypeScript compilation
pipeline so that user-authored `.ts` sensors and actuators are compiled and
registered as tiles in the sim app. Multi-file imports across `.ts` files are
supported -- the compiler resolves relative imports automatically.

Depends on infrastructure from:
- [user-authored-sensors-actuators.md](user-authored-sensors-actuators.md) (compiler pipeline)
- [vscode-authoring-debugging.md](vscode-authoring-debugging.md) (bridge architecture)
- `packages/typescript` (UserTileProject, linkUserPrograms, createUserTileExec, registerUserTile)
- `packages/bridge-client` (Project, ProjectFiles, FileSystemNotification)

---

## Workflow Convention

Each phase follows this loop:

1. **Kick off** -- "Implement Phase N." The implementer reads this doc, the spec,
   and any relevant instruction files before writing code. After implementation,
   STOP and present the work for review. Do not write the Phase Log entry, amend
   the spec, update the Current State section, or perform any post-mortem activity.
2. **Review + refine** -- Followup prompts within the same conversation.
3. **Declare done** -- "Phase N is complete." Only the user can declare the phase
   complete. Do not move to the post-mortem step until the user requests it.
4. **Post-mortem** -- "Run post-mortem for Phase N." This step:
   - Diffs planned deliverables vs what was actually built.
   - Records the outcome in the Phase Log (bottom of this doc). The Phase Log is
     a post-mortem artifact -- never write it during implementation.
   - Amends upstream specs with dated notes if they were wrong or underspecified.
   - Propagates discoveries to upcoming phases in this doc (updated risks,
     changed deliverables, new prerequisites).
   - Writes a repo memory note with key decisions for future conversations.
5. **Next phase** -- New conversation (or same if context is not exhausted).

The planning doc is the source of truth across conversations. Session memory does
not survive. Keep this doc current.

---

## Current State

(Updated 2026-03-31) Phase 1 complete and reworked. `user-tile-compiler.ts`
maintains a persistent `UserTileProject` instance that mirrors the bridge
filesystem. Any file mutation (`updateFile`, `deleteFile`, `renameFile`,
`setFiles`) triggers `compileAll()`, which type-checks the whole project as a
single `ts.createProgram` and produces `CompileResult` per entry-point file.
Cross-file imports are resolved automatically. Full-sync on reconnect is
handled via `setFiles()`. Results are cached with listener hooks for future
phases. No tile registration yet.

---

## Architecture Context

### File change flow

```
VS Code edit -> extension -> bridge server -> sim app
                                               |
                          project.fromRemoteFileChange(notification)
                                               |
                          saveFilesystem() + userTileCompiler.*()
                                               |
                          UserTileProject.compileAll()
                                               |
                          onCompilation / onRemoval listeners
```

`fromRemoteFileChange` fires on every remote mutation with a `FileSystemNotification`:
- `action: "write"` -- `path`, `content`, `newEtag`
- `action: "delete"` -- `path`
- `action: "rename"` -- `oldPath`, `newPath`
- `action: "import"` -- `entries` (full sync)

### Compilation pipeline (packages/typescript)

The primary compilation API is `UserTileProject`, a stateful class that holds
all project files and compiles them as a unit:

| Method / Class | Input | Output |
|---|---|---|
| `new UserTileProject(options?)` | optional `CompileOptions` | project instance |
| `project.setFiles(files)` | `Map<string, string>` (full sync) | replaces all files |
| `project.updateFile(path, content)` | path + source | adds or updates one file |
| `project.deleteFile(path)` | path | removes one file |
| `project.renameFile(old, new)` | old + new path | moves a file |
| `project.compileAll()` | (uses internal file map) | `ProjectCompileResult` |
| `project.compileAffected()` | (uses internal file map) | `ProjectCompileResult` (currently same as `compileAll`) |
| `linkUserPrograms(brainProgram, userPrograms)` | base program + compiled tiles | `LinkResult` with `linkedProgram` + `UserTileLinkInfo[]` |
| `createUserTileExec(linkedProgram, linkInfo, vm, scheduler)` | linked program + VM | `HostAsyncFn` |
| `registerUserTile(linkInfo, hostFn)` | link info + host fn | registers tiles in brain services |

`ProjectCompileResult` contains:
- `results: Map<string, CompileResult>` -- one entry per file that has
  `export default Sensor(...)` or `export default Actuator(...)`. Files without
  a default export are utility/library modules and produce no entry.
- `tsErrors: Map<string, CompileDiagnostic[]>` -- TypeScript type errors by file.
  When tsErrors is non-empty, results is empty (type errors block compilation).

Cross-file imports are resolved automatically. When a utility file changes,
`compileAll()` recompiles all entry points that (transitively) import it.

### Registration constraints

- **TileCatalog**: supports `add()`, `delete(tileId)`, `registerTileDef()` -- fully dynamic.
- **FunctionRegistry**: append-only (`register()`). No delete/replace. Functions are
  stored in a `List` where index = numeric ID; removal would break VM references.
  Workaround: register a stable wrapper `HostAsyncFn` that delegates to a mutable
  inner function, allowing hot-swap without touching the registry.

---

## Phase 1: Compile on file change (complete)

Hook `fromRemoteFileChange` to detect `.ts` file mutations, maintain a
persistent `UserTileProject` instance, and recompile the whole project on each
change. No tile registration yet -- just compilation and diagnostic reporting.

### Deliverables

1. New module `apps/sim/src/services/user-tile-compiler.ts`:
   - Maintains a `UserTileProject` instance that mirrors the bridge filesystem.
   - Maintains a `Map<path, CompileResult>` cache of compilation results.
   - `fileWritten(path, content)` -- calls `project.updateFile()`, recompiles.
   - `fileDeleted(path)` -- calls `project.deleteFile()`, recompiles.
   - `fileRenamed(oldPath, newPath)` -- calls `project.renameFile()`, recompiles.
   - `fullSync(files)` -- filters for `.ts`/`.d.ts` files, calls
     `project.setFiles()`, recompiles.
   - `recompileAll()` -- calls `project.compileAll()`, diffs results against
     cache, fires `onCompilation` for new/changed entries and `onRemoval` for
     disappeared entries.
   - Exposes `onCompilation(fn)` and `onRemoval(fn)` listener hooks.
2. Wire into `vscode-bridge.ts`:
   - `fromRemoteFileChange` callback dispatches to `fileWritten`, `fileDeleted`,
     `fileRenamed`, or `fullSync` based on `ev.action`.
3. Logging of compile results (diagnostics or success) via `logger` from
   `@mindcraft-lang/core`.

### Risks

- `compileAll()` is synchronous and creates a new `ts.createProgram` on every
  call -- may be slow for large projects. Acceptable for now; consider
  debouncing or `compileAffected()` (once it does incremental work) later.

### Phase 1 Notes (2026-03-31)

- Originally built with per-file `compileUserTile()` calls. Reworked same day
  to use `UserTileProject` after the compiler was updated to support multi-file
  project compilation.
- API uses separate `fileWritten`, `fileDeleted`, `fileRenamed`, `fullSync`
  functions dispatched from `vscode-bridge.ts` -- compiler module has no
  bridge-protocol dependency.
- Uses `logger` from `@mindcraft-lang/core` instead of `console`.
- `recompileAll()` diffs the new result set against the cache to detect both
  new/changed entries and removed entries (e.g., when a file loses its default
  export or is deleted). This also covers full-sync on reconnect.
- **Gap identified post-phase:** `createProject()` loads the filesystem from
  localStorage but does not compile `.ts` files at that point. User tiles
  from the persisted filesystem are not compiled until a remote file change
  arrives. Phase 2 addresses the startup case via a metadata cache for tile
  registration, and Phase 3 handles initial compilation once the bridge
  connects and delivers the filesystem.

---

## Phase 2: Tile metadata cache and startup stub registration

### Problem

`BrainTileSet.deserialize()` searches the global `TileCatalog` for every tile ID
in the brain binary. If a user-authored tile ID (e.g., `user.sensor.MyThing`)
is not registered, deserialization throws. The sim's `loadBrainFromLocalStorage`
catches the error and silently falls back to the default brain -- the user's
saved brain is discarded without warning.

The startup ordering makes this unavoidable:

1. `registerCoreBrainComponents()` + `registerBrainComponents()` -- sync, module eval
2. React renders, Phaser boots
3. **Engine loads brains from localStorage** -- sync, calls `deserialize()`
4. `connectBridge()` -- after first React render
5. Bridge connects, filesystem arrives, `.ts` files compiled

User tile compilation cannot run before brain loading (step 3) because the
`.ts` source files only arrive via the bridge (step 5). Without pre-registered
tile stubs, any brain referencing a user tile will fail to deserialize.

### Solution

Cache tile registration metadata (name, kind, callDef, params, outputType) in
localStorage alongside the filesystem. On startup, synchronously re-register
stub tiles from this cache before brains are loaded. After the bridge
connects and `.ts` files are compiled, upgrade the stubs with real host
functions via the Phase 3 indirection wrappers.

### Deliverables

1. **Metadata type**: define a serializable `UserTileMetadata` shape containing
   everything needed by `registerUserTile` except the actual `HostAsyncFn`:
   tile ID, kind, name, callDef, params, outputType.
2. **Persist metadata**: when Phase 1's `onCompilation` fires with a successful
   result, extract metadata from the `UserAuthoredProgram` and save a
   `Map<path, UserTileMetadata>` to localStorage (e.g., key
   `sim:user-tile-metadata`). Remove entries on file deletion.
3. **Startup stub registration**: in `bootstrap.ts` (or a new module called from
   it), read the metadata cache from localStorage and register each entry as a
   tile with a no-op `HostAsyncFn`. This runs synchronously before React/Phaser,
   so tiles exist in the catalog when brains deserialize.
4. **Upgrade path**: when real compilation finishes (Phase 3), the indirection
   wrapper swaps in the real host function. The stub entry's function registry
   slot is reused.

### Startup sequence after this phase

| Step | What |
|---|---|
| 1 | `registerCoreBrainComponents()`, `registerBrainComponents()` |
| 2 | **Load user tile metadata cache, register stubs** (sync) |
| 3 | React renders, Phaser boots |
| 4 | Engine loads brains from localStorage (stubs exist -- deser succeeds) |
| 5 | `connectBridge()` starts, filesystem arrives |
| 6 | Compile `.ts` files, upgrade stubs with real host functions |

### Risks

- Metadata cache can go stale if the user edits `.ts` files outside the
  bridge (unlikely in practice -- the bridge is the editing path).
- If the cached callDef doesn't match the tile usage in a saved brain
  (e.g., user changed params and re-saved), the brain will load but may
  fail at compile/runtime. This is the same behavior as changing any tile's
  contract -- acceptable.
- Need to ensure the stub's function registry name matches what
  `registerUserTile` would produce (e.g., `user.sensor.MyThing`) so that
  Phase 3 can find and reuse the entry.

---

## Phase 3: Tile registration and hot-swap

On successful compile, register sensor/actuator tiles in the brain services
using indirection wrappers so the underlying function can be hot-swapped on
recompile. If Phase 2 already registered a stub for a tile, reuse that
function registry entry.

Since `compileAll()` returns the full set of compiled tiles on every mutation
(not just the changed file), the registration layer always receives the
complete picture. Diffing against the previously registered set determines
what to add, update, or remove.

### Prerequisites

- Phase 1's `onCompilation` and `onRemoval` listeners are the integration points.
- Phase 2's stub registration establishes the function registry entries and
  tile catalog entries. Phase 3 upgrades them in-place.

### Deliverables

1. Indirection wrapper factory -- creates a stable `HostAsyncFn` that delegates
   to a mutable inner function reference. Exposes a `swap(newFn)` method.
2. On first successful compile of a tile:
   - Call `registerUserTile(linkInfo, wrapperFn)` to register tile + params.
   - Store the mapping: `filePath -> { tileId, wrapper }`.
3. On recompile with same name/kind: recompile, re-link,
   `createUserTileExec` with new linked program, swap the wrapper's inner
   function. No re-registration needed.
4. On recompile with changed name/kind/params: delete old tile from
   `TileCatalog`, register new tile. The old `FunctionRegistry` entry becomes
   orphaned (acceptable).
5. On `.ts` file deletion: remove tile from `TileCatalog`, remove from cache.
6. Notify the brain editor UI that tile definitions have changed so the palette
   updates.
7. Linking strategy: `linkUserPrograms` needs a `BrainProgram`. For registration
   purposes, create a minimal empty brain program to link against. The real
   linking happens at brain-run time (Phase 4).
8. Handle the `createUserTileExec` dependency on VM + Scheduler -- defer actual
   exec creation. The wrapper starts as a no-op until a VM is available.

### Risks

- `registerUserTile` calls `functions.register()` which throws on duplicate names.
  Must guard against re-registration. On recompile with same name, only the
  wrapper's inner function changes -- no re-registration needed.
- If a tile's signature changes (params, kind, name), need to `tiles.delete()`
  the old tile and re-register. The function registry entry cannot be removed,
  so the old entry becomes dead weight. Acceptable for now.
- Running brains that reference a tile mid-swap could see inconsistent state.
  Assume brains are not running during authoring, or that a stale reference is
  acceptable.
- Need to understand how the brain editor discovers available tiles (likely
  reads from `TileCatalog` on render). If it caches, it needs a refresh signal.

---

## Phase 4: Integration with brain execution

Connect the compiled user tiles to actual brain program execution so they
run in the simulation.

### Deliverables

1. At brain-compile time (when a brain program is built for an actor):
   - Gather all successfully compiled `UserAuthoredProgram`s.
   - Call `linkUserPrograms(brainProgram, userPrograms)` to produce the
     linked program.
   - For each `UserTileLinkInfo`, call `createUserTileExec(linkedProgram,
     linkInfo, vm, scheduler)` and swap into the corresponding wrapper.
2. The wrappers registered in Phase 3 now delegate to real exec functions.
3. When user tiles are recompiled while a brain is running, re-link and
   re-swap. Define when this takes effect (next tick? next brain restart?).

### Risks

- Linking must happen after the base brain program is compiled but before
  execution begins. Need to find the right hook in the sim's brain lifecycle.
- Multiple actors may share the same brain program. Linked programs should
  be shared, not duplicated per actor.

---

## Phase Log

(Written during post-mortem only. Do not edit during implementation.)

### Phase 1 (2026-03-31)

**Planned:** New `user-tile-compiler.ts` module with `handleFileChange()` taking
a `FileSystemNotification`, wired into `vscode-bridge.ts`. Console logging.

**Built:** `user-tile-compiler.ts` with separate `fileWritten`, `fileDeleted`,
`fileRenamed`, `fullSync` entry points (no bridge-protocol dependency). Dispatch
lives in `vscode-bridge.ts` via a switch on `ev.action`. Logging via `logger`
from `@mindcraft-lang/core`. Listener hooks (`onCompilation`, `onRemoval`) for
Phase 2 integration.

**Reworked same day:** After `packages/typescript` was updated to support
multi-file project compilation via `UserTileProject`, the module was reworked to
maintain a persistent `UserTileProject` instance instead of calling per-file
`compileUserTile()`. `recompileAll()` now calls `project.compileAll()` and diffs
results against the cache, firing listeners for both new/changed and removed
entries. Full-sync and multi-file imports are handled implicitly.

**Deviations:**
- API shape: separate functions instead of single `handleFileChange`. Cleaner
  separation -- compiler module has no bridge-protocol import.
- Logging: `logger` instead of `console` (per project convention).
- Compilation model: project-level `compileAll()` instead of per-file
  `compileUserTile()`. Also covers what was originally planned as Phase 6
  (full-sync) and Phase 7 (multi-file imports).

**No upstream spec amendments needed.** No new risks discovered.
