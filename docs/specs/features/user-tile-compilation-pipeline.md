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

Not started. The compiler (`initCompiler()`) is preloaded in `apps/sim/src/bootstrap.ts`
but no compilation or tile registration is wired to filesystem changes.

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
- `initCompiler()` is async (loads lib files). Must ensure it has completed
  before first compilation attempt.

---

## Phase 2: Tile registration with stable function wrappers

On first successful compile of a `.ts` file, register its sensor/actuator tile
in the brain services using an indirection wrapper so that the underlying
function can be hot-swapped on recompile.

### Deliverables

1. Indirection wrapper factory -- creates a stable `HostAsyncFn` that delegates
   to a mutable inner function reference. Exposes a `swap(newFn)` method.
2. On first successful compile:
   - Call `registerUserTile(linkInfo, wrapperFn)` to register tiles + params.
   - Store the mapping: `filePath -> { tileId, wrapper }`.
3. Linking strategy: `linkUserPrograms` needs a `BrainProgram`. For registration
   purposes, create a minimal empty brain program to link against. The real
   linking happens at brain-run time (Phase 4).
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

## Phase 3: Hot-swap on recompile

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
  Phase 1-3 assumes brains are not running during authoring, or that a stale
  reference is acceptable.
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
2. The wrappers registered in Phase 2 now delegate to real exec functions.
3. When user tiles are recompiled while a brain is running, re-link and
   re-swap. Define when this takes effect (next tick? next brain restart?).

### Risks

- Linking must happen after the base brain program is compiled but before
  execution begins. Need to find the right hook in the sim's brain lifecycle.
- Multiple actors may share the same brain program. Linked programs should
  be shared, not duplicated per actor.

---

## Phase 5: Full-sync and reconnect handling

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

## Phase 6: Multi-file imports (future)

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

Out of scope until Phases 1-5 are stable.

---

## Phase Log

(Written during post-mortem only. Do not edit during implementation.)
