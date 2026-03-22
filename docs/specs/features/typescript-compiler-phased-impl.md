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

- (Updated 2026-03-21) Phases 0-8 are complete.
  `packages/typescript` has a working build, test suite, type-checking pipeline, AST
  validation, descriptor extraction, the callDef design, end-to-end bytecode
  compilation and execution, control flow (`if`/`else`, `while`, `for`,
  `break`/`continue`, block-scoped `let`/`const`, variable shadowing, assignments,
  `++`/`--`), user-defined helper functions (`CALL`), callsite-persistent top-level
  variables (`LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR` with module init function),
  `onPageEntered` lifecycle support (user body compilation + always-generated
  wrapper that calls module init then user function), `null` and `undefined`
  literal support (both map to `NIL_VALUE`), nullish comparison support
  (`x === null`, `x !== undefined`) via nil operator overloads in core and
  `tsTypeToTypeId` handling of `TypeFlags.Null`, `TypeFlags.Undefined`, and
  nullable union types, a linker that merges `UserAuthoredProgram` functions
  and constants into a `BrainProgram` with `CALL`/`PUSH_CONST` operand remapping,
  a VM dispatch wrapper (`createUserTileExec`) that spawns fibers for user
  bytecode with inline sync execution via `vm.spawnFiber()` + `vm.runFiber()`,
  and a registration bridge (`registerUserTile`) that wires user-authored tiles
  into the `FunctionRegistry` and `TileCatalog`.
- `src/index.ts` re-exports `compileUserTile`, `initCompiler`, `buildAmbientSource`,
  `CompileDiagnostic`, `CompileResult`, `ExtractedDescriptor`, `ExtractedParam` from
  the compiler module alongside `UserAuthoredProgram` and `UserTileLinkInfo`
  interfaces, `linkUserPrograms` and `LinkResult` from the linker module, and
  `createUserTileExec`, `registerUserTile`, `RegistrationServices` from the runtime
  module.
- `src/linker/linker.ts` exports `linkUserPrograms(brainProgram, userPrograms[])` which
  appends user functions to the brain program, remaps `CALL` and `PUSH_CONST` operands,
  merges constants, and returns `LinkResult` with `linkedEntryFuncId`,
  `linkedInitFuncId`, and `linkedOnPageEnteredFuncId` per user program.
- `src/runtime/authored-function.ts` exports `createUserTileExec(linkedProgram,
linkInfo, vm, scheduler)` returning a `HostAsyncFn` with `exec` and `onPageEntered`
  methods. Sync tiles execute inline via `vm.spawnFiber()` + `vm.runFiber()`.
- `src/runtime/registration-bridge.ts` exports `registerUserTile(linkInfo, hostFn,
services)` performing three-step registration: param tile defs, function entry,
  sensor/actuator tile def.
- `src/compiler/compile.ts` exports `compileUserTile(source, options?)` which accepts
  a TypeScript source string and optional `CompileOptions`, runs it through a fully
  in-memory virtual `ts.CompilerHost`, validates the AST, extracts descriptor metadata,
  and (when `resolveHostFn` is provided) lowers and emits bytecode into a
  `UserAuthoredProgram`. `CompileOptions` supports `resolveHostFn`, `resolveTypeId`,
  and `ambientSource` for app-injected types. The lib `.d.ts` content is lazy-loaded
  via `initCompiler()` (async, dynamic `import()`) so bundlers like Vite automatically
  chunk the ~230KB lib strings into a separate file loaded on demand.
- Pipeline: parse -> type check -> validate AST -> extract descriptor -> lower -> emit
  -> assemble program.
- `src/compiler/validator.ts` rejects unsupported constructs (classes, enums, `var`,
  `for...in`, `eval`, computed property names, etc.) with positioned diagnostics.
- `src/compiler/descriptor.ts` extracts `ExtractedDescriptor` from the
  `Sensor()`/`Actuator()` default export: `kind`, `name`, `outputType`, `params`,
  `execIsAsync`, `onExecuteNode`, `onPageEnteredNode`.
- `src/compiler/types.ts` defines `CompileDiagnostic`, `ExtractedDescriptor`,
  `ExtractedParam`.
- `src/compiler/scope.ts` provides `ScopeStack` -- a block-scoping variable allocator
  with `pushScope`/`popScope`/`declareLocal`/`resolveLocal`. Used by the lowering pass
  for `let`/`const` variable declarations and identifier resolution.
- `src/compiler/ir.ts` defines IR node types including control flow (`IrLabel`,
  `IrJump`, `IrJumpIfFalse`, `IrJumpIfTrue`, `IrDup`) and multi-function support
  (`IrCall`, `IrLoadCallsiteVar`, `IrStoreCallsiteVar`).
- `src/compiler/lowering.ts` exports `lowerProgram()` which compiles all file-level
  function declarations, the `onExecute` body, the optional user `onPageEntered` body,
  a module init function (if callsite-persistent vars exist), and an always-generated
  `onPageEntered` wrapper into a `ProgramLoweringResult` containing multiple
  `FunctionEntry` records. `ProgramLoweringResult` includes `onPageEnteredWrapperId`.
  Supports `if`/`else`, `while`, C-style `for`, `break`/`continue`, block-scoped
  variable declarations, assignments (`=`, `+=`, `-=`, `*=`, `/=`), prefix/postfix
  `++`/`--`, user-defined function calls, and callsite-persistent variable access.
- `src/compiler/virtual-host.ts` provides `createVirtualCompilerHost()` -- a
  browser-compatible `ts.CompilerHost` with zero Node.js API usage.
- `src/compiler/ambient.ts` exports `buildAmbientSource(appTypeEntries?)` which
  generates the `"mindcraft"` ambient module with `Context`, `Sensor`, `Actuator`,
  `SensorConfig`, `ActuatorConfig`, `MindcraftTypeMap`, and `MindcraftType` union.
  Core types (`boolean`, `number`, `string`) are always present; apps pass additional
  entries to extend the union. `AMBIENT_MINDCRAFT_DTS` is the default (core-only)
  generated output. `SensorConfig.output` and `ParamDef.type` are constrained to
  `MindcraftType` (= `keyof MindcraftTypeMap`), giving compile-time validation of
  type strings.
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
- (Added 2026-03-20, resolved) **Trailing RET required.** When `if`/`else` emits a
  `Jump(endLabel)` at the end of the then-branch, the `endLabel` must target a valid
  instruction. If the `if`/`else` is the last statement, the label points past the end
  of the bytecode, which fails `BytecodeVerifier`. Solved by appending a trailing `RET`
  instruction at the end of every lowered function body.

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
- (Added 2026-03-20) **`ScopeStack` is function-scoped, not module-scoped.** Phase 4's
  `ScopeStack` tracks locals within a single function body. Phase 5 must either create
  a new `ScopeStack` per compiled function or distinguish module-level scope (callsite
  vars) from function-level scope (locals) with a separate mechanism.
- (Added 2026-03-20) **Assignment and `++`/`--` are already implemented.** Phase 4
  added `=`, `+=`, `-=`, `*=`, `/=`, prefix/postfix `++`/`--`. Phase 5's helper
  function calling will benefit from these being available. The lowering context
  already uses `LowerContext` with a `ScopeStack` -- extending to multi-function
  should be straightforward.

---

### Phase 6: `onPageEntered` + lifecycle wrapper

**Objective:** Compile the `export function onPageEntered(ctx)` named export and
generate the `onPageEntered` wrapper that runs module init then calls the user's
function.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- compile `onPageEnteredNode` from
  descriptor, generate `onPageEntered` wrapper function that calls module init then
  user `onPageEntered` (leverages existing `lowerProgram` multi-function infrastructure)
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
- (Added 2026-03-21) **NIL_VALUE fallthrough required.** All generated function bodies
  (including the `onPageEntered` wrapper) must push `NIL_VALUE` before trailing
  `Return` nodes. The VM's `RET` instruction unconditionally pops a return value.
  Phase 5 established this pattern; Phase 6 must follow it for the generated wrapper
  and any compiled `onPageEntered` user function body.
- (Added 2026-03-21) **`onPageEntered` is now inside the descriptor object.** Phase 2
  moved `onPageEntered` from a file-level named export into the `Sensor()`/`Actuator()`
  config object. Phase 6's plan text still references `export function onPageEntered`
  -- the implementation should extract and compile `descriptor.onPageEnteredNode`
  instead.

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
- (Added 2026-03-21) **`lifecycleFuncIds.onPageEntered` must be remapped.** The
  `onPageEntered` wrapper funcId is relative to the user program's function array.
  After linking, the linker must remap it (add the function offset) and return the
  remapped lifecycle funcIds alongside `linkedEntryFuncId`. The wrapper is always
  present (never undefined), so no null-check is needed.

---

### Phase 8: VM dispatch wrapper + registration bridge

**Objective:** Build the `BrainFunctionEntry` exec wrapper that spawns a fiber for
user bytecode, manages callsite-persistent state, and resolves handles. Wire it through
function and tile registration so a brain rule can invoke a user-authored tile
end-to-end. Also build `onPageEntered` dispatch.

**Packages/files touched:**

- `packages/typescript/src/runtime/authored-function.ts` --
  `createUserTileExec(linkedProgram, linkInfo, vm, scheduler)` returning `HostFn`
  with `exec` and `onPageEntered` methods
- `packages/typescript/src/runtime/registration-bridge.ts` --
  `registerUserTile(linkInfo, services)` that performs the three-step registration
  flow: ensure param tile defs, register in `FunctionRegistry`, add to `TileCatalog`
- `packages/typescript/src/runtime/authored-function.spec.ts` -- integration tests

**Prerequisites from earlier phases:**

- `UserTileLinkInfo` from Phase 7 provides `linkedEntryFuncId` and
  `linkedOnPageEnteredFuncId` (already remapped by the linker). The wrapper uses
  these directly -- no offset arithmetic needed.
- The `onPageEntered` wrapper is always generated (Phase 6 decision), so
  `linkedOnPageEnteredFuncId` is always present. The wrapper already calls
  module init internally, so the bridge does not call `initFuncId` separately.
- `UserAuthoredProgram.callDef` is a fully constructed `BrainActionCallDef`
  (Phase 3). The registration bridge passes it directly to
  `functions.register()`.
- `UserAuthoredProgram.numCallsiteVars` gives the size for `callsiteVars`
  allocation.

**Concrete deliverables:**

1. `exec` wrapper function:
   - Retrieves or allocates `callsiteVars` via `getCallSiteState`/`setCallSiteState`
     from `@mindcraft-lang/core/brain` (keyed by `ctx.currentCallSiteId`)
   - On first allocation, creates `List<Value>` of size `numCallsiteVars` filled
     with `NIL_VALUE`, then spawns a fiber for `linkedOnPageEnteredFuncId` to run
     module init
   - Spawns a fiber via `IFiberScheduler.spawn(linkedEntryFuncId, args, ctx)`
   - Attaches `callsiteVars` to the spawned `Fiber`
   - Resolves the handle via `HandleTable` when the spawned fiber completes
2. `onPageEntered` dispatch:
   - Spawns a fiber for `linkedOnPageEnteredFuncId` (the wrapper resets callsite
     vars via module init, then calls user `onPageEntered` if present)
   - Attaches the callsite's `callsiteVars` to the fiber
3. Registration bridge:
   - Ensures parameter tile defs exist (named -> `BrainTileParameterDef` scoped
     to `user.<tileName>.<paramName>`; anonymous -> shared `anon.<type>` with
     auto-creation)
   - Registers `BrainFunctionEntry` via `functions.register(userId, true, fn,
callDef)` -- always async per spec's unified invocation model
   - Creates `BrainTileSensorDef` or `BrainTileActuatorDef` and adds to catalog
4. Integration test: compile a sensor from source -> link into a `BrainProgram` ->
   register via bridge -> invoke from a brain fiber -> verify return value
5. Integration test: same for an actuator

**Acceptance criteria:**

- Test: sync sensor resolves handle within same tick (fiber completes without AWAIT,
  handle resolves immediately)
- Test: callsite vars persist across two invocations of the same tile (second call
  sees state from first call)
- Test: two callsites get independent callsite var state (each
  `ctx.currentCallSiteId` produces its own `callsiteVars`)
- Test: `onPageEntered` dispatch resets callsite vars and runs user body
- Test: registration bridge creates correct `BrainTileSensorDef` / `BrainTileActuatorDef`
  with expected tileId (`tile.sensor->user.<name>` / `tile.actuator->user.<name>`)
- Test: parameter tile defs are registered (named + anonymous)

**Key risks:**

- **Fiber lifecycle and handle resolution.** The `IFiberScheduler.spawn()` API returns
  a fiber ID. Need to subscribe to fiber completion (e.g., via `scheduler.onFiberDone`
  or polling fiber state) to resolve the handle. The exact mechanism depends on what
  `IFiberScheduler` exposes -- check the interface before implementing.
- **`callsiteVars` attachment timing.** The `callsiteVars` list must be attached to
  the `Fiber` before the fiber's first `LOAD_CALLSITE_VAR` instruction executes. Since
  `spawn()` creates the fiber, the attachment must happen between `spawn()` and the
  first `vmDispatch` step.
- **Module init on first allocation.** The very first time a callsite is invoked, the
  `callsiteVars` array is fresh (all `NIL_VALUE`). The module init function must run
  before `onExecute` to set initial values. This can be done by spawning a fiber for
  `linkedOnPageEnteredFuncId` (which calls init) before spawning the `onExecute` fiber,
  or by calling init within the same fiber via a combined wrapper. Check whether
  sequential fiber spawning within a single tick is supported.
- **`resolveTypeId` for param tile defs.** The registration bridge must map
  `ExtractedParam.type` strings (e.g., `"number"`) to `TypeId` values for
  `BrainTileParameterDef` construction. The compiler already resolves `outputType` via
  `CompileOptions.resolveTypeId`; the bridge needs the same resolver (or the resolved
  `TypeId` values pre-computed on `UserAuthoredProgram`).

---

### Phase 9: Logical operators (`&&`, `||`, `!`)

**Objective:** Add short-circuit `&&` and `||` operators and unary `!` (boolean NOT)
to the lowering pass.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- add cases for `&&`, `||`, `!`

**Prerequisites:** Null comparisons (`=== null`, `!== null`) and `!nil` are already
handled by Phase 6.5 nil operator overloads. This phase adds only the general-purpose
logical operators.

**Concrete deliverables:**

1. `&&` emits: evaluate LHS, `JumpIfFalse(end)` (short-circuit), `Pop`, evaluate RHS,
   `Label(end)`. The result is the LHS value if falsy, else the RHS value (JS
   semantics).
2. `||` emits: evaluate LHS, `JumpIfTrue(end)` (short-circuit), `Pop`, evaluate RHS,
   `Label(end)`. The result is the LHS value if truthy, else the RHS value.
3. `!` emits: evaluate operand, `HostCallArgs` for the boolean NOT operator
   (`CoreOpId.Not`). The nil-typed `!nil -> true` case is already registered
   (Phase 6.5).

**Acceptance criteria:**

- Test: `true && false` -> `false`
- Test: `false && sideEffect()` -> `false` (side effect not called)
- Test: `false || true` -> `true`
- Test: `true || sideEffect()` -> `true` (side effect not called)
- Test: `!true` -> `false`, `!false` -> `true`
- Test: `0 && 42` -> `0` (JS value-preserving semantics)

**Key risks:**

- **Truthiness semantics.** `JumpIfFalse`/`JumpIfTrue` depend on the VM's truthiness
  rules. Verify that the VM treats `0`, `""`, `false`, and `NIL_VALUE` as falsy and
  everything else as truthy, matching JavaScript semantics. If the VM only checks
  boolean values, a truthiness coercion HOST_CALL may be needed.

---

### Phase 10: String operations

**Objective:** Support string concatenation via `+` and template literal lowering.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- template literal lowering,
  string `+` operator resolution

**Concrete deliverables:**

1. `"hello" + " world"` compiles via the existing binary expression path using the
   string `Add` operator overload (already registered in core for
   `String + String -> String`).
2. Template literals (`` `hello ${name}` ``) desugar to a chain of string
   concatenations: `"hello " + name`. The lowering walks `ts.TemplateExpression`
   child spans and emits `PushConst(headText)` then for each span:
   `lowerExpression(span.expression)`, `HostCallArgs(Add)`, `PushConst(tailText)`,
   `HostCallArgs(Add)`.
3. Tagged template literals are rejected by the validator (already excluded by the
   subset).

**Acceptance criteria:**

- Test: `"a" + "b"` -> `"ab"`
- Test: `` `count: ${n}` `` where n=42 -> `"count: 42"`
- Test: `` `${a}-${b}` `` with multiple spans -> correct concatenation
- Test: empty template literal ` ` ``->`""`

**Key risks:**

- **String + non-string coercion.** TS allows `"hello" + 42`. Need to verify whether
  the core operator overloads handle `String + Number -> String` coercion, or whether
  a `toString` HOST_CALL is needed for the non-string operand.
- **Template literal AST structure.** `ts.TemplateExpression` has a `head`
  (`TemplateHead`) and `templateSpans` array, each with an `expression` and a
  `literal` (either `TemplateMiddle` or `TemplateTail`). The lowering must handle
  all combinations including empty head/tail strings.

---

### Phase 11: Object/struct literals

**Objective:** Compile object literal expressions to `STRUCT_NEW` / `STRUCT_SET`
bytecode for user-creatable struct types, and establish the ambient type generation
infrastructure that distinguishes user-creatable structs from native-backed structs.

**Prerequisite: App-type shape declarations.** This phase requires the compiler to
know struct field layouts so it can emit correct `STRUCT_NEW(typeId)` instructions.
Before implementing 9c, the ambient generation must support full interface declarations
derived from `ITypeRegistry`. See the "Type registry ambient generation" prerequisite
below.

#### Native-backed vs user-creatable struct types

The core `StructTypeShape` supports two categories of struct types, distinguished by
the presence of runtime hooks:

- **User-creatable structs** (e.g., `Vector2`): No `fieldGetter`, `fieldSetter`, or
  `snapshotNative` hooks. Fields are stored in the `StructValue.v` Dict. User code
  can create instances via object literals (`{ x: 1, y: 2 }`), which compile to
  `STRUCT_NEW` + `STRUCT_SET`.
- **Native-backed structs** (e.g., `ActorRef`): Have one or more hooks registered.
  The `StructValue.native` field wraps a host object (or lazy resolver function).
  The VM's `GET_FIELD` delegates to `fieldGetter`, `SET_FIELD` delegates to
  `fieldSetter`, and `deepCopyValue` (triggered by assignment) calls `snapshotNative`
  to materialize lazy handles. User code **cannot** create instances of these types
  via object literals -- they can only be received from host functions or sensor
  parameters, because there is no way for user bytecode to provide the `native` handle.

This distinction must be reflected in both the ambient type declarations and the
compiler's lowering logic.

**Packages/files touched:**

- `packages/core/src/brain/interfaces/type-system.ts` -- add enumeration method
  (e.g., `entries(): Iterable<[TypeId, TypeDef]>`) to `ITypeRegistry`
- `packages/typescript/src/compiler/ambient.ts` -- `buildAmbientFromRegistry(registry)`
  that generates interface declarations for all struct types, `MindcraftTypeMap`
  entries, and a `resolveTypeId` function from the registry. Native-backed struct
  interfaces must use a private brand (e.g., `readonly __brand: unique symbol`) to
  prevent structural compatibility with object literals, while user-creatable struct
  interfaces are plain and structurally constructable.
- `packages/typescript/src/compiler/lowering.ts` -- handle
  `ts.ObjectLiteralExpression`: emit `STRUCT_NEW(typeId)` then for each property
  `PUSH_CONST(fieldName)`, evaluate value, `STRUCT_SET`. Reject object literals
  whose contextual type resolves to a native-backed struct (the brand prevents this
  at the TS type level; the lowering should emit a diagnostic if it reaches this path
  anyway).
- `packages/typescript/src/compiler/ir.ts` -- add `IrStructNew`, `IrStructSet` nodes
- `packages/typescript/src/compiler/emit.ts` -- emit `STRUCT_NEW`, `STRUCT_SET` opcodes

**Concrete deliverables:**

1. `buildAmbientFromRegistry(registry)` generates ambient `.d.ts` content by iterating
   over all registered types:
   - For user-creatable struct types (no hooks): emit a plain interface with typed
     fields, e.g., `interface Vector2 { x: number; y: number; }`.
   - For native-backed struct types (any hook present): emit a branded interface with
     readonly fields, e.g.,
     `interface ActorRef { readonly __brand: unique symbol; readonly id: number; readonly position: Vector2; readonly "energy pct": number; }`.
     The brand prevents object literal assignment. If a `fieldSetter` is registered,
     the corresponding fields may omit `readonly` -- but for v1, treating all
     native-backed fields as readonly is a safe default.
   - For both: add `MindcraftTypeMap` entries mapping the type name to the interface.
   - Returns both `ambientSource` and a `resolveTypeId` function. Replaces the manual
     `buildAmbientSource(appTypeEntries?)` API.
2. `ITypeRegistry.entries()` exposes registered types for the generator.
3. `{ x: 1, y: 2 }` compiles to the correct struct construction bytecode when the
   target type is a known user-creatable struct.
4. The lowering infers the struct `TypeId` from the TS checker's contextual type
   (e.g., return type annotation, variable type annotation, or assignment target type).
5. Native-backed struct types are usable as variable and parameter types
   (e.g., `let target: ActorRef = params.target;`). Assignment compiles to
   `STORE_LOCAL` -- the VM's `deepCopyValue` handles `snapshotNative` transparently;
   the compiler does not need to emit special code for this.

**Acceptance criteria:**

- Test: `const pos: Vector2 = { x: 1, y: 2 }` -> `STRUCT_NEW(vector2TypeId)` +
  field assignments
- Test: struct as return value -> correct bytecode
- Test: `buildAmbientFromRegistry` generates correct plain interface for a
  user-creatable struct with two fields
- Test: `buildAmbientFromRegistry` generates branded interface for a native-backed
  struct (one with `fieldGetter`)
- Test: `const a: ActorRef = { id: 1, ... }` -> TS type error (brand prevents
  structural match)
- Test: `let target: ActorRef = params.target;` -> compiles successfully to
  `LOAD_LOCAL` / `STORE_LOCAL`
- Test: unknown struct type -> compile error

**Key risks:**

- **Type inference for untyped object literals.** If a user writes `const x = { a: 1 }`
  without a type annotation, the compiler cannot determine which struct type to use.
  May need to require explicit type annotations on object literals (consistent with
  the spec's emphasis on typed code), or support structural matching against known
  struct types.
- **`ITypeRegistry` changes touch `packages/core`.** Adding `entries()` is a small
  interface change but it affects the core package. Verify that the method can be
  added without breaking the Luau/roblox-ts build.
- **Nested struct literals.** `{ pos: { x: 1, y: 2 } }` requires recursive struct
  construction. The inner struct must be constructed before the outer one sets the
  field.
- **Brand vs opaque type strategy.** The `__brand: unique symbol` pattern is
  well-established in TypeScript for nominal typing, but alternatives exist (e.g.,
  generating the interface as a class declaration, or using `declare const` with a
  branded type alias). The brand approach is preferred because it has no runtime cost
  and prevents accidental structural matches without requiring class machinery.
- **fieldSetter writability.** If a native-backed struct has `fieldSetter` for some
  fields, those fields are writable at runtime. For v1, treating all native-backed
  fields as readonly simplifies the ambient generation. A later phase can refine
  this with per-field writability metadata if needed.

---

### Phase 12: Array/list literals

**Objective:** Compile array literal expressions to `LIST_NEW` / `LIST_PUSH` bytecode.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `ts.ArrayLiteralExpression`
- `packages/typescript/src/compiler/ir.ts` -- add `IrListNew`, `IrListPush` nodes
- `packages/typescript/src/compiler/emit.ts` -- emit `LIST_NEW`, `LIST_PUSH` opcodes

**Concrete deliverables:**

1. `[1, 2, 3]` compiles to `LIST_NEW(typeId)` + three `LIST_PUSH` instructions.
2. The lowering infers the list element `TypeId` from the TS checker's
   contextual/inferred type.
3. Empty array `[]` compiles to `LIST_NEW(typeId)` alone.

**Acceptance criteria:**

- Test: `[1, 2, 3]` -> list with 3 elements, VM reads correct values
- Test: empty array `[]` -> empty list
- Test: array as return value -> correct bytecode
- Test: nested arrays `[[1], [2]]` -> correct nested list construction

**Key risks:**

- **Element type inference.** `[1, 2, 3]` has element type `number`, but the VM's
  `LIST_NEW` requires a `TypeId`. The lowering needs to map the TS element type to
  a VM `TypeId` via `tsTypeToTypeId`. For v1, only primitive-typed arrays may be
  sufficient.
- **Mixed-type arrays.** TypeScript allows `[1, "a", true]` with type
  `(number | string | boolean)[]`. The VM may not support mixed-type lists.
  Reject or handle with a union type.

---

### Phase 13: Property access chains + host calls

**Objective:** Compile property access chains (e.g., `ctx.self.position.x`) to `GET_FIELD`
instructions, and context method calls (e.g., `ctx.engine.queryNearby(pos, range)`)
to `HOST_CALL_ARGS` instructions. This is the gateway to the full `Context` API.

**Prerequisite:** Phase 11's ambient-from-registry work must be complete so the compiler
knows field layouts of struct types. The `EngineContext` method resolution depends on
a method-to-host-function-ID mapping.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- extend `lowerPropertyAccess`
  beyond the current `params.xyz` special case; add `lowerMethodCall` for
  `ctx.engine.*` dispatch
- `packages/typescript/src/compiler/ir.ts` -- add `IrGetField` node (field name operand)
- `packages/typescript/src/compiler/emit.ts` -- emit `GET_FIELD` opcode
- `packages/typescript/src/compiler/types.ts` -- extend `CompileOptions` with a
  method resolution table (or reuse `resolveHostFn` with dotted names like
  `"engine.queryNearby"`)

**Concrete deliverables:**

1. `obj.field` compiles to `lowerExpression(obj)` + `GET_FIELD("field")` for known
   struct-typed expressions. This works uniformly for both user-creatable and
   native-backed struct types -- the VM dispatches to `fieldGetter` when present;
   the compiler does not need to distinguish.
2. `ctx.engine.methodName(args)` compiles to pushing args then
   `HOST_CALL_ARGS(fnId, argc, callSiteId)` where `fnId` is resolved from the method
   name via `resolveHostFn("engine.methodName")`.
3. `ctx.self.getVariable("x")` and `ctx.self.setVariable("x", v)` compile to the
   corresponding host calls.
4. `ctx.time`, `ctx.dt`, `ctx.tick` compile to the appropriate host calls or
   `LOAD_VAR` instructions.
5. The current `lowerPropertyAccess` special case for `params.xyz` is preserved
   (it short-circuits to `LoadLocal` without `GET_FIELD`).

**Acceptance criteria:**

- Test: `ctx.self.getVariable("x")` -> correct `HOST_CALL_ARGS` emission
- Test: struct property chain `pos.x` -> `GET_FIELD("x")`
- Test: native-backed struct field `target.position` -> `GET_FIELD("position")`
  (same bytecode as user-creatable struct; VM handles dispatch)
- Test: `ctx.engine.queryNearby(pos, 5)` -> `HOST_CALL_ARGS` with 2 args
- Test: unknown method `ctx.engine.nonExistent()` -> compile error
- Test: `params.speed` still resolves to `LoadLocal` (regression check)

**Key risks:**

- **`ctx` parameter identity.** The first parameter to `onExecute` is `ctx`. The
  lowering must recognize `ctx` as the context parameter and resolve
  `ctx.engine.X(...)` to the correct host function. The TS checker's symbol
  resolution can identify the parameter type; the lowering should check
  whether the receiver is of type `Context`.
- **Property access vs method call ambiguity.** `ctx.time` is a property read;
  `ctx.engine.queryNearby(...)` is a method call. The lowering must distinguish
  these (check if the parent node is a `CallExpression`).
- **Call site IDs.** `HOST_CALL_ARGS` takes a `callSiteId` operand.
  Currently the emit pass hardcodes `callSiteId: 0`. We need to decide whether Phase
  9e assigns real call site IDs or defers that to a later phase.

---

### Phase 14: `for...of` loop

**Objective:** Compile `for...of` loops over list-typed values.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `ts.ForOfStatement`,
  emit iterator pattern using `LIST_LEN`, `LIST_GET`, loop control
- `packages/typescript/src/compiler/ir.ts` -- add `IrListLen`, `IrListGet` nodes
  (if not already present)
- `packages/typescript/src/compiler/emit.ts` -- emit `LIST_LEN`, `LIST_GET` opcodes

**Concrete deliverables:**

1. `for (const item of items) { ... }` desugars to:
   ```
   StoreLocal(listLocal)        // items
   PushConst(0)
   StoreLocal(indexLocal)       // i = 0
   Label(loopStart)
   LoadLocal(indexLocal)
   LoadLocal(listLocal)
   LIST_LEN                     // items.length
   HostCallArgs(LessThan)       // i < items.length
   JumpIfFalse(loopEnd)
   LoadLocal(listLocal)
   LoadLocal(indexLocal)
   LIST_GET                     // items[i]
   StoreLocal(itemLocal)        // const item = items[i]
   <body>
   Label(continueTarget)
   LoadLocal(indexLocal)
   PushConst(1)
   HostCallArgs(Add)            // i + 1
   StoreLocal(indexLocal)
   Jump(loopStart)
   Label(loopEnd)
   ```
2. `break` and `continue` within `for...of` work via the existing loop stack.

**Acceptance criteria:**

- Test: `for (const x of [1, 2, 3]) { sum += x; }` -> sum is 6
- Test: `for...of` with `break` -> exits early
- Test: `for...of` with `continue` -> skips iteration
- Test: `for...of` over empty list -> body never executes

**Key risks:**

- **List type resolution.** The iterable expression must resolve to a list-typed
  value. The lowering should verify access to `LIST_LEN` and `LIST_GET` is valid
  for the inferred type.
- **Hidden locals.** The desugaring introduces hidden local variables (index counter,
  list reference). These must be allocated via `ScopeStack` but not visible to the
  user as named variables.

---

### Phase 15: Ternary operator + nullish coalescing

**Objective:** Compile conditional expressions (`? :`) and nullish coalescing (`??`).

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle
  `ts.ConditionalExpression` and nullish coalescing (`??`)

**Prerequisites from earlier phases:** `tsTypeToTypeId` already handles nullable union
types by stripping null/undefined (Phase 6.5). The nil operator overloads for `==`/`!=`
are registered. `??` emission can test the LHS against nil using `JumpIfTrue` after a
nil-equality check, or use the VM's truthiness semantics directly if nil is the only
falsy nil-ish value concern.

**Concrete deliverables:**

1. `cond ? a : b` compiles to: evaluate cond, `JumpIfFalse(elseLabel)`, evaluate a,
   `Jump(endLabel)`, `Label(elseLabel)`, evaluate b, `Label(endLabel)`.
2. `x ?? fallback` compiles to: evaluate x, `Dup`, check nil (via EqualTo nil
   operator or JumpIfTrue for non-nil), short-circuit or evaluate fallback.

**Acceptance criteria:**

- Test: `true ? 1 : 2` -> 1
- Test: `false ? 1 : 2` -> 2
- Test: `null ?? 42` -> 42
- Test: `5 ?? 42` -> 5
- Test: nested ternary `a ? b ? 1 : 2 : 3` -> correct evaluation

**Key risks:**

- **`??` vs `||` semantics.** `??` only triggers on `null`/`undefined` (nil), not on
  `0` or `""`. If using `JumpIfFalse`, the semantics are wrong (it would trigger on
  `0` and `""`). Must use nil-specific check, not truthiness. Consider emitting:
  `Dup`, `PushConst(NIL_VALUE)`, `HostCallArgs(EqualTo, nil)`, `JumpIfFalse(keep)`,
  `Pop` (discard nil), evaluate fallback, `Jump(end)`, `Label(keep)`, `Label(end)`.

---

### Phase 16: Destructuring

**Objective:** Support simple object and array destructuring in variable declarations.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `ts.ObjectBindingPattern`
  and `ts.ArrayBindingPattern` in variable declarations

**Concrete deliverables:**

1. `const { x, y } = pos;` desugars to: evaluate `pos`, then for each binding
   `Dup`, `GET_FIELD("x")`, `StoreLocal(x_idx)`, etc. Final `Pop` to discard the
   source object.
2. `const [a, b] = arr;` desugars to: evaluate `arr`, then `Dup`,
   `PushConst(0)`, `LIST_GET`, `StoreLocal(a_idx)`, `Dup`, `PushConst(1)`,
   `LIST_GET`, `StoreLocal(b_idx)`, `Pop`.
3. Nested destructuring is rejected for v1 (validation error).
4. Rest patterns (`...rest`) are rejected for v1.

**Acceptance criteria:**

- Test: `const { x, y } = { x: 1, y: 2 }` -> `x === 1`, `y === 2`
- Test: `const [a, b] = [10, 20]` -> `a === 10`, `b === 20`
- Test: nested destructuring -> validation error
- Test: destructuring with default value `const { x = 5 } = obj` -> uses default
  when field is nil

**Key risks:**

- **Default values in destructuring.** `const { x = 5 } = obj` requires nil-checking
  the destructured value and substituting the default. This adds complexity. Could
  defer defaults to a later phase and implement only simple destructuring first.
- **Destructuring patterns in parameters.** `function f({ x, y }: Point)` would
  require handling binding patterns in function parameter positions. Scope to
  variable declarations only for v1.

---

### Phase 17: Arrow functions as helpers

**Objective:** Support arrow function expressions assigned to `const` or `let`
variables, compiling them as helper functions callable via `CALL`.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- recognize arrow functions in
  variable initializers, register in function table, compile body

**Prerequisites:** The existing helper function infrastructure (Phase 5) compiles
`FunctionDeclaration` nodes. Arrow functions are syntactically different
(`ts.ArrowFunction`) but semantically equivalent for the non-closure case.

**Concrete deliverables:**

1. `const add = (a: number, b: number): number => a + b;` compiles to a
   `FunctionBytecode` entry and the variable reference resolves to a `CALL`.
2. Arrow functions with block bodies (`=> { ... }`) and expression bodies
   (`=> expr`) are both supported.
3. Arrow functions are detected during the initial function table scan
   (alongside `FunctionDeclaration`).
4. Closures (arrow functions that capture outer scope variables) are rejected
   with a diagnostic for v1.

**Acceptance criteria:**

- Test: `const double = (x: number) => x * 2; return double(5);` -> 10
- Test: block-body arrow `const f = (x: number): number => { return x + 1; };`
  -> correct result
- Test: arrow function capturing a local variable -> diagnostic error

**Key risks:**

- **Closure detection.** Must detect when an arrow function references variables
  from an outer function scope (not module-level callsite vars, which are allowed).
  Use the TS checker's symbol resolution to determine if referenced symbols are
  from an enclosing function scope.
- **Function table registration ordering.** Arrow functions assigned to `const` at
  the top level must be registered in the function table during the initial scan
  pass, before any function bodies are compiled. This is the same pattern as
  `FunctionDeclaration` but requires recognizing the pattern in
  `VariableDeclaration` initializers.

---

### Phase 18: Async host call emission

**Objective:** Detect calls to async host functions and emit `HOST_CALL_ARGS_ASYNC`
instead of `HOST_CALL_ARGS`.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- extend host call lowering to
  check if the target function is async and emit `IrHostCallArgsAsync`
- `packages/typescript/src/compiler/ir.ts` -- add `IrHostCallArgsAsync` node
- `packages/typescript/src/compiler/emit.ts` -- emit `HOST_CALL_ARGS_ASYNC` opcode
  via `emitter.hostCallArgsAsync()`
- `packages/typescript/src/compiler/types.ts` -- extend `CompileOptions.resolveHostFn`
  return type to include async flag (e.g., return `{ id: number, isAsync: boolean }`)

**Prerequisites:** Phase 13 (property access chains + host calls) must be complete
so that `ctx.engine.*` method calls compile. Phase 18 extends the mechanism to
distinguish sync vs async host functions.

**Concrete deliverables:**

1. `CompileOptions.resolveHostFn` returns `{ id: number, isAsync: boolean } | undefined`
   (breaking change from current `number | undefined`).
2. When `resolveHostFn` indicates async, the lowering emits `IrHostCallArgsAsync`
   instead of `IrHostCallArgs`.
3. `emitFunction` emits `HOST_CALL_ARGS_ASYNC` for async IR nodes using
   `emitter.hostCallArgsAsync(fnId, argc, callSiteId)` (already available in core's
   `BytecodeEmitter`).

**Acceptance criteria:**

- Test: calling a sync host function -> `HOST_CALL_ARGS` in bytecode
- Test: calling an async host function -> `HOST_CALL_ARGS_ASYNC` in bytecode
- Test: `resolveHostFn` returning async info is threaded correctly through the pipeline

**Key risks:**

- **Breaking `resolveHostFn` signature.** Changing from `number | undefined` to a
  richer return type is a breaking change for existing callers. Need to update all
  test helpers and the sim app's resolver. Consider a migration path (accept both
  shapes, or add a separate `resolveHostFnEx`).
- **Call site ID allocation.** `HOST_CALL_ARGS_ASYNC` requires a meaningful
  `callSiteId` (not hardcoded 0) for per-callsite state management. May need to
  defer proper call site ID allocation to Phase 20 or handle it here.

---

### Phase 19: `await` emission

**Objective:** Compile `await` expressions to the `AWAIT` opcode.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `ts.AwaitExpression`:
  lower the operand (which should be a `HOST_CALL_ARGS_ASYNC`), then emit `IrAwait`
- `packages/typescript/src/compiler/ir.ts` -- add `IrAwait` node
- `packages/typescript/src/compiler/emit.ts` -- emit `AWAIT` opcode via
  `emitter.await()` (already available in core's `BytecodeEmitter`)

**Prerequisites:** Phase 18 (async host call emission) must be complete so that the
operand of `await` produces a handle on the stack.

**Concrete deliverables:**

1. `await ctx.engine.moveToward(target, speed)` compiles to
   `HOST_CALL_ARGS_ASYNC(fnId, 2, callSiteId)` + `AWAIT`.
2. The result of `await` is the resolved handle value, left on the stack.
3. `await` on a non-async call produces a compile error.
4. Multiple `await` expressions in a single function body each emit their own
   `AWAIT` instruction.

**Acceptance criteria:**

- Test: single `await` in function body -> `HOST_CALL_ARGS_ASYNC` + `AWAIT` in bytecode
- Test: `const result = await asyncCall()` -> result stored in local after `AWAIT`
- Test: two consecutive `await` calls -> two `AWAIT` instructions
- Test: `await` on sync function call -> compile error

**Key risks:**

- **`await` validation.** Must ensure the operand of `await` is a call expression
  targeting an async host function. The TS checker flags `await` on non-Promise types,
  but the lowering should also validate against the known async host function set.
- **No state machine needed.** The VM fiber model preserves full execution state across
  `AWAIT` (stack, frames, locals, PC). No CPS or generator transformation is required.
  This is a significant simplification, but verify it works correctly with local
  variables and nested scopes across suspension points.

---

### Phase 20: Async `onExecute` compilation

**Objective:** Compile `async onExecute(ctx, params)` functions with one or more
`await` points. Verify that the fiber correctly suspends and resumes across ticks.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `async` modifier on
  `onExecute` (the `descriptor.execIsAsync` flag is already extracted)
- Integration tests exercising async execution

**Prerequisites:** Phases 10a and 10b must be complete. Phase 8 (exec wrapper) must
handle async fiber lifecycle (handle pending, fiber suspension, resumption, completion).

(Added 2026-03-21, from Phase 8 post-mortem) **Async dispatch strategy.** Phase 8's
exec wrapper uses `vm.spawnFiber()` + `vm.runFiber()` for inline synchronous execution.
This will not work for async tiles -- `vm.runFiber()` returns when the fiber hits AWAIT,
but the handle remains pending until the fiber resumes and completes in a later tick.
Phase 20 must implement a different dispatch path: either integrate with the scheduler
(`scheduler.spawn()` or equivalent), use a polling/callback pattern to detect fiber
completion, or extend the exec wrapper to detect `VmStatus.WAITING` and defer handle
resolution. The exec wrapper already receives `scheduler` as a parameter.

**Concrete deliverables:**

1. An async actuator like the following compiles and executes:
   ```typescript
   export default Actuator({
     name: "patrol",
     async onExecute(ctx: Context, params: { speed: number }): Promise<void> {
       await ctx.engine.moveToward(target, params.speed);
       await ctx.engine.moveToward(origin, params.speed);
     },
   });
   ```
2. The function body compiles linearly (no state machine transformation) with
   `HOST_CALL_ARGS_ASYNC` + `AWAIT` at each suspension point.
3. Local variables survive across `await` points (verified by test).
4. Callsite-persistent variables are accessible before and after `await`.

**Acceptance criteria:**

- Test: async actuator with one `await` -> fiber suspends, handle resolves on
  completion
- Test: local variable assigned before `await`, read after -> correct value
- Test: callsite var modified before `await`, read after -> correct value
- Test: async sensor returning a value after `await` -> handle resolves with
  return value

**Key risks:**

- **Fiber suspension/resumption test infrastructure.** Integration tests need a way
  to simulate async handle resolution (mock a host function that returns a pending
  handle, advance the scheduler, resolve the handle, verify the fiber resumes).
  This test infrastructure may need to be built alongside the tests.
- **Void return for async actuators.** Async actuators return `Promise<void>`. The
  compiled bytecode must push `NIL_VALUE` before `RET` (matching the existing
  NIL_VALUE fallthrough pattern from Phase 5).

---

### Phase 21: Async end-to-end integration

**Objective:** Full integration test: compile an async actuator from source, link it
into a `BrainProgram`, register it via the registration bridge (Phase 8), invoke it
from a brain rule with a WHEN condition, and verify the full lifecycle:
spawn -> suspend -> resume -> complete -> handle resolve.

**Packages/files touched:**

- Integration test file(s) in `packages/typescript/src/runtime/`
- May require test utilities for mock async host functions

**Prerequisites:** Phases 8, 10a, 10b, and 10c must be complete.

**Concrete deliverables:**

1. End-to-end test: brain rule with WHEN condition using a sync sensor -> DO action
   using an async actuator -> actuator suspends at `await` -> handle resolves on next
   tick -> rule completes
2. Test verifies: correct fiber states (READY -> RUNNING -> WAITING -> RUNNING ->
   COMPLETED), handle lifecycle (PENDING -> RESOLVED), callsite var persistence
   across suspension

**Acceptance criteria:**

- Test: async actuator invoked from brain rule -> completes after handle resolution
- Test: sync sensor + async actuator in same rule -> correct interleaving
- Test: cancellation (page deactivation) during suspended async fiber -> fiber
  transitions to CANCELLED

(Added 2026-03-21, from Phase 8 post-mortem) **Recompile-and-update pathway.** The
registration bridge (`registerUserTile`) currently handles first-registration only.
`FunctionRegistry.register()` and `TileCatalog.registerTileDef()` both throw on
duplicate names. A stateless recompile-and-update pathway should be established in
this phase (or an earlier one) so the caller does not need to track whether a prior
registration exists. The bridge should detect whether the tile is already registered
and update the existing `BrainFunctionEntry.fn` closure rather than re-registering.
Include tests for the update path.

**Key risks:**

- **Brain compilation integration.** The brain compiler emits `HOST_CALL_ASYNC` for
  tiles registered as async. Need to verify that the brain-level HOST_CALL_ASYNC
  dispatches correctly to the user tile's exec wrapper (Phase 8), which spawns a
  child fiber.
- **Scheduler tick semantics.** Multiple fibers (brain rule fiber + user code fiber)
  interleave within the scheduler. Need to verify budget accounting treats user fibers
  the same as built-in fibers.

---

### Phase 22: Debug metadata types

**Objective:** Define the `DebugMetadata` type hierarchy in
`@mindcraft-lang/typescript` (mirroring the structures defined in the
[debugger spec, section 6](vscode-authoring-debugging.md#6-debug-metadata)) and add
the `debugMetadata` field to `UserAuthoredProgram`.

**Packages/files touched:**

- `packages/typescript/src/compiler/types.ts` -- add `DebugMetadata`,
  `DebugFileInfo`, `DebugFunctionInfo`, `Span`, `ScopeInfo`, `LocalInfo`,
  `CallSiteInfo`, `SuspendSiteInfo` interfaces
- `packages/typescript/src/compiler/types.ts` -- add optional `debugMetadata` field
  to `UserAuthoredProgram`

**Concrete deliverables:**

1. All debug metadata interfaces defined per the debugger spec.
2. `UserAuthoredProgram.debugMetadata?: DebugMetadata` field added.
3. No functional changes -- metadata population is Phases 23-25.

**Acceptance criteria:**

- Types compile without errors
- Existing tests continue to pass (field is optional)

**Key risks:**

- Low risk. Type-only changes.

---

### Phase 23: Source span tracking

**Objective:** Track source spans during lowering and build `pcToSpanIndex` during
emission so every bytecode instruction maps back to a source location.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- annotate IR nodes with source
  position info (TS AST node start/end positions)
- `packages/typescript/src/compiler/ir.ts` -- add optional `sourceSpan` field to
  IR node base
- `packages/typescript/src/compiler/emit.ts` -- build `pcToSpanIndex` array and
  `spans` list as instructions are emitted; set `isStatementBoundary` per the rules
  in the spec (expression statements, conditions, variable declarations with init,
  return statements, break/continue, await/resume)

**Concrete deliverables:**

1. Every IR node carries an optional `sourceSpan` with `{ start, end, line, column }`
   from the TS AST node.
2. The emit pass builds `spans: Span[]` and `pcToSpanIndex: number[]` for each
   function.
3. Statement boundary rules are applied per the debugger spec's table.
4. `DebugFunctionInfo.spans` and `DebugFunctionInfo.pcToSpanIndex` are populated.

**Acceptance criteria:**

- Test: compiled function's `pcToSpanIndex` has an entry for every PC
- Test: statement boundaries are set for expression statements, `if` conditions,
  loop conditions, `return`, `break`/`continue`
- Test: sub-expression PCs have `isStatementBoundary: false`
- Test: generated functions (init, wrapper) have `isGenerated: true`

**Key risks:**

- **IR node annotation overhead.** Adding source spans to every IR node increases
  memory during compilation. Acceptable since compilation is not
  performance-critical.
- **Statement boundary completeness.** Missing a boundary type means the debugger
  cannot pause at that location. Must verify against the spec's table exhaustively.

---

### Phase 24: Scope and variable metadata

**Objective:** Emit `ScopeInfo` and `LocalInfo` metadata describing the scope tree
and variable lifetimes for debugger inspection.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- track scope enter/exit PCs,
  record variable declaration PCs and lifetimes
- `packages/typescript/src/compiler/scope.ts` -- extend `ScopeStack` to record
  scope metadata (kind, parent, start/end PC)

**Concrete deliverables:**

1. Each function's `DebugFunctionInfo.scopes` contains a tree of `ScopeInfo` entries
   (function scope at root, block scopes nested).
2. Each `LocalInfo` records name, slot index, storage kind (`"local"` or
   `"parameter"`), scope ID, and lifetime PC range.
3. Module-level scope for callsite-persistent variables is represented as a
   `"module"` scope.

**Acceptance criteria:**

- Test: function with nested blocks -> correct scope tree
- Test: variable declared in a block -> `lifetimeStartPc`/`lifetimeEndPc` match
  the block's PC range
- Test: parameters have `storageKind: "parameter"`
- Test: callsite vars appear in a `"module"` scope

**Key risks:**

- **PC range tracking.** Scope start/end PCs must be precisely tracked during emission,
  not just during lowering. The emit pass assigns final PCs; the lowering pass only
  knows IR indices. Need a mapping from IR index to emitted PC.

---

### Phase 25: DebugMetadata assembly

**Objective:** Assemble the complete `DebugMetadata` structure from the per-function
metadata collected in Phases 11b-11c and attach it to `UserAuthoredProgram`.

**Packages/files touched:**

- `packages/typescript/src/compiler/compile.ts` -- collect per-function debug info
  from lowering and emission, assemble `DebugMetadata`, set on
  `UserAuthoredProgram.debugMetadata`
- `packages/typescript/src/compiler/emit.ts` -- return debug spans and metadata
  alongside bytecode

**Concrete deliverables:**

1. `DebugMetadata` is fully populated: `files` (single file for v1), `functions`
   (one `DebugFunctionInfo` per `FunctionBytecode`).
2. Generated functions (module init, `onPageEntered` wrapper) have `isGenerated: true`.
3. `callSites` and `suspendSites` are populated (suspend sites only for async
   functions, Phase 10+).
4. The `programRevisionId` on `UserAuthoredProgram` acts as a revision key for
   the debug metadata.

**Acceptance criteria:**

- Test: compiled program's `debugMetadata` has correct file count (1) and function
  count
- Test: `DebugFunctionInfo.compiledFuncId` matches the index in `Program.functions`
- Test: generated functions have `isGenerated: true`
- Test: user-authored functions have `isGenerated: false`

**Key risks:**

- **Metadata correctness across recompilation.** The `debugFunctionId` (stable
  identity) must be deterministic across recompilations of the same source. Use
  `filePath + "/" + functionName` as the format. The `compiledFuncId` (index into
  `Program.functions`) may change on recompilation -- that is expected.
- **Linker remapping of debug metadata.** After linking, `compiledFuncId` values in
  the debug metadata need to be remapped (offset by function base). This may be a
  concern for Phase 7's linker -- either handle it in a sub-phase or as part of 11d.

---

## Immediate Next Phase

**Phase 9** is next. Phases 0-8 are complete. The compiler produces `UserAuthoredProgram`
bytecode, the linker merges it into a `BrainProgram`, the exec wrapper spawns fibers
for user bytecode and resolves handles, and the registration bridge wires user-authored
tiles into the tile catalog. Sync sensors and actuators are end-to-end functional.

Phase 9 adds logical operators (`&&`, `||`, `!`) to expand the language coverage.
Phases 10-17 continue expanding language features (each independently testable).
Phases 18-21 add async support. Phases 22-25 add debug metadata.

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

### Phase 2.5 -- 2026-03-20

**Status:** Complete. Back-propagated the resolved callDef design into Phase 0-2 code.

**Objective:** The callDef/callSpec/param design was resolved during the Phase 2
post-mortem but the implementation code predated it. This phase updated the existing
Phase 0-2 types, ambient declarations, descriptor extraction, and tests to align
with the design as documented in the spec.

**Changes:**

| File                           | Change                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `src/compiler/types.ts`        | Added `anonymous: boolean` field to `ExtractedParam`.                                                                    |
| `src/compiler/ambient.ts`      | Added `anonymous?: boolean` to `ParamDef`. Made `params` optional on `SensorConfig` and `ActuatorConfig`.                |
| `src/compiler/descriptor.ts`   | Extracts `anonymous` flag from param definitions (boolean literal, defaults to `false`).                                 |
| `src/index.ts`                 | Added `callDef: BrainActionCallDef` and `outputType?: TypeId` to `UserAuthoredProgram`, importing types from core/brain. |
| `src/compiler/compile.spec.ts` | Updated existing param assertions to verify `anonymous: false`. Added tests for anonymous params and omitted `params`.   |

**Test counts:** 26 total (5 type-checking, 7 validation, 11 extraction, 3 core imports).

**No new discoveries.** All changes were mechanical alignment with the already-resolved
design. No spec amendments needed.

### Phase 3 -- 2026-03-20

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                          | Actual  | Notes                                                                                                                                           |
| ---------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/compiler/ir.ts`: IR node types                              | Done    | `IrPushConst`, `IrLoadLocal`, `IrStoreLocal`, `IrReturn`, `IrPop`, `IrHostCallArgs`, `IrMapGet`.                                                |
| `src/compiler/lowering.ts`: TS AST -> IR                         | Done    | Handles param preamble (MapValue extraction), binary expressions, literals, return, property access (`params.xyz`).                             |
| `src/compiler/emit.ts`: IR -> FunctionBytecode                   | Done    | Uses `compiler.BytecodeEmitter` + `compiler.ConstantPool` from core (namespace import).                                                         |
| `src/compiler/call-def-builder.ts`: params -> BrainActionCallDef | Done    | Named params -> `user.<tileName>.<paramName>`, anonymous -> `anon.<type>`, optional wrapped.                                                    |
| `src/compiler/compile.ts`: pipeline wiring                       | Done    | `compileUserTile(source, options?)` produces `UserAuthoredProgram` when `resolveHostFn` is provided.                                            |
| `src/compiler/types.ts`: `UserAuthoredProgram`, `CompileOptions` | Done    | `CompileOptions` gained `resolveTypeId` and `ambientSource`. `UserAuthoredProgram` has full metadata.                                           |
| End-to-end VM execution tests                                    | Done    | 10 tests: true/false comparison, number/bool/string literals, arithmetic, metadata, type resolution error, app-defined type, ambient rejection. |
| `buildCallDef` tests                                             | Done    | 5 tests: empty, required, optional, anonymous, mixed.                                                                                           |
| `descriptor.ts`: extract `anonymous` flag                        | Skipped | Already done in Phase 2.5.                                                                                                                      |
| `ambient.ts`: make params optional, add anonymous                | Skipped | Already done in Phase 2.5.                                                                                                                      |

**Design changes from spec:**

1. **`exec` -> `onExecute` in all test sources.** The spec's example used `exec` but
   Phase 2 renamed it to `onExecute`. All Phase 3 tests use the updated name.
2. **`mapOutputType` replaced by `resolveTypeId` in `CompileOptions`.** The original
   Phase 3 plan did not mention type resolution as a configurable concern. During
   implementation, `mapOutputType` was identified as a hardcoded bottleneck that
   cannot handle app-defined types. It was replaced with an injected
   `resolveTypeId(shortName) -> TypeId | undefined` function in `CompileOptions`,
   with a built-in `coreTypeResolver` fallback for the three primitive types. Unknown
   output types now produce a `CompileDiagnostic` instead of silently passing through.
3. **`ambientSource` in `CompileOptions`.** The original plan used a hardcoded
   `AMBIENT_MINDCRAFT_DTS` string. The ambient is now generated by
   `buildAmbientSource(appTypeEntries?)` which accepts additional type map entries.
   `SensorConfig.output` and `ParamDef.type` are constrained to
   `MindcraftType = keyof MindcraftTypeMap` -- a string literal union that
   TypeScript validates at authoring time. Apps extend the union by passing entries
   to `buildAmbientSource`.
4. **`buildAmbientSource` exported from package API.** Added to `src/index.ts` so
   consuming apps can generate ambient sources with their custom types.

**Extra files:** None.

**Test counts:** 41 total (10 codegen/VM, 5 buildCallDef, 5 type-checking, 7
validation, 11 extraction, 3 core imports).

**Discoveries:**

1. `BytecodeEmitter` and `ConstantPool` are under the `compiler` namespace export
   from `@mindcraft-lang/core/brain`. Must use `import { compiler } from "..."` then
   `compiler.BytecodeEmitter`, not direct named imports. This was documented in the
   Phase 0 log but the import pattern was not explicit enough.
2. The operator function naming convention is
   `$$op_<opId>_<lhsTypeId>_<rhsTypeId>_to_<resultTypeId>` (e.g.,
   `$$op_lt_number:<number>_number:<number>_to_boolean:<boolean>`). The lowering
   resolves operand types via the TS checker's `ts.Type` flags, not from
   `ExtractedParam.type`.
3. The `onExecute` function takes 1 parameter (a `MapValue` of args keyed by slotId)
   if the descriptor has params, else 0 parameters. The preamble unpacks each param
   into a local: `LOAD_LOCAL 0`, `PUSH_CONST slotId`, `MAP_GET`, `STORE_LOCAL N`.
4. **App-type shape visibility is a deferred concern.** The current
   `buildAmbientSource` can declare type names in the `MindcraftTypeMap` but not their
   structural shapes. For Phase 3 this is fine -- user code only returns primitives.
   **This becomes a hard blocker for Phase 9c (struct literals) and 9e (property
   access chains)** where the compiler must know field layouts to emit `STRUCT_NEW`,
   `STRUCT_SET`, and `GET_FIELD` instructions. The ambient generation must be extended
   to accept full interface declarations before those phases. See the prerequisite
   note added to Phase 9+.
5. `ParamDef.type` strings flow through `call-def-builder.ts` for tileId construction
   but are not validated against the type registry at compile time. The registration
   bridge (not yet built) resolves them to `TypeId`s. For now, invalid param type
   strings are caught only if the TS checker rejects the `MindcraftType` union.
6. `null` literal is not yet supported in lowering (produces "Unsupported expression:
   NullKeyword"). This is fine for Phase 3 scope; resolved in Phase 6.5.

### Phase 4 -- 2026-03-20

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                            | Actual | Notes                                                                                                                                                        |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/compiler/lowering.ts`: visitors for `IfStatement`, etc.       | Done   | Refactored from per-function params to unified `LowerContext`. Handles `if`/`else`, `while`, `for`, `break`, `continue`, `Block`, `VariableDeclarationList`. |
| `src/compiler/ir.ts`: `Jump`, `JumpIfFalse`, `JumpIfTrue`, `Label` | Done   | Also added `IrDup` (needed for assignment expressions to leave value on stack).                                                                              |
| `src/compiler/scope.ts`: scope stack                               | Done   | New file. `ScopeStack` with `pushScope`/`popScope`/`declareLocal`/`resolveLocal`.                                                                            |
| Tests                                                              | Done   | 11 new end-to-end tests in `codegen.spec.ts`.                                                                                                                |

**Additional work beyond plan:**

| Item                     | Notes                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Assignment expressions   | `=`, `+=`, `-=`, `*=`, `/=` lowering. Not in Phase 4 plan but required by test patterns like `count = count + 1` and `i = i + 1` in loops.                                |
| Prefix/postfix `++`/`--` | Both `i++` and `++i` supported. Required for idiomatic `for (let i = 0; i < n; i++)` loops (acceptance criterion).                                                        |
| Identifier resolution    | `lowerExpression` now resolves bare identifiers via `ScopeStack.resolveLocal()`, not just property-access syntax. Required for local variable reads.                      |
| Trailing `RET`           | Every lowered function body now ends with an unconditional `RET` instruction. Prevents `BytecodeVerifier` errors when jump labels target end-of-function.                 |
| `IrDup` IR node          | Needed for assignment expressions (the assigned value must remain on the stack as the expression result). Not in the plan but necessary for correct expression semantics. |
| `else if` chains         | Naturally falls out of recursive `lowerStatement` on `stmt.elseStatement`. Added a dedicated test with 3 branches.                                                        |

**Test counts:** 52 total (11 Phase 4 control flow, 10 Phase 3 codegen/VM, 5
buildCallDef, 5 type-checking, 7 validation, 11 extraction, 3 core imports).

**Discoveries:**

1. **Trailing `RET` is required.** When an `if`/`else` is the last statement in a
   function and both branches end with `return`, the `Jump(endLabel)` at the end of
   the then-branch targets the instruction after the last emitted instruction. The
   `BytecodeVerifier` rejects this as out-of-bounds. Appending a trailing `RET` at
   the end of every function body fixes this safely (if the function already returned,
   the trailing `RET` is unreachable but harmless).
2. **`LowerContext` is a better architecture than parameter threading.** Phase 3 passed
   `(scope, checker, ir, diags)` as separate function parameters. Phase 4 unified
   these into a `LowerContext` object that also carries the loop stack and label
   counter. This makes adding new lowering context (e.g., function table in Phase 5)
   much cleaner.
3. **Variable slot reuse is deferred.** `ScopeStack` allocates monotonically increasing
   local indices. Slots from popped scopes are not recycled. This wastes a few locals
   in deeply nested code but keeps the implementation simple. Can revisit as an
   optimization if `numLocals` becomes a concern for the VM.
4. **Assignment as expression.** TypeScript assignments are expressions (they have a
   value). The lowering emits `DUP` before `STORE_LOCAL` so the assigned value
   remains on the stack. When an assignment is used as a statement (via
   `ExpressionStatement`), the enclosing `POP` discards this value.
5. **`for` loop `continue` targets the incrementor, not the condition.** The
   `continueLabel` in a `for` loop points to the incrementor expression, not the
   loop-start condition check. This ensures `i++` runs before the next iteration's
   condition test, matching JavaScript semantics.
6. **`null` literal still unsupported.** Carried forward from Phase 3. Resolved in
   Phase 6.5.

### Phase 5 -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                                | Actual  | Notes                                                                                                                                                                                           |
| ---------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lowering.ts`: handle `FunctionDeclaration`, function calls via `CALL` | Done    | `lowerHelperFunction()` compiles file-level function declarations. `lowerCallExpression()` emits `IrCall` for user-defined functions. `LowerContext` gained `functionTable` and `callsiteVars`. |
| `compile.ts`: two-pass function ID assignment                          | Changed | Single-pass in `lowerProgram()` -- functions are assigned IDs as discovered. See design change below.                                                                                           |
| `emit.ts`: emit multiple `FunctionBytecode` entries                    | Done    | `compile.ts` loops over `programResult.functions` and calls `emitFunction()` for each.                                                                                                          |
| `scope.ts`: distinguish module-level vs function-level scope           | Changed | `scope.ts` unchanged. Module-vs-function distinction handled in `lowering.ts` via `resolveVarTarget()`: locals resolve via `ScopeStack`, callsite vars via `LowerContext.callsiteVars` map.     |
| Module init function generation                                        | Done    | `generateModuleInit()` emits `STORE_CALLSITE_VAR` for each top-level initializer. Appended as final function entry when callsite vars exist.                                                    |

**Design changes from plan:**

1. **Single-pass instead of two-pass function ID assignment.** The plan called for a
   two-pass pattern (first assign IDs, then compile). The implementation uses a
   single-pass: `lowerProgram()` first scans all top-level `FunctionDeclaration` nodes
   to populate the function table (name -> funcId mapping), then compiles all function
   bodies. This achieves the same result -- all function IDs are known before any body
   is compiled -- without a separate compilation pass.
2. **`scope.ts` not modified.** The plan listed `scope.ts` as a touched file for
   distinguishing module-level scope from function-level scope. Instead, the
   distinction is handled entirely in `lowering.ts` via the `resolveVarTarget()`
   function, which checks `ScopeStack` first (function locals), then
   `LowerContext.callsiteVars` (module-level persistent state). Each function body
   gets its own fresh `ScopeStack`, while `callsiteVars` is shared across all
   functions in the `LowerContext`. This keeps `ScopeStack` as a simple
   single-concern class.
3. **Function ID ordering.** The implemented ordering is: 0 = `onExecute`, 1..N =
   helper functions (in declaration order), N+1 = module init (if needed). This
   differs from `BrainCompiler`'s pattern but is correct for user-authored programs
   where `onExecute` is always the entry point.

**Additional work beyond plan:**

| Item                                | Notes                                                                                                                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `IrCall` IR node                    | New IR node with `funcIndex` and `argc` fields. Not explicitly listed in the plan's file list but required for the `CALL` instruction emission.                         |
| `IrLoadCallsiteVar` IR node         | New IR node with `index` field. Required for `LOAD_CALLSITE_VAR` emission.                                                                                              |
| `IrStoreCallsiteVar` IR node        | New IR node with `index` field. Required for `STORE_CALLSITE_VAR` emission.                                                                                             |
| `initFuncId` on UserAuthoredProgram | Added to `types.ts`. Required so the exec wrapper knows which function to call for module initialization.                                                               |
| NIL_VALUE fallthrough safety        | All function bodies push `NIL_VALUE` before trailing `Return` nodes. The VM's `RET` pops a return value; functions without explicit `return` need a value on the stack. |
| `resolveVarTarget` abstraction      | Returns `{ kind: "local"                                                                                                                                                | "callsiteVar", index }`for unified store/load emission. Simplifies assignment and`++`/`--` lowering for both variable kinds. |
| `emitLoad` / `emitStore` helpers    | Abstract `IrLoadLocal` vs `IrLoadCallsiteVar` (and store equivalents) based on `resolveVarTarget` result.                                                               |

**Test counts:** 63 total (11 Phase 5, 11 Phase 4 control flow, 10 Phase 3 codegen/VM,
5 buildCallDef, 5 type-checking, 7 validation, 11 extraction, 3 core imports).

**Discoveries:**

1. **NIL_VALUE fallthrough is required for all generated functions.** The VM's `RET`
   instruction unconditionally pops a return value from the stack. If a function body
   falls through without an explicit `return` statement (common for void helpers and
   module init), the stack is empty and `RET` causes a stack underflow. The fix is to
   push `NIL_VALUE` before every trailing `Return` IR node. This applies to
   `onExecute`, helper functions, and module init. Phase 6 (`onPageEntered` wrapper)
   must also follow this pattern.
2. **`LowerContext` extensions worked cleanly.** Phase 4's `LowerContext` design paid
   off -- adding `functionTable` and `callsiteVars` fields was straightforward with no
   refactoring of existing code. Future phases adding more context (e.g., lifecycle
   function IDs) can follow the same pattern.
3. **Module-level vs function-level scope via `resolveVarTarget()`.** Rather than
   modifying `ScopeStack` to understand two kinds of variables, a separate resolution
   function checks locals first, then callsite vars. This keeps `ScopeStack` focused on
   block-scoping within a single function. Helper functions get their own `ScopeStack`
   (with params as initial locals) but share the same `callsiteVars` map.
4. **Function parameters are locals 0..N-1.** For helper functions, the `ScopeStack` is
   initialized with `numParams` as the initial next-local index, and each parameter
   name is declared at indices 0 through N-1. This matches the VM's calling convention
   where `CALL` pushes arguments into the callee's locals.
5. **`null` literal still unsupported.** Carried forward from Phase 4. Resolved in
   Phase 6.5.

### Phase 6 -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                        | Actual | Notes                                                                                                                             |
| -------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `lowering.ts`: compile `onPageEnteredNode`, generate wrapper   | Done   | `lowerOnPageEnteredBody()` compiles user body; `generateOnPageEnteredWrapper()` generates CALL-init, CALL-user, NIL, RET wrapper. |
| `compile.ts`: set `lifecycleFuncIds.onPageEntered`             | Done   | Set to `programResult.onPageEnteredWrapperId`.                                                                                    |
| `onPageEntered` compiles as a separate `FunctionBytecode`      | Done   | User body compiled with 0 params, shared `callsiteVars`, own `ScopeStack`.                                                        |
| Generated wrapper calls module init, then user `onPageEntered` | Done   | Both calls are optional -- wrapper emits CALL+POP only if initFuncId / userOnPageEnteredFuncId exist.                             |
| `lifecycleFuncIds.onPageEntered` points to wrapper             | Done   | Always set (wrapper is always generated).                                                                                         |
| If no user `onPageEntered`, wrapper still runs module init     | Done   | Tested explicitly.                                                                                                                |

**Design notes:**

1. **Wrapper is always generated.** Even when there are no callsite vars and no user
   `onPageEntered`, the wrapper is emitted (pushes NIL, returns). This keeps
   `lifecycleFuncIds.onPageEntered` unconditionally set, simplifying the registration
   bridge -- it can always register the hook without conditional logic.
2. **Function ID ordering.** 0=onExecute, 1..M=helpers, M+1=user onPageEntered (if
   present), next=module init (if callsite vars exist), last=onPageEntered wrapper.
   The wrapper is always the final function entry.
3. **No changes to `types.ts` or `ir.ts`.** The `lifecycleFuncIds.onPageEntered` field
   already existed on `UserAuthoredProgram` (added in Phase 5 as `onPageEntered?:
number`). `IrCall`, `IrPushConst`, and `IrReturn` IR nodes were sufficient for both
   the user body and the generated wrapper.
4. **`onPageEntered` extracted from descriptor, not file-level.** As noted in the
   Phase 6 risk section (added 2026-03-21), `onPageEntered` is a method on the
   `Sensor()`/`Actuator()` config object, not a file-level named export. The
   implementation uses `descriptor.onPageEnteredNode` directly.

**Updated prior tests:** Two existing tests (`program metadata is correct` in Phase 3
and `program has correct function count with helpers` in Phase 5) had their function
count assertions incremented by 1 to account for the always-present wrapper.

**Test counts:** 68 total (5 Phase 6, 11 Phase 5, 11 Phase 4 control flow, 10 Phase 3
codegen/VM, 5 buildCallDef, 5 type-checking, 7 validation, 11 extraction, 3 core
imports).

**Discoveries:**

1. **Always-generated wrapper simplifies downstream integration.** By unconditionally
   generating the wrapper (even when it's a no-op NIL+RET), the linker and
   registration bridge (Phases 7-8) can always read
   `lifecycleFuncIds.onPageEntered` without null checks. The cost is one trivial
   function entry per program.
2. **No `LowerContext` changes needed.** The user `onPageEntered` body reuses the
   same lowering infrastructure as helper functions (own `ScopeStack`, shared
   `callsiteVars` and `functionTable`). No new fields on `LowerContext`.
3. **Generated wrapper uses IR directly, not lowering.** The wrapper is so simple
   (CALL+POP, CALL+POP, NIL, RET) that it constructs `IrNode[]` manually rather
   than going through `lowerStatements`. This avoids needing a synthetic AST.
4. **`null` literal still unsupported.** Carried forward from Phase 5.

### Phase 6.5 -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Objective:** Add `null` and `undefined` literal support and nil operator
overloads. The `NullKeyword` syntax kind was previously rejected with "Unsupported
expression: NullKeyword" (noted in Phase 3, carried forward through Phase 6).
This phase maps both `null` and `undefined` to `NIL_VALUE`, registers nil operator
overloads in core, and extends `tsTypeToTypeId` to handle `TypeFlags.Null`,
`TypeFlags.Undefined`, and nullable union types so that `x === null` and
`x === undefined` comparisons compile and execute correctly.

**Deliverables:**

| Planned                               | Actual | Notes                                                                                                                                        |
| ------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `lowering.ts`: handle `NullKeyword`   | Done   | Two-line addition: `NullKeyword` -> `PushConst(NIL_VALUE)`, parallel to `true`/`false`.                                                      |
| `lowering.ts`: handle `undefined`     | Done   | `lowerIdentifier` intercepts the identifier `"undefined"` and emits `PushConst(NIL_VALUE)` before variable lookup.                           |
| Tests for null in variable assignment | Done   | Assigns `null` to a local then uses `=== null` comparison; verifies correct execution.                                                       |
| Tests for null as return value        | Done   | Helper function returning `null`; caller compares `=== null`.                                                                                |
| Tests for null in callsite var init   | Done   | Top-level `let cached: number \| null = null;` initializer compiled via module init with null comparison.                                    |
| `lowering.ts`: `tsTypeToTypeId` null  | Done   | Maps `TypeFlags.Null` and `TypeFlags.Undefined` -> `CoreTypeIds.Nil`. Strips both from union types.                                          |
| Core nil operator overloads           | Done   | `operators.ts`: `nil == nil`, `nil != nil`, `!nil`, plus cross-type `==`/`!=` for nil with number/boolean/string (check runtime NativeType). |
| Core nil overload tests               | Done   | `brain.spec.ts`: 11 new tests covering same-type, cross-type, and WHEN condition integration.                                                |
| Tile suggestion regression fix        | Done   | `tile-suggestions.ts`: skip Nil-typed RHS in `incompleteExprExpectedType` to avoid false ambiguity.                                          |
| TypeScript null comparison tests      | Done   | `codegen.spec.ts`: 2 new tests (`number !== null`, `null === null`); 3 existing tests updated to use `=== null`.                             |
| TypeScript undefined tests            | Done   | `codegen.spec.ts`: 3 new tests (`undefined` -> NIL_VALUE, `undefined === null`, `number !== undefined`).                                     |

**No new files.** No changes to `ir.ts`, `emit.ts`, `scope.ts`, or `types.ts`.

**Test counts:**

- `packages/typescript`: 76 total (8 Phase 6.5, 5 Phase 6, 11 Phase 5, 11 Phase 4
  control flow, 10 Phase 3 codegen/VM, 5 buildCallDef, 5 type-checking, 7 validation,
  11 extraction, 3 core imports).
- `packages/core`: 429 total (11 nil overload tests added to `brain.spec.ts`).

**Discoveries:**

1. **Cross-type nil overloads must check runtime NativeType.** The operator overload
   system dispatches statically by `TypeId` at compile time. For a variable of static
   type `number` that actually holds `NIL_VALUE` at runtime (from a `number | null`
   union), a constant `false` result for `number == nil` would be wrong. The fix is
   to check `args.v.get(N).t === NativeType.Nil` at runtime. This is the correct
   pattern for any cross-type nil comparison.
2. **Union types in `tsTypeToTypeId` are common for nullable parameters.** `number |
null` has `TypeFlags.Union` with a `.types` array. The implementation strips null
   constituents and recurses on the single remaining type. Multi-type unions (e.g.,
   `number | string | null`) are not yet handled -- acceptable for now but Phase 9+
   may need expansion.
3. **Nil overloads cause tile-suggestion ambiguity.** Adding `NotEqualTo(String, Nil)`
   alongside `NotEqualTo(String, String)` caused `incompleteExprExpectedType` to see
   two RHS types and mark the expected type as ambiguous. The fix is to skip
   `CoreTypeIds.Nil` RHS in the ambiguity check -- nil is not a tile-selectable type
   and should never influence expected-type inference.
4. **Null comparisons resolved.** Discovery #1 from the initial Phase 6.5 log
   ("null comparisons not yet supported") is fully resolved. No need to defer to
   Phase 9a.
5. **`undefined` is an identifier, not a keyword.** In TypeScript's AST, `undefined`
   is an `Identifier` node (not `UndefinedKeyword`). It must be intercepted in
   `lowerIdentifier` before variable lookup, unlike `null` which is a
   `SyntaxKind.NullKeyword`. Both map to the same `NIL_VALUE` at runtime.
6. **`null` and `undefined` are fully interchangeable at the VM level.** Both produce
   `NIL_VALUE` (`NativeType.Nil`). This matches Luau (Roblox target) which has only
   `nil`, and aligns with TypeScript's nullish semantics (`??`, `==`).

### Phase 7 -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                                  | Actual | Notes                                                                                                    |
| ------------------------------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------- |
| `src/linker/linker.ts`: `linkUserPrograms(brainProgram, userPrograms[])` | Done   | Appends user functions, remaps `CALL` and `PUSH_CONST` operands, merges constants, returns `LinkResult`. |
| `src/linker/linker.spec.ts`: tests                                       | Done   | 7 tests covering all acceptance criteria plus additional scenarios.                                      |
| Returns linked entry funcId for each user program                        | Done   | Via `UserTileLinkInfo.linkedEntryFuncId`.                                                                |
| Test: linked program callable by funcId                                  | Done   | Compiles sensor, links into empty brain program, executes via VM.                                        |
| Test: constant pool indices correct after merging                        | Done   | Verifies brain constants preserved at original indices, user constants appended.                         |
| Test: `CALL` to user helper resolves correctly                           | Done   | Verifies `CALL` instructions in linked bytecode have funcIds >= brain function offset.                   |

**Additional work beyond plan:**

| Item                                  | Notes                                                                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `linkedOnPageEnteredFuncId`           | Added to `UserTileLinkInfo`. Remaps `lifecycleFuncIds.onPageEntered` by the function offset. Tested explicitly.                   |
| `LinkResult` interface                | New interface returned by `linkUserPrograms`, containing `linkedProgram` and `userLinks[]`.                                       |
| Multiple user program test            | Links two independent user programs into one brain program, verifies both execute correctly with independent offsets.             |
| Brain function preservation test      | Verifies the brain program's original stub function (PUSH_CONST + RET) still executes correctly after linking user programs.      |
| Linked helper function execution test | End-to-end: compiles a sensor with a `triple()` helper, links into a brain program with a stub, executes via VM, verifies result. |
| `src/index.ts` re-exports             | Added `linkUserPrograms` and `LinkResult` exports.                                                                                |

**No changes to `packages/core`.** The linker operates entirely on the `List<FunctionBytecode>`
and `List<Value>` data structures already exported from core. No new core APIs were needed.

**No spec amendments needed.** The `user-authored-sensors-actuators.md` linking section
accurately described the algorithm. The implementation matches the spec's steps 4-6.

**Test counts:** 83 total (7 linker, 8 null/nil, 5 onPageEntered/lifecycle, 11 helper
functions/callsite state, 11 control flow, 10 codegen/VM, 5 buildCallDef, 5
type-checking, 7 validation, 11 extraction, 3 core imports).

**Discoveries:**

1. **Constants are appended, not deduplicated.** The linker appends user constants
   to the brain's constant pool without deduplication. This is correct and simple:
   each user program was compiled with its own `ConstantPool` which already
   deduplicates internally. Cross-program dedup would save a few entries but adds
   complexity (value equality checks for all `Value` types) with no meaningful
   benefit at current scale.
2. **Brain program instructions are not remapped.** Only user program instructions
   need remapping. The brain program's existing functions reference function IDs and
   constant indices that are still valid in the linked program (they occupy the same
   positions). This is a key simplification -- the linker only touches user bytecode.
3. **`linkedOnPageEnteredFuncId` is essential for Phase 8.** The exec wrapper / tile
   registration bridge needs both `linkedEntryFuncId` (for `onExecute` dispatch) and
   `linkedOnPageEnteredFuncId` (for lifecycle hook registration). Returning both from
   the linker avoids the registration bridge needing to know about function offsets.
4. **The linker is ~40 lines of logic.** The spec estimated ~50 lines; the actual
   implementation is slightly smaller. The `remapInstructions` helper is clean and
   handles only the two opcodes that reference pool/function indices (`PUSH_CONST`
   and `CALL`). No other opcodes use indices into these arrays.
5. **`initFuncId` remapping is deferred to the registration bridge.** The
   `UserAuthoredProgram.initFuncId` is a program-local function index. The linker
   remaps `lifecycleFuncIds.onPageEntered` (which wraps the init call) but does not
   separately remap `initFuncId`. The exec wrapper in Phase 8 should use the
   `onPageEntered` wrapper (which already calls init) rather than calling
   `initFuncId` directly. This is consistent with the Phase 6 design where the
   wrapper is the single entry point for lifecycle setup.
   (Updated 2026-03-21: Superseded by Phase 8. The linker now remaps `initFuncId`
   into `linkedInitFuncId` on `UserTileLinkInfo`. First-allocation init calls
   `linkedInitFuncId` (module init only), not the full `onPageEntered` wrapper.
   This matches native built-in tile behavior.)

### Phase 8 -- 2026-03-21

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                    | Actual  | Notes                                                                                                                                  |
| ---------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/runtime/authored-function.ts`: `createUserTileExec()` | Done    | Returns `HostAsyncFn` with `exec` and `onPageEntered` methods. Uses `vm.spawnFiber` + `vm.runFiber` for sync dispatch.                 |
| `src/runtime/registration-bridge.ts`: `registerUserTile()` | Done    | Three-step flow: ensure param tile defs, register function, add sensor/actuator tile def.                                              |
| `src/runtime/authored-function.spec.ts`: integration tests | Done    | 5 authored-function tests + 3 registration-bridge tests.                                                                               |
| `src/index.ts`: new exports                                | Done    | `createUserTileExec`, `registerUserTile`, `RegistrationServices` exported.                                                             |
| Handle resolution for sync sensors                         | Done    | `exec` wrapper resolves handle immediately after fiber completes.                                                                      |
| Callsite vars allocation and module init                   | Changed | First invocation runs `linkedInitFuncId` (module init only), not the full `onPageEntered` wrapper. See design decision #7.             |
| `onPageEntered` dispatch                                   | Done    | Spawns fiber for `linkedOnPageEnteredFuncId` wrapper, which runs module init + user body.                                              |
| Registration bridge: param tile defs                       | Done    | Named params -> `user.<tileName>.<paramName>`, anonymous -> `anon.<type>`. Checks `tiles.has()` before registering.                    |
| Registration bridge: function registration                 | Done    | `functions.register(pgmId, true, hostFn, callDef)` -- always async. pgmId uses `user.sensor.<name>` / `user.actuator.<name>` (see #8). |
| Registration bridge: tile catalog entry                    | Done    | `BrainTileSensorDef` or `BrainTileActuatorDef` with `user.sensor.<name>` / `user.actuator.<name>` ID.                                  |

**Design decisions:**

1. **Sync inline execution via `vm.spawnFiber` + `vm.runFiber`.** Rather than using
   `scheduler.spawn()` (which enqueues for later tick execution), the exec wrapper
   creates fibers directly via `vm.spawnFiber()` and runs them immediately with
   `vm.runFiber()`. This allows sync user tiles to complete and resolve their handle
   within the same HOST_CALL_ARGS_ASYNC instruction, avoiding scheduler queue
   complexity. The brain fiber sees the handle already resolved when it hits AWAIT.
   The spec says "there is no special-case inline or reentrant execution path" --
   the implementation explicitly uses an inline path for sync tiles. Async tiles
   (Phase 20+) will need a different dispatch strategy.

2. **Shallow-copy execution context for user fibers.** `vm.spawnFiber()` mutates
   `executionContext.fiberId`. To avoid clobbering the brain fiber's context, the
   wrapper creates a shallow copy (`{ ...ctx }`) for each spawned fiber. The
   `callSiteState` Dict is shared by reference (correct -- callsite state persists
   across both contexts).

3. **Negative instance-scoped fiber IDs.** Each `createUserTileExec` closure has
   its own `nextFiberId` counter starting at -1 and decrementing. Negative IDs
   avoid collisions with the scheduler's positive ID space (`nextFiberId = 1`,
   incrementing). The counter is instance-scoped (not module-level) so multiple
   exec wrappers do not share mutable state. These fibers are ephemeral -- not
   added to the scheduler's tracking.

4. **`params: ExtractedParam[]` added to `UserAuthoredProgram`.** The registration
   bridge needs param type strings (e.g., `"number"`) to resolve TypeIds for
   `BrainTileParameterDef` construction. Rather than parsing this from the
   `callDef.argSlots` tile IDs (fragile), the original `ExtractedParam[]` array
   is stored on `UserAuthoredProgram`. This is a `packages/typescript` type change
   only -- no core modifications.

5. **`RegistrationServices` interface.** The bridge takes an injected services object
   with `functions: IFunctionRegistry`, `tiles: ITileCatalog`, and
   `resolveTypeId: (shortName: string) => TypeId | undefined`. This decouples the
   bridge from the global `getBrainServices()` singleton, enabling isolated testing.

6. **Always async registration.** Per the spec's unified invocation model, user tiles
   are registered as `isAsync: true`. The brain dispatches them via
   `HOST_CALL_ARGS_ASYNC`, which creates a pending handle. The exec wrapper resolves
   the handle synchronously for sync tiles; async tiles (Phase 18+) will resolve
   later.

7. **First-allocation init uses `linkedInitFuncId`, not `linkedOnPageEnteredFuncId`.**
   The original plan called the full `onPageEntered` wrapper on first allocation.
   Review identified this as incorrect: native built-in tiles initialize callsite
   state in `exec` on first access, and `onPageEntered` runs only on actual page
   entry. Calling the wrapper on first allocation would run the user's
   `onPageEntered` body at construction time (wrong lifecycle event) and could
   double-fire if the brain also calls `onPageEntered` during the same page entry.
   Fix: `UserTileLinkInfo` gained `linkedInitFuncId?: number`, the linker now remaps
   `initFuncId`, and `getOrCreateCallsiteVars` calls `linkedInitFuncId` (module init
   only). Phase 7's discovery #5 ("initFuncId remapping deferred") is superseded.

8. **Registration IDs use `user.sensor.<name>` / `user.actuator.<name>`.** The spec's
   tileId naming table shows `user.<name>` (e.g., `user.chase`). The implementation
   uses `user.sensor.<name>` / `user.actuator.<name>` to avoid name collisions if a
   sensor and actuator share the same user-given name. The spec table should be
   updated.

**No changes to `packages/core`.** All new code is in `packages/typescript/src/runtime/`.
The exec wrapper and registration bridge use only public APIs from
`@mindcraft-lang/core/brain`.

**Test counts:** 91 total (5 authored-function, 3 registration-bridge, 7 linker, 8
null/nil, 5 onPageEntered/lifecycle, 11 helper functions/callsite state, 11 control
flow, 10 codegen/VM, 5 buildCallDef, 5 type-checking, 7 validation, 11 extraction,
3 core imports).

**Discoveries:**

1. **`vm.runFiber` can be called recursively.** The exec wrapper runs inside
   `HOST_CALL_ARGS_ASYNC` dispatch (itself inside `vm.runFiber` for the brain fiber).
   Calling `vm.runFiber` again for the user fiber is safe -- each call operates on a
   different fiber object, and the VM's shared state (program, handles, function
   registry) is read-only during dispatch. This recursive pattern enables sync user
   tiles to complete within the brain fiber's dispatch loop.

2. **Fiber `instrBudget` must be set before `vm.runFiber`.** The scheduler normally
   sets `fiber.instrBudget` in `tick()`. Since the exec wrapper bypasses the
   scheduler, it sets `instrBudget = 10000` directly. This is sufficient for sync
   tiles; a future optimization could derive the budget from the remaining brain
   fiber budget.

3. **Module init on first allocation is separate from `onPageEntered`.** On first
   callsite invocation, the wrapper spawns a fiber for `linkedInitFuncId` to set
   initial callsite var values. The full `onPageEntered` wrapper (which calls init
   then user body) runs only on actual page entry events. This matches native
   built-in tile behavior.

4. **`onPageEntered` is called per-callsite by the brain runtime.** The brain's
   `enterPage()` iterates `pageMetadata.hostCallSites` and calls
   `entry.fn.onPageEntered(ctx)` with `ctx.currentCallSiteId` set to the call site
   ID. This means our wrapper's `onPageEntered` correctly retrieves the right
   callsiteVars via `getCallSiteState()`.

5. **Tile namespace import pattern.** Concrete tile def classes (`BrainTileSensorDef`,
   `BrainTileActuatorDef`, `BrainTileParameterDef`) are under the `tiles` namespace
   export from `@mindcraft-lang/core/brain` (not at the top level). Import as
   `import { tiles as tileDefs } from "@mindcraft-lang/core/brain"` and reference
   as `tileDefs.BrainTileSensorDef`.

6. **Anonymous param tile defs use `anon.<type>` IDs and are shared.** The
   `tiles.has()` check before registration prevents duplicate registration when
   multiple tiles share the same anonymous param type (e.g., two sensors both using
   `anon.number`). Named params use `user.<tileName>.<paramName>` which is always
   unique.

7. **Recompile-and-update pathway needed.** `FunctionRegistry.register()` and
   `TileCatalog.registerTileDef()` both throw on duplicate names. The current bridge
   handles first-registration only. A stateless recompile-and-update pathway should
   be established so the caller does not need to track whether a prior registration
   exists. The bridge should detect whether the tile is already registered and update
   the existing `BrainFunctionEntry.fn` closure rather than re-registering. This
   should be done in the appropriate future phase and include tests for the update
   path.
