# User-Authored Sensors and Actuators

Design spec for compiling user-authored TypeScript into Mindcraft bytecode,
enabling custom Sensors and Actuators that execute inside the Mindcraft VM.

## Status

As of 2026-04-03, the authoring surface, TypeScript front-end guidance, and
debug-metadata discussion in this document remain useful. The wrapper-based
runtime design that routed user tiles through `BrainFunctionEntry`,
`FunctionRegistry`, `UserTileLinkInfo`, and `createUserTileExec()` is obsolete.

Current execution semantics are defined by
[brain-action-execution-architecture.md](brain-action-execution-architecture.md)
and its phased implementation plan. User-authored tiles now compile to direct
bytecode action artifacts that are linked into Brain-local executable action
tables through the explicit compile -> link -> instantiate path.

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

2. **VM alignment.** The runtime treats sensors and actuators as action
  descriptors plus executable bindings. User-authored code should therefore
  compile to a direct action artifact with a callable entry point and declared
  call signature, not to a special-purpose wrapper runtime.

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

export default Sensor({
  name: "nearby-enemy",
  output: "boolean",
  params: {
    range: { type: "number", default: 5 },
  },
  onExecute(ctx: Context, params: { range: number }): boolean {
    const enemies = ctx.engine.queryNearby(ctx.self.position, params.range);
    if (enemies.length > 0) {
      lastSeen = ctx.time;
    }
    return enemies.length > 0;
  },
  onPageEntered(ctx: Context): void {
    lastSeen = 0;
  },
});
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
  async onExecute(ctx: Context, params: { speed: number }): Promise<void> {
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

- **Single default export.** One sensor or actuator per file. The compiler knows
  exactly what to compile. Multi-file support is available for importing helpers.
- **Declarative metadata.** `name`, `output`, `params` are statically analyzable. The
  compiler reads them at compile time to generate `BrainActionCallDef` and tile
  registration data. Each named param becomes a `param()` arg spec scoped to the
  tile (`user.<tileName>.<paramName>`). Each anonymous param reuses a shared
  `anon.<type>` tile def, auto-registering one if it does not already exist.
- **`onExecute` is the entrypoint.** Compiles to the primary `FunctionBytecode`. Parameters
  are derived from the `params` descriptor.
- **`ctx` is the injected context.** Not a global. Not an import. It is a function
  parameter whose type is known at compile time. At runtime, ctx is a native-backed
  `StructValue` wrapping the `ExecutionContext`, occupying local slot 0. The VM
  automatically creates this struct via `injectCtxTypeId` on the entry function's
  `FunctionBytecode` -- the caller passes only the `MapValue` args.
- **`async onExecute` compiles to HOST_CALL_ASYNC + AWAIT.** The compiler detects `async` on
  `onExecute` and emits async bytecode. Both sensors and actuators may be sync or async.
  The runtime uses one unified invocation model regardless (see section C).
- **Helper functions are allowed.** Users can define local functions within the file. These
  compile to additional `FunctionBytecode` entries invoked via CALL.
- **`onPageEntered` is part of the descriptor.** If present, it is a lifecycle method
  on the descriptor object, sharing the same lexical scope and callsite-persistent
  state as `onExecute` and helpers.
- **Classes are supported.** Users can define classes with constructors, methods, and
  fields. Classes compile to struct-backed types with qualified method names. No
  inheritance is supported.
- **No class instantiation needed for the descriptor.** `Sensor()` and `Actuator()` are
  compile-time markers, not runtime constructors. They do not exist at bytecode level.

### Why this shape scales

Multi-file support is already implemented. A user file can import helper functions,
variables, and classes from other user files. The compiler resolves those imports at
compile time via the TypeScript checker and links the `FunctionBytecode` entries.
No runtime module system is needed.

When parameter types become richer (enums, structs, lists), the `params` descriptor
extends naturally without changing the authoring pattern.

#### Params descriptor shape

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
| `target` | `param("anon.ActorRef", { anonymous: true })` | Reuses or auto-creates `BrainTileParameterDef("anon.ActorRef")` |
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

After extraction, a callDef construction step converts
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

The IR is a linear sequence of typed operations, not a tree. This keeps it close to
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
  | LoadCallsiteVar(index: number)    // callsite-persistent top-level variable
  | StoreCallsiteVar(index: number)
  | Return
  | Call(funcIndex: number, argc: number)
  | CallIndirect(argc: number)        // pop FunctionValue, call by funcId
  | CallIndirectArgs(argc: number)    // same, but args passed as MapValue
  | PushFunctionRef(funcName: string) // push FunctionValue for named function
  | MakeClosure(funcName: string, captureCount: number) // create closure
  | LoadCapture(index: number)        // load captured variable in closure
  | HostCallArgs(fnName: string, argc: number)      // sync host call
  | HostCallArgsAsync(fnName: string, argc: number) // async host call
  | Await
  | GetField(fieldName: string)       // generic field access (structs + native-backed)
  | GetFieldDynamic                    // field name at runtime (top of stack)
  | MapNew(typeId: string)
  | MapGet | MapSet
  | StructNew(typeId: string)
  | StructSet
  | StructCopyExcept(numExclude: number, typeId: string) // struct spread
  | ListNew(typeId: string)
  | ListPush | ListGet | ListSet | ListLen
  | ListPop | ListShift | ListRemove | ListInsert | ListSwap
  | TypeCheck(nativeType: number)      // typeof lowering (Op.TYPE_CHECK)
  | Label(labelId: number)
  | Jump(labelId: number)
  | JumpIfFalse(labelId: number)
  | JumpIfTrue(labelId: number)
```

The `StructNew(typeId)` parameter is a constant pool index pointing to a string value
(the typeId string, e.g., `"struct:<Vector2>"`), not a numeric type identifier. The VM
reads `ins.a` as `numFields` (0 for the "create empty then set fields" pattern used
by the compiler) and `ins.b` as the constant pool index for the typeId string.

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

`continue` in a for-loop targets the update expression (`continue_target`), not
`loop_start`. This ensures the incrementor runs before the next condition check,
matching JavaScript semantics. `break` targets `loop_end`.

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

Context methods are dispatched via the general-purpose `lowerStructMethodCall()`
mechanism. The struct value is passed as the first argument.

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

```typescript
// typeof x === "number"
// ->
LoadLocal(x_index);
TypeCheck; // pushes type string onto stack
PushConst("number");
HostCallArgs(EqualTo, 2);
```

**Async/await:** See section F.

**Class declarations:**

```typescript
// class Vector2 { constructor(public x: number, public y: number) {} mag(): number { ... } }
// const v = new Vector2(3, 4);
// v.mag()
// ->
// Class compiles to:
//   - A struct type registered with the type system (typeId = "struct:<module>::Vector2")
//   - A constructor function (Vector2.constructor) that creates a StructNew and sets fields
//   - Method functions (Vector2.mag) that take `this` as the struct receiver
//
// new Vector2(3, 4):
PushConst(3)
PushConst(4)
Call(constructorFuncIndex, 2)   // returns a StructValue
StoreLocal(v_index)

// v.mag():
LoadLocal(v_index)
Call(magFuncIndex, 1)           // receiver passed as first arg
```

Classes compile to struct-backed types. The constructor function creates a new `StructValue`,
sets fields from constructor parameters, and returns the struct. Methods are compiled as
standalone functions with the receiver struct passed as the first argument. Method dispatch
is resolved at compile time using qualified names (`ClassName.methodName` or
`module::ClassName.methodName` for imported classes). No inheritance, no prototype chains,
no vtables.

**Destructuring:**

```typescript
// const { x, y } = pos;  ->  lower pos, then GetField("x"), StoreLocal; GetField("y"), StoreLocal
// const [a, b] = items;  ->  lower items, then ListGet at index 0, 1, StoreLocal for each
// const { x, ...rest } = obj;  ->  GetField for x, then StructCopyExcept(1, typeId) for rest
// const [first, ...rest] = items;  ->  ListGet for first, then splice-based copy for rest
```

Destructuring is supported for both object and array patterns, including rest elements,
default values, and nested patterns.

### Stage 5: IR Optimization (optional)

For v1, this can be a no-op pass. Future optimizations:

- Constant folding (`1 + 2` -> `3`)
- Dead code elimination (unreachable code after return/throw)
- Redundant load/store elimination
- Inline expansion of trivial helper functions

### Stage 6: Bytecode Emission

Walk the IR and emit bytecode using `BytecodeEmitter`. The emitter has methods
for all opcodes: `pushConst`, `call`, `callIndirect`, `callIndirectArgs`,
`makeClosure`, `loadCapture`, `hostCallArgs`, `hostCallArgsAsync`, `loadLocal`,
`storeLocal`, `loadCallsiteVar`, `storeCallsiteVar`, `typeCheck`, `getField`,
`setField`, `listNew`, `listPush`, `listGet`, `listSet`, `listLen`, `listPop`,
`listShift`, `listRemove`, `listInsert`, `listSwap`, `structNew`, `structSet`,
`structCopyExcept`, `mapNew`, `mapGet`, `mapSet`, and more.

The `emitFunction` call receives a `functionTable` parameter for resolving
`PushFunctionRef` and `MakeClosure` IR nodes (which use function names) to
numeric funcIds.

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
interface UserAuthoredProgram extends UserActionArtifact {
  name: string;
  params: ExtractedParam[];
  debugMetadata?: DebugMetadata;
}
```

The current emitted artifact keeps debug metadata alongside the action-artifact
shape described in
[brain-action-execution-architecture.md](brain-action-execution-architecture.md).
`entryFuncId` and `activationFuncId` remain artifact-local function indexes and
are remapped during the core brain link step. `params` is still stored so the
registration bridge can resolve parameter tile defs without reparsing the
call spec. See `packages/ts-compiler/src/compiler/types.ts` for the current
shape.

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

This program is published as a direct bytecode action artifact. Brain
compilation references its `ActionDescriptor.key`, and the explicit brain link
step resolves that key into an executable action entry before VM
instantiation.

### Stage 8: Bytecode Verification

Run the `BytecodeVerifier` on the assembled program. (The verifier exists today as a
private class in `vm.ts`; it validates instruction operands, jump targets, function
references, and constant pool indices. It may need to be extracted or extended to support
the new opcodes.)

### Where this code lives

The compiler and metadata publication bridge live in the
`@mindcraft-lang/ts-compiler` package, not in `packages/core`. Core must remain
free of TypeScript compiler API dependencies to preserve roblox-ts
compatibility. Core provides the VM, bytecode interfaces, action-descriptor
contracts, and the explicit brain link/runtime path; the TypeScript package
consumes those to compile and publish user action artifacts.

```
packages/ts-compiler/src/
  compiler/
    compile.ts              -- public entry point; re-exports UserTileProject
    project.ts              -- UserTileProject class (multi-file orchestrator)
    validator.ts            -- Stage 2: AST subset validation
    descriptor.ts           -- Stage 3: descriptor + lifecycle extraction
    lowering.ts             -- Stage 4: TS AST -> IR (5000+ lines)
    ir.ts                   -- IR types
    emit.ts                 -- Stage 6: IR -> bytecode emission
    scope.ts                -- lexical scope stack for local variable allocation
    ambient.ts              -- generates ambient declarations from type registry
    types.ts                -- shared compiler types (UserAuthoredProgram, etc.)
    call-def-builder.ts     -- builds BrainActionCallDef from ExtractedParam[]
    virtual-host.ts         -- in-memory ts.CompilerHost
    diag-codes.ts           -- all diagnostic code enums
  runtime/
    registration-bridge.ts  -- publishes tile metadata + direct bytecode action artifacts
```

Final brain linking and executable-action materialization now happen in core's
brain link step and the sim's resolver-backed runtime wiring, not in a
TypeScript-side VM wrapper.

The ambient declarations are generated dynamically from the type registry via
`buildAmbientDeclarations()` rather than maintained as a static `.d.ts` file.

### Linking user-authored bytecode into the brain program

The VM has one `Program` with a flat `functions: List<FunctionBytecode>`. The `CALL`
opcode indexes into `Program.functions`. A `UserAuthoredProgram` has its own `functions`
list with funcIds starting at 0. These two function ID spaces must be unified for the
single-VM model to work. (HOST_CALL IDs are a separate namespace -- global
FunctionRegistry -- and have no conflict.)

The linking step is now part of the brain-runtime compile -> link -> instantiate
pipeline. After `compileBrain()` produces the unlinked brain program, the link
step:

1. resolves each referenced `ActionDescriptor.key` to either a host-backed or
  bytecode-backed action artifact
2. merges bytecode action functions and constants into the executable brain
  program when needed
3. remaps artifact-local `entryFuncId` and `activationFuncId` values into the
  final executable program layout
4. materializes executable action entries for `ACTION_CALL` /
  `ACTION_CALL_ASYNC` dispatch

The resulting executable brain program is then instantiated by the VM. User
actions are not invoked through a `HOST_CALL` wrapper path anymore.

The linker is ~100 lines: iterate user programs, compute offset, copy+remap
bytecode instructions, merge constants. It lives in `@mindcraft-lang/ts-compiler`, not
in core. Core provides no linking API -- the linker manipulates `List<>` contents on
the `BrainProgram` before passing it to the VM constructor.

---

## C. Runtime Model

The active runtime model is the resolver-based action architecture described in
[brain-action-execution-architecture.md](brain-action-execution-architecture.md)
and implemented by the phased plan in
[brain-action-execution-phased-impl.md](brain-action-execution-phased-impl.md).

In the current design:

1. A user-authored tile compiles to a direct bytecode action artifact with
   artifact-local `entryFuncId`, optional `activationFuncId`, `numStateSlots`,
   `isAsync`, and debug metadata.
2. Publication registers tile metadata in `TileCatalog`, registers any needed
   parameter tiles, and publishes a direct bytecode action artifact to the
   action registry. No user tile is registered in `FunctionRegistry`, and no
   VM-capturing host wrapper is created.
3. Brain compilation interns `ActionDescriptor.key` values. The explicit brain
   link step resolves those keys to host-backed or bytecode-backed actions and
   materializes the executable action table before VM instantiation.
4. `ACTION_CALL` executes sync bytecode-backed actions on the current fiber.
   `ACTION_CALL_ASYNC` executes async bytecode-backed actions on child fibers.
   Page activation, activation hooks, and persistent state bind through the
   action-instance model rather than through wrapper-managed fiber globals.
5. Live recompilation updates the user action artifact registry, keeps the last
   successful artifact on compile failure, and recreates only the active Brain
   instances whose linked action revisions are stale.

Use the architecture spec for detailed runtime semantics. This document's
remaining sections focus on authoring, compiler lowering, debug metadata, and
the TypeScript surface area rather than the superseded wrapper runtime.

### Integration with tile system

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
| Anon param `target`    | `"anon.ActorRef"` (shared, not tile-scoped) |
| Anon param tileId      | `"tile.parameter->anon.ActorRef"`           |

Sensors use the `user.sensor.<name>` prefix (e.g., `user.sensor.chase`). Actuators
use `user.actuator.<name>`. This avoids collisions if a sensor and actuator share
the same user-given name. Named params remain scoped by the bare tile name
(`user.<tileName>.<paramName>`) since params are unique within a tile.

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

#### Step 1 -- Publish metadata and the action artifact

Successful compilation now publishes a `UserAuthoredProgram` as two linked
pieces of data:

1. tile metadata for `TileCatalog`
2. a direct bytecode action artifact for the sim's action registry

`packages/ts-compiler/src/runtime/registration-bridge.ts` builds an
`ActionDescriptor`, registers any needed parameter tiles, and publishes a
`BytecodeResolvedAction` to the brain action registry. No user-authored tile is
registered in `FunctionRegistry`, and no VM-capturing host wrapper is created.

#### Step 2 -- Resolve through the brain link step

The tile catalog exposes the `ActionDescriptor` to the parser, typechecker, and
compiler. Brain compilation interns `ActionDescriptor.key`, the explicit brain
link step resolves that key to either a host-backed or bytecode-backed action,
and runtime dispatch executes through the executable action table described in
[brain-action-execution-architecture.md](brain-action-execution-architecture.md).

### Revision and recompilation semantics

Each successful compilation produces a new `UserAuthoredProgram` with a
compiler-emitted `revisionId`, but the sim derives a deterministic content-based
revision before deciding whether active brains need rebuild invalidation.

**What happens after a successful compile:**

1. The new `UserAuthoredProgram` (bytecode + debug metadata) replaces the
   previous artifact for that `ActionKey`.
2. The sim updates the tile catalog metadata and the startup metadata cache for
   that tile.
3. Any active Brain whose linked action revisions include the changed key at an
   older revision is recreated from the same `BrainDef` and host object.
4. Active brains whose executable programs do not depend on the changed action
   are left running.
5. Failed recompilation keeps the last successful artifact and currently running
   brains in place.

This is explicit executable-brain invalidation and rebuild, not in-place
mutation of a global host-function entry.

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

The ambient declarations below show the full design-intent interface. The
implementation generates these interfaces dynamically from the type registry via
`buildAmbientDeclarations()`. Currently, SelfContext has `getVariable` and
`setVariable` registered as struct methods; `switchPage`, `restartPage`,
`currentPageId`, and `previousPageId` are planned but not yet registered. Context
fields (`time`, `dt`, `tick`, `self`, `engine`) are registered as struct fields
with a fieldGetter.

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

Host apps register methods on EngineContext via `addStructMethods()` and register
corresponding host functions via `functions.register()`. The ambient declarations are
generated dynamically from the type registry. The example below shows the design-intent
API surface for the sim app, which would be generated from registered struct methods.

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

Ambient declarations are generated dynamically from the type registry, not maintained
as static `.d.ts` files. `buildAmbientDeclarations()` in
`packages/ts-compiler/src/compiler/ambient.ts` iterates over all registered types --
including Context, SelfContext, EngineContext -- and generates TypeScript interfaces
with fields and method signatures. Native-backed structs get branded readonly
interfaces. Host apps register their EngineContext methods via `addStructMethods()`
before calling `buildAmbientDeclarations()`, so the generated ambient automatically
includes all engine-specific methods.

The TypeScript program is created with the generated ambient declarations as a virtual
file. The TypeScript checker validates user code against the combined API surface. If
user code calls `ctx.engine.queryNearby(...)`, the checker verifies that `queryNearby`
exists on `EngineContext` and that the arguments match. Host apps can also pass
additional `ambientSource` via `CompileOptions` for app-specific type augmentations.

### How this works at runtime

Context, SelfContext, and EngineContext are **native-backed structs** registered in the
core type system via `registerContextTypes()` in
`packages/core/src/brain/runtime/context-types.ts`. Each has a `fieldGetter` that
extracts values from the underlying `ExecutionContext` at runtime.

The ctx parameter is injected into `onExecute` via the `injectCtxTypeId` field on the
entry function's `FunctionBytecode`. When the VM spawns a fiber for a function with
`injectCtxTypeId` set, it creates a `StructValue` via
`mkNativeStructValue(fn.injectCtxTypeId, executionContext)` and prepends it to the
fiber's arguments. The user's `onExecute` sees ctx as local slot 0.

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

### Supported

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
| Closures                  | Capture-by-value via `MAKE_CLOSURE` / `LOAD_CAPTURE`                  |
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
| Destructuring             | Object and array patterns with rest elements and defaults             |
| Struct spread             | `{ ...base, x: 1 }` via `STRUCT_COPY_EXCEPT`                         |
| Spread in arrays          | `[...items, newItem]`                                                 |
| `typeof`                  | Returns string, implemented via `TYPE_CHECK` opcode                   |
| Classes (no inheritance)  | Constructor, methods, fields. Compiles to struct-backed types.        |
| `new` expressions         | Class instantiation via constructor functions                         |
| `this` keyword            | Inside class methods, resolves to the struct receiver                 |
| Compound assignment       | `+=`, `-=`, `*=`, `/=`, `%=`, `&&=`, `\|\|=`, `??=`                  |
| Prefix/postfix ops        | `++x`, `x++`, `--x`, `x--`                                           |
| Multi-file imports        | `import { fn } from "./helpers"` resolved at compile time             |
| Array methods             | `push`, `pop`, `shift`, `filter`, `map`, `forEach`, `find`, etc.     |
| String methods            | Via host function dispatch                                            |
| `Math` methods            | `abs`, `floor`, `ceil`, `round`, `sqrt`, `sin`, `cos`, `min`, `max`, `random`, etc. |

### Excluded (feasible later)

| Feature              | Reason                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- |
| `enum`               | Syntax sugar. Can be added as constant objects.                                       |
| Generics             | Type-level complexity. Low priority since types are erased.                           |
| Generators / `yield` | Different from VM YIELD. Complex state machine.                                       |
| `switch`             | Can be lowered to if/else chains.                                                     |
| `for...in`           | Requires reflective property enumeration. Exclude permanently in favor of `for...of`. |
| `finally`            | Requires additional VM support for guaranteed cleanup.                                |
| Regex                | No VM-level regex engine. Long-term host call.                                        |
| Rest parameters      | `...args` -- requires variadic support.                                               |
| Default parameters   | `function f(x = 5)` -- simple desugaring.                                             |
| Optional parameters  | `function f(x?: number)` -- default to nil.                                           |
| `try` / `catch`      | Maps to existing TRY/THROW opcodes but adds complexity.                               |
| Class inheritance     | Requires vtable, prototype chains, constructor chaining.                              |
| Static members        | Not supported in the current class implementation.                                    |
| Private fields        | `#name` syntax not supported.                                                        |
| Getters/setters       | Not supported in classes.                                                             |

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
either requires significant VM extensions (generators), violates sandboxing (eval,
globals), or adds complexity disproportionate to its value (decorators, symbols).

The supported subset is sufficient to write meaningful sensors and actuators: query state,
do arithmetic, make decisions, call host APIs, store results, define classes, import
helpers from other files, and use closures for functional patterns.

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
async function onExecute(ctx: Context, params: { target: Position }): Promise<void> {
  const pos = ctx.engine.getPosition();
  await ctx.engine.moveToward(params.target, 1.0);
  const newPos = ctx.engine.getPosition();
}

// Compiled bytecode (pseudocode):
// func onExecute:
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
async function onExecute(ctx: Context): Promise<void> {
  await ctx.engine.moveToward(target1, 1.0); // AWAIT #1
  await ctx.engine.moveToward(target2, 1.0); // AWAIT #2
  await ctx.engine.moveToward(target3, 1.0); // AWAIT #3
}
```

Each await compiles to HOST_CALL_ASYNC + AWAIT. The fiber suspends and resumes three
times, continuing from exactly where it left off each time.

### Await inside loops

```typescript
async function onExecute(ctx: Context): Promise<void> {
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

### Current state: what is implemented

The compiler and runtime support the following:

- TypeScript subset (section E) including classes, closures, destructuring, multi-file
  imports, array/string/Math methods, compound assignment, prefix/postfix operators
- `Sensor()` / `Actuator()` descriptor API with `onExecute` and `onPageEntered`
- Full compiler pipeline (stages 1-8) including multi-file `UserTileProject`
- `LOAD_LOCAL` / `STORE_LOCAL`, `LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR`,
  `MAKE_CLOSURE` / `LOAD_CAPTURE`, `TYPE_CHECK`, `CALL_INDIRECT` / `CALL_INDIRECT_ARGS`
  VM opcodes
- Common Mindcraft context (`ctx.time`, `ctx.dt`, `ctx.self.*`)
- Engine context (sim app reference implementation)
- Sensors and actuators, sync or async (unified invocation model)
- Instruction budget limits
- Inline error diagnostics from TypeScript checker and subset validator
- User-authored tiles appear in tile catalog alongside built-in tiles
- `onPageEntered` lifecycle function
- Classes (single, no inheritance) compiled to struct types + method functions
- Multi-file authoring with `import` / `export` between user files
- Virtual module resolution via `UserTileProject` and `createVirtualCompilerHost`
- Cross-file symbol resolution and type checking
- Linked bytecode (multiple files -> single `UserAuthoredProgram`)
- Closures (capture-by-value) via `MAKE_CLOSURE` / `LOAD_CAPTURE`
- Bytecode verification on user programs

### Future work

The following are not yet implemented and represent potential future phases:

**Language features:**

- `switch` statements (lower to if/else chains)
- `enum` declarations (lower to constant objects)
- Default and optional function parameters
- Rest parameters
- `try` / `catch` / `finally` (maps to existing TRY/THROW opcodes)
- Type narrowing in if/else branches
- Generics (currently erased by TS checker; no compiler support needed unless runtime
  generics are desired)

**Tooling and productivity:**

- Debugger / step-through with source maps
- Hot reload of user code
- Editor autocomplete beyond TypeScript-provided
- Better error messages with source location mapping

**Ecosystem:**

- Sharing user-authored tiles between brains
- Shared helper libraries reusable across sensors/actuators
- Package system for community-contributed tiles

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
unsupported features must be clear and specific about what is not supported (e.g.,
"Inheritance is not supported in Mindcraft sensors", "switch statements are not
supported").

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

This was true initially but classes are now supported (single, no inheritance). They
compile to struct-backed types with qualified method names. The class constraint that
remains is no inheritance, no getters/setters, no static members, no private fields.

**Closures are capture-by-value only.** Captured variables are snapshot at closure
creation time -- mutations inside the closure are not visible outside, and vice versa.
This avoids the complexity of mutable upvalue cells, heap-allocated variable boxes, or
closure-conversion passes that would be needed for capture-by-reference semantics.
The constraint is acceptable because most closure use cases in user-authored code are
callbacks to array methods like `.filter()`, `.map()`, `.forEach()` where captured
values are read-only. Closures are implemented via `MAKE_CLOSURE` / `LOAD_CAPTURE`
opcodes.

**No generics.** Types are erased after checking. The compiler does not need to
monomorphize or specialize. Type parameters in ambient declarations work fine because
the TypeScript checker handles them -- the Mindcraft compiler never sees them.

**Single file per tile (originally).** Originally eliminated module resolution, import
graph analysis, circular dependency detection, and cross-file linking. Multi-file
support is now implemented via `UserTileProject`, but the architecture remains simple:
`collectImports()` gathers exported symbols from imported files and merges them into a
single `UserAuthoredProgram`. There is no runtime module system.

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
