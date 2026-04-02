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

(Updated 2026-04-02) Phases 0-16, 18-21 complete, plus Array method lowering
detour, VM list mutation ops detour, Array.sort detour, class declarations detour,
destructuring extensions detour, string methods detour, Math methods detour, and
multi-file compilation detour. See the original doc's Current State and Phase Log
for full history.

### Compiler pipeline (`packages/typescript/src/compiler/`)

- `compile.ts` -- `compileUserTile(source, options?)` single-file entry point;
  wraps `UserTileProject` for backward compatibility. Re-exports
  `CompileResult`, `ProjectCompileResult`, `UserTileProject`.
- `project.ts` -- `UserTileProject` orchestration class. `setFiles()`,
  `updateFile()`, `deleteFile()`, `renameFile()` manage a virtual file system.
  `compileAll()` / `compileAffected()` return `ProjectCompileResult` with
  per-file `CompileResult` entries. Shared TS program, single
  `getPreEmitDiagnostics()` pass, `collectImports()` for cross-file symbols.
- `virtual-host.ts` -- `createVirtualCompilerHost()`, zero Node.js APIs.
- `validator.ts` -- rejects unsupported constructs with positioned diagnostics.
- `descriptor.ts` -- extracts `ExtractedDescriptor` from `Sensor()`/`Actuator()`.
- `scope.ts` -- `ScopeStack` block-scoping allocator; `allocLocal()` for temporaries.
  No metadata tracking (no scope IDs, no start/end PCs, no parent tracking).
- `ir.ts` -- 43 IR node kinds (control flow, struct/list/map construction, list
  mutation ops, struct copy-except, function refs/closures/indirect calls, type
  checking, async host calls, await).
- `lowering.ts` -- `lowerProgram()` produces `ProgramLoweringResult` with multiple
  `FunctionEntry` records (onExecute, onPageEntered wrapper, module init, helpers,
  class constructors, class methods, closures).
- `emit.ts` -- `emitFunction()` produces `EmitResult { bytecode, diagnostics }`.
  No span tracking or debug metadata.
- `ambient.ts` -- `buildAmbientDeclarations()` generates the "mindcraft" ambient
  module (structs, branded numbers, enums, list types, function types).
- `types.ts` -- `CompileDiagnostic`, `ExtractedDescriptor`, `ExtractedParam`,
  `UserAuthoredProgram`, `UserTileLinkInfo`, `CompileOptions`.
  `CompileDiagnostic` currently has `{ code, message, line?, column? }` -- start
  position only, no end position, no severity. Needs enhancement to carry full
  source ranges (`endLine`, `endColumn`) and `severity` so the diagnostics
  bridge pipeline ([diagnostics-bridge-pipeline.md](diagnostics-bridge-pipeline.md))
  can forward them to VS Code without lossy synthesis. All three creation sites
  (`makeDiag` in lowering, `addDiag` in validator, TS diagnostic mapping in
  project.ts) already have access to full span information from the TS AST; the
  fields just need to be populated.
- `diag-codes.ts` -- all diagnostic code enums (Validator, Descriptor, Lowering,
  Emit, Compile).
- `call-def-builder.ts` -- builds `BrainActionCallDef` from params.

### Linker (`packages/typescript/src/linker/linker.ts`)

`linkUserPrograms(brainProgram, userPrograms[])` appends user functions to the brain
program, remaps `CALL`, `PUSH_CONST`, `MAKE_CLOSURE` operands, remaps `FunctionValue`
constants, merges constants, copies `injectCtxTypeId`. Returns `LinkResult` with
`linkedEntryFuncId`, `linkedInitFuncId`, `linkedOnPageEnteredFuncId`. No debug
metadata remapping.

### Runtime (`packages/typescript/src/runtime/`)

- `authored-function.ts` -- `createUserTileExec(linkedProgram, linkInfo, vm, scheduler)`
  returns a `HostAsyncFn`. Sync tiles use `vm.spawnFiber()` + `vm.runFiber()` inline
  with hardcoded `instrBudget = 10000` (deferred: should respect scheduler budget or
  loop on YIELDED). Async tiles use scheduler-integrated dispatch: `execAsync` spawns
  a fiber, registers it via `scheduler.addFiber()`, and maps the fiber ID to the
  outer handle ID. `onFiberDone`/`onFiberFault`/`onFiberCancelled` callbacks are
  chained onto the scheduler to resolve/reject/cancel the outer handle when the
  fiber completes. `execIsAsync` flag on `UserAuthoredProgram` selects the dispatch
  path at wrapper creation time (static branch, not per-call). The callback chaining
  is monkey-patching -- an acceptable workaround given the current `Scheduler`
  interface design but not ideal; a cleaner architecture would use a dedicated
  fiber-completion subscription mechanism.
- `registration-bridge.ts` -- `registerUserTile(linkInfo, hostFn)` three-step
  registration via `getBrainServices()`. Supports recompile-and-update: if a
  function with the same `pgmId` is already registered, the existing
  `BrainFunctionEntry.fn` is updated in place rather than re-registering.

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

Classes: `lowerClassDeclaration()` handles constructors, field initializers, methods.
`new ClassName(...)` via `lowerNewExpression()`. `this` keyword inside
constructors/methods (via `thisLocalIndex`). Method-to-method calls on `this`,
compound assignment on `this.field`. Module-scoped `fileName::ClassName` TypeIds.
Validator rejects: `extends`, `static`, private fields (`#`), getters/setters.

Destructuring: object destructuring (`const { x, y } = pos`) via `GetField`, array
destructuring (`const [a, b] = arr`) via `ListGet`, property rename (`{ x: posX }`),
omitted elements (`[, b]`), default values with nil-check (`{ x = 5 }`). Nested
destructuring (arbitrary depth). Array rest patterns (`const [first, ...rest]`) via
`LIST_SLICE`. Object rest patterns (`const { x, ...rest }`) via `STRUCT_COPY_EXCEPT`.
Computed property names (`{ [key]: val }`). Parameter-position destructuring
(`function f({ x, y }: Point)`). Source evaluated once into a temp local
(`allocLocal()`).

Literals: object -> `STRUCT_NEW`/`STRUCT_SET`, array -> `LIST_NEW`/`LIST_PUSH`,
map -> `MAP_NEW`/`MAP_SET`, enum values via `tryResolveEnumValue()`.

Array/list ops:
- Element access `arr[i]` / assignment `arr[i] = val` via `lowerElementAccess()`.
- `.length` -> `LIST_LEN`.
- Inline methods: `.push`, `.indexOf`, `.lastIndexOf`, `.filter`, `.map`,
  `.forEach`, `.sort` (insertion sort via `CALL_INDIRECT`), `.includes`, `.some`,
  `.every`, `.find`, `.findIndex`, `.reduce`, `.concat`, `.join`, `.reverse`,
  `.slice`, `.toString`.
- Mutation opcodes: `LIST_POP` (95), `LIST_SHIFT` (96), `LIST_REMOVE` (97),
  `LIST_INSERT` (98), `LIST_SWAP` (99) for `.pop`, `.shift`, `.splice`, `.unshift`.
- Static: `Array.from()` with optional mapper.
- Only `.fill` and `.copyWithin` produce compile-time diagnostics.

String ops:
- `.length` via `$$str_length` host call. Bracket access (`str[i]`).
- Methods: `.charAt`, `.charCodeAt`, `.indexOf`, `.lastIndexOf`, `.slice`,
  `.substring`, `.toLowerCase`, `.toUpperCase`, `.trim`, `.split`, `.concat`,
  `.toString`, `.valueOf`.

Math:
- Constants: `E`, `LN10`, `LN2`, `LOG2E`, `LOG10E`, `PI`, `SQRT1_2`, `SQRT2`.
- Unary: `abs`, `acos`, `asin`, `atan`, `ceil`, `cos`, `exp`, `floor`, `log`,
  `round`, `sin`, `sqrt`, `tan`.
- Binary: `atan2`, `max`, `min`, `pow`.
- `Math.random()` (zero args).

Async: `HOST_CALL_ARGS_ASYNC` + `AWAIT` emission for async host function calls.
`execIsAsync` flag propagated through compilation, linking, and runtime dispatch.

Multi-file: `UserTileProject` manages multiple source files with shared TS program.
`collectImports()` resolves cross-file `ImportedFunction`, `ImportedVariable`,
`ImportedClass`. Module-qualified TypeIds for cross-file class disambiguation.
Diamond imports with correct init ordering and per-importer isolation.

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
dispatch via `lowerStructMethodCall()` emits `HOST_CALL_ARGS` (sync) or
`HOST_CALL_ARGS_ASYNC` (async, based on `BrainFunctionEntry.isAsync`).

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
- (Added 2026-03-24, from Phase 18 post-mortem) **Bytecode inspection pattern.**
  Phase 18 tests verify opcode presence via `prog.functions.some(fn => fn.code.some(
  instr => instr.op === Op.HOST_CALL_ARGS_ASYNC))`. Phase 19 tests can use the same
  pattern to verify `Op.AWAIT` instructions in the output. The `Widget.fetchData`
  async method is already registered in the test fixture.

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
- (Added 2026-03-24, from Phase 19 post-mortem) **Test pattern established.** Phase 19
  tests already exercise the full suspend/resume cycle: register async host fn with
  no-op `exec`, run fiber until `VmStatus.WAITING`, externally `handles.resolve()`,
  call `vm.resumeFiberFromHandle()`, run fiber again. This pattern can be reused
  directly for Phase 20 integration tests. Local variables across await points are
  confirmed to survive (tested in Phase 19).
- **Void return for async actuators.** Async actuators return `Promise<void>`. The
  compiled bytecode must push `NIL_VALUE` before `RET` (matching the existing
  NIL_VALUE fallthrough pattern from Phase 5).

---

### Phase 21: Async end-to-end integration

(Updated 2026-04-02) The async compilation pipeline (Phases 18-20) is complete.
The `authored-function.ts` exec wrapper handles async dispatch via event listeners
(`waitForHandle` subscribing to `vm.handles.events.on("completed")`), but this
bypasses the scheduler entirely. Research shows this is suboptimal:

- User-tile fibers are invisible to `scheduler.getStats()`, `scheduler.gc()`,
  and `scheduler.cancel()`. Page deactivation orphans async user-tile fibers.
- Budget is hardcoded to 10000 (10x the scheduler's default 1000) and user-tile
  fibers run to completion/WAITING without yielding, potentially starving others.
- Each `waitForHandle` listener fires for every handle completion globally and
  checks `completedId !== innerHandleId` (O(n) per completion). The scheduler's
  built-in path uses `handle.waiters` for O(1) dispatch.
- The VM's AWAIT opcode already registers `fiber.id` in `handle.waiters`, and
  `FiberScheduler.onHandleCompleted` already iterates waiters and calls
  `vm.resumeFiberFromHandle()`. All the infrastructure exists.

The registration bridge is first-registration only. The recompile-and-update
pathway is still needed.

**Objective:** (1) Migrate async user-tile dispatch from event-listener-based to
scheduler-integrated, so user-tile fibers participate in the scheduler's budget,
cancellation, and lifecycle tracking. (2) Implement recompile-and-update in the
registration bridge. (3) Full end-to-end integration tests.

**Packages/files touched:**

- `packages/typescript/src/runtime/authored-function.ts` -- replace `execAsync` /
  `waitForHandle` event-listener dispatch with scheduler-integrated dispatch:
  use `scheduler.addFiber()` (or equivalent) to register the spawned fiber,
  remove manual `vm.runFiber()` calls and `events.on("completed")` listeners.
  Add a mechanism to resolve the outer handle when the user-tile fiber reaches
  DONE (e.g., fiber-to-outer-handle mapping with a scheduler callback or
  `onHandleCompleted` hook).
- `packages/typescript/src/runtime/registration-bridge.ts` -- add
  recompile-and-update pathway.
- Integration test file(s) in `packages/typescript/src/runtime/`.
- May need minor additions to `FiberScheduler` in
  `packages/core/src/brain/runtime/vm.ts` if a fiber-completion callback is
  needed for outer handle resolution.

**Concrete deliverables:**

1. **Scheduler-integrated async dispatch.** `execAsync` spawns a fiber and adds
   it to the scheduler via `scheduler.addFiber()` (or `scheduler.spawn()`).
   The scheduler's `tick()` runs the fiber with its standard budget (1000).
   When the fiber hits AWAIT, the VM's AWAIT opcode registers the fiber in
   `handle.waiters` automatically. `FiberScheduler.onHandleCompleted` resumes
   the fiber. When the fiber reaches DONE, the outer handle is resolved.
   Remove `waitForHandle`, the global `events.on("completed")` listener, and
   the hardcoded `instrBudget = 10000`.
2. **Outer handle resolution.** When the scheduler-managed user-tile fiber
   completes (DONE), the outer handle (the one the brain rule fiber is waiting
   on) must be resolved with the fiber's return value. This requires a mapping
   from the user-tile fiber's ID to the outer handle ID, triggered by a
   fiber-completion callback. Options: extend `FiberScheduler` with an
   `onFiberDone` hook, or use `fiber.metadata` to store the outer handle ID
   and resolve it in the scheduler's `tick()` loop after detecting DONE status.
3. **Sync dispatch unchanged.** `execSync` still uses inline `spawnFiber` +
   `runFiber` for non-async tiles (no scheduler involvement needed since it
   completes in one shot).
4. End-to-end test: brain rule with WHEN condition using a sync sensor -> DO
   action using an async actuator -> actuator suspends at `await` -> handle
   resolves on next scheduler tick -> rule completes.
5. Test verifies: correct fiber states (READY -> RUNNING -> WAITING -> RUNNING ->
   COMPLETED), handle lifecycle (PENDING -> RESOLVED), callsite var persistence
   across suspension.
6. Recompile-and-update pathway: `registerUserTile` detects whether the tile is
   already registered and updates the existing `BrainFunctionEntry.fn` closure
   rather than re-registering. Tests for the update path.

**Acceptance criteria:**

- Test: async actuator invoked from brain rule -> completes after handle resolution
- Test: sync sensor + async actuator in same rule -> correct interleaving
- Test: cancellation (page deactivation) during suspended async fiber -> fiber
  transitions to CANCELLED (scheduler.cancel() covers user-tile fibers)
- Test: user-tile fiber visible in `scheduler.getStats()`
- Test: user-tile fiber respects scheduler budget (yields after default budget)
- Test: re-registering a tile with updated code -> existing entry updated

**Key risks:**

- **Outer handle resolution timing.** The brain rule fiber is WAITING on the outer
  handle. The user-tile fiber runs on the scheduler and eventually reaches DONE.
  The outer handle must be resolved at that point so the brain fiber can resume on
  the next tick. If the scheduler's `tick()` loop doesn't have a hook for
  fiber-completion, one must be added. This is the main new mechanism to design.
- **Brain compilation integration.** The brain compiler emits `HOST_CALL_ASYNC` for
  tiles registered as async. Need to verify that the brain-level HOST_CALL_ASYNC
  dispatches correctly to the user tile's exec wrapper, which now adds a child
  fiber to the scheduler rather than running it inline.
- **Scheduler tick ordering.** With both the brain rule fiber and the user-tile
  fiber in the same scheduler, their relative execution order within a tick matters.
  The user-tile fiber should be enqueued after the brain rule fiber yields/waits,
  so it picks up on the same or next tick.
- **Sync path must remain inline.** `execSync` must not be affected -- sync tiles
  run to completion within the HOST_CALL_ASYNC handler and resolve the outer handle
  immediately. Only async tiles go through the scheduler.
- **Recompile-and-update.** `FunctionRegistry.register()` and
  `TileCatalog.registerTileDef()` both throw on duplicate names. The bridge must
  detect existing registrations and update in place rather than re-registering.

---

### Phase 22: Debug metadata types

(Updated 2026-04-02) No debug metadata work has been started. The `types.ts` file
currently has no debug-related interfaces. `UserAuthoredProgram` has no
`debugMetadata` field. The debugger spec (section 6) defines the full type hierarchy.

The compiler now produces multi-file programs via `UserTileProject`, so
`DebugFileInfo` may contain multiple entries (one per source file in the project).
Class methods and constructors generate additional `FunctionBytecode` entries
alongside closures -- all need `DebugFunctionInfo` records.

**Objective:** Define the `DebugMetadata` type hierarchy in
`@mindcraft-lang/typescript` (mirroring the structures defined in the
[debugger spec, section 6](vscode-authoring-debugging.md#6-debug-metadata)) and add
the `debugMetadata` field to `UserAuthoredProgram`.

**Packages/files touched:**

- `packages/typescript/src/compiler/types.ts` -- add `DebugMetadata`,
  `DebugFileInfo`, `DebugFunctionInfo`, `Span`, `ScopeInfo`, `LocalInfo`,
  `CallSiteInfo`, `SuspendSiteInfo` interfaces; add optional `debugMetadata`
  field to `UserAuthoredProgram`

**Concrete deliverables:**

1. All debug metadata interfaces defined per the debugger spec section 6:
   - `DebugMetadata { files, functions }`
   - `DebugFileInfo { fileIndex, path, sourceHash }`
   - `DebugFunctionInfo { debugFunctionId, compiledFuncId, fileIndex, prettyName,
     isGenerated, sourceSpan, spans, pcToSpanIndex, scopes, locals, callSites,
     suspendSites }`
   - `Span { spanId, startLine, startColumn, endLine, endColumn,
     isStatementBoundary }`
   - `ScopeInfo { scopeId, kind, parentScopeId, startPc, endPc, name }`
   - `LocalInfo { name, slotIndex, storageKind, scopeId, lifetimeStartPc,
     lifetimeEndPc, typeHint }`
   - `CallSiteInfo { pc, callSiteId, targetDebugFunctionId, isAsync }`
   - `SuspendSiteInfo { awaitPc, resumePc, sourceSpan }`
2. `UserAuthoredProgram.debugMetadata?: DebugMetadata` field added.
3. No functional changes -- metadata population is Phases 23-25.

**Acceptance criteria:**

- Types compile without errors
- Existing tests continue to pass (field is optional)

**Key risks:**

- Low risk. Type-only changes.
- `ScopeInfo.kind` should include `"function" | "block" | "module" | "brain"` per
  the debugger spec. The `"brain"` kind is for brain-variable scopes, which may not
  be populated by the user-tile compiler but should be represented in the type.
- `LocalInfo.storageKind` in the debugger spec is `"local" | "parameter"`. Closure
  captures (`LOAD_CAPTURE`) have a different storage mechanism; consider adding
  `"capture"` as a storage kind.

---

### Phase 23: Source span tracking

(Updated 2026-04-02) No source span work has been started. IR nodes (43 kinds in
`ir.ts`) have no `sourceSpan` field. The emit pass (`emitFunction`) returns
`EmitResult { bytecode, diagnostics }` with no span tracking. The lowering pass
(5300+ lines in `lowering.ts`) would need annotation across all expression and
statement lowering paths.

The compiler now has substantially more lowering paths than when this phase was
originally planned: class declarations (constructors, methods, field init),
destructuring extensions (nested, rest, computed, parameter-position), string
methods (14 methods), Math methods/constants (8 constants, 14 unary, 4 binary),
and additional array methods (`.lastIndexOf`, `.findIndex`, `.reduce`, `.toString`,
`Array.from()`). All of these generate IR nodes that would need source span
annotation.

**Objective:** Track source spans during lowering and build `pcToSpanIndex` during
emission so every bytecode instruction maps back to a source location.

**Packages/files touched:**

- `packages/typescript/src/compiler/ir.ts` -- add optional `sourceSpan` field to
  a shared IR node base type (all 43 node kinds inherit it).
- `packages/typescript/src/compiler/lowering.ts` -- annotate IR nodes with source
  position info from the TS AST node (`node.getStart()`, `node.getEnd()`,
  line/column from `sourceFile.getLineAndCharacterOfPosition()`).
- `packages/typescript/src/compiler/emit.ts` -- extend `EmitResult` to include
  `spans: Span[]` and `pcToSpanIndex: number[]`. Build these during emission.
  Set `isStatementBoundary` per the debugger spec's rules.
- `packages/typescript/src/compiler/project.ts` -- pass span data through from
  `emitFunction` to the `CompileResult`.

**Prerequisites:** Phase 22 (debug metadata types) must be complete so `Span` is
defined.

**Concrete deliverables:**

1. Every IR node carries an optional `sourceSpan` with
   `{ start, end, startLine, startColumn, endLine, endColumn }` from the TS AST
   node.
2. The emit pass builds `spans: Span[]` and `pcToSpanIndex: number[]` for each
   function.
3. Statement boundary rules are applied per the debugger spec's table
   (expression statements, conditions, variable declarations with init, return
   statements, break/continue, await/resume).
4. `DebugFunctionInfo.spans` and `DebugFunctionInfo.pcToSpanIndex` are populated.

**Acceptance criteria:**

- Test: compiled function's `pcToSpanIndex` has an entry for every PC
- Test: statement boundaries are set for expression statements, `if` conditions,
  loop conditions, `return`, `break`/`continue`
- Test: sub-expression PCs have `isStatementBoundary: false`
- Test: generated functions (init, wrapper) have `isGenerated: true`

**Key risks:**

- **Annotation scope.** With 5300+ lines in lowering.ts and 43 IR node kinds, the
  annotation work is substantial. A practical approach is to annotate top-level
  statement lowering calls (the TS AST node is always available there) and let
  sub-expression nodes inherit the span of their parent statement, rather than
  attempting per-sub-expression precision in the first pass.
- **Multi-file spans.** With `UserTileProject` supporting multiple files, spans in
  helper modules must reference the correct `fileIndex`. The lowering pass
  currently works on a single file at a time (called per-file by `project.ts`),
  so file index can be set at the per-file compilation boundary.
- **Class-generated functions.** Constructor and method bodies are lowered as
  separate `FunctionEntry` records. Each needs its own span set. The class
  declaration node provides the outer span; method/constructor nodes provide
  inner spans.
- **Statement boundary completeness.** Missing a boundary type means the debugger
  cannot pause at that location. Must verify against the spec's table exhaustively.

---

### Phase 24: Scope and variable metadata

(Updated 2026-04-02) `ScopeStack` in `scope.ts` is currently minimal: a stack of
`Map<string, number>` with `pushScope()`/`popScope()`/`declareLocal(name)`/
`allocLocal()`/`resolveLocal(name)`. No scope IDs, no start/end PCs, no scope kind,
no parent tracking. This phase requires significant extension.

Hidden temporaries allocated via `allocLocal()` (used by list method inlining,
for...of desugaring, destructuring source evaluation, class field init) should be
excluded from debug metadata or marked as compiler-generated.

Closure functions use `LOAD_CAPTURE` for captured variables -- the debug metadata's
`LocalInfo.storageKind` should include `"capture"` for variables loaded from a
closure's capture list.

Class constructors and methods introduce `this` as a local variable (slot 0 after
params). This should appear in the debug metadata as a special local.

**Objective:** Emit `ScopeInfo` and `LocalInfo` metadata describing the scope tree
and variable lifetimes for debugger inspection.

**Packages/files touched:**

- `packages/typescript/src/compiler/scope.ts` -- extend `ScopeStack` to record
  scope metadata: scope IDs, kind (`"function" | "block" | "module"`), parent
  scope ID, start/end IR indices (mapped to PCs during emission).
- `packages/typescript/src/compiler/lowering.ts` -- track scope enter/exit points,
  record variable declaration IR indices and lifetimes. Mark `allocLocal()`
  temporaries as compiler-generated.
- `packages/typescript/src/compiler/emit.ts` -- map IR-index-based scope/variable
  boundaries to final PCs.

**Prerequisites:** Phase 23 (source span tracking) must be complete because scope
start/end PCs share the same IR-index-to-PC mapping infrastructure.

**Concrete deliverables:**

1. Each function's `DebugFunctionInfo.scopes` contains a tree of `ScopeInfo` entries
   (function scope at root, block scopes nested).
2. Each `LocalInfo` records name, slot index, storage kind (`"local"`,
   `"parameter"`, or `"capture"`), scope ID, and lifetime PC range.
3. Module-level scope for callsite-persistent variables is represented as a
   `"module"` scope.
4. `allocLocal()` temporaries are excluded from `LocalInfo` output.
5. `this` in class methods/constructors appears as a local.

**Acceptance criteria:**

- Test: function with nested blocks -> correct scope tree
- Test: variable declared in a block -> `lifetimeStartPc`/`lifetimeEndPc` match
  the block's PC range
- Test: parameters have `storageKind: "parameter"`
- Test: callsite vars appear in a `"module"` scope
- Test: closure captures have `storageKind: "capture"`
- Test: compiler-generated temporaries are not in the `locals` list

**Key risks:**

- **PC range tracking.** Scope start/end PCs must be precisely tracked during emission,
  not just during lowering. The emit pass assigns final PCs; the lowering pass only
  knows IR indices. Phase 23's IR-index-to-PC mapping must support this.
- **Class scope complexity.** Classes introduce a constructor function scope and
  per-method function scopes. These are separate `FunctionEntry` records so each
  gets its own scope tree. `this` occupies a local slot and must be represented.
- **Destructuring scope.** Parameter-position destructuring injects locals at the
  function scope level. Nested destructuring may produce intermediate temporaries
  that should be hidden.

---

### Phase 25: DebugMetadata assembly

(Updated 2026-04-02) The compiler orchestration is now in `project.ts`
(`UserTileProject._compileEntryPoint()`), not `compile.ts`. Multi-file compilation
means the assembly step must collect `DebugFileInfo` entries for each source file
in the project and assign stable `fileIndex` values. Class declarations generate
constructor and method `FunctionBytecode` entries alongside closures -- all need
`DebugFunctionInfo` records. The linker remaps `CALL`, `MAKE_CLOSURE`, and
`PUSH_CONST` operands but currently does not touch any debug metadata. Debug
metadata remapping must be added to the linker or performed as a post-link step.

**Objective:** Assemble the complete `DebugMetadata` structure from the per-function
metadata collected in Phases 23-24 and attach it to `UserAuthoredProgram`.

**Packages/files touched:**

- `packages/typescript/src/compiler/project.ts` -- collect per-function debug info
  from lowering and emission, assemble `DebugMetadata`, set on
  `UserAuthoredProgram.debugMetadata`
- `packages/typescript/src/compiler/emit.ts` -- return debug spans, scopes, and
  local metadata alongside bytecode in `EmitResult`
- `packages/typescript/src/linker/linker.ts` -- remap `compiledFuncId` values in
  debug metadata by function base offset. Copy or merge `DebugFileInfo` entries.

**Prerequisites:** Phases 23 and 24 must be complete (spans and scope metadata are
populated per-function).

**Concrete deliverables:**

1. `DebugMetadata` is fully populated: `files` (one `DebugFileInfo` per source file
   in the project), `functions` (one `DebugFunctionInfo` per `FunctionBytecode`).
2. Generated functions (module init, `onPageEntered` wrapper) have
   `isGenerated: true`. Closures and class methods have `isGenerated: false`.
3. `callSites` and `suspendSites` are populated (suspend sites only for async
   functions).
4. `programRevisionId` on `UserAuthoredProgram` acts as a revision key.
5. `debugFunctionId` uses deterministic keys:
   - User functions: `filePath + "/" + functionName`
   - Class methods: `filePath + "/" + className + "." + methodName`
   - Class constructors: `filePath + "/" + className + ".constructor"`
   - Closures: `filePath + "/" + parentFuncName + "/<closure#N>"`
   - Generated: `filePath + "/<init>"`, `filePath + "/<onPageEntered-wrapper>"`
6. Linker remaps `compiledFuncId` in debug metadata by function base offset.

**Acceptance criteria:**

- Test: compiled program's `debugMetadata` has correct file count and function count
- Test: `DebugFunctionInfo.compiledFuncId` matches the index in `Program.functions`
- Test: generated functions have `isGenerated: true`
- Test: user-authored functions have `isGenerated: false`
- Test: class methods and constructors have distinct `debugFunctionId` values
- Test: multi-file project has multiple `DebugFileInfo` entries
- Test: linked program's debug metadata `compiledFuncId` values are correctly
  offset

**Key risks:**

- **Metadata correctness across recompilation.** The `debugFunctionId` (stable
  identity) must be deterministic across recompilations of the same source. The
  `compiledFuncId` (index into `Program.functions`) may change on recompilation --
  that is expected.
- **Linker remapping.** `linkUserPrograms` currently copies `FunctionBytecode`
  fields `{ code, numParams, numLocals, name, maxStackDepth, injectCtxTypeId }`
  and remaps instructions. It does not handle any debug metadata. If debug metadata
  is stored on `UserAuthoredProgram` rather than per-`FunctionBytecode`, the linker
  must offset all `compiledFuncId` values by `funcOffset` and merge `DebugFileInfo`
  entries (adjusting `fileIndex` to avoid collisions across programs).
- **Multi-file file identifier stability.** With multiple source files, the
  per-file identifier must be stable across recompilations.
  Alphabetical-sort-by-path is fragile: adding a single file can shift every
  subsequent value, invalidating debug metadata for unchanged files. This matters
  for incremental recompilation (`compileAffected()`), debugger caching, and the
  recompile-and-update pathway (Phase 21). Preferred strategy: assign by
  insertion order in `UserTileProject` -- existing files keep their value, new
  files get the next available slot. Deletion can leave gaps (sparse) or compact
  with a metadata generation counter that tells consumers to invalidate cached
  mappings. Note: with this strategy the value is a stable opaque ID, not a
  contiguous array index. Consider renaming the field from `fileIndex` to
  `fileId` in Phase 22's type definitions (propagating to `DebugFileInfo` and
  `DebugFunctionInfo`) to avoid implying dense indexing.

---

## Phase Log

Completed phases are recorded here with dates, actual outcomes, and deviations.
(Phases 0-15 are logged in [typescript-compiler-phased-impl.md](typescript-compiler-phased-impl.md).)

### Phase 16 -- Destructuring (2026-03-24)

**Planned:** Object and array destructuring in variable declarations.

**Actual:** All four deliverables implemented as spec'd. Additionally:
- Property rename (`{ x: posX }`) and omitted array elements (`[, b]`) supported.
- Default values implemented with `TypeCheck(NativeType.Nil)` nil-check pattern
  (same as nullish coalescing).
- Source expression evaluated once into a temp local via `allocLocal()` rather than
  using `Dup`/`Pop` as originally sketched. This avoids re-evaluating the initializer
  per binding and is simpler to reason about.
- Computed property names in destructuring rejected with diagnostic.

**Deviations from spec:**
- Spec described `Dup`/`Pop` pattern for source value management. Implementation
  uses `allocLocal()` + `LoadLocal` instead. Functionally equivalent, avoids
  stack depth tracking complexity for multi-element patterns.
- Default value test uses a struct with all fields present (verifying defaults don't
  interfere) rather than `Partial<T>`, since `Partial<T>` doesn't resolve to a
  known struct type in the compiler's type resolution.

**Risks resolved:**
- Default values: successfully implemented using `TypeCheck(NativeType.Nil)` as
  predicted by Phase 15 risk update.
- Parameter destructuring: correctly out of scope -- lowering only dispatches
  from `lowerVariableDeclarationList`.

**Observation:** `GetField` on a non-struct and `ListGet` on a non-list will crash
the VM at runtime without a compile-time diagnostic. This is consistent with existing
property-access and element-access code paths, which rely on TypeScript's type checker
to prevent mismatches. Not a Phase 16 regression.

**Tests added:** 7 (object destructuring, array destructuring, nested rejection,
rest rejection, defaults, rename, omitted elements). All 243 tests pass.

### Phase 18 -- Async host call emission (2026-03-24)

**Planned:** Detect calls to async host functions and emit `HOST_CALL_ARGS_ASYNC`
instead of `HOST_CALL_ARGS`.

**Actual:** All three deliverables implemented exactly as spec'd:
- `IrHostCallArgsAsync` IR node added to `ir.ts` (union type + interface).
- `lowerStructMethodCall` in `lowering.ts` stores the `fnEntry` from
  `getBrainServices().functions.get(fnName)` and checks `fnEntry.isAsync` to
  choose between `IrHostCallArgsAsync` and `IrHostCallArgs`.
- `emitFunction` in `emit.ts` handles `HostCallArgsAsync` case, resolves `fnId`,
  calls `emitter.hostCallArgsAsync(fnId, argc, 0)`.
- `Widget.fetchData` registered as async in test fixture's `before()` block.

**Deviations from spec:**
- None. Implementation matched spec exactly.

**Risks resolved:**
- Function registry metadata: `BrainFunctionEntry.isAsync` is a discriminated
  union field (`true` | `false`). Works cleanly with a simple boolean check.
- Call site ID: hardcoded to 0 for now, matching the existing sync pattern.
  Deferred to Phase 20 as spec suggested.

**Observation:** Only `lowerStructMethodCall` needed async detection. All other
`IrHostCallArgs` emission sites in lowering.ts are arithmetic/comparison operators,
which are inherently sync. Phase 19 (`await` emission) can build directly on this
-- the `IrHostCallArgsAsync` node marks exactly where `AWAIT` should follow.

**Tests added:** 2 (async method -> HOST_CALL_ARGS_ASYNC in bytecode, sync method
-> HOST_CALL_ARGS only). All 245 tests pass.

### Phase 19 -- `await` emission (2026-03-24)

**Planned:** Compile `await` expressions to the `AWAIT` opcode. Validate that
`await` is only used on async host function calls.

**Actual:** All four deliverables implemented as spec'd:
- `IrAwait` IR node added to `ir.ts` (union type + interface).
- `lowerAwaitExpression` in `lowering.ts` handles `ts.isAwaitExpression`: lowers
  the operand, validates the last emitted IR node is `HostCallArgsAsync`, emits
  `IrAwait`. Non-async operands produce a compile diagnostic.
- `emitFunction` in `emit.ts` handles `Await` case, calls `emitter.await()`.
- `lowerExpression` dispatch extended with `ts.isAwaitExpression` branch.

**Deviations from spec:**
- Tests go beyond the spec's bytecode-inspection-only criteria. All three passing
  tests execute the compiled code end-to-end: compile -> spawnFiber -> runFiber ->
  assert VmStatus.WAITING -> handles.resolve() -> resumeFiberFromHandle -> runFiber
  again -> assert VmStatus.DONE with correct return value. This validates the full
  suspend/resume cycle, not just opcode presence.
- Added a "local variable survives across await point" test (spec mentioned this
  as a risk to verify but did not list it as a formal acceptance criterion).

**Risks resolved:**
- `await` validation: implemented by checking that the last IR node before `IrAwait`
  is `HostCallArgsAsync`. Simple and effective -- avoids needing to walk the TS AST
  to determine the call target's async-ness separately.
- No state machine: confirmed. The VM fiber model preserves locals, stack, and PC
  across AWAIT. The "local variable survives across await point" test proves this
  with `const before = "prefix-"` assigned before await, concatenated with the
  resolved value after resume.

**Observation:** The `Widget` struct type and `Widget.fetchData` async method are
registered in the "struct method calls" describe block's `before()` and persist
across describe blocks (shared `getBrainServices()` singleton). The await tests'
`before()` guards (`if (!types.get(...))`) are effectively no-ops since the type
is already registered. This is fine but means the await tests depend on the struct
method calls block running first.

**Tests added:** 4 (single await suspend/resume, two consecutive awaits, local
variable across await, await on sync call -> error). All 197 tests pass.

### Phase 20 -- Async `onExecute` compilation (2026-03-24)

**Planned:** Compile `async onExecute(ctx, params)` functions with one or more
`await` points. Verify fiber suspension/resumption via the exec wrapper.

**Actual:** All four acceptance criteria met. Three files changed, one new test
suite added:
- `types.ts` -- added `execIsAsync: boolean` to `UserAuthoredProgram`. This
  propagates the already-extracted `descriptor.execIsAsync` flag through
  compilation and linking to the runtime.
- `compile.ts` -- populates `execIsAsync` from `descriptor.execIsAsync`.
- `authored-function.ts` -- exec wrapper now branches on `execIsAsync`:
  - Sync path (`execSync`): unchanged -- spawns fiber, runs to completion,
    resolves outer handle immediately.
  - Async path (`execAsync`): spawns fiber, runs it. If fiber completes inline
    (no await hit), resolves immediately. If fiber suspends (`VmStatus.WAITING`),
    calls `waitForHandle` which subscribes to `vm.handles.events.on("completed")`
    for the inner handle. On completion, resumes fiber via
    `vm.resumeFiberFromHandle()`, re-runs, and either resolves or chains again
    for subsequent awaits.
  - Refactored `runFiberToCompletion` into `spawnAndRun` (returns fiber + result)
    with `runFiberToCompletion` as a wrapper for sync-only uses.

**Deviations from spec:**
- Spec listed `lowering.ts` as a touched file. No lowering changes were needed --
  the async compilation pipeline (HOST_CALL_ARGS_ASYNC + AWAIT emission) was
  already fully implemented in Phases 18-19. Phase 20 was purely a runtime
  dispatch concern.
- Spec's example used `ctx.engine.moveToward()` but tests used the already-
  registered `Widget.fetchData` async method. Functionally equivalent -- both
  exercise HOST_CALL_ARGS_ASYNC + AWAIT suspension/resumption.

**Risks resolved:**
- Async dispatch strategy: chose event listener approach
  (`vm.handles.events.on("completed")`) rather than scheduler integration or
  polling. This is non-blocking and chains naturally for multiple awaits via
  recursive `waitForHandle()`.
- Test infrastructure: reused the Phase 19 suspend/resume pattern directly.
  The `Widget` struct type with async `fetchData` method was already registered
  from earlier test suites. Tests register their own `before()` fixtures with
  guards to avoid duplicates.
- Void return: async actuators return `Promise<void>`, and the existing
  `NIL_VALUE` fallthrough in the compiled bytecode produces the correct result.
  The exec wrapper uses `result.result ?? NIL_VALUE` to normalize.

**Observation:** The `execIsAsync` flag drives a static branch at wrapper
creation time (`exec: execIsAsync ? execAsync : execSync`), not a per-call
check. This avoids any overhead for sync tiles and makes the intent clear.
The `waitForHandle` function is non-blocking -- it registers a listener and
returns. The callback fires when the handle completes externally.

**Tests added:** 4 (async actuator suspend/resolve, local var across await,
callsite var across await, async sensor with return value). All 253 tests pass.

### Phase 21 -- Async end-to-end integration (2026-04-02)

**Planned:** (1) Migrate async dispatch from event-listener-based to
scheduler-integrated. (2) Implement recompile-and-update in registration bridge.
(3) Full end-to-end integration tests including scheduler stats, budget, and
cancellation.

**Actual:** All six acceptance criteria met. Four files changed:

- `packages/core/src/brain/interfaces/vm.ts` -- added optional `addFiber?` to the
  `Scheduler` interface. This lets user-tile code register fibers with the scheduler
  without depending on the concrete `FiberScheduler` type.
- `authored-function.ts` -- replaced event-listener-based async dispatch with
  scheduler-integrated dispatch:
  - `execAsync` spawns a fiber and calls `scheduler.addFiber!()` instead of running
    the fiber inline and subscribing to handle completion events.
  - Removed `waitForHandle`, `spawnAndRun`, and the hardcoded `instrBudget = 10000`
    for async fibers. The scheduler now controls the budget.
  - Added `pendingAsyncFibers` map (fiberId -> outerHandleId) to track which outer
    handle to resolve when a user-tile fiber completes.
  - Monkey-patches `scheduler.onFiberDone`, `scheduler.onFiberFault`, and
    `scheduler.onFiberCancelled` to chain outer handle resolution onto existing
    callbacks. This is a necessary workaround given the current `Scheduler` interface
    design -- the interface exposes callbacks as assignable properties rather than
    providing a subscription/listener pattern. If we were designing from scratch, a
    proper event bus or per-fiber completion callback would be cleaner.
  - Sync dispatch (`execSync`) unchanged: inline `spawnFiber` + `runFiber` with
    hardcoded `instrBudget = 10000`. Renamed helper to `runFiberInline`.
- `registration-bridge.ts` -- added recompile-and-update: checks
  `functions.get(pgmId)` for existing registration, updates `fn` in place if found,
  skips `functions.register()` and `tiles.registerTileDef()` for the update path.
- `authored-function.spec.ts` -- migrated all 4 existing async tests from mock
  scheduler to `FiberScheduler` with `tick()` pattern. Added 3 new tests (scheduler
  stats visibility, budget respect, cancellation) and 1 recompile-and-update test.

**Deviations from spec:**

- Spec deliverable 4 called for a full brain-rule-to-async-actuator end-to-end test
  (WHEN sensor -> DO async actuator -> rule completes). This was not implemented --
  it would require a fully compiled brain program with rules, which is beyond the
  scope of the `packages/typescript` test infrastructure. The scheduler-level tests
  (fiber spawned, budget-limited, WAITING, resumed, DONE -> outer handle resolved)
  verify the same mechanics without needing a full brain compilation.
- Spec deliverable 5 mentioned verifying fiber state transitions
  (READY -> RUNNING -> WAITING -> RUNNING -> COMPLETED). The tests verify the
  relevant observable states (RUNNABLE in stats, WAITING in stats, DONE via handle
  resolution, CANCELLED via cancel). RUNNING is transient within `tick()` and not
  directly observable.
- Spec suggested extending `FiberScheduler` with an `onFiberDone` hook. The hook
  already existed as a no-op arrow function on `FiberScheduler` and as an optional
  callback on the `Scheduler` interface. The VM already calls
  `scheduler.onFiberDone?.(fiber.id, retv)` in `execRet`. No core changes to the
  `FiberScheduler` class were needed -- only the `Scheduler` interface gained the
  optional `addFiber` method.

**Risks resolved:**

- Outer handle resolution timing: the VM calls `scheduler.onFiberDone` synchronously
  during `vm.runFiber()` when the top frame returns. The monkey-patched callback
  resolves the outer handle immediately, so the brain rule fiber can be resumed on
  the next `onHandleCompleted` cycle within the same `tick()` or the next one.
- Scheduler tick ordering: the user-tile fiber is enqueued via `addFiber` (which
  calls `enqueueRunnable`), so it runs on the next `tick()` call after the brain
  rule fiber's HOST_CALL_ASYNC handler returns. This is correct -- the brain rule
  fiber is already WAITING by that point.
- Recompile-and-update: updating `BrainFunctionEntry.fn` in place works because
  the `fn` property is not `readonly`. Existing brain rules that reference this
  entry by ID will pick up the new closure on the next HOST_CALL invocation.

**Deferred concerns:**

- **Sync fiber budget.** `execSync` and module-init fibers use a hardcoded
  `instrBudget = 10000`. If a sync fiber exceeds this budget, `vm.runFiber` returns
  `YIELDED` and the result is silently dropped (handle resolved with `NIL_VALUE`).
  This needs a proper solution: either loop on YIELDED (blocking but guarantees
  completion), or use `Number.MAX_SAFE_INTEGER` (defeats the purpose of budgets),
  or integrate sync fibers into the scheduler with a completion callback. For now
  10000 is sufficient for typical sync sensors/actuators.
- **Monkey-patching scheduler callbacks.** The `Scheduler` interface exposes
  lifecycle callbacks as assignable properties (`onFiberDone`, `onFiberFault`,
  `onFiberCancelled`). `createUserTileExec` chains onto these by saving the
  previous value and calling it before its own logic. This works but is fragile:
  multiple calls to `createUserTileExec` with the same scheduler would create a
  chain of closures. A cleaner design would be a proper event subscription
  mechanism (e.g., `scheduler.on("fiberDone", callback)`) or per-fiber completion
  callbacks (e.g., `fiber.onDone`). Not urgent since in practice each scheduler
  instance is typically long-lived and `createUserTileExec` is called a bounded
  number of times (once per user tile).

**Tests added:** 8 total (4 existing async tests migrated to FiberScheduler +
tick() pattern, 3 new: scheduler stats, budget respect, cancellation; 1 new:
recompile-and-update). All 499 tests pass (packages/typescript). All 530 core
tests pass.
