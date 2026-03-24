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
with the existing tile compiler, and emits `FunctionBytecode` / `Program`
structures the VM already runs. (The existing tile compiler produces `BrainProgram`,
which adds rule-to-function mapping and page metadata on top of the base `Program`
interface. User-authored code targets `Program` directly.) From Phase 1, the compiler
uses a virtual file host so that multi-file support can be added later without
architectural migration.

The compiler pipeline runs **entirely in the browser** at authoring time. There is
no server-side compilation step. The full flow -- from TypeScript source to
diagnostics (and eventually bytecode) -- executes client-side in the user's
browser. All file access goes through an in-memory virtual host; no Node.js-only
APIs (`node:fs`, `node:path`, etc.) may appear in runtime code paths.

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

let lastSeen = 0;

const callSpec = {
  range: { type: "number", default: 5 },
};

export default Sensor({
  name: "nearby-enemy",
  output: "boolean",
  params: callSpec,
  exec(ctx: Context, params: { range: number }): boolean {
    const enemies = ctx.engine.queryNearby(ctx.self.position, params.range);
    if (enemies.length > 0) {
      lastSeen = ctx.time;
    }
    return enemies.length > 0;
  },
});

export function onPageEntered(ctx: Context): void {
  lastSeen = 0;
}
```

For actuators:

```typescript
import { Actuator, type Context } from "mindcraft";

let moveCount = 0;

export default Actuator({
  name: "flee",
  params: {
    speed: { type: "number", default: 1 },
  },
  async exec(ctx: Context, params: { speed: number }): Promise<void> {
    const threat = ctx.self.getVariable("threat");
    if (threat) {
      moveCount += 1;
      await ctx.engine.moveAwayFrom(ctx.self, threat.position, params.speed);
    }
  },
  onPageEntered(ctx: Context): void {
    moveCount = 0;
  },
});
```

Key properties of this shape:

- **Single default export.** One sensor or actuator per file (v1). The compiler knows
  exactly what to compile.
- **Declarative metadata.** `name`, `output`, `params` are statically analyzable. The
  compiler reads them at compile time to generate `BrainActionCallDef` and tile
  registration data. Each named param becomes a `param()` arg spec scoped to the
  tile (`user.<tileName>.<paramName>`). Each anonymous param reuses a shared
  `anon.<type>` tile def, auto-registering one if it does not already exist.
  (Updated 2026-03-20: callDef design settled. See Stage 3 and Section C.)
- **`onExecute` is the entrypoint.** Compiles to the primary `FunctionBytecode`. Parameters
  are derived from the `params` descriptor.
  (Updated 2026-03-20: renamed from `exec` to `onExecute` for consistency with `onPageEntered`.)
- **`ctx` is the injected context.** Not a global. Not an import. It is a function
  parameter whose type is known at compile time. At runtime, ctx is a native-backed
  `StructValue` wrapping the `ExecutionContext`, occupying local slot 0.
  (Updated 2026-03-24: ctx is now a real runtime value, not a compile-time phantom.)
- **`async onExecute` compiles to HOST_CALL_ASYNC + AWAIT.** The compiler detects `async` on
  `onExecute` and emits async bytecode. Both sensors and actuators may be sync or async.
  The runtime uses one unified invocation model regardless (see section C).
- **Helper functions are allowed.** Users can define local functions within the file. These
  compile to additional `FunctionBytecode` entries invoked via CALL.
- **`onPageEntered` is part of the descriptor.** If present, it is a lifecycle method
  on the descriptor object, sharing the same lexical scope and callsite-persistent
  state as `onExecute` and helpers.
  (Updated 2026-03-20: moved from a separate named export into the descriptor object
  for cohesion and simpler extraction.)
- **No class instantiation needed.** `Sensor()` and `Actuator()` are compile-time markers,
  not runtime constructors. They do not exist at bytecode level.

### Why this shape scales

When multi-file support arrives, a user file can import helper functions from other user
files. The compiler resolves those imports at compile time and links the
`FunctionBytecode` entries. No runtime module system is needed.

When parameter types become richer (enums, structs, lists), the `params` descriptor
extends naturally without changing the authoring pattern.

#### Params descriptor shape

(Added 2026-03-20)

Each entry in the `params` object describes a single argument slot:

```typescript
interface ParamDef {
  type: string; // "number" | "boolean" | "string" (v1); app types later
  default?: unknown; // literal default value; omit for required params
  anonymous?: boolean; // if true, brain editor accepts any expression (no label tile)
}
```

- **Named params** (default, `anonymous` omitted or `false`): The user sees a labeled
  tile in the brain editor. A per-tile `BrainTileParameterDef` is created with tileId
  `tile.parameter->user.<tileName>.<paramName>`.
- **Anonymous params** (`anonymous: true`): The brain editor shows an expression slot
  without a label tile. The callDef references a shared hidden tile
  `tile.parameter->anon.<type>`. If that tile def does not already exist in the catalog,
  the registration bridge creates it on the fly -- no app-side pre-registration needed.
- A param with a `default` value is optional; a param without `default` is required.
- `params` itself is optional on the descriptor. If omitted, the tile takes no arguments
  and the callDef is an empty bag.

Example with anonymous param:

```typescript
export default Actuator({
  name: "chase",
  params: {
    target: { type: "actorRef", anonymous: true },
    speed: { type: "number", default: 1 },
  },
  onExecute(ctx: Context, params: { target: unknown; speed: number }): void {
    // ...
  },
});
```

This produces:

| Param    | callDef arg spec                              | Tile def                                                        |
| -------- | --------------------------------------------- | --------------------------------------------------------------- |
| `target` | `param("anon.actorRef", { anonymous: true })` | Reuses or auto-creates `BrainTileParameterDef("anon.actorRef")` |
| `speed`  | `optional(param("user.chase.speed"))`         | New `BrainTileParameterDef("user.chase.speed", Number)`         |

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

The TypeScript compiler API runs at **authoring time** (in-browser, client-side) and
may also run during **build-time** tooling (code generation scripts, etc.) -- it does
**not** run at gameplay runtime. "Authoring time" means the compiler executes inside the
user's browser with no server roundtrip. Build-time scripts (e.g., bundling lib `.d.ts`
files) may use Node.js APIs, but the compiled output that ships to the browser must not
depend on them.

The virtual file host must be **fully in-memory** with zero filesystem access:

- No `node:fs`, `node:path`, or any other Node.js-only API in runtime code paths.
- TypeScript's lib `.d.ts` files (e.g., `lib.es5.d.ts`) must be bundled as strings
  or otherwise made available without `node:fs`. A build script may read them from
  `node_modules/typescript/lib/` and generate a source module that embeds them as
  string constants.
- `getDefaultLibFileName` must return a virtual path that exists in the in-memory
  file map, not a real filesystem path.
- `ts.sys` must not be used. The virtual host replaces all default host functions
  that would ordinarily access the filesystem.

It is acceptable to depend on the `typescript` npm package in the toolchain because
its compiler API works in the browser. However, TypeScript's default `CompilerHost`
implementation calls `node:fs` internally, so a custom virtual host is required.
The compiled bytecode must not carry any TypeScript runtime dependency.

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

### Stage 3: Descriptor and Lifecycle Extraction

Statically analyze the default export to extract sensor/actuator
metadata and lifecycle functions:

(Updated 2026-03-20: `exec` renamed to `onExecute`. `onPageEntered` moved inside the
descriptor object -- no longer a separate named export. See Phase 2 log.)

```typescript
interface ExtractedDescriptor {
  kind: "sensor" | "actuator";
  name: string;
  outputType: string | undefined; // sensors only
  params: ExtractedParam[];
  execIsAsync: boolean;
  onExecuteNode: ts.FunctionExpression | ts.MethodDeclaration | ts.ArrowFunction;
  onPageEnteredNode: ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction | null;
}

interface ExtractedParam {
  name: string;
  type: string;
  defaultValue?: number | string | boolean | null;
  required: boolean;
  anonymous: boolean;
}
```

The extraction walks the object literal passed to `Sensor()` or `Actuator()` and reads
property values. Because the descriptor must be a literal object expression (not a
variable reference), extraction is straightforward AST analysis.

(Added 2026-03-20) After extraction, a callDef construction step converts
`ExtractedParam[]` into a `BrainActionCallDef`. This is a mechanical mapping:

- Each named param -> `param("user.<tileName>.<paramName>")`
- Each anonymous param -> `param("anon.<type>", { anonymous: true })`
- Optional params (those with defaults) -> wrapped in `optional()`
- All params -> wrapped in `bag()`

The callDef is stored on `UserAuthoredProgram` and used during tile registration.
Parameter slotIds are assigned in declaration order (first param -> slotId 0, etc.).
At runtime, the compiled bytecode accesses params via `MAP_GET` with the param's
known slotId, with a preamble that unpacks each param into a local variable
(applying defaults when the arg is absent in the MapValue).

`onPageEntered`, if present, is an optional method on the descriptor object with
signature `(ctx: Context) => void`. It is stored in the `ExtractedDescriptor` for
lowering alongside `onExecute` and any helper functions. If `onPageEntered` is not
present, the field is null and the compiler omits the lifecycle hook from the
assembled program.

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
  | Swap                               // swap top two stack values
  | LoadLocal(index: number)          // function-local variable
  | StoreLocal(index: number)
  | LoadVar(varIndex: number)         // brain-level variable
  | StoreVar(varIndex: number)
  | Jump(label: Label)
  | JumpIfFalse(label: Label)
  | JumpIfTrue(label: Label)
  | Label(label: Label)
  | Call(funcIndex: number, argc: number)
  | CallIndirect(argc: number)        // pop FunctionValue, call by funcId
  | Return
  | HostCall(fnId: number, argc: number, callSiteId: number)
  | HostCallAsync(fnId: number, argc: number, callSiteId: number)
  | Await
  | Yield
  | LoadCallsiteVar(index: number)  // callsite-persistent top-level variable
  | StoreCallsiteVar(index: number)
  | LoadCapture(index: number)      // load captured variable in closure
  | MapNew(typeId: number)
  | MapSet | MapGet | MapHas | MapDelete
  | ListNew(typeId: number)
  | ListPush | ListGet | ListSet | ListLen
  | StructNew(typeId: number)
  | StructGet(fieldName: string)
  | StructSet(fieldName: string)
  | StructAssignCheck               // runtime type check for struct assignment
  | GetField(fieldName: string)
  | SetField(fieldName: string)
  | PushFunctionRef(funcName: string) // push FunctionValue for named function
  | MakeClosure(funcId: number, captureCount: number) // create closure
  | TypeCheck                        // typeof lowering (Op.TYPE_CHECK)
```

(Updated 2026-03-23: IR node list expanded to reflect core type system additions.
`CallIndirect`, `LoadCapture`, `PushFunctionRef`, `MakeClosure`, `TypeCheck`,
`StructAssignCheck`, and `Swap` were added across core type system Phases 3-8 and
the list method detour. These nodes are already implemented in ir.ts and emit.ts.)

(Updated 2026-03-21: `StructNew(typeId)` -- the `typeId` parameter is a constant pool
index pointing to a string value (the typeId string, e.g., `"struct:<Vector2>"`), not
a numeric type identifier. The VM reads `ins.a` as `numFields` (0 for the "create empty
then set fields" pattern used by the compiler) and `ins.b` as the constant pool index
for the typeId string.)

#### Lowering rules

**Variable declarations:**

```typescript
// let x = 5;
// ->
PushConst(5);
StoreLocal(x_index);
```

Local variables within authored functions use the new `LOAD_LOCAL` / `STORE_LOCAL`
opcodes with indices allocated during lowering. The compiler maintains a scope stack to
resolve lexical scoping. Each function gets its own local variable index space.

Note: The current VM uses `LOAD_VAR` / `STORE_VAR` with variable **names** resolved through
`ExecutionContext` -- these are brain-level variables shared across rules. For
user-authored code with lexical scoping (block scope, function scope), the VM will need
**frame-local variable slots**. This requires extending the VM with `LOAD_LOCAL` /
`STORE_LOCAL` opcodes that index into a per-frame local variable array.
This gives proper lexical scoping, avoids name collisions between authored code and brain
variables, and is the standard approach for any bytecode VM that supports function calls
with local state. The `Frame` interface currently has three fields (`funcId`, `pc`,
`base`); this adds a `locals: List<Value>` field plus two new opcodes. This is a small,
well-contained VM extension.

For callsite-persistent top-level variables (top-level `let` / `const` in the user's
file), the compiler emits `LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR` instead. These
index into a per-callsite `callsiteVars` storage that persists across fiber lifetimes.
See section C for details.

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
JumpIfFalse(loop_end)<body>;
Label(continue_target)<update>;
Jump(loop_start);
Label(loop_end);
```

(Updated 2026-03-20: `continue` in a for-loop targets the update expression
(`continue_target`), not `loop_start`. This ensures the incrementor runs before
the next condition check, matching JavaScript semantics. `break` targets `loop_end`.)

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

**Context method calls (struct method dispatch):**

(Updated 2026-03-24: revised to reflect the ctx-as-native-struct and struct method
dispatch implementation. Context methods are now dispatched via the general-purpose
`lowerStructMethodCall()` mechanism. The struct value is passed as the first argument.)

```typescript
// ctx.engine.queryNearby(pos, range)
// ->
LoadLocal(0);              // ctx (local slot 0)
GetField("engine");        // EngineContext struct
<push pos>
<push range>
HostCallArgs("EngineContext.queryNearby", 3)  // struct + 2 args
```

Calls to methods on context structs are resolved at compile time. The compiler checks
the receiver's struct type definition for a matching method, then looks up the
`"TypeName.methodName"` host function in the FunctionRegistry. The struct value is
pushed as the first argument. Unknown method calls produce a compile error.

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

**Element access (index read/write):**

(Added 2026-03-23: implemented in core type system detour.)

```typescript
// const x = items[i];
// ->
LoadLocal(items_index);
LoadLocal(i_index);
ListGet;
StoreLocal(x_index);

// items[i] = 42;
// ->
LoadLocal(items_index);
LoadLocal(i_index);
PushConst(42);
Swap; // reorder for LIST_SET operand layout
ListSet;
```

**Arrow functions and closures:**

(Added 2026-03-23: implemented in core type system Phases 5-6.)

```typescript
// const double = (x: number): number => x * 2;
// double(5)
// ->
PushFunctionRef("double"); // FunctionValue with funcId
StoreLocal(double_index);
// ...
PushConst(5);
LoadLocal(double_index);
CallIndirect(1); // pops FunctionValue, calls by funcId

// Closures with captures:
// const offset = 10;
// const addOffset = (x: number): number => x + offset;
// ->
LoadLocal(offset_index); // push captured value
MakeClosure(funcId, 1); // create FunctionValue with 1 capture
StoreLocal(addOffset_index);
// Inside the closure body:
LoadCapture(0); // load the captured 'offset' value
```

**typeof:**

(Added 2026-03-23: implemented as Op.TYPE_CHECK in core type system Phase 4.)

```typescript
// typeof x === "number"
// ->
LoadLocal(x_index);
TypeCheck; // pushes type string onto stack
PushConst("number");
HostCallArgs(EqualTo, 2);
```

**Async/await:** See section F.

### Stage 5: IR Optimization (optional)

For v1, this can be a no-op pass. Future optimizations:

- Constant folding (`1 + 2` -> `3`)
- Dead code elimination (unreachable code after return/throw)
- Redundant load/store elimination
- Inline expansion of trivial helper functions

### Stage 6: Bytecode Emission

Walk the IR and emit bytecode using `BytecodeEmitter`. The emitter already has methods
for all existing opcodes (`pushConst`, `call`, `hostCall`, `loadVar`, `storeVar`, etc.).
New opcodes (`LOAD_LOCAL`, `STORE_LOCAL`, `LOAD_CALLSITE_VAR`, `STORE_CALLSITE_VAR`)
will need corresponding new emitter methods (`loadLocal`, `storeLocal`,
`loadCallsiteVar`, `storeCallsiteVar`).

(Updated 2026-03-23: Additional emitter methods now exist from core type system work:
`callIndirect`, `makeClosure`, `loadCapture`, `typeCheck`, and emitter cases for
`ListGet`, `ListSet`, `Swap`, `StructAssignCheck`. The `emitFunction` call now receives
a `functionTable` parameter for resolving `PushFunctionRef` IR nodes to funcIds.)

```typescript
for (const op of irOps) {
  switch (op.kind) {
    case "PushConst":
      emitter.pushConst(constantPool.add(op.value));
      break;
    case "LoadLocal":
      emitter.loadLocal(op.index); // new method, added with the new opcode
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

#### Statement boundary emission

The compiler is responsible for marking which PCs are **statement boundaries** (safe
points). The debugger spec defines all breakpoint, stepping, and pause behavior in terms
of these boundaries -- see
[debugger spec, section 6](vscode-authoring-debugging.md#6-debug-metadata) and
[section 9](vscode-authoring-debugging.md#9-pause-and-execution-control). The compiler
must guarantee boundaries at least at the following points:

| TS construct                   | Boundary PC                                               |
| ------------------------------ | --------------------------------------------------------- |
| Function entry                 | First emitted instruction of every function body          |
| Variable declaration with init | First instruction of the initializer evaluation           |
| Expression statement           | First instruction of the expression                       |
| `if` condition                 | First instruction of the condition evaluation             |
| `while` / `for` condition      | First instruction of the condition (loop back-edge)       |
| `for` update                   | First instruction of the update expression                |
| `for...of` iterator advance    | Instruction that advances the iterator                    |
| `return`                       | First instruction of the return value evaluation (or RET) |
| `break` / `continue`           | The JUMP instruction                                      |
| `await`                        | The AWAIT instruction PC                                  |
| Resume after `await`           | The resume PC (first instruction after AWAIT)             |
| Assignment expression          | First instruction of the RHS evaluation                   |

Sub-expression evaluation (e.g., individual operands of `a + b * c`) does **not** produce
statement boundaries. The `isStatementBoundary` flag on these spans is `false`. They exist
in the span list for source mapping (stack trace display) but are not valid pause points.

Stepping behavior is determined entirely at compile time by the placement of statement
boundaries. The VM checks for breakpoints and processes pause requests only at PCs
flagged as statement boundaries. No runtime heuristic is involved.

### Stage 7: Program Assembly

Assemble the compiled functions, constants, and metadata into a structure that the runtime
can load. The core fields (`version`, `functions`, `constants`, `variableNames`,
`entryPoint`) match the existing `Program` interface in `interfaces/vm.ts`.

```typescript
interface UserAuthoredProgram extends Program {
  kind: "sensor" | "actuator";
  name: string;
  outputType?: TypeId; // sensors only; mapped from "boolean" -> CoreTypeIds.Boolean, etc.
  callDef: BrainActionCallDef; // constructed from ExtractedParam[] via callDef builder
  callsiteVarCount: number; // number of callsite-persistent top-level variables
  hasOnPageEntered: boolean; // whether the source file exports onPageEntered
  debugMetadata: DebugMetadata; // source mapping and scope metadata
  programRevisionId: string; // unique per successful compilation
}
```

(Updated 2026-03-21: The actual implementation stores lifecycle function IDs instead of
booleans: `lifecycleFuncIds: { onPageEntered?: number }` holds the wrapper's function
index. `numCallsiteVars` replaces `callsiteVarCount`. `entryFuncId` and `initFuncId`
are also present. `params: ExtractedParam[]` is also stored so the registration bridge
can resolve TypeIds for parameter tile defs without parsing callDef. See
`packages/typescript/src/compiler/types.ts` for the current shape.)

#### Debug metadata emission

The compiler emits a `DebugMetadata` structure as a first-class output of program
assembly. All debugger behavior -- breakpoints, stepping, scope display, variable
inspection, stack reconstruction -- depends exclusively on this metadata. The VM does
not infer source structure from bytecode; it relies on the metadata the compiler provides.

The `DebugMetadata` structure is defined authoritatively in the
[debugger spec, section 6](vscode-authoring-debugging.md#6-debug-metadata). In summary:

```
DebugMetadata
  files: List<DebugFileInfo>       -- source file paths and content hashes
  functions: List<DebugFunctionInfo>
```

Each `DebugFunctionInfo` contains:

- `debugFunctionId` -- stable identity (file path + function name), survives recompilation
- `compiledFuncId` -- index into `Program.functions` (may change on recompile)
- `isGenerated` -- true for compiler-inserted functions (init, lifecycle hooks)
- `spans: List<Span>` -- executable source ranges, each with an `isStatementBoundary` flag
- `pcToSpanIndex: number[]` -- O(1) lookup from instruction PC to span index
- `scopes: List<ScopeInfo>` -- scope tree (function, block, module, brain)
- `locals: List<LocalInfo>` -- variable name, slot index, lifetime PC range, storage kind
- `callSites: List<CallSiteInfo>` -- PC and target identity for each call instruction
- `suspendSites: List<SuspendSiteInfo>` -- await/resume PC pairs

The compiler populates this metadata during lowering and bytecode emission:

1. **Spans** are created from TS AST node source positions during Stage 4 (lowering).
   The `isStatementBoundary` flag is set according to the statement boundary rules
   (see "Statement boundary emission" below).
2. **pcToSpanIndex** is built during Stage 6 (bytecode emission) as each IR op is
   emitted and assigned a PC.
3. **Scopes and locals** are built from the TypeScript checker's symbol table and the
   compiler's local variable allocation in Stage 4.
4. **Call sites and suspend sites** are recorded during Stage 6 as HOST_CALL, CALL,
   and AWAIT instructions are emitted.

The metadata is stored alongside the `UserAuthoredProgram` in the world/project data and
sent to the debug adapter on attach. It is refreshed on each successful recompilation.

This program is stored alongside the brain definition. When the brain compiles, it
integrates user-authored programs by registering them as `BrainFunctionEntry` objects
whose `exec` function dispatches into the VM rather than calling native TypeScript.

### Stage 8: Bytecode Verification

Run the `BytecodeVerifier` on the assembled program. (The verifier exists today as a
private class in `vm.ts`; it validates instruction operands, jump targets, function
references, and constant pool indices. It may need to be extracted or extended to support
the new opcodes.)

### Where this code lives

The compiler and runtime wrapper live in the `@mindcraft-lang/typescript` package, not in
`packages/core`. Core must remain free of TypeScript compiler API dependencies to
preserve roblox-ts compatibility. Core provides the VM, bytecode interfaces, and
FunctionRegistry -- the TypeScript package consumes those to compile and link user code.

```
packages/typescript/src/
  compiler/
    ts-compiler.ts          -- orchestrates the full pipeline
    ts-validator.ts         -- Stage 2: AST subset validation
    ts-descriptor.ts        -- Stage 3: descriptor + lifecycle extraction
    ts-lowering.ts          -- Stage 4: TS AST -> IR
    ir.ts                   -- IR types
  linker/
    linker.ts               -- merges UserAuthoredProgram into BrainProgram
  runtime/
    authored-function.ts    -- VM-callable wrapper for user bytecode
  types/
    mindcraft-ambient.d.ts  -- ambient type declarations for user code
```

(Updated 2026-03-23: The actual file layout after implementation differs from the plan
above. Key differences: `ts-compiler.ts` -> `compile.ts`, `ts-validator.ts` ->
`validate.ts`, `ts-descriptor.ts` -> `extract.ts`, `ts-lowering.ts` -> `lowering.ts`.
Additional files exist: `emit.ts` (bytecode emission), `scope.ts` (scope stack and
local allocation), `ambient.ts` (generates ambient declarations from type registry),
`types.ts` (shared compiler types including `UserAuthoredProgram`). The ambient
declarations are generated dynamically from the type registry rather than maintained
as a static `.d.ts` file.)

### Linking user-authored bytecode into the brain program

The VM has one `Program` with a flat `functions: List<FunctionBytecode>`. The `CALL`
opcode indexes into `Program.functions`. A `UserAuthoredProgram` has its own `functions`
list with funcIds starting at 0. These two function ID spaces must be unified for the
single-VM model to work. (HOST_CALL IDs are a separate namespace -- global
FunctionRegistry -- and have no conflict.)

The linking step is a pure data transformation that happens after `compileBrain()`
produces the `BrainProgram` and before `new VM(program, handles)`:

1. `compileBrain()` produces a `BrainProgram` with N rule functions at funcIds `0..N-1`.
2. For each user-authored tile referenced in the brain (discoverable from page metadata's
   sensor/actuator tile sets), retrieve its `UserAuthoredProgram`.
3. Append its `FunctionBytecode` entries to `BrainProgram.functions` -- the first entry
   gets funcId `N`, the next `N+1`, etc.
4. Merge its constants into `BrainProgram.constants`, recording old-to-new index mapping.
5. Rewrite the copied user bytecode: remap `CALL` funcId operands (+offset),
   `MAKE_CLOSURE` funcId operands (+offset), `PUSH_CONST` index operands (per constant
   mapping), and `FunctionValue` constants in the constant pool (+funcId offset).
6. Record the remapped entry point funcId for each user tile.

(Updated 2026-03-23: step 5 now includes `MAKE_CLOSURE` funcId remapping and
`FunctionValue` constant pool remapping, both added in core type system Phase 5-6.
The linker already implements these via the `funcOffset` applied to both instruction
operands and constant pool entries.)

The HOST_CALL exec wrapper for user tiles is created by `createUserTileExec()`:

(Updated 2026-03-24: revised to reflect the ctx-as-native-struct implementation.
The exec wrapper creates a `StructValue` from the `ExecutionContext` and passes it
as the first fiber argument. `createUserTileExec()` takes the resolved `linkedProgram`
and `linkInfo` (with `linkedEntryFuncId`, `linkedInitFuncId`,
`linkedOnPageEnteredFuncId` already remapped by the linker) and uses
`vm.spawnFiber()` + `vm.runFiber()` for inline execution. On first allocation, only
the module init function (`linkedInitFuncId`) runs -- not the full `onPageEntered`
wrapper -- matching native built-in tile behavior. See
`packages/typescript/src/runtime/authored-function.ts`.)

The linker itself is ~50 lines: iterate user programs, compute offset, copy+remap
bytecode instructions, merge constants. It lives in `@mindcraft-lang/typescript`, not
in core. Core provides no linking API -- the linker manipulates `List<>` contents on
the `BrainProgram` before passing it to the VM constructor.

---

## C. Runtime Model

### What a compiled user-authored tile becomes

A compiled user-authored sensor or actuator becomes a `BrainFunctionEntry` registered in
the `FunctionRegistry`, indistinguishable from a built-in tile at runtime. The difference
is in the `exec` implementation.

Built-in tiles have native TypeScript `exec` functions:

```typescript
{
  exec: (ctx, args) => {
    // native TypeScript logic
    return someValue;
  };
}
```

User-authored tiles have a **VM-dispatch exec** that creates a `StructValue` wrapping
the `ExecutionContext` and passes it as the first argument to the user's bytecode.
The entry function ID used here is the **linked** ID (remapped after merging user
bytecode into the brain program -- see "Linking user-authored bytecode into the brain
program" below):

(Updated 2026-03-24: revised to reflect the ctx-as-native-struct implementation.
The ctx `StructValue` is created via `mkNativeStructValue(ContextTypeIds.Context, ctx)`
and passed as the first fiber argument. See
`packages/typescript/src/runtime/authored-function.ts` for the current implementation.)

```typescript
{
  exec: (ctx, args, handleId) => {
    let vars = getCallSiteState<List<Value>>(ctx);
    if (!vars) {
      vars = allocateCallsiteVars(userProgram.numCallsiteVars);
      setCallSiteState(ctx, vars);
      // run module init function to set initial values
    }
    const ctxStruct = mkNativeStructValue(ContextTypeIds.Context, ctx);
    const fiberArgs = hasParams ? List.from<Value>([ctxStruct, mapArgsToSlots(args)]) : List.from<Value>([ctxStruct]);
    const childCtx = { ...ctx };
    const fiberId = vm.spawnFiber(linkedEntryFuncId, fiberArgs, childCtx);
    const fiber = vm.getFiber(fiberId);
    fiber.callsiteVars = vars;
    vm.runFiber(fiberId);
    handles.resolve(handleId, fiber.result ?? NIL_VALUE);
  };
}
```

Every invocation of a user-authored tile:

1. Spawns a fiber from the user program's entry point function
2. Pushes arguments onto the fiber's stack
3. Returns a handle to the calling fiber
4. The calling fiber suspends at AWAIT until the handle resolves
5. When the spawned fiber completes, the handle resolves with its return value

If the user's `exec` function contains no AWAIT instructions (i.e., it calls no async
host functions), the spawned fiber runs to completion within the current tick and the
handle resolves immediately. The calling fiber resumes in the same tick -- no scheduling
delay occurs. This means a synchronous sensor executes with no observable overhead
compared to a hypothetical inline path, while using the same code path as an async
actuator that suspends across multiple ticks.

For sync tiles, the spawned fiber runs to completion within the current tick via
`vm.spawnFiber()` + `vm.runFiber()` and the handle resolves immediately. The calling
fiber resumes in the same tick -- no scheduling delay occurs. Async tiles (Phase 20+)
will need a different dispatch strategy that integrates with the scheduler.

### Entry functions, callsites, and fibers

This section defines the relationship between a user's source file, its compiled entry
function, callsites in the brain, and runtime fibers.

**Source file to entry function.** Each user-authored source file (one per sensor or
actuator) compiles to a single `UserAuthoredProgram`. The program's entry point is the
`exec` function from the descriptor. The program may contain additional `FunctionBytecode`
entries for helper functions and compiler-generated functions, but only one entry point.

**Callsites.** A single authored tile may appear in multiple rules within a brain, or
multiple times within the same rule. Each usage is a distinct **callsite** identified by
a `callSiteId`. The brain compiler assigns callsite IDs when it compiles rules containing
HOST_CALL_ASYNC instructions that reference user-authored tiles. Multiple callsites may
reference the same `UserAuthoredProgram` (same bytecode, same entry function). Each
callsite gets its own independent copy of callsite-persistent top-level state
(`callsiteVars`).

**Fibers.** Each brain rule executes as a fiber. When a rule's fiber reaches a
HOST_CALL_ASYNC that dispatches to a user-authored tile (sensor or actuator), the `exec`
wrapper spawns a new fiber via the scheduler. The calling rule fiber suspends at AWAIT
until the spawned fiber completes and resolves the handle. If the user function completes
without hitting any AWAIT instruction, the spawned fiber finishes within the current tick
and the handle resolves immediately -- the calling fiber resumes in the same tick with no
scheduling delay.

In all cases, the entry function (`exec`) is invoked within a fiber via the `vmDispatch`
function. The fiber is a standard VM fiber -- the same type used by tile-compiled rule
fibers. The user-authored bytecode runs under the same scheduler, same budget limits,
and same `FiberState` lifecycle as any built-in code.

### WHEN clause evaluation semantics

Condition evaluation in a WHEN clause is not required to resolve in the same tick. When a
WHEN clause invokes a user-authored sensor, the sensor's fiber is spawned and the rule
fiber suspends at AWAIT. The semantics are:

- **Immediate resolution.** If the sensor's `exec` contains no AWAIT instructions, the
  fiber completes within the current tick. The handle resolves with the sensor's return
  value, and the rule fiber resumes in the same tick. This is the common case for sensors
  that compute a boolean from current world state.

- **Deferred resolution.** If the sensor's `exec` contains AWAIT instructions (e.g., it
  queries an async host API), the fiber suspends and the condition remains **pending**
  until the fiber completes in a later tick. The rule does not evaluate the DO clause
  while the condition is pending.

- **Truthy resolution.** When the condition fiber completes and the return value is
  truthy, the rule proceeds to evaluate the DO clause.

- **Falsy resolution.** When the condition fiber completes and the return value is falsy,
  the rule does not execute the DO clause. The WHEN clause may be re-evaluated on the
  next tick (per normal rule scheduling).

This model means that a sensor does not need to answer "is this condition true right
now?" synchronously. It is free to perform async work if needed. In practice, most
sensors will complete immediately, but the runtime imposes no restriction.

**Debugger mapping.** In the debugger, each fiber is a DAP thread (see
[debugger spec, section 8](vscode-authoring-debugging.md#8-debug-target-and-thread-model)).
When a user-authored function is executing inside a fiber, its stack frames appear in the
fiber's call stack alongside any tile-compiled frames that invoked it via HOST_CALL.

### Per-instance state

This spec uses the term **callsite-persistent top-level state** for variables declared
at the top level of a user's source file. These variables persist across fiber lifetimes
(surviving between ticks) and are scoped per callsite (each usage of the tile in a brain
rule gets independent state). The opcodes are `LOAD_CALLSITE_VAR` /
`STORE_CALLSITE_VAR` and the runtime storage is the `callsiteVars` array on the `Fiber`.
The debugger spec presents these as "Callsite State" in the DAP Scopes pane.

User-authored code has two scopes of variable storage:

- **Frame-local variables** (`LOAD_LOCAL` / `STORE_LOCAL`) live on the fiber's frame.
  They survive across await points because the fiber preserves its full execution state,
  but they are lost when the fiber completes or is cancelled.
- **Callsite-persistent top-level variables** (`LOAD_CALLSITE_VAR` /
  `STORE_CALLSITE_VAR`) persist across ticks and across fiber lifetimes. These are the
  right place for state that must survive between invocations -- cooldown timers,
  remembered targets, accumulated counts, etc.

#### Per-callsite scoping

Callsite-persistent top-level variables are **distinct per callsite**, not per module. If
the same user-authored sensor is used as a tile in two different rules (or twice in the
same rule), each usage gets its own independent copy of the variables. This matches
how built-in sensors work: the `Timeout` sensor stores `{ fireTime, lastTick }` via
`getCallSiteState()` / `setCallSiteState()`, and each callsite has independent state.

Note the distinction between the three variable scopes:

| Scope               | Opcodes                                    | Lifetime               | Sharing                           |
| ------------------- | ------------------------------------------ | ---------------------- | --------------------------------- |
| Frame-local         | `LOAD_LOCAL` / `STORE_LOCAL`               | Single fiber execution | None -- private to the call frame |
| Callsite-persistent | `LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR` | Persists across ticks  | Independent per callsite          |
| Brain               | `LOAD_VAR` / `STORE_VAR`                   | Persists across ticks  | Shared across all rules           |

Brain variables (`LOAD_VAR` / `STORE_VAR`) are visible to all rules in the brain and
correspond to variables the user creates in the tile editor. Callsite-persistent
variables are invisible outside their callsite -- they are implementation-private state
of a particular sensor/actuator invocation.

Callsite-persistent top-level variables correspond to top-level `let` / `const`
declarations in the user's source file. From the user's perspective they are ordinary
module globals:

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

#### VM support: LOAD_CALLSITE_VAR / STORE_CALLSITE_VAR

Two new opcodes:

| Opcode               | Operands     | Behavior                                                   |
| -------------------- | ------------ | ---------------------------------------------------------- |
| `LOAD_CALLSITE_VAR`  | a = varIndex | Push `callsiteVars[varIndex]` onto stack                   |
| `STORE_CALLSITE_VAR` | a = varIndex | Pop value from stack and store in `callsiteVars[varIndex]` |

The `callsiteVars` storage is a `List<Value>` allocated **per callsite**. The size is
known at compile time (the compiler counts the number of callsite-persistent top-level
variables in the source file). Each callsite that uses the user-authored sensor/actuator
gets its own independent `callsiteVars` array.

The `callsiteVars` reference is stored on the `Fiber` (not on `ExecutionContext`,
because `ExecutionContext` is shared across all fibers in a brain -- two concurrent
user-authored fibers from different callsites need different var arrays). The backing
`List<Value>` is persisted in call-site state so it survives fiber destruction.

This piggybacks on the existing call-site state mechanism. Built-in sensors already
store per-callsite state via `getCallSiteState()` / `setCallSiteState()` keyed by
`callSiteId`. For user-authored code, the `callsiteVars` array is stored as the
call-site state for that callsite:

```
HOST_CALL_ASYNC (user-authored tile, callSiteId = N)
  -> look up callSiteState[N]
  -> if absent, allocate List<Value> of length callsiteVarCount and run init function
  -> store callsiteVars in callSiteState[N]
  -> spawn fiber for user bytecode
  -> attach callsiteVars to the spawned Fiber
  -> LOAD_CALLSITE_VAR / STORE_CALLSITE_VAR index into fiber.callsiteVars
```

(Updated 2026-03-21: On first allocation, Phase 8 runs only the module init function
(`linkedInitFuncId`) -- not the full `onPageEntered` wrapper. This matches native
built-in tile behavior where `onPageEntered` is a page-entry lifecycle event, not a
construction-time concern. The linker now remaps `initFuncId` into
`linkedInitFuncId` on `UserTileLinkInfo`.)

The `callsiteVars` reference is attached to the `Fiber` before executing the user's
bytecode. When the fiber runs `LOAD_CALLSITE_VAR(i)`, the VM reads
`fiber.callsiteVars[i]`. When it runs `STORE_CALLSITE_VAR(i)`, it writes
`fiber.callsiteVars[i]`. Because the backing `List<Value>` is stored in call-site
state (not on the fiber), it survives fiber destruction and persists across ticks.

#### Callsite-persistent variable initialization

Callsite-persistent variable initializers (e.g., `let lastFireTime = 0`) compile to a
compiler-generated **module init function**. This function evaluates initializer
expressions in source order and stores results via `STORE_CALLSITE_VAR`.

The module init function runs:

1. **On first allocation** -- when a callsite's `callsiteVars` array is created for the
   first time (the callsite has never been invoked before).
2. **On every page entry** -- via the generated `onPageEntered` wrapper (see
   "Compiler-generated functions" below), resetting callsite-persistent state to
   initial values. This matches how built-in sensors reset their call-site state in
   `onPageEntered`.

If the descriptor also includes an authored `onPageEntered` method, the generated
wrapper calls the module init first (to reset state), then calls the user's
`onPageEntered` body. The user function runs with freshly-reset `callsiteVars`. If no
authored `onPageEntered` exists, the wrapper calls only the module init.
(Updated 2026-03-21: `onPageEntered` is a method on the descriptor object, not a
file-level named export. See the updated source shape at the top of this section.)

This means top-level initializers always re-run on page entry. Authors who want to
perform additional setup (clearing external state, logging, etc.) declare
`onPageEntered` as a method on the descriptor object.

#### Helper function state access

Helper functions declared in the same file as the `exec` entry point share access to
the callsite-persistent top-level state of their containing module. State access is
resolved **lexically** -- a helper function that references a top-level variable compiles
to the same `LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR` instructions as the `exec`
function itself. No new state instances are created when a helper is called.

The same rule applies to `onPageEntered` when declared as a method on the descriptor
object: it is compiled as a regular user-authored function in the same file, and its
references to top-level variables resolve against the same callsite-persistent state
instance.
(Updated 2026-03-21: `onPageEntered` is a descriptor method, not a named export.)

```typescript
let hitCount = 0; // callsite-persistent (STORE_CALLSITE_VAR index 0)

function incrementHits(): void {
  hitCount += 1; // LOAD_CALLSITE_VAR 0, add 1, STORE_CALLSITE_VAR 0
}

export default Sensor({
  name: "hit-tracker",
  output: "number",
  onExecute(ctx: Context): number {
    incrementHits(); // CALL -- shares the same callsiteVars array
    return hitCount; // LOAD_CALLSITE_VAR 0
  },
  onPageEntered(ctx: Context): void {
    // Module init already reset hitCount to 0 before this runs.
    // Additional setup could go here.
  },
});
```

In the compiled bytecode, `incrementHits` and `onPageEntered` are separate
`FunctionBytecode` entries invoked via CALL. They run in new frames on the same fiber,
and the `callsiteVars` array is attached to the `Fiber`, not to the frame. All
frames within the same fiber invocation read and write the same `callsiteVars`. This is
the standard behavior for module-level variables in any language with module scope.

The semantic rule: **`onExecute`, `onPageEntered`, and all helper functions in the same
source file resolve top-level bindings against the same callsite-persistent state
instance for that tile usage.** No function in the file gets a separate copy of
`callsiteVars`.

Helper functions do not get their own callsite-persistent state. Only top-level
declarations in the source file produce `callsiteVars` slots.

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

- **On page enter:** The generated `onPageEntered` wrapper runs the module init function
  (resetting callsite-persistent state), then calls the user's authored `onPageEntered`
  function if one exists. The wrapper is registered as the `BrainFunctionEntry`'s
  `onPageEntered` hook and dispatches into compiled bytecode -- it is not an inline JS
  callback.
- **On page exit:** Fibers spawned by user code are cancelled when the page deactivates,
  same as built-in fibers.
- **Per tick:** Rules containing user sensors/actuators execute their fibers via the
  normal scheduler. Budget limits apply equally to user code.

### Compiler-generated functions

The compiler produces `FunctionBytecode` entries beyond the user's explicitly declared
functions. Each generated function has `isGenerated: true` in its `DebugFunctionInfo`.

| Generated function      | Purpose                                                         | Has debug spans | Breakpoint target (v1) | Appears in stack traces                                   |
| ----------------------- | --------------------------------------------------------------- | --------------- | ---------------------- | --------------------------------------------------------- |
| Module init             | Evaluates top-level variable initializers                       | Yes             | No                     | Yes (with `isGenerated` flag, displayed as subtle/dimmed) |
| `onPageEntered` wrapper | Calls module init, then authored `onPageEntered` (if it exists) | No              | No                     | Yes (with `isGenerated` flag)                             |

**Module init function:** Compiled from top-level `let`/`const` initializer expressions.
Runs on first callsite allocation and again on every page entry. Contains
`STORE_CALLSITE_VAR` instructions for each declared top-level variable. The compiler
emits debug spans for the initializer expressions so that stack traces through the init
function show meaningful source locations. However, the init function is not a valid
breakpoint target in v1 -- users cannot set breakpoints on top-level initializer lines.

**`onPageEntered` wrapper:** Always generated, regardless of whether the user declares
an authored `onPageEntered`. The wrapper is a small generated function that:

1. Calls the module init function (resets all callsite-persistent variables to their
   declared initial values).
2. If the user's file exports `onPageEntered`, calls it. The user's function runs with
   freshly-reset `callsiteVars`, so it can perform additional setup or override
   specific variable values.

The authored `onPageEntered` (if present) is a regular user-authored `FunctionBytecode`
entry -- it is **not** generated. It is a valid breakpoint target and appears in stack
traces with its authored name, not dimmed.

Generated functions are always included in stack traces but marked with `isGenerated: true`
in the debug metadata. The debugger presents them as subtle/dimmed frames (see
[debugger spec, section 12](vscode-authoring-debugging.md#12-stack-scopes-and-variable-inspection)).
Step-into on a CALL to a generated function behaves normally -- the debugger enters the
function. Step-over skips past it.

### Integration with tile system

(Updated 2026-03-20: expanded with callDef construction, tileId naming, and anonymous
param auto-registration.)

User-authored sensors and actuators follow a **three-step registration flow**: ensure
parameter tile defs exist, register the function entry, then register the tile def.

#### TileId naming convention

All user-authored tile IDs use a `user.` prefix to avoid collisions with core and
app-defined tiles:

| Concept                | Value                                       |
| ---------------------- | ------------------------------------------- |
| User's `name`          | `"chase"`                                   |
| Internal actuator ID   | `"user.actuator.chase"`                     |
| Function registry name | `"user.actuator.chase"`                     |
| Actuator tileId        | `"tile.actuator->user.actuator.chase"`      |
| Named param `speed`    | `"user.chase.speed"`                        |
| Named param tileId     | `"tile.parameter->user.chase.speed"`        |
| Anon param `target`    | `"anon.actorRef"` (shared, not tile-scoped) |
| Anon param tileId      | `"tile.parameter->anon.actorRef"`           |

Sensors use the `user.sensor.<name>` prefix (e.g., `user.sensor.chase`). Actuators
use `user.actuator.<name>`. This avoids collisions if a sensor and actuator share
the same user-given name. Named params remain scoped by the bare tile name
(`user.<tileName>.<paramName>`) since params are unique within a tile.

(Updated 2026-03-21: table updated to use `user.sensor.<name>` /
`user.actuator.<name>` convention matching Phase 8 implementation.)

The `user.` prefix is applied automatically by the registration bridge. The user
never writes it.

#### Step 0 -- Ensure parameter tile defs exist

For each param declared in the descriptor:

- **Named params:** Register a new `BrainTileParameterDef` scoped to this tile:

  ```typescript
  const typeId = resolveTypeId(p.type); // "number" -> CoreTypeIds.Number, etc.
  tiles.registerTileDef(
    new BrainTileParameterDef(`user.${tileName}.${p.name}`, typeId, {
      visual: { label: p.name },
    }),
  );
  ```

- **Anonymous params:** Check if a shared `anon.<type>` tile def already exists.
  If not, create it on the fly:
  ```typescript
  const anonId = `anon.${p.type}`;
  const tileId = mkParameterTileId(anonId);
  if (!tiles.has(tileId)) {
    tiles.registerTileDef(new BrainTileParameterDef(anonId, resolveTypeId(p.type), { hidden: true }));
  }
  ```
  This removes ordering dependencies -- the user tile does not need to know whether
  the app pre-registered anonymous tile defs for a given type. Novel anonymous param
  types work as long as the type can be resolved to a `TypeId`.

#### Step 1 -- Register in `FunctionRegistry`

The compiled user program produces a `BrainFunctionEntry` whose `exec` function
dispatches into the VM instead of running native TypeScript. This entry is registered
via `getBrainServices().functions.register()` with the `BrainActionCallDef` from the
compiled program:

```typescript
const { functions, tiles } = getBrainServices();
const userId = `user.${userProgram.name}`;

const fnEntry = functions.register(
  userId,
  true, // always async -- unified invocation model
  {
    onPageEntered: (ctx) => vmDispatchPageEnter(userProgram, ctx),
    exec: (ctx, args, handleId) => vmDispatch(userProgram, ctx, args, handleId),
  },
  userProgram.callDef,
);
```

This is identical to how the sim app registers built-in sensors/actuators (e.g.,
`fns.register(fnBump.tileId, fnBump.isAsync, fnBump.fn, fnBump.callDef)`). The only
difference is that `exec` dispatches into user bytecode rather than calling native code.
All user-authored tiles register as async (`isAsync: true`) and use a single `vmDispatch`
function. If the user's code completes without hitting any AWAIT instruction, the handle
resolves immediately within the same tick.

#### Step 2 -- Add to `TileCatalog`

A `BrainTileSensorDef` or `BrainTileActuatorDef` is created from the
`BrainFunctionEntry` and added to the catalog via `tiles.registerTileDef()`:

```typescript
if (userProgram.kind === "sensor") {
  tiles.registerTileDef(
    new BrainTileSensorDef(userId, fnEntry, userProgram.outputType, {
      visual: userProgram.visual,
    }),
  );
} else {
  tiles.registerTileDef(
    new BrainTileActuatorDef(userId, fnEntry, {
      visual: userProgram.visual,
    }),
  );
}
```

This mirrors how the sim app creates tile definitions (e.g.,
`new BrainTileSensorDef(fnDef.tileId, fn, fnDef.returnType, { visual: fnDef.visual })`).

After all three steps, the user-authored tile is indistinguishable from a built-in one
in the catalog. The brain compiler discovers it the same way it discovers built-in tiles:
by looking up tile defs from the catalogs passed to `compileBrain()`. The rule compiler
emits `HOST_CALL` / `HOST_CALL_ASYNC` with the `fnEntry.id`, and the VM dispatches to
the registered exec function -- which happens to run user bytecode.

The user sees their custom sensor/actuator as a tile alongside built-in ones.

### Revision and recompilation semantics

Each successful compilation produces a new `UserAuthoredProgram` with a unique
`programRevisionId`. The revision ID changes on every successful compile, regardless of
whether the source changed semantically.

**What happens after a successful compile:**

1. The new `UserAuthoredProgram` (bytecode + debug metadata) replaces the previous
   version in the world/project store.
2. The registered `BrainFunctionEntry` is updated: its `exec` closure now dispatches
   into the new bytecode.
3. VMs that have **not yet loaded** the function entry will pick up the new bytecode
   on the next HOST_CALL to that sensor/actuator.
4. VMs that have already loaded the old bytecode into a running fiber continue executing
   the old code until that fiber completes or is cancelled. There is no in-flight
   bytecode replacement.
5. Callsite-persistent state (`callsiteVars`) is **not** automatically cleared on
   recompilation. If the new revision changes the number or meaning of callsite-persistent
   variables, the init function runs on the next page entry to re-initialize them. Between recompile
   and page re-entry, stale state may be read by the new bytecode -- this is acceptable
   for v1 because the typical workflow is recompile-then-restart.

**Interaction with the debugger:**

If a debug session is active when recompilation occurs, the policy is
**detach on recompile**: the debug adapter detaches the current session, then
re-attaches using the new revision's debug metadata. Breakpoints are re-resolved
against the new metadata using original requested source lines. See
[debugger spec, section 11](vscode-authoring-debugging.md#11-breakpoint-semantics)
for the full recompilation-during-debug lifecycle.

There is no hot reload in v1. The detach-reattach cycle ensures the debug session
always refers to the currently compiled bytecode and metadata.

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

(Updated 2026-03-24: The ambient declarations below show the full design-intent
interface. The current implementation generates these interfaces dynamically from
the type registry via `buildAmbientDeclarations()`. As of now, SelfContext has
`getVariable` and `setVariable` registered as struct methods; `switchPage`,
`restartPage`, `currentPageId`, and `previousPageId` are planned but not yet
registered. Context fields (`time`, `dt`, `tick`, `self`, `engine`) are registered
as struct fields with a fieldGetter.)

```typescript
// Generated dynamically by buildAmbientDeclarations() from the type registry
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

(Updated 2026-03-24: Host apps no longer provide a separate ambient declaration file.
Instead, they register methods on EngineContext via `addStructMethods()` and register
corresponding host functions via `functions.register()`. The ambient declarations are
generated dynamically from the type registry. The example below shows the design-intent
API surface for the sim app, which would be generated from registered struct methods.)

Each host app declares its engine-specific capabilities by registering struct methods
and host functions. For example, the sim app would register:

```typescript
// In the sim app's brain initialization
types.addStructMethods(ContextTypeIds.EngineContext, List.from([
  { name: "queryNearby", params: List.from([...]), returnTypeId: entityListTypeId },
  { name: "moveToward", params: List.from([...]), returnTypeId: CoreTypeIds.Void, isAsync: true },
  { name: "getPosition", params: List.empty(), returnTypeId: positionTypeId },
  { name: "queryEntities", params: List.from([...]), returnTypeId: entityListTypeId },
]));

// Each method also needs a corresponding host function registration:
functions.register("EngineContext.queryNearby", false, { exec: ... }, callDef);
functions.register("EngineContext.moveToward", true, { exec: ... }, callDef);
// etc.
```

This produces the following generated ambient declarations:

```typescript
// Generated by buildAmbientDeclarations() -- not a static file
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

(Updated 2026-03-24: Ambient declarations are now generated dynamically from the type
registry, not maintained as static `.d.ts` files. `buildAmbientDeclarations()` in
`packages/typescript/src/compiler/ambient.ts` iterates over all registered types --
including Context, SelfContext, EngineContext -- and generates TypeScript interfaces
with fields and method signatures. Native-backed structs get branded readonly
interfaces. Host apps register their EngineContext methods via `addStructMethods()`
before calling `buildAmbientDeclarations()`, so the generated ambient automatically
includes all engine-specific methods.)

The TypeScript program is created with the generated ambient declarations as a virtual
file. The TypeScript checker validates user code against the combined API surface. If
user code calls `ctx.engine.queryNearby(...)`, the checker verifies that `queryNearby`
exists on `EngineContext` and that the arguments match. Host apps can also pass
additional `ambientSource` via `CompileOptions` for app-specific type augmentations.

### How this works at runtime

(Updated 2026-03-24: revised to reflect the ctx-as-native-struct implementation.
Context, SelfContext, and EngineContext are native-backed structs registered in
`packages/core/src/brain/runtime/context-types.ts`. The compile-time phantom approach
described in earlier drafts has been removed.)

Context, SelfContext, and EngineContext are **native-backed structs** registered in the
core type system via `registerContextTypes()`. Each has a `fieldGetter` that extracts
values from the underlying `ExecutionContext` at runtime. The ctx parameter is passed to
`onExecute` as a real `StructValue` argument (local slot 0).

**Property access** on Context uses `GET_FIELD`, the same opcode used for any struct:

```
ctx.time          -> LoadLocal(0); GetField("time")    // fieldGetter returns mkNumberValue(execCtx.time)
ctx.self          -> LoadLocal(0); GetField("self")    // fieldGetter returns mkNativeStructValue(SelfContext, execCtx)
ctx.self.position -> LoadLocal(0); GetField("self"); GetField("position")
```

**Method calls** on context structs use the general-purpose struct method dispatch.
Methods are declared via `StructMethodDecl` on the struct type and registered as host
functions using the `"TypeName.methodName"` naming convention. The compiler's
`lowerStructMethodCall()` resolves the receiver's struct type, looks up the method in
the type definition's `methods` list, then emits `HOST_CALL_ARGS` with the struct
value as the first argument:

```
ctx.self.getVariable("x")    -> LoadLocal(0); GetField("self"); PushConst("x");
                                 HOST_CALL_ARGS("SelfContext.getVariable", argc=2)
ctx.engine.queryNearby(p, r) -> LoadLocal(0); GetField("engine"); <push p>; <push r>;
                                 HOST_CALL_ARGS("EngineContext.queryNearby", argc=3)
```

Host apps register their engine methods as struct methods via `addStructMethods()` and
as host functions using the `"TypeName.methodName"` convention:

```typescript
// In the sim app's brain initialization
const { types, functions } = getBrainServices();

types.addStructMethods(
  ContextTypeIds.EngineContext,
  List.from([
    {
      name: "queryNearby",
      params: List.from([
        { name: "position", typeId: positionTypeId },
        { name: "range", typeId: CoreTypeIds.Number },
      ]),
      returnTypeId: entityListTypeId,
    },
  ]),
);

functions.register(
  "EngineContext.queryNearby",
  false,
  {
    exec: (_ctx, args) => {
      const engineStruct = args.v.get(0) as StructValue;
      const execCtx = engineStruct.native as ExecutionContext;
      const pos = args.v.get(1) as StructValue;
      const range = (args.v.get(2) as NumberValue).v;
      return mkListValue(
        entityListTypeId,
        execCtx.data.engine.queryNearby(toWorldPos(pos), range).map((e) => mkEntityStruct(e)),
      );
    },
  },
  mkCallDef(seq(param("position"), param("range"))),
);
```

### Boundary between common and engine-specific

| Layer            | Scope        | Examples                                     | Registration                                     |
| ---------------- | ------------ | -------------------------------------------- | ------------------------------------------------ |
| Common Mindcraft | All hosts    | time, dt, tick, self.getVariable, switchPage | Core package via `registerContextTypes()`        |
| Engine context   | Per host app | queryNearby, moveToward, getPosition         | Host app via `addStructMethods()` + `register()` |

The common layer is registered by `registerContextTypes()` in
`packages/core/src/brain/runtime/context-types.ts`. This registers Context, SelfContext,
and EngineContext as native-backed structs with fieldGetters. SelfContext methods
(`getVariable`, `setVariable`) are registered as host functions using the
`"SelfContext.methodName"` naming convention.

Engine methods are registered by the host app via two steps: (1) call
`types.addStructMethods()` to declare the method signatures on EngineContext (so the
compiler generates ambient type declarations), and (2) call `functions.register()` to
register the host function implementation using the `"EngineContext.methodName"` naming
convention.

### Sandboxing

User code can only access capabilities exposed through registered host functions. The
compiler validates at compile time that all accessed methods exist in the ambient type
declarations. At runtime, the VM can only execute HOST_CALL instructions with registered
function IDs. There is no mechanism for user bytecode to access arbitrary native objects,
call arbitrary functions, or escape the VM sandbox.

The `ctx.data` pattern (where `ExecutionContext.data` holds the native engine entity) is
invisible to user code. User code sees typed `Context` / `SelfContext` / `EngineContext`
methods and fields. The fieldGetters and host function implementations unwrap the
`ExecutionContext` from the struct's `native` backing internally.

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
| Function declarations     | Named functions, arrow functions (including closures)                 |
| Function calls            | Direct calls and indirect calls via function references               |
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
| `typeof`                  | Returns string, implemented via `TYPE_CHECK` opcode                   |

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

(Updated 2026-03-23: "Closures (capturing)" removed from this table. Closures with
capture-by-value semantics are now fully implemented via `MAKE_CLOSURE` / `LOAD_CAPTURE`
opcodes (core type system Phase 6). Arrow functions and function expressions that capture
outer scope variables compile correctly. Capture is by value -- mutations to captured
primitives inside the closure are not visible outside, and vice versa.)

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
   - frame-local variables (once `LOAD_LOCAL`/`STORE_LOCAL` are implemented) remain
2. The `AwaitSite` records `resumePc`, `stackHeight`, `frameDepth`, `handleId`
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
fiber's stack (and frame locals, once `LOAD_LOCAL`/`STORE_LOCAL` are implemented). Each
iteration suspends at AWAIT and resumes in the next tick (or whenever the handle
resolves), continuing the loop.

### Cancellation

When a page deactivates, all active fibers are cancelled. This includes fibers spawned
by user-authored tiles (both sensors and actuators). Cancellation transitions the
fiber to CANCELLED state. Any in-progress host async operation should detect cancellation
and clean up.

User code does not need explicit cancellation handling in v1. The VM handles it
automatically. In a future phase, we could support a `ctx.cancellationToken` or
`AbortSignal`-like pattern for cooperative cancellation within user code.

### Unified invocation model for sensors and actuators

Both sensors and actuators follow the same async invocation model. Every user-authored
tile invocation spawns a fiber, returns a handle, and the calling rule fiber suspends at
AWAIT until the handle resolves. There is no distinction between sensor and actuator
execution at the runtime level.

- A sensor whose `exec` is synchronous (contains no `await`) completes within the current
  tick. The handle resolves immediately and the calling fiber resumes in the same tick.
- A sensor whose `exec` is async (contains `await`) suspends across ticks, just like an
  async actuator would. See "WHEN clause evaluation semantics" in section C for how this
  interacts with condition evaluation.
- An actuator follows the same model -- sync actuators complete immediately, async
  actuators suspend across ticks.

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
- `LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR` VM opcodes for callsite-persistent
  top-level state
- Common Mindcraft context (`ctx.time`, `ctx.dt`, `ctx.self.*`)
- One host app's engine context (sim app as reference implementation)
- Sensors and actuators, sync or async (unified invocation model)
- Bytecode verification on user programs
- Instruction budget limits apply to user code (no special treatment)
- Inline error diagnostics from TypeScript checker and subset validator
- User-authored tiles appear in tile catalog alongside built-in tiles
- `onPageEntered` lifecycle function as named export in the same source file

**Not in scope for Phase 1:**

- Classes, generics, switch, finally, try/catch
- Multi-file authoring
- Importing between user files
- Debugger / step-through
- Hot reload of user code
- Editor autocomplete beyond TypeScript-provided
- Sharing user-authored tiles between brains

**Deliverables:**

1. `ts-compiler.ts` -- orchestrator
2. `ts-validator.ts` -- subset enforcement
3. `ts-descriptor.ts` -- metadata and lifecycle extraction
4. `ts-lowering.ts` -- TS AST -> IR
5. `ir.ts` -- IR types
6. `authored-function.ts` -- VM-dispatch wrapper
7. `mindcraft-ambient.d.ts` -- common API declarations
8. VM extension: `LOAD_LOCAL` / `STORE_LOCAL` opcodes (`Frame.locals`),
   `LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR` opcodes (callsite-persistent
   `callsiteVars` storage on `Fiber`)
9. Test suite covering all supported constructs
10. Sim app integration: engine ambient declarations + host function mappings

### Phase 2: Stronger type system and language ergonomics

**Goal:** Richer language features that make authoring more productive.

(Updated 2026-03-23: closures and source maps for debugging have been removed from this
phase's scope. Closures (capture-by-value) were implemented in core type system Phase 6
and are now available in Phase 1. Source span tracking and debug metadata are tracked in
the typescript-compiler-phased-impl.md Phases 22-25.)

**Scope:**

- Classes (single, no inheritance) -- compile to struct types + function tables
- `switch` statements -- lower to if/else chains
- `enum` declarations -- lower to constant objects
- Default and optional function parameters
- Rest parameters
- `try` / `catch` -- maps to existing TRY/THROW opcodes
- `finally` blocks
- Type narrowing in if/else branches (compiler uses TS checker info)
- Better error messages with source location mapping

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

Callsite-persistent top-level variables (via `LOAD_CALLSITE_VAR` /
`STORE_CALLSITE_VAR`) are scoped per callsite and per file. When multiple files are
compiled into a single `UserAuthoredProgram`, each file's top-level variables get a
contiguous segment within the `callsiteVars` array. The compiler assigns non-overlapping
index ranges so that callsite-persistent variables from different files do not collide.
At runtime, each callsite still gets its own independent `callsiteVars` array containing
all segments.

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

**4. Fiber-per-invocation overhead.**
Every user-authored tile invocation spawns a fiber via the scheduler, even for simple
synchronous sensors. This adds a fiber allocation and scheduling step compared to a
hypothetical inline execution path.

**Mitigation:** If the user's code completes without hitting any AWAIT instruction,
the fiber finishes within the current tick and the handle resolves immediately. The
overhead is a fiber allocation and a scheduler round-trip -- negligible compared to the
cost of executing the user's bytecode. The unified model eliminates the complexity of
a reentrant VM and the risk of bugs from having two distinct execution paths.

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

**Closures are capture-by-value only.** (Updated 2026-03-23: closures are now
implemented via `MAKE_CLOSURE` / `LOAD_CAPTURE` opcodes from core type system Phase 6,
but with capture-by-value semantics only. Captured variables are snapshot at closure
creation time -- mutations inside the closure are not visible outside, and vice versa.
This avoids the complexity of mutable upvalue cells, heap-allocated variable boxes, or
closure-conversion passes that would be needed for capture-by-reference semantics.
The constraint is acceptable because most closure use cases in user-authored code are
callbacks to array methods like `.filter()`, `.map()`, `.forEach()` where captured
values are read-only.)

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

### TypeScript compiler API browser compatibility

The `typescript` npm package's compiler API is designed to work in any JavaScript
environment, but its **default host functions** (`ts.sys`, the default `CompilerHost`)
use Node.js filesystem APIs (`node:fs`, `node:path`). When running the compiler
in the browser, these defaults are unavailable. A custom virtual `CompilerHost` must
be provided that implements `readFile`, `fileExists`, `getSourceFile`,
`getDefaultLibFileName`, and related methods using an in-memory file map. Failure to
do so results in runtime errors or a Node.js-only implementation that cannot ship to
the browser.

Build-time tooling (scripts that generate source modules, bundle lib `.d.ts` content,
etc.) may freely use Node.js APIs. The constraint applies only to code that executes
at authoring time in the browser.

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

---

## Amendments

### 2026-03-23 -- ctx must be a real value, not a compile-time phantom

Phase 13 of the compiler implementation initially treated `ctx` as a compile-time
phantom (no runtime representation; the compiler intercepted property accesses and
rewrote them to HOST_CALL_ARGS). This was rejected because ctx cannot behave like a
regular TypeScript value under that approach (no aliasing, no storage, no passing to
functions). The spec's own section E ("Property access") describes `LoadLocal(ctx_index)`
followed by `GetField("self")` -- i.e., ctx as a real stack value.

The accepted direction is to make ctx a native-backed struct (same pattern as ActorRef
in apps/sim). See [ctx-as-native-struct.md](ctx-as-native-struct.md) for the full
design. This also requires a new general-purpose struct method dispatch feature in the
compiler for `ctx.self.getVariable(...)` etc.
