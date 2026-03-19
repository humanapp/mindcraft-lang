# User-Authored Sensors and Actuators

Design spec for compiling user-authored TypeScript into Mindcraft bytecode,
enabling custom Sensors and Actuators that execute inside the Mindcraft VM.

---

## Table of Contents

- [A. Architectural Recommendation](#a-architectural-recommendation)
- [B. Compiler Design](#b-compiler-design)
- [C. Runtime Model](#c-runtime-model)
- [D. Context and Capability Model](#d-context-and-capability-model)
- [E. TypeScript Subset Proposal](#e-typescript-subset-proposal)
- [F. Async Strategy](#f-async-strategy)
- [G. Evolution Plan](#g-evolution-plan)
- [H. Risks and Tradeoffs](#h-risks-and-tradeoffs)

---

## A. Architectural Recommendation

### Position

User-authored Sensors and Actuators should compile through a **new TypeScript front-end**
that targets the **existing Mindcraft bytecode back-end**. The front-end parses a
constrained TypeScript subset, lowers it to an intermediate representation (IR) shared
with the existing tile compiler, and emits the same `FunctionBytecode` / `BrainProgram`
structures the VM already runs. From Phase 1, the compiler uses a virtual file host so
that multi-file support can be added later without architectural migration.

This is not a parallel system. It is a second entry point into the same compiler
back-end and the same VM.

### Why a new front-end, same back-end

The existing compiler front-end is tile-oriented: it consumes `IBrainTileDef` sequences
via a Pratt parser and grammar-based call-spec parser, producing `Expr` AST nodes that
map 1:1 to visual tiles. TypeScript source has fundamentally different syntax (statements,
blocks, classes, lexical scope), so trying to shoehorn it through the tile parser would
be worse than building a proper TypeScript-to-IR lowering pass.

However, the back-end -- `BytecodeEmitter`, `ConstantPool`, `Op` instruction set,
`FunctionBytecode`, `HandleTable`, `FiberScheduler` -- is TypeScript-source-agnostic.
It already supports everything needed: function calls, variables, maps/lists/structs,
HOST_CALL, HOST_CALL_ASYNC, AWAIT, TRY/THROW, and field access. A new front-end should
produce instructions from this same set rather than inventing new opcodes or a separate VM.

### Why function-based authoring, not class-based

Users should author sensors and actuators as **exported functions with a descriptor
object**, not as class subclasses. Reasons:

1. **Compilation simplicity.** A function compiles to a single `FunctionBytecode`. A class
   with inheritance requires vtable dispatch, constructor chaining, prototype chains, and
   `this` binding -- all features the VM does not have and does not need.

2. **VM alignment.** The existing runtime model treats sensors and actuators as
   `BrainFunctionEntry` objects containing an `exec` function plus metadata. User-authored
   code should produce the same shape: a callable entry point with a declared call
   signature.

3. **Inspectability.** A function with explicitly typed parameters and a return type is
   trivially analyzable at compile time. A class hierarchy requires instantiation analysis,
   method resolution order, and dynamic dispatch.

4. **Scalability.** When multi-file support arrives, importing a function from another file
   is straightforward. Importing a class with inheritance across files introduces diamond
   problems and requires a class linker.

### Source shape

```typescript
import { Sensor, type Context } from "mindcraft";

const callSpec = {
  range: { type: "number", default: 5 },
};

export default Sensor({
  name: "nearby-enemy",
  output: "boolean",
  params: callSpec,
  exec(ctx: Context, params: { range: number }): boolean {
    const enemies = ctx.engine.queryNearby(ctx.self.position, params.range);
    return enemies.length > 0;
  },
});
```

For actuators:

```typescript
import { Actuator, type Context } from "mindcraft";

export default Actuator({
  name: "flee",
  params: {
    speed: { type: "number", default: 1 },
  },
  async exec(ctx: Context, params: { speed: number }): Promise<void> {
    const threat = ctx.self.getVariable("threat");
    if (threat) {
      await ctx.engine.moveAwayFrom(ctx.self, threat.position, params.speed);
    }
  },
});
```

Key properties of this shape:

- **Single default export.** One sensor or actuator per file (v1). The compiler knows
  exactly what to compile.
- **Declarative metadata.** `name`, `output`, `params` are statically analyzable. The
  compiler reads them at compile time to generate `BrainActionCallDef` and tile
  registration data.
- **`exec` is the entrypoint.** Compiles to the primary `FunctionBytecode`. Parameters
  are derived from the `params` descriptor.
- **`ctx` is the injected context.** Not a global. Not an import. It is a function
  parameter whose type is known at compile time.
- **`async exec` maps to HOST_CALL_ASYNC + AWAIT.** The compiler detects `async` on `exec`
  and generates async bytecode.
- **Helper functions are allowed.** Users can define local functions within the file. These
  compile to additional `FunctionBytecode` entries invoked via CALL.
- **No class instantiation needed.** `Sensor()` and `Actuator()` are compile-time markers,
  not runtime constructors. They do not exist at bytecode level.

### Why this shape scales

When multi-file support arrives, a user file can import helper functions from other user
files. The compiler resolves those imports at compile time and links the
`FunctionBytecode` entries. No runtime module system is needed.

When parameter types become richer (enums, structs, lists), the `params` descriptor
extends naturally without changing the authoring pattern.

---

## B. Compiler Design

### Pipeline overview

```
TypeScript source
    |
    v
[1] TypeScript Compiler API (parsing, type checking, symbol resolution)
    |
    v
[2] AST Validation (enforce subset restrictions)
    |
    v
[3] Descriptor Extraction (static analysis of Sensor/Actuator metadata)
    |
    v
[4] Function Lowering (TS AST -> Mindcraft IR)
    |
    v
[5] IR Optimization (optional: constant folding, dead code elimination)
    |
    v
[6] Bytecode Emission (IR -> FunctionBytecode via BytecodeEmitter)
    |
    v
[7] Program Assembly (functions + constants + metadata -> UserProgram)
    |
    v
[8] Bytecode Verification (existing BytecodeVerifier)
```

### Stage 1: TypeScript Compiler API

Use `ts.createSourceFile()` for parsing and `ts.createProgram()` for full type checking.

The TypeScript compiler API runs at **authoring time and build time** -- not at gameplay
runtime. It is acceptable to depend on the TypeScript compiler package in the toolchain
(editor, build system) but the compiled bytecode must not carry any TypeScript runtime
dependency.

For v1, create virtual in-memory source files. Provide ambient type declarations for
the Mindcraft API (`mindcraft.d.ts`) so the TypeScript checker validates user code against
the correct API surface. Even in single-file mode, the compiler uses a virtual file host
so that adding multi-file support later requires no architectural change.

```typescript
const files = new Map<string, string>();
files.set("mindcraft.d.ts", ambientSource);
files.set("user-code.ts", userSource);

const host = createVirtualCompilerHost(files, compilerOptions);
const program = ts.createProgram(["user-code.ts"], compilerOptions, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
```

This gives us:

- Full TypeScript parsing (the real parser, not a custom one)
- Type checking with our declared API surface
- Symbol resolution for imports, function references, variable scopes
- Diagnostics the editor can display inline

### Stage 2: AST Validation

Walk the TypeScript AST and reject unsupported constructs before attempting compilation.
This is a visitor pass that produces diagnostics for:

- Disallowed syntax (see TypeScript Subset section)
- Missing default export
- Invalid descriptor shape
- Forbidden global access
- Dynamic property access
- `eval`, `Function`, `Proxy`, `Reflect`, `with`
- `for...in` (use `for...of` instead)
- Computed property names (except string/number literals)

Validation errors are reported as authored-code diagnostics with source positions. The
compiler does not proceed to lowering if validation fails.

### Stage 3: Descriptor Extraction

Statically analyze the default export to extract sensor/actuator metadata:

```typescript
interface ExtractedDescriptor {
  kind: "sensor" | "actuator";
  name: string;
  outputType: TypeId; // sensors only
  params: List<ExtractedParam>;
  execIsAsync: boolean;
  execFuncNode: ts.FunctionExpression; // the exec function body
}

interface ExtractedParam {
  name: string;
  typeId: TypeId;
  defaultValue?: Value; // from default in descriptor
  required: boolean;
}
```

The extraction walks the object literal passed to `Sensor()` or `Actuator()` and reads
property values. Because the descriptor must be a literal object expression (not a
variable reference), extraction is straightforward AST analysis. This produces the
`BrainActionCallDef` that integrates with the existing tile system.

### Stage 4: Function Lowering (TS AST -> Mindcraft IR)

This is the core of the compiler. It walks TypeScript AST nodes and produces a sequence of
**Mindcraft IR operations** that map closely to the existing bytecode instructions.

#### IR design

The IR should be a linear sequence of typed operations, not a tree. This keeps it close to
final bytecode while allowing optimization passes. Each IR operation corresponds to one or
a small fixed number of bytecode instructions.

```
IrOp =
  | PushConst(value: Value)
  | Pop
  | Dup
  | LoadLocal(index: number)          // function-local variable
  | StoreLocal(index: number)
  | LoadVar(varIndex: number)         // brain-level variable
  | StoreVar(varIndex: number)
  | Jump(label: Label)
  | JumpIfFalse(label: Label)
  | JumpIfTrue(label: Label)
  | Label(label: Label)
  | Call(funcIndex: number, argc: number)
  | Return
  | HostCall(fnId: number, argc: number, callSiteId: number)
  | HostCallAsync(fnId: number, argc: number, callSiteId: number)
  | Await
  | Yield
  | LoadModuleVar(index: number)    // module-scoped persistent variable
  | StoreModuleVar(index: number)
  | MapNew(typeId: number)
  | MapSet | MapGet | MapHas | MapDelete
  | ListNew(typeId: number)
  | ListPush | ListGet | ListSet | ListLen
  | StructNew(typeId: number)
  | StructGet(fieldName: string)
  | StructSet(fieldName: string)
  | GetField(fieldName: string)
  | SetField(fieldName: string)
```

#### Lowering rules

**Variable declarations:**

```typescript
// let x = 5;
// ->
PushConst(5);
StoreLocal(x_index);
```

Local variables within authored functions use `LOAD_VAR` / `STORE_VAR` with indices
allocated during lowering. The compiler maintains a scope stack to resolve lexical
scoping. Each function gets its own local variable index space.

Note: The current VM uses `LOAD_VAR` / `STORE_VAR` with variable names resolved through
`ExecutionContext`. For user-authored code with lexical scoping (block scope, function
scope), the VM will need **frame-local variable slots**. This requires extending the VM with
`LOAD_LOCAL` / `STORE_LOCAL` opcodes that index into a per-frame local variable array.
This gives proper lexical scoping, avoids name collisions between authored code and brain
variables, and is the standard approach for any bytecode VM that supports function calls
with local state. The implementation adds a `locals: List<Value>` field to `Frame` and
two new opcodes. This is a small, well-contained VM extension.

For module-scoped variables (top-level `let` / `const` in the user's file), the compiler
emits `LOAD_MODULE_VAR` / `STORE_MODULE_VAR` instead. These index into a per-module
`moduleVars` storage that persists across fiber lifetimes. See section C for details.

**If/else:**

```typescript
// if (cond) { body } else { alt }
// ->
<cond>JumpIfFalse(else_label)<body>;
Jump(end_label);
Label(else_label)<alt>;
Label(end_label);
```

**While loop:**

```typescript
// while (cond) { body }
// ->
Label(loop_start)<cond>;
JumpIfFalse(loop_end)<body>;
Jump(loop_start);
Label(loop_end);
```

**For loop:**

```typescript
// for (let i = 0; i < n; i++) { body }
// ->
<init>Label(loop_start)<cond>;
JumpIfFalse(loop_end) < body > <update>Jump(loop_start);
Label(loop_end);
```

**Function calls (user-defined):**

```typescript
// const result = helper(a, b);
// ->
<push a>
<push b>
Call(helper_func_index, 2)
StoreLocal(result_index)
```

User-defined helper functions compile to separate `FunctionBytecode` entries. Calls use
the `CALL` instruction with the function index and argument count.

**Context method calls (host calls):**

```typescript
// ctx.engine.queryNearby(pos, range)
// ->
<push pos>
<push range>
HostCall(queryNearby_fnId, 2, callSiteId)
```

Calls to methods on `ctx`, `ctx.engine`, or `ctx.self` are resolved at compile time to
host function IDs. The compiler maintains a mapping from known API method names to
`BrainFunctionEntry` IDs. Unknown method calls produce a compile error.

**Property access:**

```typescript
// ctx.self.position
// ->
LoadLocal(ctx_index); // or however ctx is accessed
GetField("self");
GetField("position");
```

Property access on known struct types uses `GET_FIELD` / `SET_FIELD`. The compiler resolves
field names at compile time against type definitions.

**Object literals (struct construction):**

```typescript
// const pos = { x: 1, y: 2 };
// ->
StructNew(positionTypeId);
PushConst("x");
PushConst(1);
StructSet;
PushConst("y");
PushConst(2);
StructSet;
StoreLocal(pos_index);
```

**Array literals (list construction):**

```typescript
// const items = [1, 2, 3];
// ->
ListNew(numberListTypeId);
PushConst(1);
ListPush;
PushConst(2);
ListPush;
PushConst(3);
ListPush;
StoreLocal(items_index);
```

**Async/await:** See section F.

### Stage 5: IR Optimization (optional)

For v1, this can be a no-op pass. Future optimizations:

- Constant folding (`1 + 2` -> `3`)
- Dead code elimination (unreachable code after return/throw)
- Redundant load/store elimination
- Inline expansion of trivial helper functions

### Stage 6: Bytecode Emission

Walk the IR and emit bytecode using the existing `BytecodeEmitter`:

```typescript
for (const op of irOps) {
  switch (op.kind) {
    case "PushConst":
      emitter.pushConst(constantPool.add(op.value));
      break;
    case "LoadLocal":
      emitter.loadLocal(op.index);
      break;
    case "Call":
      emitter.call(op.funcIndex, op.argc);
      break;
    case "HostCall":
      emitter.hostCall(op.fnId, op.argc, op.callSiteId);
      break;
    // ...
  }
}
```

The emitter handles label resolution and jump fixup, exactly as it does for tile-compiled
code.

### Stage 7: Program Assembly

Assemble the compiled functions, constants, and metadata into a structure that the runtime
can load:

```typescript
interface UserAuthoredProgram {
  kind: "sensor" | "actuator";
  name: string;
  outputType: TypeId; // sensors
  callDef: BrainActionCallDef; // parameter spec for tile system
  functions: List<FunctionBytecode>;
  constants: List<Value>;
  entryPoint: number; // function index of exec
  execIsAsync: boolean;
}
```

This program is stored alongside the brain definition. When the brain compiles, it
integrates user-authored programs by registering them as `BrainFunctionEntry` objects
whose `exec` function dispatches into the VM rather than calling native TypeScript.

### Stage 8: Bytecode Verification

Run the existing `BytecodeVerifier` on the assembled program. This validates instruction
operands, jump targets, function references, and constant pool indices.

### Where this code lives

```
packages/core/src/brain/
  authored/
    compiler/
      ts-compiler.ts          -- orchestrates the full pipeline
      ts-validator.ts         -- Stage 2: AST subset validation
      ts-descriptor.ts        -- Stage 3: descriptor extraction
      ts-lowering.ts          -- Stage 4: TS AST -> IR
      ir.ts                   -- IR types
    runtime/
      authored-function.ts    -- VM-callable wrapper for user bytecode
    types/
      mindcraft-ambient.d.ts  -- ambient type declarations for user code
```

---

## C. Runtime Model

### What a compiled Sensor becomes

A compiled user-authored sensor becomes a `BrainFunctionEntry` registered in the
`FunctionRegistry`, indistinguishable from a built-in sensor at runtime. The difference
is in the `exec` implementation.

Built-in sensors have native TypeScript `exec` functions:

```typescript
{
  exec: (ctx, args) => {
    // native TypeScript logic
    return someValue;
  };
}
```

User-authored sensors have a **VM-dispatch exec**:

```typescript
{
  exec: (ctx, args) => {
    // Spawn a fiber to execute the user's bytecode
    // Map args from the standard MapValue format to local variables
    // Run the fiber
    // Return the result from the fiber's stack
    return vmDispatch(userProgram, ctx, args);
  };
}
```

The `vmDispatch` function:

1. Creates a temporary fiber from the user program's entry point function
2. Pushes arguments onto the fiber's stack
3. Runs the fiber to completion (within the current tick's budget)
4. Returns the value left on the fiber's stack

For synchronous sensors, this happens inline within the host call -- the VM is
reentrant at this level because the outer fiber is paused at the HOST_CALL instruction
while the inner fiber runs.

### What a compiled Actuator becomes

Same as sensors but the entry may be async. An async user-authored actuator:

1. Registers as `BrainAsyncFunctionEntry` with `isAsync: true`
2. The `exec` function spawns a fiber and creates a handle
3. The fiber runs across multiple ticks if needed
4. When the fiber completes, the handle resolves

```typescript
{
  exec: (ctx, args, handleId) => {
    const fiberId = scheduler.spawn(userProgram.entryPoint, mapArgsToList(args, userProgram.callDef), ctx);
    // When fiber completes, resolve the handle
    scheduler.onFiberDone = (fid, result) => {
      if (fid === fiberId) {
        handles.resolve(handleId, result ?? VOID_VALUE);
      }
    };
  };
}
```

### Per-instance state

User-authored code has two scopes of variable storage:

- **Frame-local variables** (`LOAD_LOCAL` / `STORE_LOCAL`) live on the fiber's frame.
  They survive across await points because the fiber preserves its full execution state,
  but they are lost when the fiber completes or is cancelled.
- **Module-scoped variables** (`LOAD_MODULE_VAR` / `STORE_MODULE_VAR`) persist across
  ticks and across fiber lifetimes. These are the right place for state that must survive
  between invocations -- cooldown timers, remembered targets, accumulated counts, etc.

#### Per-callsite scoping

Module-scoped variables are **distinct per callsite**, not per module. If the same
user-authored sensor is used as a tile in two different rules (or twice in the same
rule), each usage gets its own independent copy of the module variables. This matches
how built-in sensors work: the `Timeout` sensor stores `{ fireTime, lastTick }` via
`getCallSiteState()` / `setCallSiteState()`, and each callsite has independent state.

Note the distinction between the three variable scopes:

| Scope             | Opcodes                                | Lifetime               | Sharing                           |
| ----------------- | -------------------------------------- | ---------------------- | --------------------------------- |
| Frame-local       | `LOAD_LOCAL` / `STORE_LOCAL`           | Single fiber execution | None -- private to the call frame |
| Module (callsite) | `LOAD_MODULE_VAR` / `STORE_MODULE_VAR` | Persists across ticks  | Independent per callsite          |
| Brain             | `LOAD_VAR` / `STORE_VAR`               | Persists across ticks  | Shared across all rules           |

Brain variables (`LOAD_VAR` / `STORE_VAR`) are visible to all rules in the brain and
correspond to variables the user creates in the tile editor. Module variables are
invisible outside their callsite -- they are implementation-private state of a
particular sensor/actuator invocation.

Module-scoped variables correspond to top-level `let` / `const` declarations in the
user's source file. From the user's perspective they are ordinary module globals:

```typescript
import { Sensor, type Context } from "mindcraft";

let lastFireTime = 0;
let fireCount = 0;

export default Sensor({
  name: "cooldown-ready",
  output: "boolean",
  params: { cooldown: { type: "number", default: 2 } },
  exec(ctx: Context, params: { cooldown: number }): boolean {
    if (ctx.time - lastFireTime >= params.cooldown * 1000) {
      lastFireTime = ctx.time;
      fireCount += 1;
      return true;
    }
    return false;
  },
});
```

If this sensor is placed in two different WHEN clauses, each callsite tracks its own
`lastFireTime` and `fireCount` independently. The user does not need to think about
this -- the scoping is automatic.

#### VM support: LOAD_MODULE_VAR / STORE_MODULE_VAR

Two new opcodes:

| Opcode             | Operands     | Behavior                                                 |
| ------------------ | ------------ | -------------------------------------------------------- |
| `LOAD_MODULE_VAR`  | a = varIndex | Push `moduleVars[varIndex]` onto stack                   |
| `STORE_MODULE_VAR` | a = varIndex | Pop value from stack and store in `moduleVars[varIndex]` |

The `moduleVars` storage is a `List<Value>` allocated **per callsite**. The size is known
at compile time (the compiler counts the number of module-scoped variables in the source
file). Each callsite that uses the user-authored sensor/actuator gets its own
independent `moduleVars` array.

This piggybacks on the existing call-site state mechanism. Built-in sensors already
store per-callsite state via `getCallSiteState()` / `setCallSiteState()` keyed by
`callSiteId`. For user-authored code, the `moduleVars` array is stored as the call-site
state for that callsite:

```
HOST_CALL (user-authored sensor, callSiteId = N)
  -> look up callSiteState[N]
  -> if absent, allocate List<Value> of length moduleVarCount and run init function
  -> attach moduleVars to execution context
  -> spawn/run fiber for user bytecode
  -> LOAD_MODULE_VAR / STORE_MODULE_VAR index into the attached moduleVars
```

The `moduleVars` reference is attached to the `ExecutionContext` (or a sub-object of it)
before executing the user's bytecode. When the fiber runs `LOAD_MODULE_VAR(i)`, the VM
reads `moduleVars[i]`. When it runs `STORE_MODULE_VAR(i)`, it writes `moduleVars[i]`.
Because the `moduleVars` array is stored in call-site state (not on the fiber), it
survives fiber destruction and persists across ticks.

#### Module variable initialization

Module-scoped variable initializers (e.g., `let lastFireTime = 0`) compile to an
**init function** that runs once per callsite when the `moduleVars` array is first
allocated. This function executes the initializer expressions and stores results via
`STORE_MODULE_VAR`. The init function also runs on page re-entry (via the
`onPageEntered` hook), resetting module state to initial values -- matching the
behavior of built-in sensors that reset their call-site state in `onPageEntered`.

#### Future: variable storage annotations

Out of scope for v1. Captured here to preserve the idea for future iteration.

The v1 defaults (per-callsite scoping, reset on page re-entry) are intentional --
they are simple, match CS intuition for module-level `let`, and align with how
built-in sensors manage call-site state. However, future versions may allow authors
to opt into non-default storage semantics for individual variables, such as:

- **Shared across callsites** -- a single variable instance shared by all uses of the
  sensor/actuator within the same brain, rather than independent per callsite.
- **Persistent across page re-entry** -- the variable retains its value when a page
  is re-entered instead of resetting to the initializer.

Possible expression forms (none committed):

- Decorators: `@shared let totalCount = 0;`, `@persistent let highScore = 0;`
- JSDoc/comment tags: `/** @shared */ let totalCount = 0;`

The design of this feature, including syntax, semantics, and interaction with the
multi-file module system, is deferred to a future phase.

- **Parameters** are received as function arguments, mapped from the `MapValue` that
  the tile system constructs.

### Lifecycle

- **On page enter:** If the user descriptor declares an `onPageEntered` function, it
  compiles to a separate `FunctionBytecode` and registers as the entry's
  `onPageEntered` hook.
- **On page exit:** Fibers spawned by user code are cancelled when the page deactivates,
  same as built-in fibers.
- **Per tick:** Rules containing user sensors/actuators execute their fibers via the
  normal scheduler. Budget limits apply equally to user code.

### Integration with tile system

When a user-authored sensor or actuator is compiled, the compiler produces a
`BrainActionCallDef` from the `params` descriptor. This call def is used to:

1. Register the function in `FunctionRegistry` with the correct call signature
2. Create a `BrainTileSensorDef` or `BrainTileActuatorDef` that appears in the
   tile catalog
3. Enable argument parsing when the tile is used in a brain rule

The user sees their custom sensor/actuator as a tile alongside built-in ones.

---

## D. Context and Capability Model

### Design principles

1. **Common Mindcraft context** is the same for all hosts/apps
2. **Engine-specific context** is injected by the host and declared via ambient types
3. **User code accesses context through a typed parameter**, not globals
4. **Compile-time safety** -- user code cannot reference capabilities that are not declared
5. **Runtime sandboxing** -- the VM prevents access beyond declared capabilities

### Common Mindcraft context

Available to all user code regardless of host:

```typescript
// In mindcraft-ambient.d.ts
declare module "mindcraft" {
  interface Context {
    /** Current simulation time in milliseconds */
    readonly time: number;
    /** Delta time since last tick in milliseconds */
    readonly dt: number;
    /** Current tick number */
    readonly tick: number;

    /** Access to self (the entity running this brain) */
    readonly self: SelfContext;

    /** Engine-specific capabilities (declared by host) */
    readonly engine: EngineContext;
  }

  interface SelfContext {
    /** Get a brain variable by name */
    getVariable(name: string): Value;
    /** Set a brain variable */
    setVariable(name: string, value: Value): void;
    /** Request switching to a different page */
    switchPage(pageId: string): void;
    /** Request restarting the current page */
    restartPage(): void;
    /** Get current page ID */
    readonly currentPageId: string;
    /** Get previous page ID */
    readonly previousPageId: string;
  }

  /** Base engine context -- host apps extend this */
  interface EngineContext {}
}
```

### Engine-specific context

Each host app provides its own ambient declaration file that extends `EngineContext`:

```typescript
// sim-engine-ambient.d.ts (provided by the sim app)
import "mindcraft";

declare module "mindcraft" {
  interface EngineContext {
    /** Query entities near a position */
    queryNearby(position: Position, range: number): Entity[];
    /** Move the entity toward a target */
    moveToward(target: Position, speed: number): Promise<void>;
    /** Get the entity's current position */
    getPosition(): Position;
    /** Get all entities matching a filter */
    queryEntities(filter: EntityFilter): Entity[];
  }

  interface Position {
    readonly x: number;
    readonly y: number;
  }

  interface Entity {
    readonly id: number;
    readonly position: Position;
    readonly archetype: string;
  }

  interface EntityFilter {
    archetype?: string;
    maxDistance?: number;
  }
}
```

### How this works at compile time

The TypeScript program is created with both `mindcraft-ambient.d.ts` and the host-specific
ambient file. The TypeScript checker validates user code against the combined API surface.
If user code calls `ctx.engine.queryNearby(...)`, the checker verifies that `queryNearby`
exists on `EngineContext` and that the arguments match.

### How this works at runtime

Each method on `Context`, `SelfContext`, and `EngineContext` maps to a host function
registered in the `FunctionRegistry`. The compiler knows these mappings:

```
ctx.time          -> LOAD_VAR(time_var_index)  (or a known built-in)
ctx.self.getVariable("x")  -> HOST_CALL(getVariable_fnId, ...)
ctx.engine.queryNearby(p, r) -> HOST_CALL(queryNearby_fnId, ...)
```

The compiler maintains a **method resolution table** that maps `EngineContext` method names
to host function IDs. Host apps register their engine methods as host functions during
initialization:

```typescript
// In the sim app's brain initialization
functions.register(
  "engine.queryNearby",
  false,
  {
    exec: (ctx, args) => {
      const self = getSelf(ctx);
      const pos = args.v.getStruct(0);
      const range = args.v.getNumber(1);
      return mkListValue(
        entityListTypeId,
        self.engine.queryNearby(toWorldPos(pos), range.v).map((e) => mkEntityStruct(e)),
      );
    },
  },
  mkCallDef(seq(param("position"), param("range"))),
);
```

### Boundary between common and engine-specific

| Layer            | Scope        | Examples                                     | Registration |
| ---------------- | ------------ | -------------------------------------------- | ------------ |
| Common Mindcraft | All hosts    | time, dt, tick, self.getVariable, switchPage | Core package |
| Engine context   | Per host app | queryNearby, moveToward, getPosition         | Host app     |

The common layer is registered by `registerCoreRuntimeComponents()`. Engine methods are
registered by the host app during its brain initialization, exactly as the sim app
currently registers its custom sensors/actuators.

### Sandboxing

User code can only access capabilities exposed through registered host functions. The
compiler validates at compile time that all accessed methods exist in the ambient type
declarations. At runtime, the VM can only execute HOST_CALL instructions with registered
function IDs. There is no mechanism for user bytecode to access arbitrary native objects,
call arbitrary functions, or escape the VM sandbox.

The `ctx.data` pattern (where `ExecutionContext.data` holds the native engine entity) is
invisible to user code. User code sees typed `Context` / `EngineContext` methods. The
host function implementations unwrap `ctx.data` internally.

---

## E. TypeScript Subset Proposal

### Supported in v1

| Feature                   | Notes                                                                 |
| ------------------------- | --------------------------------------------------------------------- |
| `let`, `const`            | Block-scoped. `var` excluded.                                         |
| Primitive types           | `number`, `string`, `boolean`, `null`, `undefined` (mapped to nil)    |
| Arithmetic                | `+`, `-`, `*`, `/`, `%` via HOST_CALL_ARGS                            |
| Comparison                | `===`, `!==`, `<`, `<=`, `>`, `>=`                                    |
| Logical                   | `&&`, `\|\|`, `!` with short-circuit                                  |
| String concatenation      | `+` overloaded for strings                                            |
| `if` / `else if` / `else` | Standard control flow                                                 |
| `while`                   | Standard loop                                                         |
| `for` (C-style)           | `for (let i = 0; i < n; i++)`                                         |
| `for...of`                | Over arrays/lists                                                     |
| `break`, `continue`       | In loops only                                                         |
| `return`                  | With or without value                                                 |
| Function declarations     | Named functions, arrow functions                                      |
| Function calls            | Direct calls only (no `.call`, `.bind`, `.apply`)                     |
| Object literals           | `{ x: 1, y: 2 }` -- compile to StructValue                            |
| Array literals            | `[1, 2, 3]` -- compile to ListValue                                   |
| Property access           | `obj.field` -- compile to GET_FIELD                                   |
| Index access              | `arr[i]` -- compile to LIST_GET / MAP_GET                             |
| Type annotations          | For documentation and type checking; erased at compile time           |
| Interfaces                | Type-level only, no runtime effect                                    |
| Type aliases              | Type-level only                                                       |
| `async` / `await`         | See section F                                                         |
| Ternary operator          | `cond ? a : b`                                                        |
| Nullish coalescing        | `??`                                                                  |
| Optional chaining         | `?.` (with static analysis)                                           |
| Template literals         | `` `hello ${name}` `` -- desugars to string concatenation             |
| Destructuring (simple)    | `const { x, y } = pos;` for objects; `const [a, b] = arr;` for arrays |
| Spread in arrays          | `[...items, newItem]`                                                 |
| `typeof`                  | Returns string, implemented as HOST_CALL                              |

### Excluded in v1 (feasible later)

| Feature              | Reason                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- |
| Classes              | Significant VM extension (vtable, `this`, constructors). Target for Phase 2.          |
| `enum`               | Syntax sugar. Can be added as constant objects in Phase 2.                            |
| Generics             | Type-level complexity. Low priority since types are erased.                           |
| Generators / `yield` | Different from VM YIELD. Complex state machine. Phase 3+.                             |
| `switch`             | Can be lowered to if/else chains. Phase 2 convenience.                                |
| `for...in`           | Requires reflective property enumeration. Exclude permanently in favor of `for...of`. |
| `finally`            | Requires additional VM support for guaranteed cleanup. Phase 2.                       |
| Regex                | No VM-level regex engine. Long-term host call.                                        |
| Rest parameters      | `...args` -- requires variadic support. Phase 2.                                      |
| Default parameters   | `function f(x = 5)` -- simple desugaring. Phase 2.                                    |
| Optional parameters  | `function f(x?: number)` -- Phase 2. Default to nil.                                  |
| `try` / `catch`      | Maps to existing TRY/THROW opcodes but adds complexity. Phase 2.                      |
| Closures (capturing) | Requires captured variable hoisting or closure objects. Phase 2.                      |

### Excluded permanently

| Feature                            | Reason                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------ |
| `eval`                             | Arbitrary code execution. Violates sandboxing.                           |
| `Function` constructor             | Same as eval.                                                            |
| `Proxy`, `Reflect`                 | Runtime metaprogramming. Incompatible with deterministic VM.             |
| `with`                             | Deprecated. Dynamic scope.                                               |
| `import()` (dynamic)               | Runtime module loading. No module system in VM.                          |
| Decorators                         | Metaprogramming. Compile-time complexity for marginal benefit.           |
| Symbol                             | Runtime identity concept. No VM equivalent.                              |
| WeakMap, WeakSet                   | GC-dependent semantics. No VM GC hooks.                                  |
| Prototype manipulation             | `__proto__`, `Object.create`, etc. No prototype chain in VM.             |
| `arguments` object                 | Legacy feature. No var-args in v1.                                       |
| `globalThis`, `window`, `document` | Sandboxing violation.                                                    |
| `setTimeout`, `setInterval`        | Bypass VM scheduling. Use `ctx.time` / timeout sensors.                  |
| `Promise` constructor              | User code uses `async`/`await`; raw `Promise` creation is not supported. |

### Why this subset

The core principle is: **support imperative programming with structured control flow and
typed data.** This maps cleanly to the existing VM instruction set. Everything excluded
either requires significant VM extensions (classes, generators), violates sandboxing
(eval, globals), or adds complexity disproportionate to its value (decorators, symbols).

The v1 subset is sufficient to write meaningful sensors and actuators: query state, do
arithmetic, make decisions, call host APIs, store results, and handle errors.

---

## F. Async Strategy

### Semantic model

The VM's async model is fiber-based: a fiber suspends at an AWAIT instruction when a
handle is PENDING, and resumes when the handle resolves. This is semantically equivalent
to async/await in TypeScript with one critical difference: **there are no Promises at
runtime.** Handles are VM-internal constructs.

### Compilation of async/await

An `async` function compiles to a single `FunctionBytecode` with embedded AWAIT
instructions. **No state machine transformation is needed.** The VM fiber already
preserves the full execution state (stack, frames, locals, PC) across suspension and
resumption.

This is a major advantage of the fiber-based VM design. In a traditional JS engine,
`async`/`await` must be transformed into a state machine or generator because the
JavaScript call stack is lost on suspension. In the Mindcraft VM, the fiber's execution
state is an explicit data structure that persists across yields.

```typescript
// User code:
async function exec(ctx: Context, params: { target: Position }): Promise<void> {
  const pos = ctx.engine.getPosition();
  await ctx.engine.moveToward(params.target, 1.0);
  const newPos = ctx.engine.getPosition();
}

// Compiled bytecode (pseudocode):
// func exec:
//   HOST_CALL getPosition        ; sync call, result on stack
//   STORE_LOCAL pos_idx
//   LOAD_LOCAL target_idx         ; from params
//   PUSH_CONST 1.0
//   HOST_CALL_ASYNC moveToward   ; async call, handle on stack
//   AWAIT                         ; suspends if handle is PENDING
//   HOST_CALL getPosition        ; resumes here after handle resolves
//   STORE_LOCAL newPos_idx
//   PUSH_CONST nil
//   RET
```

### Await points and state preservation

When the fiber hits AWAIT with a PENDING handle:

1. The fiber's current state is preserved in place:
   - `vstack` (operand stack) -- all computed values remain
   - `frames` (call stack) -- all call frames with their PCs and bases remain
   - `locals` (frame-local variables) -- all local variables remain
2. The `AwaitSite` records `resumePc`, `stackHeight`, `frameDepth`
3. The fiber transitions to WAITING
4. When the handle resolves, the scheduler resumes the fiber:
   - Frames/stack restored to the await site state
   - Result value pushed onto stack (or error injected)
   - Execution continues from `resumePc`

Object state (brain variables, struct values) does not need special treatment because
variables are stored in the brain's variable dict (not on the stack) and struct values
are deep-copied on assignment.

### Multiple awaits

A single async function body can contain multiple await points. Each AWAIT instruction
independently suspends and resumes. No state machine is needed because the fiber tracks
its position naturally:

```typescript
async function exec(ctx: Context): Promise<void> {
  await ctx.engine.moveToward(target1, 1.0); // AWAIT #1
  await ctx.engine.moveToward(target2, 1.0); // AWAIT #2
  await ctx.engine.moveToward(target3, 1.0); // AWAIT #3
}
```

Each await compiles to HOST_CALL_ASYNC + AWAIT. The fiber suspends and resumes three
times, continuing from exactly where it left off each time.

### Await inside loops

```typescript
async function exec(ctx: Context): Promise<void> {
  const waypoints = [pos1, pos2, pos3];
  for (const wp of waypoints) {
    await ctx.engine.moveToward(wp, 1.0);
  }
}
```

This works naturally. The loop counter and iterator state are local variables on the
fiber's stack/locals. Each iteration suspends at AWAIT and resumes in the next tick (or
whenever the handle resolves), continuing the loop.

### Cancellation

When a page deactivates, all active fibers are cancelled. This includes fibers spawned
by user-authored async actuators. Cancellation transitions the fiber to CANCELLED state.
Any in-progress host async operation should detect cancellation and clean up.

User code does not need explicit cancellation handling in v1. The VM handles it
automatically. In a future phase, we could support a `ctx.cancellationToken` or
`AbortSignal`-like pattern for cooperative cancellation within user code.

### Sensors vs Actuators async behavior

- **Sensors** should be synchronous in v1 (and ideally always). A sensor answers the
  question "is this condition true right now?" and should return immediately. If a sensor
  needs data that requires an async operation, the host should pre-fetch that data before
  the brain tick (e.g., vision query results are computed by the physics engine and placed
  in a queue before `brain.think()` runs).

- **Actuators** can be either sync or async. An async actuator starts an action that
  takes multiple ticks to complete (e.g., "move to position"), and the WHEN/DO rule
  remains active while the actuator runs.

### What user code can await

User code can only `await`:

1. Calls to async host functions (`ctx.engine.moveToward(...)` etc.)
2. Calls to other user-defined async functions

User code cannot await arbitrary values. The compiler validates that the operand of
`await` is either:

- A call to a function known to be async (host or user-defined)
- A variable known to hold a handle value

Attempting to `await` a non-async expression produces a compile error. This prevents
users from creating raw `Promise` objects or awaiting non-VM values.

### No generators or state machines in the pipeline

Because the VM fiber model preserves execution state natively, the compiler does **not**
need to transform async functions into state machines or generators. This is a major
simplification compared to typical TypeScript-to-bytecode compilers:

- No CPS (continuation-passing style) transformation
- No generator protocol emulation
- No upvalue capture for continuation closures
- The async function body compiles linearly, exactly as a sync function would, with
  AWAIT instructions inserted at suspension points

---

## G. Evolution Plan

### Phase 1: Minimal viable custom sensors and actuators

**Goal:** Users can write a single-file TypeScript sensor or actuator, compile it, and
use it as a tile in their brain.

**Scope:**

- TypeScript v1 subset (section E)
- Single file per sensor/actuator
- `Sensor()` / `Actuator()` descriptor API
- Compiler pipeline stages 1-8
- `LOAD_LOCAL` / `STORE_LOCAL` VM opcodes for frame-local variables
- `LOAD_MODULE_VAR` / `STORE_MODULE_VAR` VM opcodes for persistent module state
- Common Mindcraft context (`ctx.time`, `ctx.dt`, `ctx.self.*`)
- One host app's engine context (sim app as reference implementation)
- Sync sensors, sync and async actuators
- Bytecode verification on user programs
- Instruction budget limits apply to user code (no special treatment)
- Inline error diagnostics from TypeScript checker and subset validator
- User-authored tiles appear in tile catalog alongside built-in tiles

**Not in scope for Phase 1:**

- Classes, closures, generics, switch, finally, try/catch
- Multi-file authoring
- Importing between user files
- Debugger / step-through
- Hot reload of user code
- Editor autocomplete beyond TypeScript-provided
- Sharing user-authored tiles between brains

**Deliverables:**

1. `ts-compiler.ts` -- orchestrator
2. `ts-validator.ts` -- subset enforcement
3. `ts-descriptor.ts` -- metadata extraction
4. `ts-lowering.ts` -- TS AST -> IR
5. `ir.ts` -- IR types
6. `authored-function.ts` -- VM-dispatch wrapper
7. `mindcraft-ambient.d.ts` -- common API declarations
8. VM extension: `LOAD_LOCAL` / `STORE_LOCAL` opcodes (`Frame.locals`),
   `LOAD_MODULE_VAR` / `STORE_MODULE_VAR` opcodes (`moduleVars` storage)
9. Test suite covering all supported constructs
10. Sim app integration: engine ambient declarations + host function mappings

### Phase 2: Stronger type system and language ergonomics

**Goal:** Richer language features that make authoring more productive.

**Scope:**

- Classes (single, no inheritance) -- compile to struct types + function tables
- `switch` statements -- lower to if/else chains
- `enum` declarations -- lower to constant objects
- Default and optional function parameters
- Rest parameters
- `try` / `catch` -- maps to existing TRY/THROW opcodes
- `finally` blocks
- Simple closures (capture by value, not reference)
- Type narrowing in if/else branches (compiler uses TS checker info)
- Better error messages with source location mapping
- Source maps for debugging (map bytecode PC -> TS source line)
- `onPageEntered` lifecycle function in user descriptors

**Not in scope for Phase 2:**

- Inheritance, abstract classes, interfaces as runtime constructs
- Generics
- Multi-file
- Package system

### Phase 3: Multi-file and modular authored code

**Goal:** Users can split code across multiple files with explicit imports.

**Scope:**

- Multiple user files per sensor/actuator project
- `import` / `export` between user files (resolved at compile time)
- Virtual module resolution (no filesystem, no node_modules)
- Cross-file symbol resolution via TypeScript compiler API (`ts.createProgram` with
  multiple source files)
- Cross-file type checking
- Linked bytecode (multiple files compile to a single `UserAuthoredProgram` with merged
  functions, constants, and variable maps)
- Shared helper libraries (user-defined utility modules reusable across sensors/actuators)

**Architecture for multi-file:**

Use the TypeScript compiler API with virtual source files:

```typescript
const files = new Map<string, string>();
files.set("helpers.ts", helperSource);
files.set("sensor.ts", sensorSource);
files.set("mindcraft.d.ts", ambientSource);

const host = createVirtualCompilerHost(files, compilerOptions);
const program = ts.createProgram(["sensor.ts"], compilerOptions, host);
```

The TypeScript checker resolves `import { helper } from "./helpers"` naturally.
The Mindcraft compiler walks all referenced source files and compiles their functions
into the same `UserAuthoredProgram`. Import/export resolution happens at compile time;
there is no runtime module system.

The Phase 1 single-file compiler already uses virtual source files (the user's source
plus `mindcraft-ambient.d.ts`). Multi-file support extends this by adding more entries
to the virtual file map. No architectural migration is needed.

Module-scoped variables (via `LOAD_MODULE_VAR` / `STORE_MODULE_VAR`) are scoped per
callsite and per file. When multiple files are compiled into a single
`UserAuthoredProgram`, each file's top-level variables get a contiguous segment within
the `moduleVars` array. The compiler assigns non-overlapping index ranges so that
module variables from different files do not collide. At runtime, each callsite still
gets its own independent `moduleVars` array containing all segments.

---

## H. Risks and Tradeoffs

### Hardest parts

**1. TypeScript AST lowering completeness.**
The TypeScript AST is enormous. Even the constrained subset has dozens of node types
(BinaryExpression, CallExpression, PropertyAccessExpression, ElementAccessExpression,
IfStatement, WhileStatement, ForStatement, ForOfStatement, VariableDeclaration,
ArrowFunction, FunctionDeclaration, ReturnStatement, TryStatement, etc.). Each requires
correct lowering to IR. Missing cases produce silent incorrect behavior.

**Mitigation:** Exhaustive pattern matching in the lowering visitor. Any unrecognized AST
node type throws a compile error rather than silently dropping code. Extensive test suite
with one test per supported construct.

**2. Lexical scoping correctness.**
Block scoping (`let`/`const` in nested blocks) requires correct local variable allocation.
Shadowing, re-declaration, and scope exit must all work correctly.

**Mitigation:** Use the TypeScript checker's symbol table for variable resolution. Each
symbol gets a unique local slot index. The scope stack maps TS symbols to slot indices
and handles shadowing naturally.

**3. Host API surface design.**
The engine context API must be carefully designed. Too narrow and users cannot do useful
things. Too wide and we expose engine internals that are hard to maintain or sandbox.

**Mitigation:** Start with a small API surface (5-10 engine methods) for Phase 1. Expand
based on what users actually need. Every engine method must be explicitly registered as
a host function -- there is no mechanism for user code to access unregistered capabilities.

**4. Reentrant VM execution.**
When a synchronous user-authored sensor is called from a tile rule, the VM must execute
the sensor's bytecode synchronously within the HOST_CALL handler. This means running a
new fiber while the calling fiber is suspended. The VM and scheduler must handle this
reentrant execution correctly.

**Mitigation:** The VM already supports multiple fibers. For synchronous user functions,
create a temporary fiber, run it to `DONE` in a tight loop (with budget limits),
and return the result. The calling fiber never sees the inner fiber. The scheduler is
not involved for synchronous user functions -- they execute inline.

**5. Budget and fairness.**
User-authored code runs under the same instruction budget as built-in code. But user
code may be less efficient (more instructions per semantic operation due to the
compilation layer). If users write expensive logic, it may consume disproportionate
budget.

**Mitigation:** This is acceptable. Budget limits prevent runaway execution regardless
of efficiency. Users learn to write efficient sensors. In the future, we could expose
the remaining budget as `ctx.budget` so users can be budget-aware.

### Likely failure modes

**"TypeScript but not really."**
Users will try to write full TypeScript and hit subset boundaries. Error messages for
unsupported features must be clear: "Classes are not supported in Mindcraft sensors.
Use functions instead."

**Off-by-one in local variable indices.**
The most common bug in bytecode compilers is incorrect variable slot allocation. Unit
tests must cover every scoping scenario: nested blocks, shadowing, loop variables,
function parameters.

**Type mismatches at host call boundaries.**
User code may pass the wrong type to a host function. The compiler should catch this via
TypeScript type checking, but if types are widened (using `any` in ambient declarations),
runtime errors will occur. Ambient declarations must use precise types.

### Where simplifying constraints pay off

**No classes (Phase 1).** Eliminates vtable dispatch, `this` binding, constructor
chaining, and prototype resolution. Saves weeks of compiler/VM work.

**No closures (Phase 1).** Eliminates captured variable analysis, upvalue resolution, and
closure object allocation. Closures require either a closure-conversion pass or runtime
upvalue cells. Both add significant complexity.

**No generics.** Types are erased after checking. The compiler does not need to
monomorphize or specialize. Type parameters in ambient declarations work fine because
the TypeScript checker handles them -- the Mindcraft compiler never sees them.

**Single file (Phase 1).** Eliminates module resolution, import graph analysis, circular
dependency detection, and cross-file linking. The entire compilation unit is one function
plus its helpers.

**No raw Promise construction.** Users cannot create Promises, only `await` host-provided
async operations. This eliminates the need for Promise resolution semantics, `.then`
chains, `Promise.all`, `Promise.race`, etc. in the VM. Async is purely structural
(`async`/`await` keywords) and maps directly to VM handles.

### What this design does NOT do

- It does not turn Mindcraft into a TypeScript runtime. User TypeScript is compiled away;
  at runtime, only Mindcraft bytecode exists.
- It does not create a parallel VM or execution model. User code runs in the same fibers,
  with the same scheduler, under the same budget limits.
- It does not require changes to the tile language, parser, or existing brain compilation
  pipeline. User-authored tiles integrate at the registration level, not the compilation
  level.
- It does not expose arbitrary JavaScript APIs. User code can only call declared
  Mindcraft/engine APIs that are backed by registered host functions.

### Determinism

User-authored code running in the VM is as deterministic as built-in code. The VM
executes instructions sequentially, does not use timers, and does not depend on garbage
collection or object identity. The only source of non-determinism is host functions
(which may query world state that changes between ticks), and this is true for built-in
sensors too.

For strict determinism (e.g., replay), all host functions must be deterministic or
record-and-replay their outputs. This is an orthogonal concern not specific to user
authoring.

### Bytecode verification

The existing `BytecodeVerifier` runs on user-authored programs before execution. This
catches malformed bytecode (invalid jump targets, out-of-range constant indices, bad
function references). It does not verify semantic correctness (e.g., type safety at
runtime), but combined with compile-time TypeScript checking, the gap is small.

For additional safety, a future phase could add:

- **Stack depth analysis:** Verify that each function has a bounded stack depth
- **Termination analysis:** Detect obviously infinite loops at compile time
- **Resource budgets:** Per-function instruction count limits in addition to per-fiber
  budget
