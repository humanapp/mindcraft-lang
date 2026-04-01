# User Tile Compilation Pipeline -- Phased Implementation Plan

Wire filesystem changes from the VS Code bridge into the TypeScript compilation
pipeline so that user-authored `.ts` sensors and actuators are compiled and
registered as tiles in the sim app. Starts with standalone single-file compilation;
multi-file imports are a later phase.

Depends on infrastructure from:
- [user-authored-sensors-actuators.md](user-authored-sensors-actuators.md) (compiler pipeline)
- [vscode-authoring-debugging.md](vscode-authoring-debugging.md) (bridge architecture)
- `packages/typescript` (compileUserTile, linkUserPrograms, createUserTileExec, registerUserTile)
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

(Updated 2026-03-31) Phase 1 complete. File changes from the VS Code bridge
trigger compilation via `compileUserTile`. Results are cached in
`apps/sim/src/services/user-tile-compiler.ts` with listener hooks for future
phases. No tile registration yet.

---

## Architecture Context

### File change flow (already working)

```
VS Code edit -> extension -> bridge server -> sim app
                                               |
                          project.fromRemoteFileChange(notification)
                                               |
                          currently: saveFilesystem() only
```

`fromRemoteFileChange` fires on every remote mutation with a `FileSystemNotification`:
- `action: "write"` -- `path`, `content`, `newEtag`
- `action: "delete"` -- `path`
- `action: "rename"` -- `oldPath`, `newPath`
- `action: "import"` -- `entries` (full sync)

### Compilation pipeline (packages/typescript, existing)

| Function | Input | Output |
|---|---|---|
| `compileUserTile(source, options?)` | single TS source string | `CompileResult` with diagnostics + `UserAuthoredProgram` |
| `linkUserPrograms(brainProgram, userPrograms)` | base program + compiled tiles | `LinkResult` with `linkedProgram` + `UserTileLinkInfo[]` |
| `createUserTileExec(linkedProgram, linkInfo, vm, scheduler)` | linked program + VM | `HostAsyncFn` |
| `registerUserTile(linkInfo, hostFn)` | link info + host fn | registers tiles in brain services |

`compileUserTile` operates on a single source file. Multi-file imports are not yet
supported (module resolution, lowering, and linking would all need work). Standalone
single-file compilation is the starting scope.

### Registration constraints

- **TileCatalog**: supports `add()`, `delete(tileId)`, `registerTileDef()` -- fully dynamic.
- **FunctionRegistry**: append-only (`register()`). No delete/replace. Functions are
  stored in a `List` where index = numeric ID; removal would break VM references.
  Workaround: register a stable wrapper `HostAsyncFn` that delegates to a mutable
  inner function, allowing hot-swap without touching the registry.

---

## Phase 1: Compile on file change

Hook `fromRemoteFileChange` to detect `.ts` file writes, compile them via
`compileUserTile`, and cache results. No tile registration yet -- just compilation
and diagnostic reporting.

### Deliverables

1. New module `apps/sim/src/services/user-tile-compiler.ts`:
   - Maintains a `Map<path, CompileResult>` cache of compilation results.
   - `handleFileChange(notification: FileSystemNotification)` -- filters for `.ts`
     writes (excluding `.d.ts` and `tsconfig.json`), reads content from the
     notification, calls `compileUserTile(content)`, caches the result.
   - Handles `"delete"` by removing from cache.
   - Handles `"rename"` by updating the cache key.
   - Handles `"import"` (full sync) by diffing against known files and
     recompiling changed/new entries, removing deleted ones.
   - Exposes an observable for consumers to react to compilation results
     (e.g., a callback or event pattern).
2. Wire into `vscode-bridge.ts`:
   - `fromRemoteFileChange` calls both `saveFilesystem()` and
     `handleFileChange(notification)`.
3. Console logging of compile results (diagnostics or success) for
   verification during development.

### Risks

- `compileUserTile` is synchronous and calls `ts.createProgram` -- may be slow
  for large files. Acceptable for Phase 1; consider async/debounce later.

### Phase 1 Notes (2026-03-31)

- Spec called for a single `handleFileChange(notification)` entry point taking
  `FileSystemNotification`. Built instead as separate `fileWritten`, `fileDeleted`,
  `fileRenamed`, `fullSync` functions dispatched from `vscode-bridge.ts`. This
  avoids importing bridge-protocol types into the compiler module.
- `needsRecompile()` is stubbed to always return `true`. Could compare content
  hashes later but not needed yet.
- Uses `logger` from `@mindcraft-lang/core` instead of `console`.
- `CompileDiagnostic` type is imported but unused (only `CompileResult` is
  needed). Biome did not flag it; may want to remove in a future cleanup.
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

## Phase 3: Tile registration with stable function wrappers

On first successful compile of a `.ts` file, register its sensor/actuator tile
in the brain services using an indirection wrapper so that the underlying
function can be hot-swapped on recompile. If Phase 2 already registered a stub
for this tile, reuse that function registry entry.

### Prerequisites

- Phase 1's `onCompilation` and `onRemoval` listeners are the integration points.
- Phase 2's stub registration establishes the function registry entries and
  tile catalog entries. Phase 3 upgrades them in-place.

### Deliverables

1. Indirection wrapper factory -- creates a stable `HostAsyncFn` that delegates
   to a mutable inner function reference. Exposes a `swap(newFn)` method.
2. On first successful compile:
   - Call `registerUserTile(linkInfo, wrapperFn)` to register tiles + params.
   - Store the mapping: `filePath -> { tileId, wrapper }`.
3. Linking strategy: `linkUserPrograms` needs a `BrainProgram`. For registration
   purposes, create a minimal empty brain program to link against. The real
   linking happens at brain-run time (Phase 5).
4. Handle the `createUserTileExec` dependency on VM + Scheduler -- defer actual
   exec creation. The wrapper starts as a no-op until a VM is available.

### Risks

- `registerUserTile` calls `functions.register()` which throws on duplicate names.
  Must guard against re-registration. On recompile with same name, only the
  wrapper's inner function changes -- no re-registration needed.
- If a tile's signature changes (params, kind, name), need to `tiles.delete()`
  the old tile and re-register. The function registry entry cannot be removed,
  so the old entry becomes dead weight. Acceptable for now.

---

## Phase 4: Hot-swap on recompile

When a `.ts` file is re-saved and recompiled successfully:

### Deliverables

1. If name/kind unchanged: recompile, re-link, `createUserTileExec` with new
   linked program, swap the wrapper's inner function.
2. If name/kind/params changed: delete old tile from `TileCatalog`, register new
   tile. The old `FunctionRegistry` entry becomes orphaned (acceptable).
3. On `.ts` file deletion: remove tile from `TileCatalog`, remove from cache.
4. Notify the brain editor UI that tile definitions have changed so the palette
   updates.

### Risks

- Running brains that reference a tile mid-swap could see inconsistent state.
  Phases 1-4 assume brains are not running during authoring, or that a stale
  reference is acceptable.
- Need to understand how the brain editor discovers available tiles (likely
  reads from `TileCatalog` on render). If it caches, it needs a refresh signal.

---

## Phase 5: Integration with brain execution

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

## Phase 6: Full-sync and reconnect handling

Handle `filesystem:sync` (import) events robustly when the extension
reconnects or a full sync is triggered.

### Deliverables

1. On `"import"` notification: diff the incoming file set against the
   compilation cache.
   - New `.ts` files: compile and register.
   - Changed `.ts` files: recompile and swap.
   - Removed `.ts` files: delete tiles, remove from cache.
2. Batch compilation to avoid redundant work during large imports.
3. Handle the initial connection case: when the extension first syncs,
   compile all `.ts` files in the project.

---

## Phase 7: Multi-file imports (future)

Enable `.ts` files to import from other `.ts` files in the project filesystem.
This requires changes to `packages/typescript`:

1. Expand `CompileOptions` with `additionalFiles?: Map<string, string>`.
2. Populate the virtual FS with all project `.ts` files.
3. Fix relative module resolution in `virtual-host.ts` (`resolveModuleNameLiterals`
   must resolve relative to `containingFile`).
4. Pass all user files as root files to `ts.createProgram`.
5. Cross-file lowering: either merge ASTs or lower each file independently
   and link at the IR level.
6. Dependency tracking: when a utility file changes, recompile all files
   that import it.

Out of scope until Phases 1-6 are stable.

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

**Deviations:**
- API shape: separate functions instead of single `handleFileChange`. Cleaner
  separation -- compiler module has no bridge-protocol import.
- Logging: `logger` instead of `console` (per project convention).

**No upstream spec amendments needed.** No new risks discovered.
