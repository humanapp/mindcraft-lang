# Multi-File Compilation -- Phased Implementation Plan

Replace per-file `compileUserTile(source)` calls with a project-level compiler
that holds all user files in a shared `ts.createProgram`, enabling import
statements between user-authored `.ts` files. Also eliminates redundant
`mindcraft.d.ts` injection since the bridge VFS already contains it.

Depends on infrastructure from:
- [user-tile-compilation-pipeline.md](user-tile-compilation-pipeline.md) (single-file compilation, Phase 1)
- [user-authored-sensors-actuators.md](user-authored-sensors-actuators.md) (compiler pipeline)
- `packages/typescript` (compileUserTile, virtual-host, lowering, emit)
- `packages/bridge-client` (ProjectFiles, FileSystem, ExportedFileSystem)

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

(Updated 2026-03-31) Phase 1 complete. Phase 2 not started.

---

## Architecture Context

### Current single-file compilation path

```
compileUserTile(source: string)
  -> Map { "/lib/lib.mindcraft.d.ts", "/user-code.ts" }
  -> createVirtualCompilerHost(files)
  -> ts.createProgram(["/user-code.ts"], opts, host)
  -> getPreEmitDiagnostics  (type-check one file)
  -> validateAst -> extractDescriptor -> lowerProgram -> emit
  -> CompileResult { program: UserAuthoredProgram }
```

Each file gets its own `ts.createProgram`. Imports cannot resolve because the
virtual filesystem only contains two files.

### VFS filesystem (bridge-client)

The sim app's `AppProject` wraps a `FileSystem` (in-memory tree) with paths
normalized to no leading slash (e.g., `"sensors/chase.ts"`,
`"mindcraft.d.ts"`). On project creation, `mindcraft.d.ts` and `tsconfig.json`
are injected as read-only files. The filesystem is persisted to localStorage
and synced via WebSocket.

### Existing virtual compiler host

`createVirtualCompilerHost` in `packages/typescript/src/compiler/virtual-host.ts`
already implements `resolveModuleNameLiterals` -- it checks
`files.has(candidate)` for `/${name}.ts`, `/${name}.d.ts`, etc. This means
import resolution across files works if all files are present in the `Map`.

### Lowering constraints

`lowerProgram` walks `sourceFile.statements` processing `FunctionDeclaration`
and `VariableStatement`. `ImportDeclaration` currently falls through to the
unsupported-statement diagnostic. The `lowerStatement` function also does not
handle it, nor does the validator explicitly allow or reject static imports.

### Entry-point vs helper files

Only files with `export default Sensor({...})` or
`export default Actuator({...})` are entry-point tile files that produce a
`UserAuthoredProgram`. Other `.ts` files are helper/utility modules that supply
functions and types but don't produce a tile themselves.

---

## Phase 1: Multi-file type-checking and cross-file function imports

Replace per-file compilation with a shared `ts.createProgram` across all user
files. Enable static import of functions and types from helper modules.

### Deliverables

1. **`UserTileProject` class** (`packages/typescript/src/compiler/project.ts`):
   - Holds a `Map<string, string>` of all `.ts` and `.d.ts` file contents.
   - `setFiles(files)` -- bulk-replace all files (initial sync).
   - `updateFile(path, content)` -- single file update.
   - `deleteFile(path)` -- remove a file.
   - `renameFile(oldPath, newPath)` -- move a file.
   - `compileAll(): ProjectCompileResult` -- creates one `ts.createProgram`
     with all files, type-checks, then runs the per-file pipeline
     (validate -> extract -> lower -> emit) on each entry-point file.
   - `compileAffected(): ProjectCompileResult` -- initially delegates to
     `compileAll()`. Hook for future incremental optimization.

2. **`ProjectCompileResult` type**:
   ```
   results: Map<path, CompileResult>   -- per entry-point file
   tsErrors: Map<path, CompileDiagnostic[]>  -- TS errors for all files
   ```

3. **Path normalization**: VFS paths (no leading slash, e.g.,
   `"sensors/chase.ts"`) are mapped to rooted compiler paths
   (`"/sensors/chase.ts"`). `mindcraft.d.ts` from the VFS maps to the lib
   path (`"/lib/lib.mindcraft.d.ts"`).

4. **Shared type-checker**: One `ts.createProgram` for all files. TypeScript
   resolves imports across files via the existing
   `resolveModuleNameLiterals` in the virtual host.

5. **Per-file lowering pipeline**: After the shared type-check, iterate each
   non-`.d.ts` source file. Run `extractDescriptor` -- if it finds a
   `Sensor`/`Actuator` default export, the file is an entry-point: run
   `validateAst`, `lowerProgram`, and `emitFunction` to produce a
   `UserAuthoredProgram`. Otherwise it's a helper module (no output).

6. **Global function table**: Before lowering any entry-point, scan all
   source files for top-level `FunctionDeclaration`s and register them in a
   shared function table with unique IDs. This pre-population handles
   circular function references naturally.

7. **Cross-file function resolution in lowering**: When `lowerProgram`
   encounters a call to an imported function, resolve it via
   `checker.getSymbolAtLocation()` -> follow the symbol to its declaration
   source file -> look up in the global function table. All helper functions
   from all files are lowered into the same `FunctionEntry[]` array.

8. **`ImportDeclaration` handling**:
   - `validator.ts`: Allow `ImportDeclaration` (static imports). Continue to
     reject dynamic `import()`.
   - `lowering.ts`: Skip `ImportDeclaration` statements (the bindings are
     resolved through the checker, not through syntactic lowering).

9. **Helper module restriction (Phase 1 only)**: In non-entry-point files,
   reject top-level `let`/`const` with initializers via the validator.
   Helper modules must contain only function declarations, type exports, and
   `import` statements. This restriction is lifted in Phase 2.

10. **Backward-compatible `compileUserTile`**: Keep the existing function as
    a convenience wrapper. Internally it creates a temporary
    `UserTileProject`, adds one file, and calls `compileAll()`.

11. **Sim app integration** (`apps/sim/src/services/user-tile-compiler.ts`):
    - Hold a `UserTileProject` instance instead of a per-file cache.
    - On file change, call `updateFile`/`deleteFile`/`renameFile` then
      `compileAll()` (or `compileAffected()`).
    - On full sync, call `setFiles()` then `compileAll()`.
    - `mindcraft.d.ts` is read from the VFS file map -- remove the
      `buildAmbientDeclarations()` call from the compilation path.

12. **Export from `packages/typescript`**: Add `UserTileProject` and
    `ProjectCompileResult` to `index.ts`.

### Risks

- **Performance**: `ts.createProgram` with ~20 files should be <100ms. This
  is better than 20 separate programs. If it's slow, `compileAffected()` is
  the optimization hook.
- **Re-exports**: `export { foo } from "./bar"` should work via the checker
  without special lowering, but needs test coverage.
- **Circular imports**: Function-level circularity is handled by
  pre-populating the function table. Value-level circularity (top-level
  variable init) is blocked by the Phase 1 helper module restriction.

---

## Phase 2: Helper module state (callsite var promotion)

Lift the Phase 1 restriction on top-level variables in helper modules.
Promote helper module variables to callsite vars in each importing
entry-point's space.

### Deliverables

1. **Callsite var promotion**: When lowering an entry-point that imports from
   a helper module containing top-level variables, allocate callsite var
   slots in the entry-point's space for each helper variable. The helper's
   variable references are rewritten to use these promoted slots.

2. **Per-importer isolation**: Each entry-point gets its own copy of the
   helper module's variables. No shared mutable state across tiles. This
   matches the existing per-tile callsite var model.

3. **Initialization ordering**: Helper module initializers run before the
   entry-point's own initializer. If entry-point A imports helper B which
   imports helper C, init order is: C -> B -> A.

4. **Validator update**: Remove the Phase 1 restriction on top-level
   variables in helper modules.

5. **Diamond imports**: If two helpers both import the same module, each
   entry-point still gets one copy of the shared module's state. The init
   function runs once per entry-point, not once per import path.

### Risks

- **Init ordering with cycles**: Circular helper imports with mutable state
  create ambiguous init order. If Phase 1's global function table handles
  circular function refs, circular state refs need a clear error or
  topological sort with a diagnostic on cycles.
- **Callsite var space growth**: An entry-point that imports many stateful
  helpers accumulates their variables. Not a correctness issue but could
  affect memory if helpers are large. Unlikely in practice.

### Phase 1 discoveries relevant to Phase 2

- `collectImportedFunctions()` in `project.ts` is where the helper module
  variable restriction lives (`hasTopLevelVariables` check). This is the
  exact site to lift for Phase 2.
- Function resolution is per-entry-point, not global. Each entry-point
  only gets functions it actually imports (transitively). This naturally
  supports Phase 2's per-importer variable isolation -- each entry-point
  will get its own callsite var slots for each imported helper's state.
- `resolvePath` utility is duplicated in `virtual-host.ts` and `project.ts`.
  Minor duplication; could be extracted if it grows but not worth it now.
- The `ImportDeclaration` skip in the validator (`return` early) prevents
  child nodes from being visited. If Phase 2 needs to validate import
  structure (e.g., reject certain re-export patterns), the validator would
  need refinement.

---

## Phase Log

### Phase 1 -- 2026-03-31

**Status**: Complete. 253/253 tests pass. TypeScript and Biome clean.

**Files created**:
- `packages/typescript/src/compiler/project.ts` -- `UserTileProject` class,
  `CompileResult`, `ProjectCompileResult` types, import collection logic

**Files modified**:
- `packages/typescript/src/compiler/compile.ts` -- slimmed to thin wrapper
  delegating to `UserTileProject`
- `packages/typescript/src/compiler/virtual-host.ts` -- relative import
  resolution (`./`, `../`) in `resolveModuleNameLiterals`
- `packages/typescript/src/compiler/lowering.ts` -- `ImportedFunction`
  interface, `importedFunctions` parameter on `lowerProgram`
- `packages/typescript/src/compiler/validator.ts` -- early return for
  `ImportDeclaration` (allows static imports, still rejects dynamic)
- `packages/typescript/src/compiler/diag-codes.ts` -- added
  `HelperModuleHasVariables = 5003`
- `packages/typescript/src/index.ts` -- exports for `UserTileProject`,
  `ProjectCompileResult`
- `apps/sim/src/services/user-tile-compiler.ts` -- rewritten to use
  `UserTileProject` instance

**Deliverable deviations from plan**:

- D5 (per-file pipeline): Plan said `extractDescriptor` would be the
  entry-point detection mechanism. Implementation uses a simpler
  `hasDefaultExport()` syntactic check first, then runs `extractDescriptor`
  only on entry-point files. Functionally equivalent, avoids running the
  full extraction on helper modules.
- D6 (global function table): Plan said "scan all source files" for a
  single shared function table. Implementation uses per-entry-point import
  collection via `collectImportedFunctions()` with transitive resolution.
  Each entry-point only gets functions it actually imports, not all functions
  in the project. More conservative and correct.
- D7 (cross-file function resolution): Plan said `checker.getSymbolAtLocation()`
  on call expressions. Implementation walks import declarations structurally
  and uses `checker.getAliasedSymbol()` for named import alias resolution.
  Same effect, different mechanism.
- D9 (helper module restriction): Plan said "validator rejects top-level
  variables in non-entry-point files." Implementation enforces this at the
  project level in `collectImportedFunctions()` via `hasTopLevelVariables()`
  check, not in the generic validator. This is correct because the
  restriction is contextual (only applies to files imported as helpers, not
  to entry-points).

**Key decisions**:
- `mindcraft.d.ts` from the VFS maps to `/lib/lib.mindcraft.d.ts` in the
  compiler path space. The `UserTileProject` constructor falls back to
  `buildAmbientDeclarations()` only if `mindcraft.d.ts` is not in the file
  map.
- Helper module detection: files without `export default` are helpers.
  Files with `export default` that fail `extractDescriptor` still get a
  `CompileResult` with diagnostics.
- On TS errors, compilation short-circuits: no entry-points are compiled.
  The `tsErrors` map is populated and `results` is empty.
