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

(Updated 2026-04-03) Phases 1, 2, and 3 complete. The compilation pipeline
uses a three-layer architecture:

1. `CompilationProvider` (interface, `bridge-app`) -- file mutation + compile
   methods implemented by `user-tile-compiler.ts`.
2. `CompilationManager` (class, `bridge-app`) -- dispatches
   `FileSystemNotification` actions to the provider, calls `compileAll()`,
   fires `onCompilation`/`onRemoval` listeners, and emits diagnostics over
   the bridge when connected.
3. `AppProject` (class, `bridge-app`) -- owns the `CompilationManager`,
   wires `fromRemoteFileChange` to it, and exposes listeners for the sim.

`user-tile-compiler.ts` maintains a persistent `UserTileProject` instance
that mirrors the filesystem. Any file mutation triggers `compileAll()`, which
type-checks the whole project as a single `ts.createProgram` and produces
`CompileResult` per entry-point file. Cross-file imports are resolved
automatically.

`initProject()` in `vscode-bridge.ts` fires a synthetic `import` action at
startup to compile all `.ts` files persisted in localStorage. This runs
synchronously during bootstrap, before React renders, so compile results are
available before brains load (though tiles are not yet registered).

4. `user-tile-registration.ts` -- `registerUserTilesAtStartup()` links
   compiled programs against an empty `BrainProgram` and registers tiles
   via `registerUserTile()` with a no-op `HostAsyncFn`. Persists a
   `UserTileMetadata[]` cache to `sim:user-tile-metadata` in localStorage.
   On startup, if compilation produces no results (type errors, no `.ts`
   files), falls back to the cache and registers stubs from it. Called from
   `bootstrap.ts` after `initProject()` and before React renders.

5. `handleRecompilation()` in `user-tile-registration.ts` -- wired via
   `CompilationManager.onCompilation` in `vscode-bridge.ts`. Diffs new
   compile results against a tracking map (`registeredTiles`), deletes old
   tiles from `TileCatalog` when name/kind changes or file is deleted,
   re-registers via `registerUserTile()` (in-place swap for same identity),
   updates the metadata cache, and fires `onUserTilesChanged` listeners.
   If TS errors block compilation, existing registrations are preserved.

No real execution yet -- all registered tiles have no-op `HostAsyncFn`.
Phase 4 will inject linking into `Brain.initialize()` to produce real
exec functions via `createUserTileExec`.


---

## Architecture Context

### File change flow

```
VS Code edit -> extension -> bridge server -> sim app
                                               |
                          AppProject.fromRemoteFileChange(notification)
                                               |
               +-------------------------------+-------------------------------+
               |                                                               |
  CompilationManager.handleFileChange(ev)                    onRemoteFileChange listeners
               |                                              (e.g. saveFilesystem())
  CompilationProvider.fileWritten/Deleted/Renamed/fullSync
               |
  CompilationProvider.compileAll()
               |
  CompilationManager fires onCompilation / onRemoval listeners
  CompilationManager emits diagnostics over bridge (if connected)
```

`FileSystemNotification` (from `bridge-protocol`) supports these actions:
- `action: "write"` -- `path`, `content`, `newEtag`, optional `isReadonly`, `expectedEtag`
- `action: "delete"` -- `path`, optional `expectedEtag`
- `action: "rename"` -- `oldPath`, `newPath`, optional `expectedEtag`
- `action: "mkdir"` -- `path`
- `action: "rmdir"` -- `path`
- `action: "import"` -- `entries` (full sync)

`CompilationManager` ignores `mkdir` and `rmdir` actions.

### Compilation pipeline (packages/typescript)

The primary compilation API is `UserTileProject`, a stateful class that holds
all project files and compiles them as a unit:

| Method / Class | Input | Output |
|---|---|---|
| `new UserTileProject(options?)` | optional `CompileOptions` | project instance |
| `project.setFiles(files)` | `ReadonlyMap<string, string>` (full sync) | replaces all files |
| `project.updateFile(path, content)` | path + source | adds or updates one file |
| `project.deleteFile(path)` | path | removes one file |
| `project.renameFile(old, new)` | old + new path | moves a file |
| `project.compileAll()` | (uses internal file map) | `ProjectCompileResult` |
| `project.compileAffected()` | (uses internal file map) | `ProjectCompileResult` (currently same as `compileAll`) |
| `linkUserPrograms(brainProgram, userPrograms)` | `BrainProgram` + `UserAuthoredProgram[]` | `LinkResult` with `linkedProgram` + `userLinks: UserTileLinkInfo[]` |
| `createUserTileExec(linkedProgram, linkInfo, vm, scheduler)` | `BrainProgram` + `UserTileLinkInfo` + `VM` + `Scheduler` | `HostAsyncFn` |
| `registerUserTile(linkInfo, hostFn)` | `UserTileLinkInfo` + `HostAsyncFn` | registers tile + params in brain services |

`ProjectCompileResult` contains:
- `results: Map<string, CompileResult>` -- one entry per file that has
  `export default Sensor(...)` or `export default Actuator(...)`. Files without
  a default export are utility/library modules and produce no entry.
- `tsErrors: Map<string, CompileDiagnostic[]>` -- TypeScript type errors by file.
  When tsErrors is non-empty, results is empty (type errors block compilation).

`CompileResult` contains:
- `diagnostics: CompileDiagnostic[]` -- compile-time diagnostics
- `program?: UserAuthoredProgram` -- the compiled program (present on success)
- `descriptor?: ExtractedDescriptor` -- extracted tile metadata
- `functionDebugInfo?: FunctionDebugInfo[]` -- debug info for bytecode functions

Cross-file imports are resolved automatically. When a utility file changes,
`compileAll()` recompiles all entry points that (transitively) import it.

### Compilation abstraction (packages/bridge-app)

The `CompilationProvider` interface decouples the compilation engine from the
bridge protocol layer:

```
interface CompilationProvider {
  fileWritten(path, content): void
  fileDeleted(path): void
  fileRenamed(oldPath, newPath): void
  fullSync(files): void
  compileAll(): CompilationResult
}
```

`CompilationManager` accepts a `CompilationProvider` and a send function,
dispatches `FileSystemNotification` actions to the provider, calls
`compileAll()`, fires `onCompilation`/`onRemoval` listeners, and emits
`compile:diagnostics` and `compile:status` messages over the bridge when
connected.

`AppProject` extends `Project` with optional compilation support. When
`compilationProvider` is passed in constructor options, it creates a
`CompilationManager` and wires `fromRemoteFileChange` to it.

### Registration constraints

- **TileCatalog**: supports `add()`, `delete(tileId)`, `registerTileDef()`,
  `has()`, `get()`, `clear()`, `getAll()` -- fully dynamic.
- **FunctionRegistry**: `register()` is append-only and throws on duplicate
  names. Functions are stored in a `List` where index = numeric ID; removal
  would break VM references. However, `registerUserTile()` works around this
  by directly mutating `existingEntry.fn` when re-registering a tile with the
  same ID -- no indirection wrapper needed for hot-swap.

---

## Phase 1: Compile on file change (complete)

Hook `fromRemoteFileChange` to detect `.ts` file mutations, maintain a
persistent `UserTileProject` instance, and recompile the whole project on each
change. No tile registration yet -- just compilation and diagnostic reporting.

### Deliverables

1. New module `apps/sim/src/services/user-tile-compiler.ts`:
   - Implements `CompilationProvider` interface from `bridge-app`.
   - Maintains a `UserTileProject` instance that mirrors the bridge filesystem.
   - Maintains a `Map<path, CompileResult>` cache of compilation results.
   - `fileWritten(path, content)` -- calls `project.updateFile()`.
   - `fileDeleted(path)` -- calls `project.deleteFile()`.
   - `fileRenamed(oldPath, newPath)` -- calls `project.renameFile()`.
   - `fullSync(files)` -- filters for `.ts`/`.d.ts` files, calls
     `project.setFiles()`.
   - `compileAll()` -- calls `project.compileAll()`, returns
     `CompilationResult` with diagnostics mapped to bridge-protocol format.
   - Exports `createCompilationProvider()` factory,
     `handleCompilationResult()` listener, `getCompileResult()`,
     `getAllCompileResults()`.
2. Wire into `vscode-bridge.ts`:
   - `createProject()` passes `createCompilationProvider()` to `AppProject`.
   - `initProject()` registers `handleCompilationResult` on
     `CompilationManager.onCompilation` and fires a synthetic `import`
     action to compile persisted files at startup.
   - Dispatch from `FileSystemNotification` to provider methods happens in
     `CompilationManager` (bridge-app), not in `vscode-bridge.ts`.
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
- API implements the `CompilationProvider` interface from `bridge-app`.
  Dispatch from `FileSystemNotification` to provider methods happens in
  `CompilationManager` (bridge-app), not in `vscode-bridge.ts`.
- Uses `logger` from `@mindcraft-lang/core` instead of `console`.
- Result diffing and listener dispatch (`onCompilation`, `onRemoval`) are
  handled by `CompilationManager`, not the compiler module itself.
- **Startup gap closed (2026-04-02):** `initProject()` fires a synthetic
  `import` action over the `CompilationManager` at startup, which compiles
  all `.ts` files persisted in localStorage before React renders.

---

## Phase 2: Tile registration at startup (complete)

### Problem

`BrainTileSet.deserialize()` searches the global `TileCatalog` for every tile ID
in the brain binary. If a user-authored tile ID (e.g., `user.sensor.MyThing`)
is not registered, deserialization throws. The sim's `loadBrainFromLocalStorage`
catches the error and silently falls back to the default brain -- the user's
saved brain is discarded without warning.

The current startup ordering is:

1. `registerCoreBrainComponents()` + `registerBrainComponents()` -- sync
2. `initProject()` -- compiles persisted `.ts` files (sync), results cached
3. React renders, Phaser boots
4. **Engine loads brains from localStorage** -- sync, calls `deserialize()`
5. `connectBridge()` -- user-initiated from sidebar

Compilation results are available after step 2, but tiles are not yet
registered in the catalog. Step 4 will fail for any brain referencing a
user tile.

### Solution

After `initProject()` compiles the persisted `.ts` files, register the
successfully compiled tiles immediately. This can use the same
`registerUserTile()` path planned for Phase 3 (with a no-op `HostAsyncFn`
since no VM exists yet). The key insight is that `registerUserTile()` already
handles in-place function replacement -- when Phase 3/4 creates the real
exec function, it can swap it into the same function registry entry.

If compilation fails at startup (e.g., stale `.ts` files with type errors),
a metadata cache fallback is needed to ensure brain deserialization still
succeeds. Cache tile metadata (kind, name, callDef, params, outputType)
to localStorage when compilation succeeds, and use it as a fallback when
compilation fails.

### Deliverables

1. **Register tiles from startup compile results**: after `initProject()`
   triggers compilation, iterate over `getAllCompileResults()` and call
   `registerUserTile()` for each successful result with a no-op
   `HostAsyncFn`. This requires linking each `UserAuthoredProgram` against
   a minimal empty `BrainProgram` to produce `UserTileLinkInfo`.
2. **Metadata cache fallback**: define a serializable `UserTileMetadata`
   shape (tile ID, kind, name, callDef, params, outputType). Persist to
   localStorage (key `sim:user-tile-metadata`) when compilation succeeds.
   On startup, if compilation fails or produces no results, read the cache
   and register stub tiles from it.
3. **Wiring**: the registration must happen in `bootstrap.ts` after
   `initProject()` and before React renders, so tiles exist in the catalog
   when brains deserialize.

### Startup sequence after this phase

| Step | What |
|---|---|
| 1 | `registerCoreBrainComponents()`, `registerBrainComponents()` |
| 2 | `initProject()` -- compiles persisted `.ts` files |
| 3 | **Register tiles from compile results (or metadata cache fallback)** |
| 4 | React renders, Phaser boots |
| 5 | Engine loads brains from localStorage (tiles exist -- deser succeeds) |
| 6 | `connectBridge()` -- user-initiated, filesystem may update |
| 7 | Recompile, swap host functions in-place |

### Risks

- Metadata cache can go stale if the user edits `.ts` files outside the
  bridge (unlikely in practice -- the bridge is the editing path).
- If the cached callDef doesn't match the tile usage in a saved brain
  (e.g., user changed params and re-saved), the brain will load but may
  fail at compile/runtime. Same as changing any tile's contract -- acceptable.
- `linkUserPrograms` needs a `BrainProgram` to link against. For
  registration-only purposes, a minimal empty program should suffice.
  Need to verify this works.

---

## Phase 3: Tile registration and hot-swap on recompile

On successful compile (both startup and subsequent file changes), register
sensor/actuator tiles in the brain services. `registerUserTile()` already
supports in-place function replacement -- when a tile is recompiled with the
same ID, the function entry's `fn` property is mutated directly. No
indirection wrapper is needed.

Since `compileAll()` returns the full set of compiled tiles on every mutation
(not just the changed file), the registration layer always receives the
complete picture. Diffing against the previously registered set determines
what to add, update, or remove.

### Prerequisites

- Phase 2's startup registration ensures tiles exist before brains load.
- `CompilationManager.onCompilation` listener is the integration point for
  recompile events.
- `registerUserTile()` handles both first-registration and re-registration.

### Deliverables

1. On each successful compile of a tile (startup or file change):
   - Link the `UserAuthoredProgram` against a minimal empty `BrainProgram`
     via `linkUserPrograms()` to produce `UserTileLinkInfo`.
   - Call `registerUserTile(linkInfo, hostFn)` with a no-op `HostAsyncFn`
     (since no VM exists at registration time). If the tile already exists
     in the function registry, `registerUserTile` replaces `fn` in-place.
   - Store the mapping: `filePath -> { tileId, linkInfo }`.
2. On recompile with same name/kind: re-link, call `registerUserTile`
   again -- it replaces the function in-place. No catalog changes needed.
3. On recompile with changed name/kind/params: delete old tile from
   `TileCatalog`, register new tile. The old `FunctionRegistry` entry
   becomes orphaned (acceptable -- its `fn` is a no-op).
4. On `.ts` file deletion: remove tile from `TileCatalog`, remove from cache.
5. Notify the brain editor UI that tile definitions have changed so the
   palette updates.

### Risks

- If a tile's signature changes (params, kind, name), need to
  `tiles.delete()` the old tile and re-register. The old function registry
  entry cannot be removed, so it becomes dead weight. Acceptable for now.
- Running brains that reference a tile mid-swap could see inconsistent state.
  Assume brains are not running during authoring, or that a stale reference
  is acceptable.
- Need to understand how the brain editor discovers available tiles (likely
  reads from `TileCatalog` on render). If it caches, it needs a refresh
  signal.

---

## Phase 4: Integration with brain execution (ABANDONED -- DO NOT IMPLEMENT)

Connect the compiled user tiles to actual brain program execution so they
run in the simulation. Up to this point, registered tiles have no-op host
functions. This phase creates real execution wrappers via `createUserTileExec`.

### Brain lifecycle context

`Brain.initialize(contextData?)` performs these steps in order:

1. `compileBrain(brainDef, catalogs)` -> `BrainProgram`
2. `new VM(program, handles)` -- bytecode verifier runs here
3. `new FiberScheduler(vm, options)`
4. Assign function IDs to runtime rule objects, build page indices,
   create `ExecutionContext`.

The linking hook must run between step 1 and step 2.
`linkUserPrograms(brainProgram, userPrograms)` returns a **new**
`BrainProgram` with user tile bytecode appended to the function and
constant lists. The VM must be created with this linked program so that
function IDs in `createUserTileExec`-spawned fibers resolve correctly.

### Host function dispatch architecture

All VM instances share the **global `FunctionRegistry`** from
`getBrainServices().functions`. HOST_CALL instructions reference tiles by
numeric ID into this global registry:

```
VM.execHostCallAsync(fnId) -> this.fns.getAsyncById(fnId)!.fn.exec(ctx, args, hid)
                              ^^^^^
                              getBrainServices().functions (global)
```

Core sensors/actuators work because their `HostAsyncFn` implementations
are stateless -- they only use the `ExecutionContext` argument. User tile
exec functions are different: `createUserTileExec` captures a specific
`vm` and `scheduler` to spawn fibers that execute user tile bytecode.

This creates a **multi-actor conflict**: multiple actors of the same
archetype each get their own Brain/VM/Scheduler, but the
`FunctionRegistry` has only one `.fn` slot per tile ID. If we naively
swap in each Brain's exec function, only the last Brain to initialize
would work; all other Brains would spawn fibers on the wrong VM.

### Solution: per-brain exec routing

Register a single routing `HostAsyncFn` per user tile that dispatches to
the correct brain-specific exec function based on `ctx.brain`:

```
routing HostAsyncFn.exec(ctx, args, hid)
   |
   ctx.brain -> lookup brain-specific HostAsyncFn
   |
   brainExecFn.exec(ctx, args, hid)  // bound to this brain's vm/scheduler
```

Each Brain.initialize registers its own exec function with the router.
On Brain.shutdown, it unregisters. The router falls back to a no-op for
unregistered brains (stale references during transitions).

`ExecutionContext.brain` (type `IBrain`) is always set by Brain before
calling think, so the routing key is available in every HOST_CALL.

### Integration point

`Brain.initialize()` is in `packages/core`. It has no knowledge of user
tiles or `packages/typescript`. The sim app calls
`brainDef.compile()` then `brain.initialize(contextData)` in
`Actor.constructor` and `Actor.replaceBrain()`.

Since `Brain.initialize` does compileBrain + VM creation + scheduler
creation as a monolithic sequence, the linking step requires a hook.

**Option A -- programTransform callback:** Add an optional
`programTransform?: (program: BrainProgram) => BrainProgram` callback
to `Brain` (set before `initialize()` or passed as an option). If
present, `initialize()` calls it between `compileBrain()` and
`new VM()`. The sim app sets this callback to perform
`linkUserPrograms()` and stash the `userLinks` for later use.

A second optional callback
`afterVmCreated?: (vm: IVM, scheduler: IFiberScheduler) => void`
runs after step 3. The sim app uses it to call
`createUserTileExec()` for each `UserTileLinkInfo` and register the
exec functions with the per-tile routing HostAsyncFn.

**Option B -- external orchestration:** Break `Brain.initialize()` into
separable steps (`compile()`, `createVm()`, `finalize()`) so the sim
app can insert linking between steps. More invasive change to core.

Option A is recommended -- minimal invasion, keeps Brain in control of
its lifecycle, and the callbacks are opaque to core.

### Deliverables

1. **Core changes** (packages/core):
   - Add optional `programTransform` and `afterVmCreated` callbacks to
     `Brain` (either constructor options or setter methods). Update
     `initialize()` to call them at the appropriate points.
   - `programTransform` runs after `compileBrain()`, before `new VM()`.
   - `afterVmCreated` runs after `FiberScheduler` creation, before
     function ID assignment.
   - Expose `vm` and `scheduler` references to the callbacks via
     parameters (using interface types `IVM` and `IFiberScheduler`).
2. **Routing layer** (apps/sim):
   - Create a per-tile routing `HostAsyncFn` that dispatches based on
     `ctx.brain`. Maintain a `Map<IBrain, HostAsyncFn>` per tile.
   - During Phase 3's `registerPrograms()`, register the routing
     HostAsyncFn instead of the no-op. (Or upgrade existing no-op
     entries on first Brain.initialize.)
3. **Wire into Actor** (apps/sim):
   - Before `brain.initialize()`, set `programTransform` to call
     `linkUserPrograms(program, getAllCompiledPrograms())`.
   - Set `afterVmCreated` to call `createUserTileExec()` for each
     `UserTileLinkInfo` and register the result with the routing layer.
   - On `Brain.shutdown` / `replaceBrain`, unregister the brain-specific
     exec from the router.
4. **Hot-swap on recompile:**
   - When user tiles are recompiled while brains are running, each
     active Brain needs to re-link and re-create exec functions. This
     can be driven by `onUserTilesChanged` from Phase 3.
   - Approach: iterate all active actors, re-initialize their brains
     (calling `replaceBrain` with the same BrainDef). This is heavy but
     correct. A lighter approach (surgical re-link without full
     reinitialize) can be explored later.

### `createUserTileExec` API

```
createUserTileExec(
  linkedProgram: BrainProgram,
  linkInfo: UserTileLinkInfo,
  vm: runtime.VM,           -- the concrete VM class
  scheduler: Scheduler       -- the Scheduler interface (not FiberScheduler)
): HostAsyncFn
```

The returned `HostAsyncFn` has an `exec` method and an optional
`onPageEntered` method. Sync tiles run inline fibers; async tiles use
`scheduler.addFiber!()` and track pending fibers for handle resolution.

### Risks

- **Core API change**: adding callbacks to `Brain` is a cross-cutting
  change. Must ensure the Roblox target (`tsconfig.rbx.json`) is
  unaffected. The callbacks are optional and only used by the sim app.
- **Multi-actor routing overhead**: the per-call Map lookup on
  `ctx.brain` adds a small per-HOST_CALL cost. Should be negligible
  compared to fiber execution.
- **Hot-swap complexity**: re-initializing all brains on recompile
  resets their state (page, variables, fibers). Users will lose
  in-progress brain state on edit. This is acceptable during authoring
  but should be documented.
- **Multiple brains per BrainDef**: `Engine.updateBrainDef()` calls
  `actor.replaceBrain()` for every actor of that archetype. Each
  `replaceBrain` calls `compile()` + `initialize()`, so the linking
  callback runs once per actor. This is correct but means N link
  operations for N actors of the same archetype. The linking is cheap
  (array concat + remap), so this is acceptable.
- **Fiber ID collisions**: `createUserTileExec` uses negative
  decrementing fiber IDs (`nextFiberId = -1, -2, ...`). If two actors
  share a routing layer but have separate VMs, each VM's
  `createUserTileExec` tracks its own `nextFiberId`. No collision since
  fibers are per-VM.

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

### Phase 2 (2026-04-02)

**Planned:** Three deliverables: (1) register tiles from startup compile
results via `linkUserPrograms` + `registerUserTile` with a no-op `HostAsyncFn`,
(2) metadata cache fallback in localStorage (`sim:user-tile-metadata`), and
(3) wire into `bootstrap.ts` after `initProject()`.

**Built:** New module `apps/sim/src/services/user-tile-registration.ts` with
`registerUserTilesAtStartup()` called from `bootstrap.ts`.

- `registerPrograms()` links all compiled `UserAuthoredProgram`s against an
  empty `BrainProgram` via `linkUserPrograms()`, then calls `registerUserTile()`
  for each with a shared no-op `HostAsyncFn`.
- `saveMetadataCache()` persists `UserTileMetadata[]` (kind, name, callSpec,
  params, outputType) to `sim:user-tile-metadata`. Only `callSpec` is stored --
  `argSlots` are deterministically recomputed by `mkCallDef()`.
- `registerFromCache()` reconstructs minimal `UserAuthoredProgram` stubs from
  cached metadata and registers directly via `registerUserTile()` (no linking
  needed since stubs have empty bytecode).
- `saveMetadataCache()` is exported for Phase 3 to call on recompilation.

**Deviations:**
- Spec said "tile ID, kind, name, callDef, params, outputType" for the cache
  shape. Built without an explicit tile ID field -- the tile ID is derived by
  `registerUserTile()` from `kind` + `name` (e.g., `user.sensor.MyThing`).
- Spec said to link against a minimal empty `BrainProgram` for registration.
  Confirmed this works: `linkUserPrograms` with empty function/constant lists
  produces identity offsets (funcOffset=0, constOffset=0).
- Cache fallback path skips `linkUserPrograms` entirely -- constructs
  `UserTileLinkInfo` directly with `linkedEntryFuncId: 0` since the stub
  programs have no bytecode to offset.

**Risk resolved:** "linkUserPrograms needs a BrainProgram to link against. For
registration-only purposes, a minimal empty program should suffice. Need to
verify this works." -- Confirmed: works correctly, offsets are identity.

**No upstream spec amendments needed.**

**Propagation to Phase 3:** Startup registration is now handled. Phase 3 only
needs to wire the `CompilationManager.onCompilation` listener for the
recompile-on-file-change path and handle tile add/update/remove diffing. The
`saveMetadataCache()` export is ready for Phase 3 to update the cache after
each successful recompilation.

### Phase 3 (2026-04-03)

**Planned:** Five deliverables: (1) link and register tiles on each successful
compile with filePath->tileId tracking, (2) re-link/re-register on same
name/kind recompile (in-place swap), (3) delete old tile from `TileCatalog` and
re-register when name/kind/params change, (4) remove tile from catalog on `.ts`
file deletion, (5) notify brain editor UI of tile definition changes.

**Built:** `handleRecompilation()` function in `user-tile-registration.ts`,
wired via a second `onCompilation` listener in `vscode-bridge.ts`.

- **Tracking map** (`registeredTiles: Map<filePath, RegisteredTileInfo>`) tracks
  `{ tileId, kind, name }` per file. `populateTrackingMap()` seeds it from the
  startup compile. `handleRecompilation()` maintains it on every recompile.
- **Diffing logic**: on each recompile, builds `newFileToProgram` from results.
  For each previously-registered path: if the file no longer produces a tile, or
  its tileId changed, deletes the old tile from `TileCatalog` via
  `tiles.delete(catalogId)` using `mkSensorTileId`/`mkActuatorTileId` to
  reconstruct the catalog tile ID. Then calls `registerPrograms()` (link +
  `registerUserTile`) for all current programs -- `registerUserTile` handles
  both first-time and in-place updates.
- **File deletion**: when a path disappears from results, the tile is removed
  from the catalog and the tracking map.
- **TS errors guard**: if results are empty due to TypeScript errors
  (`hasTypeErrors`), does nothing -- keeps existing registrations intact.
- **Metadata cache update**: calls `saveMetadataCache()` after each successful
  recompile. Clears the cache only when results are empty without TS errors
  (all files deleted).
- **Change notification**: `onUserTilesChanged(fn)` event emitter exported for
  UI consumption. Fires after any add/update/remove. The brain editor tile
  picker reads from `TileCatalog` on each open -- no explicit subscription
  needed, but the event is available for proactive refresh.
- **`lastCompilationHadTsErrors()`**: new export from `user-tile-compiler.ts`
  to distinguish "no results due to TS errors" from "no tile files."

**Deviations:**
- Spec said to store `filePath -> { tileId, linkInfo }`. Built with
  `filePath -> { tileId, kind, name }` -- `linkInfo` is not stored because
  it is regenerated on each recompile via `linkUserPrograms()`. Storing
  `linkInfo` would be unnecessary state.
- Spec described startup registration as part of Phase 3 deliverable 1 ("on
  each successful compile, startup or file change"). Startup registration was
  already built in Phase 2. Phase 3 only added the file-change path and
  seeded the tracking map from startup results.
- Spec mentioned "notify the brain editor UI" -- built as an event emitter
  (`onUserTilesChanged`). The tile picker already reads fresh catalog state
  on each open, so no UI wiring was needed beyond providing the event.

**Risk resolved:** "Need to understand how the brain editor discovers available
tiles (likely reads from TileCatalog on render). If it caches, it needs a
refresh signal." -- Confirmed: the tile picker reads `getBrainServices().tiles`
via `suggestTiles()` on every render. No caching issue. The `onUserTilesChanged`
event is available if proactive refresh is needed later.

**Risk confirmed:** "If a tile's signature changes (params, kind, name), need to
tiles.delete() the old tile and re-register. The old function registry entry
cannot be removed, so it becomes dead weight." -- This is the case. When
name/kind changes, the old `FunctionRegistry` entry is orphaned. Also confirmed:
when params/outputType change but name/kind stay the same, `registerUserTile`
only swaps `fn` in-place -- the `callDef` on the `BrainFunctionEntry` is not
updated. This is cosmetic (affects tile picker display but not execution
correctness) and acceptable for now.

**No upstream spec amendments needed.**

**Propagation to Phase 4:** The `handleRecompilation` function and
`onUserTilesChanged` event are ready for Phase 4 to hook into. Phase 4 needs
to inject linking into `Brain.initialize()` (between `compileBrain` and VM
creation) and call `createUserTileExec` to produce real exec functions. The
no-op `HostAsyncFn` registered by `registerPrograms` will be swapped out by
`registerUserTile(linkInfo, realExecFn)` when a brain initializes.
