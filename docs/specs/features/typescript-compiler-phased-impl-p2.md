# `@mindcraft-lang/typescript` -- Phased Implementation Plan (Part 2)

Continuation doc for **Phases 16-25**. The original plan with phases 0-15 and their
post-mortems is in [typescript-compiler-phased-impl.md](typescript-compiler-phased-impl.md).
Key decisions from completed phases are in repo memory notes
(`/memories/repo/typescript-compiler-phase*.md`).

Companion to [user-authored-sensors-actuators.md](user-authored-sensors-actuators.md).
See also [vscode-authoring-debugging.md](vscode-authoring-debugging.md) -- section 6
(Debug Metadata) defines the compiler-emitted structures needed in Phase 22+.

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

(Updated 2026-03-24) Phases 0-15 complete, plus Array method lowering detour, VM list
mutation ops detour, and Array.sort detour. See the original doc's Current State and
Phase Log for full history.

### Compiler pipeline (`packages/typescript/src/compiler/`)

- `compile.ts` -- `compileUserTile(source, options?)` entry point; runs virtual
  TS host -> validate -> extract descriptor -> lower -> emit -> assemble program.
  `initCompiler()` lazy-loads the ~230KB lib strings (async, chunked by Vite).
- `virtual-host.ts` -- `createVirtualCompilerHost()`, zero Node.js APIs.
- `validator.ts` -- rejects unsupported constructs with positioned diagnostics.
- `descriptor.ts` -- extracts `ExtractedDescriptor` from `Sensor()`/`Actuator()`.
- `scope.ts` -- `ScopeStack` block-scoping allocator; `allocLocal()` for temporaries.
- `ir.ts` -- all IR node types (control flow, struct/list/map construction, list ops,
  function refs/closures/indirect calls, type checking).
- `lowering.ts` -- `lowerProgram()` produces `ProgramLoweringResult` with multiple
  `FunctionEntry` records (onExecute, onPageEntered wrapper, module init, helpers).
- `emit.ts` -- `emitFunction()` produces `FunctionBytecode`. Assigns PCs.
- `ambient.ts` -- `buildAmbientDeclarations()` generates the "mindcraft" ambient module.
- `types.ts` -- `CompileDiagnostic`, `ExtractedDescriptor`, `ExtractedParam`,
  `UserAuthoredProgram`, `UserTileLinkInfo`.

### Linker (`packages/typescript/src/linker/linker.ts`)

`linkUserPrograms(brainProgram, userPrograms[])` appends user functions to the brain
program, remaps `CALL`, `PUSH_CONST`, `MAKE_CLOSURE` operands, remaps `FunctionValue`
constants, merges constants, copies `injectCtxTypeId`. Returns `LinkResult` with
`linkedEntryFuncId`, `linkedInitFuncId`, `linkedOnPageEnteredFuncId`.

### Runtime (`packages/typescript/src/runtime/`)

- `authored-function.ts` -- `createUserTileExec(linkedProgram, linkInfo, vm, scheduler)`
  returns a `HostAsyncFn`. Sync tiles use `vm.spawnFiber()` + `vm.runFiber()` inline.
  Async dispatch is NOT yet implemented (Phase 20).
- `registration-bridge.ts` -- `registerUserTile(linkInfo, hostFn)` three-step
  registration via `getBrainServices()`. Currently handles first-registration only;
  recompile-and-update path is planned for Phase 21.

### Language features implemented

Control flow: `if`/`else`, `while`, C-style `for`, `for...of` (index-based desugar),
`break`/`continue`.

Variables: block-scoped `let`/`const`, `++`/`--`, compound assignment (`+=`, etc.),
variable shadowing, callsite-persistent top-level vars (`LOAD_CALLSITE_VAR` /
`STORE_CALLSITE_VAR` with module init function).

Expressions: binary arithmetic/comparison, logical `&&`/`||`/`!` (short-circuit via
`DUP` + conditional jump), ternary `? :` (JumpIfFalse/Jump/Label), nullish coalescing
`??` (TypeCheck(NativeType.Nil)), template literals (desugared to concatenation),
string concatenation via `Add` overload, `typeof` -> `TYPE_CHECK` opcode,
`NonNullExpression`/`AsExpression` passthrough, `null`/`undefined` -> NIL_VALUE.

Functions: user-defined helpers (`CALL`), closures/arrow functions with capture-by-value
(`MAKE_CLOSURE`, `LOAD_CAPTURE`, `CALL_INDIRECT`), function references
(`IrPushFunctionRef`), `onPageEntered` lifecycle wrapper.

Literals: object -> `STRUCT_NEW`/`STRUCT_SET`, array -> `LIST_NEW`/`LIST_PUSH`,
map -> `MAP_NEW`/`MAP_SET`, enum values via `tryResolveEnumValue()`.

Array/list ops:
- Element access `arr[i]` / assignment `arr[i] = val` via `lowerElementAccess()`.
- `.length` -> `LIST_LEN`.
- Inline methods: `.push`, `.indexOf`, `.filter`, `.map`, `.forEach`, `.sort`
  (insertion sort via `CALL_INDIRECT`), `.includes`, `.some`, `.every`, `.find`,
  `.concat`, `.join`, `.reverse`, `.slice`.
- Mutation opcodes: `LIST_POP` (95), `LIST_SHIFT` (96), `LIST_REMOVE` (97),
  `LIST_INSERT` (98), `LIST_SWAP` (99) for `.pop`, `.shift`, `.splice`, `.unshift`.
- Only `.fill` and `.copyWithin` produce compile-time diagnostics.

### Type system

- Nullable: `T | null`, `T | undefined` via `NullableCodec`. `tsTypeToTypeId()`
  returns nullable TypeIds. Ambient emits `T | null`.
- Union: `getOrCreateUnionType()` with normalization. `resolveOperatorWithExpansion()`
  handles cross-product operator lookup.
- Any/AnyList: `NativeType.Any` with `AnyCodec`. Mixed-type arrays resolve to AnyList.
- Function type: `NativeType.Function`, `FunctionValue`, `getOrCreateFunctionType()`.
- Structural subtyping: `isStructurallyCompatible()` on `ITypeRegistry`.
  `checkStructAssignmentCompat()` in `lowerAssignment`.
- Generic constructors: `ListConstructor`, `MapConstructor` via `instantiate()`.
- `tsTypeToTypeId(checker?)` resolves structs, enums, nullables, unions, functions,
  call signatures.

### Context (ctx-as-native-struct)

`Context`, `SelfContext`, `EngineContext` are native-backed structs with field getters,
registered in `packages/core/src/brain/runtime/context-types.ts`. Struct method
dispatch via `lowerStructMethodCall()` emits `HOST_CALL_ARGS`.

Ctx slot 0: `FunctionBytecode.injectCtxTypeId` set to `ContextTypeIds.Context` on
`onExecute` and `onPageEntered-wrapper` entries. The VM auto-injects the ctx struct
from `fiber.executionContext` and prepends it to args (`numParams` includes ctx slot).

All phantom ctx tracking code (ctxSymbol, isCtxExpression, etc.) has been removed.

### VM additions from detours

`LIST_POP` (95), `LIST_SHIFT` (96), `LIST_REMOVE` (97), `LIST_INSERT` (98),
`LIST_SWAP` (99) opcodes. `HOST_CALL_ARGS_ASYNC` and `AWAIT` already exist in core.

---

## Phases

### Phase 16: Destructuring

(Updated 2026-03-23: `IrListGet` already exists and is emitter-verified from the
core type system detour. Array destructuring can use it directly. Object destructuring
depends on Phase 13's `IrGetField` / `GET_FIELD`. Nullable type support from core
type system Phase 1 is available for default value nil-checks.)

**Objective:** Support simple object and array destructuring in variable declarations.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `ts.ObjectBindingPattern`
  and `ts.ArrayBindingPattern` in variable declarations. Array destructuring uses
  the existing `IrListGet` node. Object destructuring uses `IrGetField` from Phase 13.

**Concrete deliverables:**

1. `const { x, y } = pos;` desugars to: evaluate `pos`, then for each binding
   `Dup`, `GET_FIELD("x")`, `StoreLocal(x_idx)`, etc. Final `Pop` to discard the
   source object. (Depends on Phase 13's `IrGetField`.)
2. `const [a, b] = arr;` desugars to: evaluate `arr`, then `Dup`,
   `PushConst(0)`, `IrListGet`, `StoreLocal(a_idx)`, `Dup`, `PushConst(1)`,
   `IrListGet`, `StoreLocal(b_idx)`, `Pop`. (`IrListGet` already exists from the
   core type system detour.)
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
  (Updated 2026-03-24) Phase 15 showed that `TypeCheck(NativeType.Nil)` is the
  correct runtime nil-detection primitive -- use it for default value nil-checks
  rather than EqualTo operator overloads.
- **Destructuring patterns in parameters.** `function f({ x, y }: Point)` would
  require handling binding patterns in function parameter positions. Scope to
  variable declarations only for v1.

---

### Phase 17: ~~Arrow functions as helpers~~ SUPERSEDED

(Updated 2026-03-23: this phase is entirely superseded by core type system Phases 5
and 6 (function references + closures). Arrow functions and function expressions --
including those that capture outer scope variables -- are fully compiled as closure
function entries with `MAKE_CLOSURE` / `LOAD_CAPTURE` opcodes. The original Phase 17
plan only handled the non-closure case and rejected closures with a diagnostic. The
core type system work went further and implemented full closure support with
capture-by-value semantics.

What was delivered by the core type system work:

- Arrow functions with expression and block bodies compile to `FunctionBytecode` entries
- Capture analysis identifies free variables and threads them as captures
- `MAKE_CLOSURE(funcId, captureCount)` creates a `FunctionValue` with bound captures
- `LOAD_CAPTURE(captureIndex)` loads captured values inside the closure body
- `CALL_INDIRECT` dispatches calls through `FunctionValue` references
- Function table registration handles arrow functions in variable initializers
- The linker remaps `FunctionValue` constants and `MAKE_CLOSURE` function IDs

No implementation work remains for this phase. All acceptance criteria from the
original plan are satisfied or exceeded by the closure implementation.)

---

### Phase 18: Async host call emission

(Updated 2026-03-23: no structural changes needed. The core type system added
`FunctionTypeShape` and `getOrCreateFunctionType()` (Phase 7) which can express
async function signatures at the type level, but async host call detection should
still use `getBrainServices().functions.get()` metadata rather than type-level
function signatures. `resolveHostFn` was already noted as removed in Phase 10.)

**Objective:** Detect calls to async host functions and emit `HOST_CALL_ARGS_ASYNC`
instead of `HOST_CALL_ARGS`.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- extend host call lowering to
  check if the target function is async and emit `IrHostCallArgsAsync`
- `packages/typescript/src/compiler/ir.ts` -- add `IrHostCallArgsAsync` node
- `packages/typescript/src/compiler/emit.ts` -- emit `HOST_CALL_ARGS_ASYNC` opcode
  via `emitter.hostCallArgsAsync()`
- `packages/typescript/src/compiler/types.ts` -- no changes needed;
  `resolveHostFn` was removed in Phase 10. Async detection should use
  `getBrainServices().functions.get()` metadata directly

**Prerequisites:** Phase 13 (property access chains + host calls) must be complete
so that `ctx.engine.*` method calls compile. Phase 18 extends the mechanism to
distinguish sync vs async host functions. The ctx-as-native-struct refactor is
complete -- struct method dispatch via `lowerStructMethodCall()` is the mechanism
that emits `HOST_CALL_ARGS`. The async detection should extend this to emit
`HOST_CALL_ARGS_ASYNC` when the registered function is async.
(Updated 2026-03-24: ctx-as-native-struct is now implemented. Struct method
dispatch is the current mechanism for context method calls.)

**Concrete deliverables:**

1. The lowering detects async host functions via
   `getBrainServices().functions.get(fnName)` metadata (e.g., an `isAsync` field on
   the function entry). `resolveHostFn` was removed in Phase 10.
2. When the function entry indicates async, the lowering emits `IrHostCallArgsAsync`
   instead of `IrHostCallArgs`.
3. `emitFunction` emits `HOST_CALL_ARGS_ASYNC` for async IR nodes using
   `emitter.hostCallArgsAsync(fnId, argc, callSiteId)` (already available in core's
   `BytecodeEmitter`).

**Acceptance criteria:**

- Test: calling a sync host function -> `HOST_CALL_ARGS` in bytecode
- Test: calling an async host function -> `HOST_CALL_ARGS_ASYNC` in bytecode
- Test: async function entry metadata is detected correctly through the pipeline

**Key risks:**

- **Function registry metadata.** `resolveHostFn` was removed in Phase 10.
  Async detection depends on the function registry entry having the right metadata.
  Verify that `BrainFunctionEntry` (or equivalent) exposes an `isAsync` flag.
- **Call site ID allocation.** `HOST_CALL_ARGS_ASYNC` requires a meaningful
  `callSiteId` (not hardcoded 0) for per-callsite state management. May need to
  defer proper call site ID allocation to Phase 20 or handle it here.

---

### Phase 19: `await` emission

(Updated 2026-03-23: no structural changes needed from the core type system work.
The `AWAIT` opcode and fiber suspension model are unchanged. Note that `await` on
a user-defined async function (not just host calls) is now theoretically possible
since closures and `CALL_INDIRECT` exist, but this is out of scope -- user-authored
async functions are not supported in v1. Only `await` on async host calls is planned.)

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

(Updated 2026-03-23: no structural changes needed from the core type system work.
The fiber suspension/resumption model and exec wrapper are independent of the type
system additions. Local variables across `await` points work via the existing
frame/locals model, which is unaffected by the type system changes.)

**Objective:** Compile `async onExecute(ctx, params)` functions with one or more
`await` points. Verify that the fiber correctly suspends and resumes across ticks.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- handle `async` modifier on
  `onExecute` (the `descriptor.execIsAsync` flag is already extracted)
- Integration tests exercising async execution

**Prerequisites:** Phases 18 and 19 must be complete. Phase 8 (exec wrapper) must
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

(Updated 2026-03-23: no structural changes needed. The core type system work does not
affect the async integration test strategy. Note: the recompile-and-update pathway
mentioned below may benefit from the expanded type system -- if a tile is updated and
its function signatures change, the linker must re-resolve function type IDs. This is
a minor concern for this phase.)

**Objective:** Full integration test: compile an async actuator from source, link it
into a `BrainProgram`, register it via the registration bridge (Phase 8), invoke it
from a brain rule with a WHEN condition, and verify the full lifecycle:
spawn -> suspend -> resume -> complete -> handle resolve.

**Packages/files touched:**

- Integration test file(s) in `packages/typescript/src/runtime/`
- May require test utilities for mock async host functions

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

(Updated 2026-03-23: the expanded IR node set from the core type system work
(IrListGet, IrListSet, IrListLen, IrSwap, IrTypeCheck, IrPushFunctionRef,
IrCallIndirect, IrMakeClosure, IrLoadCapture, IrStructAssignCheck) does not affect
the debug metadata type definitions -- these are bytecode-level concerns, and the
debug metadata operates at the source-span and scope level. However, closure functions
generate synthetic names like `<closure#N>` which should be reflected in
`DebugFunctionInfo.name` when populating metadata in Phase 25.)

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

(Updated 2026-03-23: the expanded IR node set from the core type system work adds
new nodes that need source span annotations: `IrListGet`, `IrListSet`, `IrListLen`,
`IrSwap`, `IrTypeCheck`, `IrPushFunctionRef`, `IrCallIndirect`, `IrMakeClosure`,
`IrLoadCapture`, `IrStructAssignCheck`. All of these follow the same IR node base
pattern and will naturally carry `sourceSpan` when the optional field is added.
No structural changes to the span tracking approach are needed.)

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

(Updated 2026-03-23: closure functions introduce a new scope consideration. Captured
variables (`LOAD_CAPTURE`) have a different storage kind than locals or parameters --
the debug metadata's `LocalInfo.storageKind` should include a `"capture"` option for
variables loaded from a closure's capture list. Additionally, hidden temporaries
allocated via `allocLocal()` (used by list method inlining and for...of desugaring)
should be excluded from debug metadata or marked as compiler-generated.)

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

(Updated 2026-03-23: closure functions (from core type system Phase 6) generate
additional `FunctionBytecode` entries with synthetic names. The debug metadata assembly
must account for these: (a) closure functions should have `isGenerated: false` since
they correspond to user-written arrow function expressions, (b) `debugFunctionId`
for closures should use a deterministic key like `filePath + "/" + parentFuncName +
"/<closure#N>"`, (c) the linker remaps `MAKE_CLOSURE` function IDs, so
`compiledFuncId` values in debug metadata must be remapped in the same pass.)

**Objective:** Assemble the complete `DebugMetadata` structure from the per-function
metadata collected in Phases 22-24 and attach it to `UserAuthoredProgram`.

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
   functions, Phase 18+).
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
  concern for Phase 7's linker -- either handle it in a sub-phase or as part of 25.

---

## Phase Log

Completed phases are recorded here with dates, actual outcomes, and deviations.
(Phases 0-15 are logged in [typescript-compiler-phased-impl.md](typescript-compiler-phased-impl.md).)
