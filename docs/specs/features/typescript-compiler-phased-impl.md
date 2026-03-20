# `@mindcraft-lang/typescript` -- Phased Implementation Plan

Companion to [user-authored-sensors-actuators.md](user-authored-sensors-actuators.md).
See also [vscode-authoring-debugging.md](vscode-authoring-debugging.md) -- section 6 (Debug Metadata)
defines the compiler-emitted structures needed in Phase 11+. Sections 1-5/7-20 cover
VS Code extension and bridge concerns that are out of scope for this plan.
Focused on the compiler pipeline -- no VS Code extension, no bridge, no editor-specific concerns.

---

## Workflow Convention

Each phase follows this loop:

1. **Kick off** -- "Implement Phase N." The implementer reads this doc, the spec,
   and any relevant instruction files before writing code.
2. **Review + refine** -- Followup prompts within the same conversation.
3. **Declare done** -- "Phase N is complete." Only the user can declare the phase complete. Do not move to the post-mortem step until the user requests it.
4. **Post-mortem** -- "Run post-mortem for Phase N." This step:
   - Diffs planned deliverables vs what was actually built.
   - Records the outcome in the Phase Log (bottom of this doc).
   - Amends `user-authored-sensors-actuators.md` with dated notes if the spec
     was wrong or underspecified.
   - Propagates discoveries to upcoming phases in this doc (updated risks,
     changed deliverables, new prerequisites).
   - Writes a repo memory note with key decisions for future conversations.
5. **Next phase** -- New conversation (or same if context is not exhausted).

The planning doc is the source of truth across conversations. Session memory does
not survive. Keep this doc current.

---

## Current State

- (Updated 2026-03-20) Phases 0, 1, and 2 are complete. `packages/typescript` has a
  working build, test suite, type-checking pipeline, AST validation, and descriptor
  extraction.
- `src/index.ts` re-exports `compileUserTile`, `initCompiler`, `CompileDiagnostic`,
  `CompileResult`, `ExtractedDescriptor`, `ExtractedParam` from the compiler module
  alongside `UserAuthoredProgram` and `UserTileLinkInfo` interfaces.
- `src/compiler/compile.ts` exports `compileUserTile(source)` which accepts a
  TypeScript source string, runs it through a fully in-memory virtual
  `ts.CompilerHost`, validates the AST, and extracts descriptor metadata. No bytecode
  emission yet (Phase 3+). The lib `.d.ts` content is lazy-loaded via `initCompiler()`
  (async, dynamic `import()`) so bundlers like Vite automatically chunk the ~230KB
  lib strings into a separate file loaded on demand.
- Pipeline: parse -> type check -> validate AST -> extract descriptor.
- `src/compiler/validator.ts` rejects unsupported constructs (classes, enums, `var`,
  `for...in`, `eval`, computed property names, etc.) with positioned diagnostics.
- `src/compiler/descriptor.ts` extracts `ExtractedDescriptor` from the
  `Sensor()`/`Actuator()` default export: `kind`, `name`, `outputType`, `params`,
  `execIsAsync`, `onExecuteNode`, `onPageEnteredNode`.
- `src/compiler/types.ts` defines `CompileDiagnostic`, `ExtractedDescriptor`,
  `ExtractedParam`.
- `src/compiler/virtual-host.ts` provides `createVirtualCompilerHost()` -- a
  browser-compatible `ts.CompilerHost` with zero Node.js API usage.
- `src/compiler/ambient.ts` declares the `"mindcraft"` ambient module with `Context`,
  `Sensor`, `Actuator`, `SensorConfig`, `ActuatorConfig` (with `onExecute` and
  optional `onPageEntered`), and a minimal `Promise<T>` ambient for async support.
- `scripts/bundle-lib-dts.js` generates `src/compiler/lib-dts.generated.ts` at build
  time, bundling TypeScript's `lib.es5.d.ts` + decorator libs as string constants.
- `package.json` has an `exports` map for proper bundler resolution.
- `apps/sim` depends on `@mindcraft-lang/typescript` (local `file:` dep) and calls
  `initCompiler()` in `bootstrap.ts` to preload the compiler in the background.
- `@mindcraft-lang/core` already has all VM primitives needed: `LOAD_LOCAL`,
  `STORE_LOCAL`, `LOAD_CALLSITE_VAR`, `STORE_CALLSITE_VAR` opcodes are implemented in
  the VM. `BytecodeEmitter` has corresponding methods. `ConstantPool` is available.
  `FunctionBytecode` / `Program` / `Op` / `Instr` interfaces are available.
  The seam exists.
- `BytecodeEmitter` and `ConstantPool` are exported from
  `@mindcraft-lang/core/brain` via the compiler barrel (added in Phase 0).
- All compiler code must run in the browser at authoring time. No Node.js-only APIs
  (`node:fs`, `node:path`, etc.) in runtime code paths. Build-time scripts (code
  generation, lib bundling) may use Node.js. See the spec's Stage 1 for details.
- (Added 2026-03-20, resolved 2026-03-20) **CallDef design resolved.** The `params` /
  `ExtractedParam[]` representation maps mechanically to a `BrainActionCallDef` via a
  builder function (`buildCallDef`). Each named param becomes a `param()` arg spec
  scoped to the tile (`user.<tileName>.<paramName>`). Each anonymous param
  (`anonymous: true` in the descriptor) references a shared `anon.<type>` tile def
  that is auto-registered on the fly if it does not already exist. All params go into
  a `bag()`, with optional params wrapped in `optional()`. SlotIds are assigned in
  declaration order. The `onExecute` function receives the MapValue of args; compiled
  bytecode unpacks each param into a local variable in a preamble, applying defaults
  for absent optional params. `ExtractedParam` gains an `anonymous: boolean` field.
  `UserAuthoredProgram` includes `callDef: BrainActionCallDef` and
  `outputType?: TypeId`. TileIds use a `user.` prefix (e.g.,
  `tile.sensor->user.nearby-enemy`). See the spec's updated Section A (Params
  descriptor shape), Stage 3, and Section C (Integration with tile system) for full
  details.

---

## Phases

### Phase 0: Package skeleton and test wiring

**Objective:** Make `packages/typescript` a real, buildable, testable package with
`typescript` as a production dependency and a working test runner. Prove the
`@mindcraft-lang/core` consumption seam compiles.

**Packages/files touched:**

- `packages/typescript/package.json` -- add `typescript` as a production dep, add
  `test` / `pretest` scripts, add `tsx` devDependency
- `packages/typescript/tsconfig.json` -- add path aliases resolving
  `@mindcraft-lang/core`
- `packages/typescript/src/index.ts` -- keep existing types, add a re-export proving
  the core seam
- `packages/typescript/src/compiler/compile.ts` -- stub orchestrator with the public
  API signature
- `packages/typescript/src/compiler/compile.spec.ts` -- one test that imports the API
  and asserts it exists

**Concrete deliverables:**

1. `npm run build` succeeds in `packages/typescript`
2. `npm test` runs and passes at least one test
3. `typescript` (the TS compiler API) is a production dependency
4. Core types (`Op`, `BytecodeEmitter`, `ConstantPool`, `Program`, `FunctionBytecode`)
   are importable and resolved

**Acceptance criteria:**

- `npm run build && npm test` passes from `packages/typescript/`
- `npm run check` (biome) passes
- No dist/ output references `@mindcraft-lang/core` internals that aren't stable exports

**Key risks:**

- tsconfig resolution between the two workspace packages -- need to verify that
  `@mindcraft-lang/core`'s built dist exports resolve correctly for the TS package's
  compilation and tests
- `typescript` as a prod dep vs devDep: it must be prod because user code compilation
  happens in-browser at authoring time, not just at build time

---

### Phase 1: Virtual file host + TS type checking

**Objective:** Accept a TypeScript source string, set it up in a virtual
`ts.CompilerHost` alongside a minimal `mindcraft.d.ts` ambient file, run the TS type
checker, and return diagnostics. This is spec Stage 1 in isolation.

**Packages/files touched:**

- `packages/typescript/src/compiler/virtual-host.ts` --
  `createVirtualCompilerHost(files, options)` implementation
- `packages/typescript/src/compiler/ambient.ts` -- hardcoded `mindcraft.d.ts` content
  (minimal: `Sensor`, `Actuator`, `Context` with `time`, `dt`,
  `self.getVariable`, `self.setVariable`)
- `packages/typescript/src/compiler/compile.ts` -- wire up: source string in,
  `ts.createProgram`, return diagnostics
- `packages/typescript/src/compiler/compile.spec.ts` -- tests:
  - Valid sensor source produces zero diagnostics
  - Source with type error produces diagnostics with correct positions
  - Source referencing undefined API method produces error

**Concrete deliverables:**

1. `compileUserTile(source: string): CompileResult` exists (returns diagnostics at
   minimum, no bytecode yet)
2. Virtual file host works with `ts.createProgram`
3. `mindcraft.d.ts` ambient is minimal but sufficient for the vertical slice

**Acceptance criteria:**

- Test: valid sensor source -> 0 TS diagnostics
- Test: `ctx.engine.nonExistent()` -> diagnostic error
- Test: wrong argument type -> diagnostic error

**Key risks:**

- TypeScript compiler API is large and slightly different between versions. Pin to
  `~5.7.2` (already done in package.json).
- `mindcraft.d.ts` surface design -- start tiny, expand later. Don't try to design
  the full engine context API now.
- **Browser compatibility.** The virtual host must be fully in-memory -- no `node:fs`,
  `node:path`, or any other Node.js-only API. TypeScript's default `CompilerHost`
  uses `node:fs` internally, so every host method (`readFile`, `fileExists`,
  `getSourceFile`, `getDefaultLibFileName`, etc.) must be replaced with an in-memory
  implementation. `ts.sys` must not be used. TypeScript's lib `.d.ts` files (e.g.,
  `lib.es5.d.ts`) must be bundled as string constants at build time (a build script
  may read them from `node_modules/typescript/lib/` and generate a source module).
  `getDefaultLibFileName` must return a virtual path that exists in the in-memory
  file map, not a real filesystem path.

---

### Phase 2: AST validation + descriptor extraction

**Objective:** Walk the TS AST to (a) reject unsupported constructs and (b) extract the
`Sensor()` / `Actuator()` descriptor metadata. This is spec Stages 2-3.

**Packages/files touched:**

- `packages/typescript/src/compiler/validator.ts` -- AST walker that rejects classes,
  `eval`, `var`, dynamic imports, etc. Produces diagnostics.
- `packages/typescript/src/compiler/descriptor.ts` -- Extract `kind`, `name`,
  `outputType`, `params`, `execFuncNode`, `onPageEnteredNode` from the default export
- `packages/typescript/src/compiler/types.ts` -- `ExtractedDescriptor`,
  `ExtractedParam`, `CompileDiagnostic` types
- Tests for both

**Concrete deliverables:**

1. Validator rejects `class`, `eval`, `var`, `for...in`, computed property names --
   with diagnostics
2. Descriptor extraction reads `Sensor({ name, output, params, exec })` from AST
3. `onPageEntered` named export detected if present
4. Compile pipeline now runs: parse -> check -> validate -> extract

**Acceptance criteria:**

- Test: source with `class Foo {}` -> validation diagnostic
  "Classes are not supported"
- Test: source with `var x = 1` -> diagnostic
  "`var` is not allowed, use `let` or `const`"
- Test: valid sensor source -> `ExtractedDescriptor` with correct `name`,
  `kind: "sensor"`, `outputType`, params list
- Test: actuator source with `async exec` -> descriptor with async flag
- Test: source with `export function onPageEntered` -> `onPageEnteredNode` is non-null

**Key risks:**

- Descriptor shape must be a literal object expression. If users assign to a variable
  first, extraction fails. This is an intentional constraint -- document and enforce it.
- The validator needs to be exhaustive over disallowed AST node kinds. Use
  `ts.SyntaxKind` enum to enumerate. Reject unknown nodes rather than silently
  accepting.
- (Added 2026-03-20) `CompileDiagnostic` and `CompileResult` types already exist in
  `compile.ts` from Phase 0. Phase 2's planned `types.ts` should either import from
  there or relocate them -- avoid duplication.

**Prerequisite before Phase 3:** The `params` representation has been formalized
(resolved 2026-03-20). `ExtractedParam[]` maps mechanically to a `BrainActionCallDef`
via the callDef builder. Named params create per-tile `BrainTileParameterDef` entries;
anonymous params reuse or auto-create shared `anon.<type>` tile defs. Phase 3 can
proceed with this design. See the spec's updated Section A and Section C for details.

---

### Phase 3: Minimal lowering -- the first vertical slice

**Objective:** Lower the simplest possible `exec` function body to IR and emit working
bytecode. Target: a sync sensor that does arithmetic on params and returns a boolean.
No helpers, no callsite vars, no control flow.

**Packages/files touched:**

- `packages/typescript/src/compiler/ir.ts` -- IR node types (start small: `PushConst`,
  `LoadLocal`, `StoreLocal`, `Return`, `HostCallArgs`, arithmetic ops)
- `packages/typescript/src/compiler/lowering.ts` -- TS AST -> IR for: variable
  declarations, number/string/boolean literals, binary expressions, return statements,
  parameter access
- `packages/typescript/src/compiler/emit.ts` -- IR -> `FunctionBytecode` using
  `BytecodeEmitter` + `ConstantPool` from core
- `packages/typescript/src/compiler/call-def-builder.ts` -- converts
  `ExtractedDescriptor` to `BrainActionCallDef`
- `packages/typescript/src/compiler/compile.ts` -- wire lowering + emission into the
  pipeline, produce a `UserAuthoredProgram`
- `packages/typescript/src/compiler/types.ts` -- add `anonymous: boolean` to
  `ExtractedParam`
- `packages/typescript/src/compiler/descriptor.ts` -- extract `anonymous` flag from
  param definitions
- `packages/typescript/src/compiler/ambient.ts` -- make `params` optional, add
  `anonymous?: boolean` to `ParamDef`
- Tests that compile a source string and execute the resulting bytecode in the VM

**Concrete deliverables:**

1. A sensor like the following compiles to valid bytecode:

   ```typescript
   export default Sensor({
     name: "is-close",
     output: "boolean",
     params: { distance: { type: "number", default: 5 } },
     onExecute(ctx: Context, params: { distance: number }): boolean {
       return params.distance < 10;
     },
   });
   ```

2. The bytecode passes `BytecodeVerifier`
3. The bytecode executes in a real `VM` instance and returns the correct value
4. `UserAuthoredProgram` is fully assembled with functions, constants, callDef, and
   metadata
5. `buildCallDef()` produces correct `BrainActionCallDef` from `ExtractedDescriptor`:
   correct argSlots, slotIds, tileId strings, optional/required distinction,
   anonymous flag

**Acceptance criteria:**

- End-to-end test: source string -> `UserAuthoredProgram` -> `VM.runFiber()` ->
  correct return value
- Test covers: number literal, boolean literal, string literal, `<` comparison,
  `return`
- `BytecodeVerifier` passes on output
- Test: `buildCallDef` for a descriptor with one required param and one optional
  param -> callDef has 2 argSlots with correct tileIds and optional/required flags
- Test: `buildCallDef` for a descriptor with an anonymous param -> argSpec has
  `anonymous: true` and tileId starts with `tile.parameter->anon.`

**Key risks:**

- Getting parameter passing right. The `onExecute` function receives `(ctx, params)`.
  `params` must be a struct/map. Need to decide how parameters map to local slots.
- Binary expression lowering -- need to decide if `<` compiles to a HOST_CALL
  (existing operator overload) or a new mechanism. The spec says arithmetic operators
  use `HOST_CALL_ARGS`. Need to check if the existing operator host functions accept
  individual args or a `MapValue`.
- This is the hardest phase because it forces all the plumbing to work for the first
  time.
- (Updated 2026-03-20) **CallDef design resolved.** The `ExtractedParam[]` maps to a
  `BrainActionCallDef` via `buildCallDef()`. Named params produce per-tile parameter
  tileIds (`user.<tileName>.<paramName>`). Anonymous params reference shared
  `anon.<type>` tile defs (auto-registered on the fly if missing). The `onExecute`
  bytecode receives a MapValue keyed by slotId and unpacks params into locals in a
  preamble. `ambient.ts` needs `params` made optional, and `ParamDef` needs
  `anonymous?: boolean`. `ExtractedParam` gains `anonymous: boolean`. New file
  `call-def-builder.ts` handles the conversion. No callSpec combinators are exposed
  to user code.

---

### Phase 4: Control flow + local variables

**Objective:** Support `if`/`else`, `while`, `for`, `let`/`const` with block scoping,
and `break`/`continue`.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- add visitors for `IfStatement`,
  `WhileStatement`, `ForStatement`, `Block`, `VariableDeclarationList`
- `packages/typescript/src/compiler/ir.ts` -- add `Jump`, `JumpIfFalse`,
  `JumpIfTrue`, `Label`
- `packages/typescript/src/compiler/scope.ts` -- scope stack for local variable
  allocation with block scoping
- Tests

**Concrete deliverables:**

1. `if`/`else` compiles and executes correctly
2. `while` loop compiles and executes (including with `break`/`continue`)
3. `for` loop (C-style) compiles
4. Block-scoped `let`/`const` allocate distinct local slots; shadowing works
5. Nested blocks produce correct variable indices

**Acceptance criteria:**

- Test: sensor with
  `if (params.x > 5) { return true; } else { return false; }` ->
  correct results for x=3 and x=10
- Test: sensor with a `while` loop counting to N -> correct result
- Test: shadowed variables (`let x = 1; { let x = 2; }; return x;`) -> returns 1
- Test: `for (let i = 0; i < 3; i++)` -> runs 3 iterations

**Key risks:**

- `break`/`continue` need a label stack to track enclosing loop boundaries
- Variable slot reuse across non-overlapping scopes (optimization, can defer)

---

### Phase 5: Helper functions + callsite-persistent state

**Objective:** Support user-defined helper functions (compiled as additional
`FunctionBytecode` entries, called via `CALL`) and top-level `let`/`const` as
callsite-persistent variables (`LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR`).

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `FunctionDeclaration` at
  file level, function calls via `CALL` opcode
- `packages/typescript/src/compiler/compile.ts` -- two-pass: first pass assigns
  function IDs, second pass compiles (same pattern as `BrainCompiler`)
- `packages/typescript/src/compiler/emit.ts` -- emit multiple `FunctionBytecode`
  entries into `Program.functions`
- `packages/typescript/src/compiler/scope.ts` -- distinguish module-level scope
  (callsite vars) from function-level scope (locals)
- Module init function generation (compiler-generated function that evaluates
  top-level initializers)

**Concrete deliverables:**

1. Helper functions compile and are callable from `exec`:

   ```typescript
   function clamp(v: number, lo: number, hi: number): number {
     if (v < lo) return lo;
     if (v > hi) return hi;
     return v;
   }

   export default Sensor({
     ...,
     exec(ctx, params) {
       return clamp(params.x, 0, 100) > 50;
     },
   });
   ```

2. Top-level `let` -> `STORE_CALLSITE_VAR` / `LOAD_CALLSITE_VAR`
3. Module init function generated for top-level initializers
4. `UserAuthoredProgram.numCallsiteVars` is correct
5. Callsite vars persist across invocations (test by running the program twice and
   verifying state accumulates)

**Acceptance criteria:**

- Test: helper function called from `exec` returns correct value
- Test: top-level `let count = 0; ... count += 1; return count;` -> returns 1 on
  first call, 2 on second
- Test: multiple top-level vars -> correct slot indices
- Test: module init function resets state when `callsiteVars` is freshly allocated

**Key risks:**

- Function ID assignment ordering. Must match the two-pass pattern from
  `BrainCompiler` so that `CALL` operands are correct.
- Module init function must run before the first `exec` invocation. The exec wrapper
  checks for uninitialized `callsiteVars` and runs init.

---

### Phase 6: `onPageEntered` + lifecycle wrapper

**Objective:** Compile the `export function onPageEntered(ctx)` named export and
generate the `onPageEntered` wrapper that runs module init then calls the user's
function.

**Packages/files touched:**

- `packages/typescript/src/compiler/compile.ts` -- detect and compile `onPageEntered`
- `packages/typescript/src/compiler/lowering.ts` -- generated wrapper function emission
- `packages/typescript/src/compiler/compile.ts` -- set
  `lifecycleFuncIds.onPageEntered` on `UserAuthoredProgram`

**Concrete deliverables:**

1. `onPageEntered` compiles as a separate `FunctionBytecode`
2. Generated wrapper calls module init, then user `onPageEntered`
3. `UserAuthoredProgram.lifecycleFuncIds.onPageEntered` points to wrapper
4. If no user `onPageEntered`, wrapper still runs module init

**Acceptance criteria:**

- Test: `onPageEntered` resets a callsite var; next `exec` call sees the reset value
- Test: source without `onPageEntered` -> wrapper still generated, runs init
- Test: `onPageEntered` wrapper calls user function after init (user function can
  override init values)

**Key risks:**

- Low risk. Straightforward extension of Phase 5.

---

### Phase 7: Linker

**Objective:** Implement the linker that merges `UserAuthoredProgram` functions and
constants into a `BrainProgram`, remapping `CALL` and `PUSH_CONST` operands. Prove the
linked program executes correctly in the VM.

**Packages/files touched:**

- `packages/typescript/src/linker/linker.ts` --
  `linkUserPrograms(brainProgram, userPrograms[])` function
- `packages/typescript/src/linker/linker.spec.ts` -- tests

**Concrete deliverables:**

1. `linkUserPrograms()` appends user functions to `BrainProgram.functions`, remaps
   `CALL` funcId operands (+offset), remaps `PUSH_CONST` indices, merges constants
2. Returns the linked entry funcId for each user program
3. A test that creates a minimal `BrainProgram` + `UserAuthoredProgram`, links them,
   and runs the combined program

**Acceptance criteria:**

- Test: linked program's user function is callable by funcId from brain code
- Test: constant pool indices are correct after merging
- Test: `CALL` to a user helper function resolves correctly in the linked program

**Key risks:**

- Must remap all `PUSH_CONST` instructions in user bytecode, not just in entry
  function -- all helper functions too
- Must handle the case where user programs share no constants (trivial) and where
  they have overlapping constant values (dedup during merge, or just append)

---

### Phase 8: VM dispatch wrapper + integration test

**Objective:** Build the `BrainFunctionEntry` exec wrapper that spawns a fiber for user
bytecode and resolves a handle. Wire it through function registration so a brain rule
can invoke a user-authored tile end-to-end.

**Packages/files touched:**

- `packages/typescript/src/runtime/authored-function.ts` --
  `createUserTileEntry(program, scheduler, handles)` that returns a
  `BrainFunctionEntry`-compatible `exec` function
- `packages/typescript/src/runtime/authored-function.spec.ts` -- integration test

**Concrete deliverables:**

1. `exec` wrapper: allocates/retrieves `callsiteVars`, spawns fiber, resolves handle
2. Integration test: compile a sensor from source -> link into a BrainProgram ->
   register as a `BrainFunctionEntry` -> invoke from a manually-constructed brain
   fiber -> verify return value
3. Integration test: same for an actuator

**Acceptance criteria:**

- Test: sync sensor resolves handle within same tick
- Test: callsite vars persist across two invocations of the same tile
- Test: two callsites get independent callsite var state

**Key risks:**

- Fiber spawning mechanics -- need to match the `FiberScheduler.spawn()` API exactly
- Handle resolution timing for sync case -- verify handle resolves immediately when
  user fiber completes without AWAIT

---

### Phase 9+: Broader language coverage (looser)

With the vertical slice proven, subsequent phases expand language support:

- **9a: Logical operators** -- `&&`, `||`, `!` with short-circuit evaluation
- **9b: String operations** -- concatenation, template literals
- **9c: Object/struct literals** -- `{ x: 1, y: 2 }` -> `STRUCT_NEW` / `STRUCT_SET`
- **9d: Array/list literals** -- `[1, 2, 3]` -> `LIST_NEW` / `LIST_PUSH`
- **9e: Property access chains** -- `ctx.self.position` -> chained `GET_FIELD`
- **9f: `for...of`** -- list iteration
- **9g: Ternary + nullish coalescing** -- `??`, `?:` lowering
- **9h: Destructuring** -- simple object/array destructuring
- **9i: Arrow functions** -- as helpers (same as function declarations, no closures)

Each of these is small and independently testable.

---

### Phase 10+: Async support (looser)

- **10a: HOST_CALL_ASYNC emission** -- detect async host function calls, emit correct
  opcodes
- **10b: AWAIT emission** -- emit AWAIT after async host calls
- **10c: Async `exec`** -- compile `async exec()` with multiple await points
- **10d: Integration** -- async actuator test end-to-end with handle
  suspension/resumption

---

### Phase 11+: Debug metadata (looser)

- Statement boundary emission
- Source span tracking during lowering
- `pcToSpanIndex` construction during emission
- Scope and local variable metadata
- `DebugMetadata` assembly on `UserAuthoredProgram`

---

## Immediate Next Phase

**Phase 0** should be done first. The package has no test runner, no `typescript`
production dependency, and no proven build-and-consume seam with core.

Every subsequent phase depends on being able to `npm run build && npm test` and import
from both `typescript` and `@mindcraft-lang/core/brain`. Getting this wrong blocks
everything. Getting it right is fast (a few files) and immediately validates the
dependency graph.

---

## Suggested First Vertical Slice

The smallest meaningful end-to-end compile target is a **sync sensor with one numeric
parameter, one comparison, and a return**:

```typescript
import { Sensor, type Context } from "mindcraft";

export default Sensor({
  name: "is-close",
  output: "boolean",
  params: {
    distance: { type: "number", default: 5 },
  },
  exec(ctx: Context, params: { distance: number }): boolean {
    return params.distance < 10;
  },
});
```

This forces:

- Virtual file host + TS type checking (Phase 1)
- AST validation + descriptor extraction (Phase 2)
- Parameter access lowering (`params.distance` -> `LoadLocal` or `GetField`)
- Number literal (`10` -> `PushConst`)
- Binary comparison (`<` -> operator HOST_CALL)
- Return statement -> `RET`
- Program assembly -> `UserAuthoredProgram`
- Bytecode verification

It does **not** require: control flow, helper functions, callsite vars,
`onPageEntered`, async, linking, or the exec wrapper. Those are deliberately left out
so the slice stays narrow and provable.

The end-to-end test for this slice:
`compile("...source...") -> program -> new VM(program) -> runFiber(...) -> assert result === TRUE_VALUE`.

This slice spans Phases 1-3 and should be the target of the first runnable demo.
Everything after it is incremental.

---

## Phase Log

Completed phases are recorded here with dates, actual outcomes, and deviations.

### Phase 0 -- 2026-03-20

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                               | Actual  | Notes                                                                                                                                        |
| --------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`: `typescript` to prod deps, `tsx` devDep, test scripts | Done    | --                                                                                                                                           |
| `tsconfig.json`: add path aliases                                     | Skipped | Already had `@mindcraft-lang/core` path alias. `@mindcraft-lang/core/brain` resolves via the workspace `file:` dep without a separate alias. |
| `src/index.ts`: re-export proving core seam                           | Skipped | Seam proof lives in `core-imports.spec.ts` instead. No reason to add a re-export to the public API.                                          |
| `src/compiler/compile.ts`: stub API                                   | Done    | `CompileDiagnostic`, `CompileResult`, `compileUserTile()`                                                                                    |
| `src/compiler/compile.spec.ts`: one test                              | Done    | --                                                                                                                                           |
| Core types importable                                                 | Done    | Required adding `BytecodeEmitter` and `ConstantPool` exports to `packages/core/src/brain/compiler/index.ts`.                                 |
| `biome.json`                                                          | Added   | Not in planned file list but implied by acceptance criteria. Extends root config.                                                            |

**Extra file:** `src/compiler/core-imports.spec.ts` -- dedicated test for core brain
imports (`Op`, `BytecodeEmitter`, `ConstantPool`, type-only imports for `Program`,
`FunctionBytecode`, `Value`).

**Discoveries:**

1. `BytecodeEmitter` and `ConstantPool` were not exported from `@mindcraft-lang/core/brain`.
   The Current State section was inaccurate -- said "ConstantPool is exported" but it
   was only defined, not re-exported from the barrel. Fixed in this phase.
2. The `Op` enum uses `RET`, not `RETURN`. Future code must use `Op.RET`.
3. The existing `tsconfig.json` paths entry for `@mindcraft-lang/core` already worked.
   Subpath imports (`/brain`) resolve through the workspace `file:` dependency and
   the core package's `exports` map -- no additional tsconfig paths needed.
4. Test runner pattern: `tsx --tsconfig tsconfig.json --test $(find src -name '*.spec.ts')`.
   The `pretest` script runs `npm run build` (full tsc) since the typescript package has
   no platform-specific build steps unlike core's `build:node`.

### Phase 1 -- 2026-03-20

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                       | Actual | Notes                                                                                                                                         |
| ------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/compiler/virtual-host.ts`: `createVirtualCompilerHost()` | Done   | Includes `resolveModuleNameLiterals` for `"mindcraft"` import resolution.                                                                     |
| `src/compiler/ambient.ts`: hardcoded `mindcraft.d.ts`         | Done   | Ambient module declaration (`declare module "mindcraft"`) with `Context`, `Sensor`, `Actuator`, `ParamDef`, `SensorConfig`, `ActuatorConfig`. |
| `src/compiler/compile.ts`: wire up type checking              | Done   | Uses `ts.createProgram` + `ts.getPreEmitDiagnostics`. Filters diagnostics to user code only.                                                  |
| `src/compiler/compile.spec.ts`: 3 required tests              | Done   | 5 tests total (3 required + line/column info + empty source).                                                                                 |
| Lib `.d.ts` bundled at build time                             | Done   | `scripts/bundle-lib-dts.js` generates `src/compiler/lib-dts.generated.ts`. `prebuild` npm script runs it before `tsc`.                        |

**Additional work (review iteration):**

| Item                         | Notes                                                                                                                                                                                                                   |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lazy-loading / chunking      | Lib `.d.ts` content loaded via dynamic `import()` in `initCompiler()`. Vite automatically splits the ~230KB into a separate chunk. `compileUserTile()` stays sync; requires `initCompiler()` to have been called first. |
| `package.json` `exports` map | Added `"."` entry with `types` + `import` conditions for proper bundler resolution.                                                                                                                                     |
| `src/index.ts` re-exports    | Now re-exports `compileUserTile`, `initCompiler`, `CompileDiagnostic`, `CompileResult` from the compiler module.                                                                                                        |
| `apps/sim` integration       | Added `@mindcraft-lang/typescript` as `file:` dep. `bootstrap.ts` calls `initCompiler()` to preload in the background. Vite prod build confirms separate chunk (`lib-dts.generated-*.js`, 231KB).                       |
| Biome fix in generator       | `scripts/bundle-lib-dts.js` now escapes only `${` (not all `$`) in template literals, eliminating `noUselessEscapeInString` warnings.                                                                                   |

**Extra files:**

- `scripts/bundle-lib-dts.js` -- build script that reads `lib.es5.d.ts`,
  `lib.decorators.d.ts`, `lib.decorators.legacy.d.ts` from
  `node_modules/typescript/lib/` and generates a source module with string constants.
- `src/compiler/lib-dts.generated.ts` -- generated file (not committed), contains
  ~5000 lines of embedded lib type definitions.

**Discoveries:**

1. TypeScript 5.7's `lib.es5.d.ts` has `/// <reference lib="decorators" />` and
   `/// <reference lib="decorators.legacy" />` directives. All three files
   (`lib.es5.d.ts`, `lib.decorators.d.ts`, `lib.decorators.legacy.d.ts`) must be
   bundled for type checking to work without errors.
2. The virtual host needs `resolveModuleNameLiterals` for resolving `import ... from
"mindcraft"` to the ambient `.d.ts` file. TypeScript's built-in module resolution
   does not find virtual files on its own.
3. The `"mindcraft"` ambient types use `declare module "mindcraft" { ... }` pattern.
   The `.d.ts` file must be included in `rootNames` passed to `ts.createProgram`
   for the ambient module declaration to be visible.
4. `getDefaultLibFileName` returns a virtual path (`/lib/lib.es5.d.ts`). TypeScript
   resolves `/// <reference lib="..." />` directives relative to this path's directory.
5. Compiler options for the virtual program: `target: ES5`, `module: ES2015`,
   `strict: true`, `noEmit: true`. These are sufficient for Phase 1 type checking.
6. Diagnostics are filtered to `d.file?.fileName === "/user-code.ts"` to avoid
   surfacing internal lib/ambient diagnostics to the user.
7. The generated `lib-dts.generated.ts` file uses template literal strings. Content
   is escaped for backticks, `${` sequences, and backslash characters. Only `${`
   needs escaping (not bare `$`), otherwise Biome reports `noUselessEscapeInString`.
8. The lib `.d.ts` module (~230KB) should be loaded lazily via dynamic `import()` so
   bundlers like Vite automatically split it into a separate chunk. The async
   `initCompiler()` function handles this. Webapps should call it at startup so the
   chunk loads in the background before the user's first compile.
9. The `exports` map in `package.json` is needed for bundlers to resolve the package
   entry point correctly. Use `"types"` + `"import"` conditions under `"."`.

### Phase 2 -- 2026-03-20

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                             | Actual  | Notes                                                                                                                                                                                                         |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/compiler/validator.ts`: AST validation walker  | Done    | Rejects classes, enums, `var`, `for...in`, `with`, `switch`, generators/`yield`, computed property names, `debugger`, labeled statements, `delete`, regex, dynamic `import()`, decorators, forbidden globals. |
| `src/compiler/descriptor.ts`: descriptor extraction | Done    | Extracts `kind`, `name`, `outputType`, `params`, `onExecuteNode`, `onPageEnteredNode` from the default export object literal.                                                                                 |
| `src/compiler/types.ts`: shared types               | Done    | `CompileDiagnostic` relocated from `compile.ts`. `ExtractedDescriptor`, `ExtractedParam` defined.                                                                                                             |
| Pipeline: parse -> check -> validate -> extract     | Done    | `compileUserTile()` returns `CompileResult` with optional `descriptor`. Stages short-circuit on first failure.                                                                                                |
| `onPageEntered` as named export                     | Changed | Moved inside the `Sensor()`/`Actuator()` descriptor object. See design change below.                                                                                                                          |
| `exec` method name                                  | Changed | Renamed to `onExecute` for consistency with `onPageEntered`. See design change below.                                                                                                                         |

**Design changes from spec:**

1. **`exec` renamed to `onExecute`.** All lifecycle/entry-point methods now share a
   consistent `on*` naming convention: `onExecute`, `onPageEntered`.
2. **`onPageEntered` moved inside the descriptor.** Instead of a separate named export
   (`export function onPageEntered`), it is now an optional method on the
   `Sensor()`/`Actuator()` config object. This keeps all tile behavior in a single
   cohesive unit, simplifies extraction (no separate file-level scan), and gives
   automatic type checking via the `SensorConfig`/`ActuatorConfig` interfaces.
3. **`Promise<T>` ambient declaration.** TypeScript's type checker requires a `Promise`
   constructor declaration for `async` functions even with `target: ES5` and
   `noEmit: true`. Instead of bundling `lib.es2015.promise.d.ts` (which has
   `/// <reference no-default-lib="true"/>` that suppresses `lib.es5.d.ts`), a minimal
   `Promise<T>` interface + constructor was added to `ambient.ts`.

**Test counts:** 24 total (5 type-checking, 7 validation, 9 extraction, 3 core imports).

**Discoveries:**

1. `exec` -> `onExecute` is a better naming convention. The spec used `exec` but
   `onExecute` aligns with `onPageEntered` and any future `on*` lifecycle hooks.
2. `onPageEntered` belongs inside the descriptor object, not as a separate file-level
   export. This is simpler for users, simpler for extraction, and gives TypeScript
   type checking for free via the config interfaces.
3. TypeScript's ES5 target fails on `async` functions unless a `Promise` type is
   globally available. The `lib.es2015.promise.d.ts` file cannot simply be added
   to rootNames because it has `/// <reference no-default-lib="true"/>` which
   suppresses `lib.es5.d.ts`. A minimal ambient declaration is the cleanest fix.
4. `CompileDiagnostic` was relocated from `compile.ts` to `types.ts` to avoid
   duplication. `compile.ts` re-exports it for API compatibility.
5. The validator checks 13 distinct construct categories. It uses a `switch` on
   `SyntaxKind` plus targeted checks for `VariableDeclarationList` flags, call
   expressions with `import` keyword, and forbidden global identifiers.
6. Descriptor extraction handles both property assignment syntax
   (`onExecute: function(...)`) and method declaration syntax (`onExecute(...)`).
7. The `params` representation as `ExtractedParam[]` was a placeholder at time of
   Phase 2 completion. Resolved 2026-03-20: `ExtractedParam[]` maps mechanically
   to a `BrainActionCallDef` via `buildCallDef()`. Named params create per-tile
   parameter tileIds; anonymous params reuse shared `anon.<type>` tile defs
   (auto-registered if missing). See the Phase 3 updated risks and the spec's
   updated Section A and Section C.
8. The `ExtractedDescriptor.onPageEnteredNode` type changed from
   `ts.FunctionDeclaration` to `ts.MethodDeclaration | ts.FunctionExpression |
ts.ArrowFunction` since it now comes from an object literal method rather than
   a file-level function declaration.
