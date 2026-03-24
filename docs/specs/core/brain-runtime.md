# Brain Bytecode Compiler & VM Architecture Spec

This document specifies the Mindcraft bytecode compiler and stack-based virtual machine,
covering everything from bytecode emission through fiber-based concurrent execution. The
language design, parser, and type inference are out of scope -- they are covered by the
companion spec in `brain-language.md`.

The implementation target is `packages/core/src/brain/`. All code must follow the multi-target
constraints documented in `.github/instructions/core.instructions.md` (no `any`, no `typeof`,
no global `Error`, no Luau reserved words as identifiers, prefer `List`/`Dict` over native
`Array`/`Map`).

Each phase is a self-contained deliverable with its own tests. Complete one phase fully,
including passing tests, before moving to the next.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Phase 1 -- Value Model](#2-phase-1----value-model)
3. [Phase 2 -- Opcode Set & Instruction Format](#3-phase-2----opcode-set--instruction-format)
4. [Phase 3 -- Bytecode Emitter](#4-phase-3----bytecode-emitter)
5. [Phase 4 -- Constant Pool](#5-phase-4----constant-pool)
6. [Phase 5 -- Expression Compiler](#6-phase-5----expression-compiler)
7. [Phase 6 -- Brain Compiler](#7-phase-6----brain-compiler)
8. [Phase 7 -- Bytecode Verifier](#8-phase-7----bytecode-verifier)
9. [Phase 8 -- VM Core (Single-Fiber Execution)](#9-phase-8----vm-core-single-fiber-execution)
10. [Phase 9 -- Async Handle System](#10-phase-9----async-handle-system)
11. [Phase 10 -- Exception Handling](#11-phase-10----exception-handling)
12. [Phase 11 -- Fiber Scheduler](#12-phase-11----fiber-scheduler)
13. [Phase 12 -- Brain Runtime](#13-phase-12----brain-runtime)
14. [Appendix A -- Complete Opcode Reference](#appendix-a----complete-opcode-reference)
15. [Appendix B -- Compilation Diagnostic Codes](#appendix-b----compilation-diagnostic-codes)
16. [Appendix C -- VM Configuration Defaults](#appendix-c----vm-configuration-defaults)

---

## 1. Overview

### Pipeline

```
Tiles -> Parser -> AST (Expr) -> Type Inference -> Bytecode Compiler -> Program -> VM
                                                   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                                                     This spec covers this portion.
```

The bytecode compiler consumes the typed AST produced by the parser and type inference
passes (defined in `brain-language.md`). It emits a `BrainProgram` containing bytecode
functions, a constant pool, and page metadata. The VM executes that program using
fiber-based cooperative multitasking.

### Key Design Principles

- **Stack-based.** The VM uses a value stack per fiber. All operations push/pop values.
- **One function per rule.** Each brain rule compiles to one `FunctionBytecode`. Parent
  rules CALL their children after executing their own DO section.
- **Shared constant pool.** All rules in a brain share a single deduplicating constant pool.
- **Operators are host calls.** The compiler resolves operator overloads at compile time and
  emits HOST_CALL_ARGS instructions for them. Short-circuit boolean operators (AND/OR)
  are special-cased with jump instructions.
- **Fiber-based concurrency.** Each root rule runs in its own fiber. Fibers are cooperative
  -- they yield when their instruction budget expires or when they AWAIT an async handle.
- **Budget-limited execution.** Each fiber executes at most N instructions per scheduler
  tick, preventing runaway rules from blocking the host application.
- **Deep copy on assignment.** Variable assignment deep-copies struct values to prevent
  shared-mutable-state bugs.
- **Two-pass compilation.** First pass assigns function IDs depth-first across all rules.
  Second pass compiles each rule body, using known function IDs for CALL instructions.

### Inputs from brain-language.md

The compiler depends on these types from the language spec:

- `Expr` (AST union), `ExprVisitor<T>`, `acceptExprVisitor()`
- `TypeEnv` (Dict<nodeId, TypeInfo>), `TypeInfo` (inferred type, overload, conversion)
- `IBrainTileDef` subtypes: `BrainTileLiteralDef`, `BrainTileVariableDef`,
  `BrainTileOperatorDef`, `BrainTileSensorDef`, `BrainTileActuatorDef`, etc.
- `BrainFunctionEntry`, `BrainSyncFunctionEntry`, `BrainAsyncFunctionEntry`
- `BrainActionCallDef`, `BrainActionArgSlot` (call-spec flattened slots)
- `IBrainDef`, `IBrainPageDef`, `IBrainRuleDef`, `IBrainTileSet`
- `ITypeRegistry`, `IFunctionRegistry`
- `OpOverload`, `Conversion`, `CoreOpId`

### File Layout

```
packages/core/src/brain/
  interfaces/
    vm.ts            -- Value union, Op enum, Instr, Program, BrainProgram, HandleTable,
                        FunctionBytecode, PageMetadata, VmConfig, SchedulerConfig,
                        isTruthy, value helpers, BYTECODE_VERSION
    emitter.ts       -- IBytecodeEmitter interface
    runtime.ts       -- IBrain, ExecutionContext, IFiberScheduler, IVM
  compiler/
    emitter.ts       -- BytecodeEmitter (concrete IBytecodeEmitter)
    constant-pool.ts -- ConstantPool (deduplicating constant storage)
    rule-compiler.ts -- ExprCompiler (AST-to-bytecode visitor), CompilationContext
    brain-compiler.ts -- BrainCompiler, compileBrain(), BrainProgram construction
    diag-codes.ts    -- CompilationDiagCode enum (3000+)
  runtime/
    vm.ts            -- VM class, FiberScheduler, Fiber, Frame, Handler, BytecodeVerifier
    brain.ts         -- Brain class (integrates compiler + VM + scheduler)
```

---

## 2. Phase 1 -- Value Model

### Goal

Define the tagged value union, truthiness semantics, deep-copy behavior, and helper
functions that the VM operates on.

### 2.1 Value Union

All runtime values are tagged with a `t` field discriminated by `NativeType`:

```typescript
type Value =
  | UnknownValue // { t: NativeType.Unknown }
  | VoidValue // { t: NativeType.Void }
  | NilValue // { t: NativeType.Nil }
  | BooleanValue // { t: NativeType.Boolean; v: boolean }
  | NumberValue // { t: NativeType.Number; v: number }
  | StringValue // { t: NativeType.String; v: string }
  | EnumValue // { t: NativeType.Enum; typeId: TypeId; v: string }
  | ListValue // { t: NativeType.List; typeId: TypeId; v: List<Value> }
  | MapValue // { t: NativeType.Map; typeId: TypeId; v: ValueDict }
  | StructValue // { t: NativeType.Struct; typeId: TypeId; v?: Dict<string, Value>; native?: unknown }
  | HandleValue // { t: "handle"; id: HandleId } -- VM-internal only
  | ErrorValue; // { t: "err"; e: ErrorValue }    -- VM-internal only
```

`HandleValue` and `ErrorValue` are internal to the VM and never appear in constant pools
or host function return values under normal operation.

### 2.2 ValueDict

A typed Dict subclass for Map values:

```typescript
class ValueDict extends Dict<string | number, Value> {
  getString(key: string | number): StringValue | undefined;
  getNumber(key: string | number): NumberValue | undefined;
  // additional typed getters for convenience
}
```

Used as the value container for `MapValue`. Also used for HOST_CALL argument maps.

### 2.3 Singleton Constants

Immutable, reusable instances:

```typescript
const UNKNOWN_VALUE: UnknownValue = { t: NativeType.Unknown };
const VOID_VALUE: VoidValue = { t: NativeType.Void };
const NIL_VALUE: NilValue = { t: NativeType.Nil };
const TRUE_VALUE: BooleanValue = { t: NativeType.Boolean, v: true };
const FALSE_VALUE: BooleanValue = { t: NativeType.Boolean, v: false };
```

### 2.4 Value Builders

```typescript
function mkBooleanValue(b: boolean): BooleanValue;
function mkNumberValue(n: number): NumberValue;
function mkStringValue(str: string): StringValue;
function mkListValue(typeId: TypeId, items: List<Value>): ListValue;
function mkStructValue(typeId: TypeId, fields: Dict<string, Value>, native?: unknown): StructValue;
function mkNativeStructValue(typeId: TypeId, native: unknown): StructValue;
```

### 2.5 Value Extractors

```typescript
function extractBooleanValue(v: Value | undefined): boolean | undefined;
function extractNumberValue(v: Value | undefined): number | undefined;
function extractStringValue(v: Value | undefined): string | undefined;
function extractListValue(v: Value | undefined): List<Value> | undefined;
```

### 2.6 Type Guards

```typescript
function isNilValue(v: Value): v is NilValue;
function isBooleanValue(v: Value): v is BooleanValue;
function isNumberValue(v: Value): v is NumberValue;
function isStringValue(v: Value): v is StringValue;
function isEnumValue(v: Value): v is EnumValue;
function isListValue(v: Value): v is ListValue;
function isMapValue(v: Value): v is MapValue;
function isStructValue(v: Value): v is StructValue;
function isHandleValue(v: Value): v is HandleValue;
function isErrValue(v: Value): v is ErrorValue;
```

### 2.7 Truthiness

```typescript
function isTruthy(v: Value): boolean;
```

| Type    | Truthy when       |
| ------- | ----------------- |
| Unknown | never             |
| Void    | never             |
| Nil     | never             |
| Boolean | `v.v === true`    |
| Number  | `v.v !== 0`       |
| String  | `length(v.v) > 0` |
| Enum    | always            |
| List    | `v.v.size() > 0`  |
| Map     | `v.v.size() > 0`  |
| Struct  | always            |
| Handle  | always            |
| Error   | never             |

### 2.8 Deep Copy

```typescript
function deepCopyValue(v: Value, types: ITypeRegistry, ctx: ExecutionContext, visited?: List<Value>): Value;
```

- **Primitives** (Boolean, Number, String, Enum, Nil, Void, Unknown, Handle, Error):
  returned as-is. These types are immutable.
- **Struct**: recursively deep-copies the `v` field Dict. Each field value is itself
  deep-copied. If the type has a registered `snapshotNative` hook, it is called to
  materialize the native handle into value fields. Circular references are detected via
  a linear scan of the `visited` list.
- **List/Map**: (extend similarly for future use -- currently struct is the primary target).

Used by STORE_VAR (assignment semantics) and SET_FIELD to prevent aliasing.

### Tests

- Singleton values are referentially stable across reads.
- `mkBooleanValue(true)` returns `TRUE_VALUE` (or equivalent).
- `isTruthy` returns expected results for each type (table above).
- `deepCopyValue` on a primitive returns the same object.
- `deepCopyValue` on a struct with nested fields produces a fully independent copy.
- `deepCopyValue` on a struct with circular reference does not infinite-loop.
- Extractor functions return `undefined` for wrong types.

---

## 3. Phase 2 -- Opcode Set & Instruction Format

### Goal

Define the `Op` enum, the `Instr` structure, and the `FunctionBytecode` / `Program` types
that the compiler produces and the VM consumes.

### 3.1 Instruction Format

```typescript
interface Instr {
  op: Op; // Opcode enum value
  a?: number; // Parameter A (semantics vary by opcode)
  b?: number; // Parameter B (semantics vary by opcode)
  c?: number; // Parameter C (semantics vary by opcode)
}
```

Field semantics are opcode-specific. Unused fields are `undefined`. See Appendix A for
the complete opcode reference with field assignments, stack effects, and behavior.

### 3.2 Op Enum

Opcodes are grouped by category:

| Range   | Category      |
| ------- | ------------- |
| 0-3     | Stack         |
| 10-11   | Variables     |
| 20-22   | Control flow  |
| 30-31   | Function call |
| 40-43   | Host call     |
| 50-51   | Async         |
| 60-62   | Exceptions    |
| 70-73   | Boundaries    |
| 90-99   | Lists         |
| 100-104 | Maps          |
| 110-112 | Structs       |
| 120-121 | Fields        |
| 130-131 | Locals        |
| 140-141 | Callsite vars |
| 150     | Type check    |
| 160     | Indirect call |
| 170-171 | Closures      |

```typescript
enum Op {
  PUSH_CONST = 0,
  POP = 1,
  DUP = 2,
  SWAP = 3,
  LOAD_VAR = 10,
  STORE_VAR = 11,
  JMP = 20,
  JMP_IF_FALSE = 21,
  JMP_IF_TRUE = 22,
  CALL = 30,
  RET = 31,
  HOST_CALL = 40,
  HOST_CALL_ASYNC = 41,
  HOST_CALL_ARGS = 42,
  HOST_CALL_ARGS_ASYNC = 43,
  AWAIT = 50,
  YIELD = 51,
  TRY = 60,
  END_TRY = 61,
  THROW = 62,
  WHEN_START = 70,
  WHEN_END = 71,
  DO_START = 72,
  DO_END = 73,
  LIST_NEW = 90,
  LIST_PUSH = 91,
  LIST_GET = 92,
  LIST_SET = 93,
  LIST_LEN = 94,
  LIST_POP = 95,
  LIST_SHIFT = 96,
  LIST_REMOVE = 97,
  LIST_INSERT = 98,
  LIST_SWAP = 99,
  MAP_NEW = 100,
  MAP_SET = 101,
  MAP_GET = 102,
  MAP_HAS = 103,
  MAP_DELETE = 104,
  STRUCT_NEW = 110,
  STRUCT_GET = 111,
  STRUCT_SET = 112,
  GET_FIELD = 120,
  SET_FIELD = 121,
  LOAD_LOCAL = 130,
  STORE_LOCAL = 131,
  LOAD_CALLSITE_VAR = 140,
  STORE_CALLSITE_VAR = 141,
  TYPE_CHECK = 150,
  CALL_INDIRECT = 160,
  MAKE_CLOSURE = 170,
  LOAD_CAPTURE = 171,
}
```

### 3.3 FunctionBytecode

```typescript
interface FunctionBytecode {
  code: List<Instr>;
  numParams: number;
  name?: string;
  maxStackDepth?: number;
}
```

Each compiled rule produces one `FunctionBytecode`. `numParams` is validated by the VM on
CALL instructions. `name` is for debugging. `maxStackDepth` is optional metadata.

### 3.4 Program

The generic program type consumed by the VM:

```typescript
interface Program {
  version: number; // must equal BYTECODE_VERSION (1)
  functions: List<FunctionBytecode>;
  constants: List<Value>; // shared constant pool
  variableNames: List<string>; // index -> variable name
  entryPoint?: number; // default function to execute
}
```

### 3.5 BrainProgram

Extends `Program` with brain-specific metadata:

```typescript
interface BrainProgram extends Program {
  entryPoint: number;
  ruleIndex: Dict<string, number>; // rulePath -> funcId
  pages: List<PageMetadata>;
}

interface PageMetadata {
  pageIndex: number;
  pageId: string; // stable UUID
  pageName: string;
  rootRuleFuncIds: List<number>; // top-level rule function IDs
  hostCallSites: List<HostCallSiteEntry>; // all HOST_CALL sites in page tree
  sensors: UniqueSet<TileId>; // sensor tiles referenced
  actuators: UniqueSet<TileId>; // actuator tiles referenced
}

interface HostCallSiteEntry {
  fnId: number; // host function registry ID
  callSiteId: number; // unique call-site ID from compilation
}
```

`ruleIndex` maps a hierarchical path (`"pageIdx/ruleIdx"` or
`"pageIdx/ruleIdx/childIdx/..."`) to a function ID. This allows the Brain runtime to find
the function for any rule.

`hostCallSites` is collected after compilation and used by the Brain to call
`onPageEntered()` callbacks on host functions.

### 3.6 BYTECODE_VERSION

```typescript
const BYTECODE_VERSION = 1;
```

Checked by the bytecode verifier before execution.

### Tests

- Construct `Instr` values for each opcode, verify field access.
- Construct `FunctionBytecode` with a List of instructions.
- Construct `Program` with functions, constants, and variable names.
- Verify `BYTECODE_VERSION` is `1`.

---

## 4. Phase 3 -- Bytecode Emitter

### Goal

Implement the `BytecodeEmitter` that produces finalized instruction lists with resolved
jump offsets. The emitter provides a label-based system so the compiler can emit forward
jumps before the target is known.

### 4.1 IBytecodeEmitter Interface

```typescript
interface IBytecodeEmitter {
  // Stack
  pushConst(constIdx: number): void;
  pop(): void;
  dup(): void;
  swap(): void;

  // Variables
  loadVar(varNameIdx: number): void;
  storeVar(varNameIdx: number): void;

  // Control flow
  jmp(labelId: number): void;
  jmpIfFalse(labelId: number): void;
  jmpIfTrue(labelId: number): void;

  // Function calls
  call(funcId: number, argc: number): void;
  ret(): void;

  // Host calls (pre-built MapValue on stack)
  hostCall(hostId: number, argc: number, callSiteId: number): void;
  hostCallAsync(hostId: number, argc: number, callSiteId: number): void;

  // Host calls (raw args on stack, auto-wrapped)
  hostCallArgs(hostId: number, argc: number, callSiteId: number): void;
  hostCallArgsAsync(hostId: number, argc: number, callSiteId: number): void;

  // Async
  await(): void;
  yield(): void;

  // Exceptions
  try(catchLabel: number): void;
  endTry(): void;
  throw(): void;

  // Boundaries
  whenStart(): void;
  whenEnd(skipLabel: number): void;
  doStart(): void;
  doEnd(): void;

  // Collections
  listNew(typeId: number): void;
  listPush(): void;
  listGet(): void;
  listSet(): void;
  listLen(): void;
  mapNew(typeId: number): void;
  mapSet(): void;
  mapGet(): void;
  mapHas(): void;
  mapDelete(): void;
  structNew(typeId: number): void;
  structGet(): void;
  structSet(): void;
  getField(): void;
  setField(): void;

  // Labels & finalization
  label(): number;
  mark(labelId: number): void;
  pos(): number;
  finalize(): List<Instr>;
  reset(): void;
}
```

### 4.2 BytecodeEmitter Implementation

Private state:

```typescript
private instrs: List<Instr>;            // instruction stream
private labels: Dict<number, number>;   // labelId -> instruction index
private fixups: List<Fixup>;            // unresolved offset patches
private nextLabelId: number;
private finalized: boolean;
```

Fixup structure:

```typescript
interface Fixup {
  instrIdx: number; // which instruction to patch
  labelId: number; // which label is the target
  field: "a" | "b"; // which instruction field holds the offset
}
```

### 4.3 Label Workflow

1. `label()` -- allocates and returns a new label ID. Does not mark a position.
2. Emit instructions that reference the label (e.g., `jmpIfFalse(labelId)`). A fixup is
   recorded for each reference.
3. `mark(labelId)` -- records the current instruction index as the target position for
   that label.
4. `finalize()` -- iterates all fixups, computes signed relative offsets
   (`targetPc - instrPc`), patches them into the instruction's field. Sets `finalized = true`
   to prevent further emissions.

Relative offsets allow forward and backward jumps. A forward jump has a positive offset;
a backward jump has a negative offset.

### 4.4 Emission Methods

Each method appends one `Instr` to the `instrs` list. Methods that reference labels
(jmp, jmpIfFalse, jmpIfTrue, whenEnd, try) additionally push a `Fixup` entry.

Example: `jmpIfFalse(labelId)` emits `{ op: Op.JMP_IF_FALSE, a: 0 }` (placeholder offset)
and pushes `{ instrIdx: currentPos, labelId, field: "a" }`.

### 4.5 Reset

`reset()` clears all state (instrs, labels, fixups, nextLabelId) and sets
`finalized = false`. Called between compiling different rule functions.

### Tests

- Emit a sequence of instructions, finalize, verify instruction list.
- Forward jump: `label()` -> `jmpIfFalse(label)` -> ... -> `mark(label)` -> `finalize()`.
  Verify the JMP_IF_FALSE instruction's `a` field is the correct positive relative offset.
- Backward jump: `mark(label)` -> ... -> `jmp(label)` -> `finalize()`. Verify negative
  relative offset.
- Multiple labels in one function resolve correctly.
- `pos()` returns current instruction count.
- `reset()` clears state for reuse.
- Double-finalization or emission after finalization is handled gracefully.

---

## 5. Phase 4 -- Constant Pool

### Goal

Implement the deduplicating constant pool that stores literal values shared across all
rules in a brain.

### 5.1 ConstantPool

```typescript
class ConstantPool {
  add(value: Value): number; // returns index, deduplicates primitives
  getConstants(): List<Value>;
  size(): number;
  reset(): void;
}
```

### 5.2 Deduplication Strategy

Primitive values (Boolean, Number, String, Enum, Nil, Void, Unknown) are deduplicated by
serializing to a canonical string key:

| Type    | Serialization key format       |
| ------- | ------------------------------ |
| Nil     | `"nil"`                        |
| Boolean | `"bool:true"` / `"bool:false"` |
| Number  | `"num:42"`                     |
| String  | `"str:hello"`                  |
| Enum    | `"enum:<typeId>:<key>"`        |

Complex values (List, Map, Struct) always receive a unique index -- no deduplication.
This avoids expensive deep equality checks.

### 5.3 Usage

The compiler adds values to the pool via `add()` and uses the returned index in
`PUSH_CONST` instructions. The final `List<Value>` from `getConstants()` becomes the
program's constant pool.

### Tests

- Adding the same number twice returns the same index.
- Adding different numbers returns different indices.
- Adding the same string twice returns the same index.
- Adding a boolean then the same boolean returns the same index.
- Adding two different struct values returns different indices (no dedup).
- `size()` reflects the number of unique entries.
- `reset()` clears the pool.

---

## 6. Phase 5 -- Expression Compiler

### Goal

Implement the `ExprCompiler` that walks a typed AST (`Expr`) and emits bytecode via the
`IBytecodeEmitter`. This is the core compilation logic for individual expressions.

### 6.1 CompilationContext

```typescript
interface CompilationContext {
  variableIndices: Dict<string, number>; // var name -> index in variableNames
  variableNames: List<string>; // global variable name list
  typeEnv: TypeEnv; // node ID -> TypeInfo (from inference)
  constantPool: ConstantPool; // shared across all rules
  nextCallSiteId: { value: number }; // global counter for HOST_CALL site IDs
  diags: List<CompilationDiag>; // compilation diagnostics
}
```

### 6.2 ExprCompiler

`ExprCompiler` implements `ExprVisitor<void>`:

```typescript
class ExprCompiler implements ExprVisitor<void> {
  constructor(emitter: IBytecodeEmitter, context: CompilationContext);
  compile(expr: Expr): void; // calls acceptExprVisitor(expr, this)
}
```

### 6.3 Emit Patterns

#### Literals

```
visitLiteral(expr):
  value = valueFromLiteral(expr.tileDef)    // convert tile literal to VM Value
  idx = constantPool.add(value)
  emitter.pushConst(idx)
```

#### Variables

```
visitVariable(expr):
  nameIdx = getOrCreateVariableIndex(expr.tileDef.varName)
  emitter.loadVar(nameIdx)
```

`getOrCreateVariableIndex(name)` checks `variableIndices`, and if the name is new,
appends it to `variableNames` and records the mapping.

#### Assignments

Two forms:

**Variable assignment:**

```
visitAssignment(expr) where target is VariableExpr:
  compile(expr.value)                      // emit value expression
  emitter.dup()                            // assignment is an expression; keep copy
  nameIdx = getOrCreateVariableIndex(target.tileDef.varName)
  emitter.storeVar(nameIdx)               // deep-copies and stores
```

**Field assignment:**

```
visitAssignment(expr) where target is FieldAccessExpr:
  compile(target.object)                   // emit struct expression
  idx = constantPool.add(mkStringValue(target.accessor.fieldName))
  emitter.pushConst(idx)                   // push field name
  compile(expr.value)                      // emit value expression
  emitter.setField()                       // SET_FIELD pops value, name, struct -> pushes struct
```

#### Binary Operators

**Short-circuit AND:**

```
visitBinaryOp(expr) where op is CoreOpId.And:
  compile(expr.left)
  emitter.dup()
  endLabel = emitter.label()
  emitter.jmpIfFalse(endLabel)             // if left is falsy, skip right
  emitter.pop()                            // discard DUP'd left (it was truthy)
  compile(expr.right)
  emitter.mark(endLabel)
```

**Short-circuit OR:**

```
visitBinaryOp(expr) where op is CoreOpId.Or:
  compile(expr.left)
  emitter.dup()
  endLabel = emitter.label()
  emitter.jmpIfTrue(endLabel)              // if left is truthy, skip right
  emitter.pop()                            // discard DUP'd left (it was falsy)
  compile(expr.right)
  emitter.mark(endLabel)
```

**All other binary operators:**

```
visitBinaryOp(expr):
  compile(expr.left)
  emitConversionIfNeeded(expr.left.nodeId)  // implicit type conversion
  compile(expr.right)
  emitConversionIfNeeded(expr.right.nodeId) // implicit type conversion
  fnId = typeEnv.get(expr.nodeId).overload.fnEntry.id
  callSiteId = nextCallSiteId()
  emitter.hostCallArgs(fnId, 2, callSiteId)
```

`HOST_CALL_ARGS` pops 2 raw values from the stack, auto-wraps them into a MapValue with
numeric keys `{0: leftValue, 1: rightValue}`, and calls the host function.

If the operator's function entry is async, use `hostCallArgsAsync` followed by
`emitter.await()`.

#### Unary Operators

```
visitUnaryOp(expr):
  compile(expr.operand)
  emitConversionIfNeeded(expr.operand.nodeId)
  fnId = typeEnv.get(expr.nodeId).overload.fnEntry.id
  callSiteId = nextCallSiteId()
  emitter.hostCallArgs(fnId, 1, callSiteId)
```

If async, follow with `emitter.await()`.

#### Implicit Conversions

```
emitConversionIfNeeded(nodeId):
  typeInfo = typeEnv.get(nodeId)
  if typeInfo?.conversion:
    fnId = typeInfo.conversion.id          // conversion is a registered host function
    callSiteId = nextCallSiteId()
    emitter.hostCallArgs(fnId, 1, callSiteId)
```

#### Sensors and Actuators

```
visitActuator(expr) / visitSensor(expr):
  emitActionArguments(expr.anons, expr.parameters, expr.modifiers)
  fnId = expr.tileDef.fnEntry.id
  callSiteId = nextCallSiteId()
  if expr.tileDef.fnEntry.isAsync:
    emitter.hostCallAsync(fnId, 1, callSiteId)
    emitter.await()
  else:
    emitter.hostCall(fnId, 1, callSiteId)
```

#### Action Argument Marshaling

```
emitActionArguments(anons, parameters, modifiers):
  emitter.mapNew(0)                        // create empty MapValue

  for each { slotId, expr } in anons:
    emitter.pushConst(constantPool.add(mkNumberValue(slotId)))  // key
    compile(expr)                           // value
    emitter.mapSet()

  for each { slotId, expr } in parameters:
    emitter.pushConst(constantPool.add(mkNumberValue(slotId)))  // key
    compile(expr.value)                     // parameter's inner value
    emitter.mapSet()

  for each { slotId, expr } in modifiers:
    emitter.pushConst(constantPool.add(mkNumberValue(slotId)))  // key
    count = number of times this modifier appears (allows repeats)
    emitter.pushConst(constantPool.add(mkNumberValue(count)))   // value
    emitter.mapSet()
```

The result is a single MapValue on the stack. `HOST_CALL` (not `HOST_CALL_ARGS`) pops
this pre-built MapValue and passes it directly to the host function.

#### Field Access

```
visitFieldAccess(expr):
  compile(expr.object)                     // emit struct expression
  idx = constantPool.add(mkStringValue(expr.accessor.fieldName))
  emitter.pushConst(idx)                   // push field name
  emitter.getField()                       // GET_FIELD dispatches to type's fieldGetter
```

#### Parameters and Modifiers

```
visitParameter(expr):
  compile(expr.value)                      // emit the parameter's inner value
```

Modifiers are handled during action argument marshaling and produce no standalone bytecode.

#### Empty Expression

```
visitEmpty(expr):
  // no-op in most contexts
  // in WHEN context: push TRUE (empty condition always passes)
```

#### Error Expression

```
visitError(expr):
  // push NIL as placeholder
  // log diagnostic
```

### 6.4 Call-Site ID Counter

Each HOST_CALL, HOST_CALL_ASYNC, HOST_CALL_ARGS, and HOST_CALL_ARGS_ASYNC instruction
receives a unique `callSiteId` via `nextCallSiteId()`. This counter is shared across all
rules in the brain (via `CompilationContext.nextCallSiteId`). The VM uses it to index
into per-call-site persistent state, allowing host functions to maintain state per call
location across multiple ticks.

### Tests

- Literal emits `PUSH_CONST`.
- Variable emits `LOAD_VAR`.
- Assignment emits value, DUP, STORE_VAR.
- Field assignment emits object, field name, value, SET_FIELD.
- Binary `+` emits left, right, HOST_CALL_ARGS with argc=2.
- Binary AND emits short-circuit: left, DUP, JMP_IF_FALSE, POP, right.
- Binary OR emits short-circuit: left, DUP, JMP_IF_TRUE, POP, right.
- Unary NOT emits operand, HOST_CALL_ARGS with argc=1.
- Conversion inserts HOST_CALL_ARGS before the operator call.
- Sensor emits MAP_NEW, arg sets, HOST_CALL.
- Async actuator emits MAP_NEW, args, HOST_CALL_ASYNC, AWAIT.
- Field access emits object, field name, GET_FIELD.
- Empty expression in WHEN context emits PUSH_CONST (true).
- Call-site IDs increment monotonically across rules.
- Variables share global indices across rules.

---

## 7. Phase 6 -- Brain Compiler

### Goal

Implement the top-level `BrainCompiler` that compiles an entire brain definition (multiple
pages, each with multiple rules including nested children) into a `BrainProgram`.

### 7.1 BrainCompiler

```typescript
class BrainCompiler {
  constructor(catalogs: ReadonlyList<ITileCatalog>);
  compile(brainDef: IBrainDef): BrainProgram;
}

function compileBrain(brainDef: IBrainDef, catalogs: ReadonlyList<ITileCatalog>): BrainProgram;
```

### 7.2 Two-Pass Architecture

**Pass 1 -- Assign Function IDs:**

Depth-first traversal of all pages and rules. Each rule (including nested children) is
assigned a unique `funcId` starting from 0:

```
assignFuncIds(brainDef):
  for each page in brainDef.pages:
    for each rule in page.children:
      assignFuncIdToRule(rule, "pageIdx/ruleIdx")

assignFuncIdToRule(rule, path):
  funcId = nextFuncId++
  ruleIndex.set(path, funcId)
  functions.push(placeholder)            // pre-allocate slot
  for each child in rule.children:
    assignFuncIdToRule(child, path + "/childIdx")
```

**Pass 2 -- Compile Rule Bodies:**

With all function IDs known, compile each rule's WHEN and DO sides into bytecode:

```
compilePage(pageDef, pageIdx):
  pageMetadata = { rootRuleFuncIds, hostCallSites, sensors, actuators, ... }
  for each rule in pageDef.children:
    compileRule(rule, path, pageMetadata)
    pageMetadata.rootRuleFuncIds.push(ruleIndex.get(path))
  collectHostCallSites(pageMetadata)
  pages.push(pageMetadata)
```

### 7.3 Rule Body Compilation

```
compileRuleBody(rule, childFuncIds, pageMetadata):
  // 1. Parse WHEN and DO tiles
  whenResult = parseBrainTiles(rule.when.tiles)
  doResult = parseBrainTiles(rule.do.tiles)

  // 2. Collect sensor/actuator tile IDs into PageMetadata
  collectTileRefs(rule.when.tiles, pageMetadata)
  collectTileRefs(rule.do.tiles, pageMetadata)

  // 3. Run type inference
  typeEnv = Dict.empty()
  computeExpectedTypes(whenResult.exprs, typeEnv)
  computeInferredTypes(whenResult.exprs, catalogs, typeEnv)
  computeExpectedTypes(doResult.exprs, typeEnv)
  computeInferredTypes(doResult.exprs, catalogs, typeEnv)

  // 4. Create compilation context and emitter
  context = { variableIndices, variableNames, typeEnv, constantPool, nextCallSiteId, diags }
  emitter = new BytecodeEmitter()
  compiler = new ExprCompiler(emitter, context)

  // 5. Emit rule function body
  skipLabel = emitter.label()

  emitter.whenStart()
  if whenResult has expressions:
    compiler.compile(whenResult.exprs[0])
  else:
    emitter.pushConst(constantPool.add(TRUE_VALUE))  // empty WHEN = always true
  emitter.whenEnd(skipLabel)               // JMP to skipLabel if WHEN is false

  emitter.doStart()
  if doResult has expressions:
    compiler.compile(doResult.exprs[0])
    emitter.pop()                          // discard DO result (side-effect only)
  emitter.doEnd()

  // 6. CALL each child rule function
  for each childFuncId in childFuncIds:
    emitter.call(childFuncId, 0)
    emitter.pop()                          // discard child return value

  // 7. Emit return
  emitter.mark(skipLabel)
  emitter.pushConst(constantPool.add(NIL_VALUE))
  emitter.ret()

  return emitter.finalize()
```

### 7.4 Rule Function Layout

Every compiled rule follows this bytecode layout:

```
  WHEN_START
  <when expression bytecode>            // leaves condition on stack
  WHEN_END skipLabel                     // pops condition; jumps if false
  DO_START
  <do expression bytecode>              // leaves result on stack
  POP                                   // discard DO result
  DO_END
  CALL child_0, 0                       // call child rules (if WHEN was true)
  POP
  CALL child_1, 0
  POP
  ...
skipLabel:
  PUSH_CONST nil
  RET
```

If WHEN is false, execution jumps directly to `skipLabel`, skipping the DO section and
all child rule calls. The function always returns NIL.

### 7.5 Host Call-Site Collection

After compiling all rules in a page, `collectHostCallSites()` walks the bytecode of all
functions reachable from the page's root rules (following CALL instructions). It records
`{ fnId, callSiteId }` for every HOST_CALL and HOST_CALL_ASYNC instruction. This is used
by the Brain runtime to invoke `onPageEntered()` callbacks.

### 7.6 Output Assembly

```
return {
  version: BYTECODE_VERSION,
  functions: functions,                  // one FunctionBytecode per rule
  constants: constantPool.getConstants(),
  variableNames: variableNames,
  entryPoint: 0,                         // first page's first root rule
  ruleIndex: ruleIndex,
  pages: pages,
}
```

### Tests

- Single rule with literal WHEN and assignment DO compiles to valid bytecode.
- Rule with empty WHEN gets `PUSH_CONST true` before WHEN_END.
- Rule with children: parent CALL instructions reference correct function IDs.
- Multi-page brain: pages have correct root rule function IDs.
- Nested rules: depth-first function ID assignment matches ruleIndex paths.
- Variables are shared across rules (same name -> same index).
- Constant pool is shared across rules (same literal -> same index).
- Call-site IDs are unique across all rules.
- Host call-site collection finds all HOST_CALL instructions in reachable functions.
- Compilation diagnostics from parse/type-check are collected.

---

## 8. Phase 7 -- Bytecode Verifier

### Goal

Implement static verification of bytecode programs before execution. The verifier catches
out-of-bounds indices and invalid instruction operands that would cause runtime crashes.

### 8.1 BytecodeVerifier

```typescript
class BytecodeVerifier {
  verify(program: Program, functionRegistry: IFunctionRegistry): { ok: boolean; errors: List<string> };
}
```

### 8.2 Verification Checks

For each function in the program:

| Opcode               | Check                                                    |
| -------------------- | -------------------------------------------------------- |
| PUSH_CONST           | `a` in `[0, constants.size())`                           |
| LOAD_VAR             | `a` in `[0, variableNames.size())`                       |
| STORE_VAR            | `a` in `[0, variableNames.size())`                       |
| JMP                  | `pc + a` is a valid PC in the function                   |
| JMP_IF_FALSE         | `pc + a` is a valid PC in the function                   |
| JMP_IF_TRUE          | `pc + a` is a valid PC in the function                   |
| TRY                  | `pc + a` (catch target) is a valid PC                    |
| CALL                 | `a` (funcId) in `[0, functions.size())`; `b` = numParams |
| HOST_CALL            | `a` (fnId) exists in function registry (sync)            |
| HOST_CALL_ASYNC      | `a` (fnId) exists in function registry (async)           |
| HOST_CALL_ARGS       | `a` (fnId) exists in function registry (sync)            |
| HOST_CALL_ARGS_ASYNC | `a` (fnId) exists in function registry (async)           |

Global checks:

- `program.version === BYTECODE_VERSION`
- `program.functions.size() > 0`

### Tests

- Valid program passes verification.
- Out-of-bounds PUSH_CONST index -> error.
- Out-of-bounds LOAD_VAR index -> error.
- Invalid jump target -> error.
- Invalid CALL function ID -> error.
- Invalid HOST_CALL function ID -> error.
- Wrong BYTECODE_VERSION -> error.
- Mismatched CALL argc vs numParams -> error.

---

## 9. Phase 8 -- VM Core (Single-Fiber Execution)

### Goal

Implement the core VM that executes a single fiber: instruction dispatch, stack management,
variable resolution, function calls, and host calls. This phase does not include async
operations, exception handling, or the scheduler -- those are separate phases.

### 9.1 VM Class

```typescript
class VM implements IVM {
  constructor(prog: Program, handles: HandleTable, config?: Partial<VmConfig>);
  spawnFiber(fiberId: number, funcId: number, args: List<Value>, executionContext: ExecutionContext): Fiber;
  runFiber(fiber: Fiber, scheduler: IFiberScheduler): VmRunResult;
}
```

### 9.2 Fiber

```typescript
interface Fiber {
  id: number;
  state: FiberState;
  vstack: List<Value>; // operand stack
  frames: List<Frame>; // call stack
  handlers: List<Handler>; // exception handler stack (Phase 10)
  await?: AwaitSite; // async wait info (Phase 9)
  lastError?: ErrorValue;
  pendingInjectedThrow?: boolean;
  instrBudget: number;
  createdAt: number;
  lastRunAt: number;
  executionContext: ExecutionContext;
}

enum FiberState {
  RUNNABLE,
  WAITING,
  DONE,
  FAULT,
  CANCELLED,
}
```

### 9.3 Frame

```typescript
interface Frame {
  funcId: number; // function being executed
  pc: number; // program counter (instruction index within function)
  base: number; // stack base for this frame (for cleanup on RET)
}
```

### 9.4 VmRunResult

```typescript
type VmRunResult =
  | { status: VmStatus.DONE; result: Value }
  | { status: VmStatus.YIELDED }
  | { status: VmStatus.WAITING; handleId: HandleId }
  | { status: VmStatus.FAULT; error: ErrorValue };
```

### 9.5 Execution Loop

```
runFiber(fiber, scheduler):
  while fiber.instrBudget > 0:
    fiber.instrBudget--

    // Check for injected throw (from async error resume)
    if fiber.pendingInjectedThrow:
      handle throw

    // Get current frame
    frame = fiber.frames.peek()
    if !frame: return DONE

    // Bounds check
    func = prog.functions.get(frame.funcId)
    if frame.pc >= func.code.size():
      return FAULT("PC out of bounds")

    // Execute instruction
    instr = func.code.get(frame.pc)
    result = executeInstruction(fiber, instr, frame)
    if result: return result

  return { status: YIELDED }             // budget exhausted
```

### 9.6 Stack Operations

```typescript
push(fiber: Fiber, v: Value): void;     // bounds check: maxStackSize
pop(fiber: Fiber): Value;               // bounds check: underflow
peek(fiber: Fiber): Value;
```

Stack overflow (exceeding `maxStackSize`) is a fatal error.

### 9.7 Core Opcode Implementations

**PUSH_CONST:** `push(fiber, prog.constants.get(instr.a))`

**POP:** `pop(fiber)` -- discards top value.

**DUP:** `push(fiber, peek(fiber))`

**SWAP:** swap top two stack values.

**LOAD_VAR:**

```
name = prog.variableNames.get(instr.a)
value = resolveVariable(fiber, name)     // -> ctx chain -> NIL
push(fiber, value)
```

**STORE_VAR:**

```
name = prog.variableNames.get(instr.a)
value = pop(fiber)
copied = deepCopyValue(value, types, ctx)
setResolvedVariable(fiber, name, copied)
```

**JMP:** `frame.pc += instr.a` (signed relative offset; already patched by emitter).

**JMP_IF_FALSE:** `v = pop(fiber); if !isTruthy(v): frame.pc += instr.a; else: frame.pc++`

**JMP_IF_TRUE:** `v = pop(fiber); if isTruthy(v): frame.pc += instr.a; else: frame.pc++`

**CALL:**

```
funcId = instr.a; argc = instr.b
// Pop argc arguments from stack (reverse order)
// Create new Frame { funcId, pc: 0, base: vstack.size() }
// Push frame onto fiber.frames
// Check maxFrameDepth
```

**RET:**

```
retval = pop(fiber)
frame = fiber.frames.pop()
// Clean up stack to frame.base (discard locals)
// Debug: warn if stack != frame.base (stack leak)
if fiber.frames.size() === 0:
  fiber.state = DONE
  return { status: DONE, result: retval }
push(fiber, retval)                      // return value to caller
```

**HOST_CALL:**

```
args = pop(fiber)                        // must be MapValue
ctx = fiber.executionContext
ctx.currentCallSiteId = instr.c
ctx.rule = funcIdToRule?.get(frame.funcId)
fn = functionRegistry.getSyncById(instr.a)
result = fn.exec(ctx, args)
push(fiber, result)
```

**HOST_CALL_ARGS:**

```
argc = instr.b
args = collectArgsToMap(fiber, argc)     // pop argc values, wrap in MapValue
// same as HOST_CALL from here
```

`collectArgsToMap` pops `argc` values from the stack (last pushed = highest key index)
and wraps them in a MapValue with numeric keys `{0: val0, 1: val1, ...}`.

**WHEN_START:** No-op (semantic boundary marker).

**WHEN_END:**

```
condition = pop(fiber)
if !isTruthy(condition):
  frame.pc += instr.a                    // jump past DO section + children
else:
  frame.pc++
```

**DO_START:** No-op (semantic boundary marker).

**DO_END:** No-op (semantic boundary marker).

**YIELD:** Return `{ status: YIELDED }` immediately.

### 9.8 Collection Operations

**LIST_NEW:** `push(fiber, mkListValue(typeId, List.empty()))`

**LIST_PUSH:** `item = pop(); list = pop(); list.v.push(item); push(list)`

**LIST_GET:** `idx = pop(); list = pop(); push(list.v.get(extractNumber(idx)) ?? NIL_VALUE)`

**LIST_SET:** `val = pop(); idx = pop(); list = pop(); list.v.set(extractNumber(idx), val); push(list)`

**LIST_LEN:** `list = pop(); push(mkNumberValue(list.v.size()))`

**LIST_POP:** `list = pop(); val = list.v.pop(); push(val ?? NIL)`

**LIST_SHIFT:** `list = pop(); val = list.v.shift(); push(val ?? NIL)`

**LIST_REMOVE:** `idx = pop(); list = pop(); val = list.v.remove(floor(idx)); push(val ?? NIL)`

**LIST_INSERT:** `val = pop(); idx = pop(); list = pop(); list.v.insert(floor(idx), val)` (void)

**LIST_SWAP:** `j = pop(); i = pop(); list = pop(); list.v.swap(floor(i), floor(j))` (void)

**MAP_NEW:** `push(fiber, { t: NativeType.Map, typeId, v: new ValueDict() })`

**MAP_SET:** `val = pop(); key = pop(); map = pop(); map.v.set(extractKey(key), val); push(map)`

**MAP_GET:** `key = pop(); map = pop(); push(map.v.get(extractKey(key)) ?? NIL_VALUE)`

**MAP_HAS:** `key = pop(); map = pop(); push(mkBooleanValue(map.v.has(extractKey(key))))`

**MAP_DELETE:** `key = pop(); map = pop(); map.v.delete(extractKey(key)); push(map)`

**STRUCT_NEW:**

```
numFields = instr.a
typeIdConstIdx = instr.b
fields = Dict.empty()
for i = 0 ..< numFields:
  val = pop(); fname = pop()
  fields.set(extractString(fname), val)
typeId = extractString(prog.constants.get(typeIdConstIdx))
push(mkStructValue(typeId, fields))
```

**STRUCT_GET / STRUCT_SET:** Dispatch to the registered type's `fieldGetter` / `fieldSetter`
hook if present, otherwise direct Dict read/write.

**GET_FIELD / SET_FIELD:** Polymorphic field access. Look up the value's type in the type
registry and dispatch to its fieldGetter/fieldSetter hook. Falls back to direct struct
field access.

### 9.9 Variable Resolution Chain

```typescript
resolveVariable(fiber, name):
  ctx = fiber.executionContext

  if ctx.resolveVariable:                  // custom resolver (e.g., shared scope chain)
    result = ctx.resolveVariable(name)
    return result ?? NIL_VALUE

  value = ctx.getVariable(name)            // local scope
  return value ?? NIL_VALUE
```

```typescript
setResolvedVariable(fiber, name, value):
  ctx = fiber.executionContext

  if ctx.setResolvedVariable:
    if ctx.setResolvedVariable(name, value): return

  ctx.setVariable(name, value)
```

### 9.10 Configuration

```typescript
interface VmConfig {
  maxFrameDepth: number; // default: 256
  maxStackSize: number; // default: 4096
  maxHandlers: number; // default: 64
  maxFibers: number; // default: 10000
  maxHandles: number; // default: 100000
  defaultBudget: number; // default: 1000
  debugStackChecks?: boolean; // default: false
}
```

### Tests

- PUSH_CONST: pushes correct value from constant pool.
- POP: removes top value.
- DUP: duplicates top value.
- SWAP: exchanges top two values.
- LOAD_VAR: unset variable returns NIL.
- STORE_VAR then LOAD_VAR: reads back stored value.
- JMP: unconditional jump adjusts PC by relative offset.
- JMP_IF_FALSE: false -> jumps; true -> falls through.
- JMP_IF_TRUE: true -> jumps; false -> falls through.
- CALL + RET: call function, return value to caller.
- Nested CALL: two levels of calls, correct return values.
- Recursion up to maxFrameDepth: works; exceeding -> fault.
- HOST_CALL: calls sync host function with MapValue args.
- HOST_CALL_ARGS: auto-wraps raw values into MapValue.
- WHEN_START/WHEN_END: false condition skips to skip label.
- YIELD: returns YIELDED status.
- Stack overflow detection.
- Stack underflow detection.
- Variable persistence across multiple runFiber calls (budget yields).
- Deep copy on STORE_VAR: mutating original struct does not affect stored variable.
- List operations: NEW, PUSH, GET, SET, LEN, POP, SHIFT, REMOVE, INSERT, SWAP.
- Map operations: NEW, SET, GET, HAS, DELETE.
- Struct operations: NEW, GET, SET with fieldGetter/fieldSetter hooks.
- GET_FIELD / SET_FIELD: polymorphic dispatch.

---

## 10. Phase 9 -- Async Handle System

### Goal

Implement asynchronous operation support: the HandleTable for tracking pending operations,
HOST_CALL_ASYNC / HOST_CALL_ARGS_ASYNC for starting async ops, and AWAIT for suspending and
resuming fibers.

### 10.1 HandleTable

```typescript
enum HandleState {
  PENDING = "PENDING",
  RESOLVED = "RESOLVED",
  REJECTED = "REJECTED",
  CANCELLED = "CANCELLED",
}

class HandleTable {
  createPending(): HandleId;
  get(id: HandleId): Handle | undefined;
  resolve(id: HandleId, result: Value): void;
  reject(id: HandleId, error: ErrorValue): void;
  cancel(id: HandleId): void;
  delete(id: HandleId): void;
  clear(): void;
  gc(): number; // removes non-PENDING handles with no waiters
  size(): number;

  // Event emitter: fires "completed" when a handle transitions out of PENDING
  events: EventEmitterConsumer<"completed", HandleId>;
}
```

### 10.2 Handle

```typescript
interface Handle {
  id: HandleId;
  state: HandleState;
  result?: Value; // set when RESOLVED
  error?: ErrorValue; // set when REJECTED or CANCELLED
  waiters: UniqueSet<number>; // fiber IDs waiting on this handle
  createdAt: number;
}
```

### 10.3 HOST_CALL_ASYNC Execution

```
execHostCallAsync(fiber, instr, frame):
  args = pop(fiber)                        // pre-built MapValue
  hid = handles.createPending()
  ctx = fiber.executionContext
  ctx.currentCallSiteId = instr.c
  fn = functionRegistry.getAsyncById(instr.a)
  fn.exec(ctx, args, hid)                  // host starts async work; will call resolve/reject
  push(fiber, { t: "handle", id: hid })    // push handle onto stack
  frame.pc++
```

The host function's `exec` receives the `handleId` and is responsible for eventually
calling `handleTable.resolve(hid, result)` or `handleTable.reject(hid, error)`.

### 10.4 HOST_CALL_ARGS_ASYNC

Same as HOST_CALL_ARGS but uses `getAsyncById` and produces a handle:

```
execHostCallArgsAsync(fiber, instr, frame):
  argc = instr.b
  args = collectArgsToMap(fiber, argc)
  hid = handles.createPending()
  ctx.currentCallSiteId = instr.c
  fn = functionRegistry.getAsyncById(instr.a)
  fn.exec(ctx, args, hid)
  push(fiber, { t: "handle", id: hid })
  frame.pc++
```

### 10.5 AWAIT Execution

```
execAwait(fiber, instr, frame):
  handleValue = pop(fiber)
  if handleValue.t !== "handle":
    push(fiber, handleValue)               // not a handle -- treat as resolved value
    frame.pc++
    return

  handle = handles.get(handleValue.id)

  switch handle.state:
    case RESOLVED:
      push(fiber, handle.result)
      frame.pc++
      return                               // continue execution

    case REJECTED:
    case CANCELLED:
      // inject error via throwValue (Phase 10) or fault
      return FAULT

    case PENDING:
      // suspend fiber
      fiber.await = {
        resumePc: frame.pc + 1,
        stackHeight: fiber.vstack.size(),
        frameDepth: fiber.frames.size(),
        handleId: handleValue.id,
      }
      handle.waiters.add(fiber.id)
      fiber.state = WAITING
      return { status: WAITING, handleId: handleValue.id }
```

### 10.6 Fiber Resumption

When a handle transitions to RESOLVED:

```
resumeFiberFromHandle(fiber, handleId, scheduler):
  handle = handles.get(handleId)
  awaitSite = fiber.await

  // Restore fiber state
  // Pop frames/stack to match await site depths
  push(fiber, handle.result)              // push resolved result
  fiber.await = undefined
  frame.pc = awaitSite.resumePc
  fiber.state = RUNNABLE
  scheduler.enqueueRunnable(fiber.id)
```

When a handle transitions to REJECTED:

```
  // Same restore process, but inject error
  fiber.pendingInjectedThrow = true
  fiber.lastError = handle.error
  fiber.state = RUNNABLE
  scheduler.enqueueRunnable(fiber.id)
```

### 10.7 Fiber State Machine

```
RUNNABLE --[AWAIT on PENDING handle]----> WAITING
WAITING  --[handle RESOLVED]-----------> RUNNABLE
WAITING  --[handle REJECTED/CANCELLED]--> RUNNABLE (with injected throw)
RUNNABLE --[RET at depth 0]------------> DONE
RUNNABLE --[unhandled exception]--------> FAULT
ANY      --[cancel()]------------------> CANCELLED
RUNNABLE --[budget exhausted]-----------> RUNNABLE (re-enqueued)
```

### Tests

- HandleTable: createPending -> resolve -> get returns RESOLVED with result.
- HandleTable: createPending -> reject -> get returns REJECTED with error.
- HandleTable: cancel -> state is CANCELLED.
- HandleTable: gc removes completed handles with no waiters.
- HOST_CALL_ASYNC: pushes handle, calls host function with handleId.
- AWAIT on already-resolved handle: immediately pushes result, continues.
- AWAIT on pending handle: fiber transitions to WAITING.
- Handle resolved -> fiber resumes with result value on stack.
- Handle rejected -> fiber resumes with injected throw.
- Multiple fibers awaiting same handle: all resume when resolved.
- HOST_CALL_ARGS_ASYNC: auto-wraps args, produces handle.

---

## 11. Phase 10 -- Exception Handling

### Goal

Implement structured exception handling: TRY, THROW, END_TRY opcodes with a handler stack
that unwinds frames and the operand stack on exceptions.

### 11.1 Handler

```typescript
interface Handler {
  catchPc: number; // absolute PC to jump to on exception
  stackHeight: number; // stack height when TRY was entered
  frameDepth: number; // frame depth when TRY was entered
}
```

### 11.2 TRY

```
execTry(fiber, instr, frame):
  if fiber.handlers.size() >= config.maxHandlers:
    fault("Too many exception handlers")
  catchPc = frame.pc + instr.a            // relative offset to catch block
  fiber.handlers.push({
    catchPc,
    stackHeight: fiber.vstack.size(),
    frameDepth: fiber.frames.size(),
  })
  frame.pc++
```

### 11.3 END_TRY

```
execEndTry(fiber, instr, frame):
  fiber.handlers.pop()                    // remove handler (exiting protected region)
  frame.pc++
```

### 11.4 THROW

```
execThrow(fiber, instr, frame):
  errValue = pop(fiber)
  if errValue.t !== "err":
    errValue = { t: "err", e: wrapAsError(errValue) }
  caught = throwValue(fiber, errValue)
  if !caught:
    fiber.state = FAULT
    fiber.lastError = errValue
    return { status: FAULT, error: errValue }
```

### 11.5 throwValue (Exception Unwinding)

```
throwValue(fiber, errValue):
  while fiber.handlers.size() > 0:
    handler = fiber.handlers.pop()

    // Unwind frames to handler depth
    while fiber.frames.size() > handler.frameDepth:
      fiber.frames.pop()

    // Unwind stack to handler height
    while fiber.vstack.size() > handler.stackHeight:
      pop(fiber)

    // Push error value (catch block can inspect it)
    push(fiber, errValue)

    // Jump to catch PC
    topFrame = fiber.frames.peek()
    topFrame.pc = handler.catchPc
    return true                            // caught

  return false                             // uncaught -> fault
```

### 11.6 Injected Throws

When a fiber resumes from a rejected async handle, the VM sets
`fiber.pendingInjectedThrow = true` and `fiber.lastError = error`. At the top of the
execution loop, before processing the next instruction:

```
if fiber.pendingInjectedThrow:
  fiber.pendingInjectedThrow = false
  caught = throwValue(fiber, fiber.lastError)
  if !caught: return FAULT
```

This allows exception handlers to catch async errors.

### Tests

- TRY/THROW/END_TRY: throw inside try block jumps to catch.
- THROW without handler: fiber faults.
- Nested TRY: inner handler catches first; outer catches if inner re-throws.
- THROW unwinds stack to handler's recorded height.
- THROW unwinds frames to handler's recorded depth.
- END_TRY without throw: handler popped, execution continues normally.
- Injected throw from rejected handle: caught by handler.
- maxHandlers exceeded: fault.

---

## 12. Phase 11 -- Fiber Scheduler

### Goal

Implement the `FiberScheduler` that manages multiple fibers, distributes instruction budgets,
and coordinates async handle completion notifications.

### 12.1 FiberScheduler

```typescript
class FiberScheduler implements IFiberScheduler {
  constructor(vm: VM, config?: Partial<SchedulerConfig>);

  spawn(funcId: number, args: List<Value>, executionContext: ExecutionContext): number;
  tick(): number;
  gc(): number;
  cancel(fiberId: number): void;
  getFiber(fiberId: number): Fiber | undefined;
  addFiber(fiber: Fiber): void;
  removeFiber(fiberId: number): void;
  enqueueRunnable(fiberId: number): void;
}
```

### 12.2 SchedulerConfig

```typescript
interface SchedulerConfig {
  maxFibersPerTick: number; // default: 64
  defaultBudget: number; // default: 1000
  autoGcHandles: boolean; // default: true
}
```

### 12.3 Core Data Structures

- `fibers: Dict<number, Fiber>` -- all tracked fibers
- `runQueue: List<number>` -- FIFO queue of RUNNABLE fiber IDs
- `nextFiberId: number` -- monotonically increasing ID allocator

### 12.4 spawn()

```
spawn(funcId, args, executionContext):
  fiberId = nextFiberId++
  fiber = vm.spawnFiber(fiberId, funcId, args, executionContext)
  fibers.set(fiberId, fiber)
  runQueue.push(fiberId)
  return fiberId
```

### 12.5 tick()

```
tick():
  executed = 0
  maxPerTick = config.maxFibersPerTick

  while runQueue.size() > 0 && executed < maxPerTick:
    fiberId = runQueue.shift()               // dequeue
    fiber = fibers.get(fiberId)

    if !fiber || fiber.state !== RUNNABLE:
      continue                               // GC'd or state changed

    fiber.instrBudget = config.defaultBudget
    result = vm.runFiber(fiber, this)

    switch result.status:
      case YIELDED:
        runQueue.push(fiberId)               // re-enqueue for next tick
      case WAITING:
        // fiber stays in fibers dict, waiting for handle
      case DONE:
        onFiberDone(fiberId, result.result)
      case FAULT:
        onFiberFault(fiberId, result.error)

    executed++

  return executed
```

### 12.6 Handle Completion Integration

The scheduler subscribes to the HandleTable's `"completed"` event:

```
onHandleCompleted(handleId):
  handle = vm.handles.get(handleId)
  if !handle: return

  for each fiberId in handle.waiters:
    fiber = fibers.get(fiberId)
    if fiber && fiber.state === WAITING:
      vm.resumeFiberFromHandle(fiber, handleId, this)
      // resumeFiberFromHandle sets state to RUNNABLE and calls enqueueRunnable()

  handle.waiters.clear()

  if config.autoGcHandles && handle.state !== PENDING:
    vm.handles.delete(handleId)
```

### 12.7 cancel()

```
cancel(fiberId):
  fiber = fibers.get(fiberId)
  if !fiber: return
  vm.cancelFiber(fiber, this)              // sets state to CANCELLED
```

### 12.8 gc()

```
gc():
  removed = 0
  for each fiber in fibers:
    if fiber.state in [DONE, FAULT, CANCELLED]:
      fibers.delete(fiber.id)
      removed++
  return removed
```

### Tests

- spawn: creates RUNNABLE fiber, adds to run queue.
- tick: executes one fiber, returns 1.
- tick: executes up to maxFibersPerTick fibers.
- tick with YIELDED fiber: re-enqueued for next tick.
- tick with DONE fiber: fiber remains in dict until gc().
- gc: removes DONE/FAULT/CANCELLED fibers, returns count.
- Handle completion resumes WAITING fiber.
- Multiple fibers waiting on same handle: all resume.
- cancel: transitions fiber to CANCELLED.
- Budget fairness: each fiber gets defaultBudget instructions per tick.

---

## 13. Phase 12 -- Brain Runtime

### Goal

Implement the `Brain` class that integrates the compiler, VM, and scheduler to provide
the high-level brain execution API used by the host application.

### 13.1 IBrain Interface

```typescript
interface IBrain {
  getVariable<T>(varId: string): T | undefined;
  setVariable(varId: string, value: Value): void;
  clearVariable(varId: string): void;

  initialize(contextData?: unknown): void;
  startup(): void;
  shutdown(): void;
  think(currentTime: number): void;

  rng(): number;
  setContextData(data: unknown): void;
  requestPageChange(pageIndex: number): void;
}
```

### 13.2 Brain Class

```typescript
class Brain implements IBrain {
  constructor(brainDef: IBrainDef, catalogs: ReadonlyList<ITileCatalog>);
}
```

Key private state:

```typescript
private enabled: boolean;
private currentPageIndex: number;
private desiredPageIndex: number;
private variables: Dict<string, Value>;
private program: BrainProgram | undefined;
private vm: VM | undefined;
private scheduler: FiberScheduler | undefined;
private executionContext: ExecutionContext | undefined;
private activeRuleFiberIds: List<{ funcId: number; fiberId: number | undefined }>;
```

### 13.3 initialize(contextData?)

```
initialize(contextData):
  program = compileBrain(brainDef, catalogs)
  handles = new HandleTable()
  vm = new VM(program, handles)
  scheduler = new FiberScheduler(vm, { maxFibersPerTick: 64, defaultBudget: 1000 })

  // Build funcId -> rule mapping for VM to set ctx.rule
  funcIdToRule = buildFuncIdToRuleMap(program.ruleIndex, brainDef)

  // Create execution context
  executionContext = {
    brain: this,
    getVariable: (name) => variables.get(name),
    setVariable: (name, value) => variables.set(name, value),
    clearVariable: (name) => variables.delete(name),
    data: contextData,
    callSiteState: Dict.empty(),
    funcIdToRule,
    currentTick: 0,
    time: 0,
    dt: 0,
  }
```

### 13.4 startup()

```
startup():
  currentPageIndex = 0
  desiredPageIndex = 0
  activatePage(0)
```

### 13.5 think(currentTime)

Called each frame by the host application:

```
think(currentTime):
  if !enabled: return
  dt = currentTime - executionContext.time

  // Handle page restart
  if interrupted:
    deactivateCurrentPage()
    activatePage(currentPageIndex)
    interrupted = false

  // Handle page change
  if desiredPageIndex !== currentPageIndex:
    deactivateCurrentPage()
    currentPageIndex = desiredPageIndex
    activatePage(currentPageIndex)

  thinkPage(currentTime, dt)
```

### 13.6 thinkPage(currentTime, dt)

```
thinkPage(currentTime, dt):
  executionContext.time = currentTime
  executionContext.dt = dt
  executionContext.currentTick++

  // Respawn completed root rule fibers
  for each entry in activeRuleFiberIds:
    if shouldRespawnFiber(entry.fiberId):
      entry.fiberId = scheduler.spawn(entry.funcId, List.empty(), executionContext)

  scheduler.tick()
  scheduler.gc()
```

`shouldRespawnFiber(fiberId)` returns true when the fiber is undefined, gone from the
scheduler, or in a terminal state (DONE, FAULT, CANCELLED). Root rule fibers automatically
respawn every tick, creating a continuous behavior loop.

### 13.7 activatePage(pageIndex)

```
activatePage(pageIndex):
  pageMetadata = program.pages.get(pageIndex)
  activeRuleFiberIds.clear()

  for each funcId in pageMetadata.rootRuleFuncIds:
    fiberId = scheduler.spawn(funcId, List.empty(), executionContext)
    activeRuleFiberIds.push({ funcId, fiberId })

  // Call onPageEntered for host functions with entry hooks
  for each { fnId, callSiteId } in pageMetadata.hostCallSites:
    fn = functionRegistry.get(fnId)
    if fn.onPageEntered:
      executionContext.currentCallSiteId = callSiteId
      fn.onPageEntered(executionContext)
```

### 13.8 deactivateCurrentPage()

```
deactivateCurrentPage():
  for each { fiberId } in activeRuleFiberIds:
    if fiberId !== undefined:
      scheduler.cancel(fiberId)
  activeRuleFiberIds.clear()
  scheduler.gc()
```

### 13.9 Page Changes

`requestPageChange(pageIndex)` sets `desiredPageIndex`. The actual page switch happens at
the start of the next `think()` call. This deferred approach prevents mid-tick state
corruption.

### 13.10 Variable Access

```typescript
getVariable<T>(varId: string): T | undefined {
  value = variables.get(varId)
  return value ? extractValue(value) : undefined
}

setVariable(varId: string, value: Value): void {
  variables.set(varId, value)
}

clearVariable(varId: string): void {
  variables.delete(varId)
}
```

### 13.11 ExecutionContext

The execution context bridges the VM to the host application:

```typescript
interface ExecutionContext {
  brain: IBrain;
  getVariable(varId: string): Value | undefined;
  setVariable(varId: string, value: Value): void;
  clearVariable(varId: string): void;
  resolveVariable?(name: string): Value | undefined;
  setResolvedVariable?(name: string, value: Value): boolean;

  parentContext?: ExecutionContext;
  sharedScope?: Dict<string, Value>;
  data?: unknown; // app-specific (game entity, DOM element, etc.)
  callSiteState?: Dict<number, unknown>; // per-HOST_CALL persistent state
  currentCallSiteId?: number; // set by VM before each HOST_CALL
  funcIdToRule?: Dict<number, IBrainRule>;
  rule?: IBrainRule; // set by VM from funcIdToRule lookup
  fiberId: number; // set by VM

  currentTick: number;
  time: number;
  dt: number;
}
```

### 13.12 Call-Site State

Host functions can store per-call-site persistent state via:

```typescript
function getCallSiteState<T>(ctx: ExecutionContext): T | undefined;
function setCallSiteState<T>(ctx: ExecutionContext, state: T): void;
```

These use `ctx.callSiteState` keyed by `ctx.currentCallSiteId`. This allows the same
sensor/actuator function to maintain independent state for each place it is called in
the brain (e.g., separate timers for separate `timeout` sensor instances).

### Tests

- initialize: compiles brain, creates VM and scheduler.
- startup: activates page 0, spawns root rule fibers.
- think: executes fibers, variables persist between ticks.
- Math expression (2 + 3 = x): x reads back as 5 after think.
- Boolean logic: AND, OR, NOT evaluate correctly.
- Comparison operators: ==, !=, <, >, <=, >= produce correct boolean results.
- WHEN condition false: DO section does not execute.
- WHEN condition true: DO section executes.
- Empty WHEN: always executes DO.
- Variable assignment: value persists across ticks.
- Root rule fiber respawn: completed rule re-executes on next tick.
- Multi-page: page switch via requestPageChange deactivates old page, activates new.
- Deactivation cancels active fibers.
- Sync sensor: HOST_CALL returns value.
- Async actuator: HOST_CALL_ASYNC -> AWAIT -> result.
- Call-site state: different call sites maintain independent state.
- Operator precedence: `2 + 3 * 4` = 14, not 20.
- Nested rules: parent WHEN gates child execution.
- Program structure: correct function count, constant pool, variable names, page metadata.

---

## Appendix A -- Complete Opcode Reference

### Stack Manipulation

| Op  | Name       | a        | b   | c   | Stack Effect       | Behavior            |
| --- | ---------- | -------- | --- | --- | ------------------ | ------------------- |
| 0   | PUSH_CONST | constIdx | -   | -   | `[] -> [v]`        | Push `constants[a]` |
| 1   | POP        | -        | -   | -   | `[v] -> []`        | Discard top         |
| 2   | DUP        | -        | -   | -   | `[v] -> [v, v]`    | Duplicate top       |
| 3   | SWAP       | -        | -   | -   | `[a, b] -> [b, a]` | Exchange top two    |

### Variables

| Op  | Name      | a       | b   | c   | Stack Effect | Behavior                                         |
| --- | --------- | ------- | --- | --- | ------------ | ------------------------------------------------ |
| 10  | LOAD_VAR  | nameIdx | -   | -   | `[] -> [v]`  | Load variable by name index via resolution chain |
| 11  | STORE_VAR | nameIdx | -   | -   | `[v] -> []`  | Deep-copy value, store by name index             |

### Control Flow

| Op  | Name         | a         | b   | c   | Stack Effect | Behavior                                |
| --- | ------------ | --------- | --- | --- | ------------ | --------------------------------------- |
| 20  | JMP          | relOffset | -   | -   | `[] -> []`   | Unconditional: `pc += a`                |
| 21  | JMP_IF_FALSE | relOffset | -   | -   | `[v] -> []`  | Pop; if falsy: `pc += a`; else: `pc++`  |
| 22  | JMP_IF_TRUE  | relOffset | -   | -   | `[v] -> []`  | Pop; if truthy: `pc += a`; else: `pc++` |

### Function Calls

| Op  | Name | a      | b    | c   | Stack Effect            | Behavior                          |
| --- | ---- | ------ | ---- | --- | ----------------------- | --------------------------------- |
| 30  | CALL | funcId | argc | -   | `[args...] -> [retval]` | Push frame, transfer control      |
| 31  | RET  | -      | -    | -   | `[retval] -> (return)`  | Pop frame, return value to caller |

### Host Calls

| Op  | Name                 | a    | b    | c          | Stack Effect             | Behavior                               |
| --- | -------------------- | ---- | ---- | ---------- | ------------------------ | -------------------------------------- |
| 40  | HOST_CALL            | fnId | argc | callSiteId | `[MapValue] -> [result]` | Sync call with pre-built Map args      |
| 41  | HOST_CALL_ASYNC      | fnId | argc | callSiteId | `[MapValue] -> [handle]` | Async call, returns handle             |
| 42  | HOST_CALL_ARGS       | fnId | argc | callSiteId | `[v0..vN] -> [result]`   | Sync call; pops N values, wraps as Map |
| 43  | HOST_CALL_ARGS_ASYNC | fnId | argc | callSiteId | `[v0..vN] -> [handle]`   | Async call; pops N, wraps as Map       |

HOST_CALL vs HOST_CALL_ARGS: the former expects a single pre-built MapValue on the stack
(used for sensors/actuators with complex argument maps). The latter pops `argc` raw values
and auto-wraps them into a MapValue with numeric keys `{0, 1, 2, ...}` (used for operators
and conversions).

### Async Operations

| Op  | Name  | a   | b   | c   | Stack Effect           | Behavior                                 |
| --- | ----- | --- | --- | --- | ---------------------- | ---------------------------------------- |
| 50  | AWAIT | -   | -   | -   | `[handle] -> [result]` | Suspend if pending; resume when resolved |
| 51  | YIELD | -   | -   | -   | `[] -> []`             | Return YIELDED status to scheduler       |

### Exception Handling

| Op  | Name    | a           | b   | c   | Stack Effect              | Behavior                             |
| --- | ------- | ----------- | --- | --- | ------------------------- | ------------------------------------ |
| 60  | TRY     | catchOffset | -   | -   | `[] -> []`                | Push handler; catchPc = `pc + a`     |
| 61  | END_TRY | -           | -   | -   | `[] -> []`                | Pop handler (exit protected region)  |
| 62  | THROW   | -           | -   | -   | `[errVal] -> (exception)` | Pop error; unwind to nearest handler |

### Semantic Boundaries

| Op  | Name       | a          | b   | c   | Stack Effect   | Behavior                 |
| --- | ---------- | ---------- | --- | --- | -------------- | ------------------------ |
| 70  | WHEN_START | -          | -   | -   | `[] -> []`     | No-op marker             |
| 71  | WHEN_END   | skipOffset | -   | -   | `[cond] -> []` | Pop; if falsy: `pc += a` |
| 72  | DO_START   | -          | -   | -   | `[] -> []`     | No-op marker             |
| 73  | DO_END     | -          | -   | -   | `[] -> []`     | No-op marker             |

### List Operations

| Op  | Name      | a      | b   | c   | Stack Effect                 | Behavior                 |
| --- | --------- | ------ | --- | --- | ---------------------------- | ------------------------ |
| 90  | LIST_NEW  | typeId | -   | -   | `[] -> [list]`               | Create empty list        |
| 91  | LIST_PUSH | -      | -   | -   | `[list, item] -> [list]`     | Append item (mutates)    |
| 92  | LIST_GET  | -      | -   | -   | `[list, idx] -> [val]`       | Get by index; NIL if OOB |
| 93  | LIST_SET  | -      | -   | -   | `[list, idx, val] -> [list]` | Set by index (mutates)   |
| 94  | LIST_LEN  | -      | -   | -   | `[list] -> [num]`            | Push list length         |
| 95  | LIST_POP  | -      | -   | -   | `[list] -> [val]`            | Pop last item; NIL if empty |
| 96  | LIST_SHIFT| -      | -   | -   | `[list] -> [val]`            | Shift first item; NIL if empty |
| 97  | LIST_REMOVE| -     | -   | -   | `[list, idx] -> [val]`       | Remove at index; NIL if OOB |
| 98  | LIST_INSERT| -     | -   | -   | `[list, idx, val] -> []`     | Insert at index (void)   |
| 99  | LIST_SWAP | -      | -   | -   | `[list, i, j] -> []`        | Swap elements (void)     |

### Map Operations

| Op  | Name       | a      | b   | c   | Stack Effect               | Behavior                   |
| --- | ---------- | ------ | --- | --- | -------------------------- | -------------------------- |
| 100 | MAP_NEW    | typeId | -   | -   | `[] -> [map]`              | Create empty map           |
| 101 | MAP_SET    | -      | -   | -   | `[map, key, val] -> [map]` | Set key-value (mutates)    |
| 102 | MAP_GET    | -      | -   | -   | `[map, key] -> [val]`      | Get by key; NIL if missing |
| 103 | MAP_HAS    | -      | -   | -   | `[map, key] -> [bool]`     | Check key existence        |
| 104 | MAP_DELETE | -      | -   | -   | `[map, key] -> [map]`      | Delete key (mutates)       |

### Struct Operations

| Op  | Name       | a         | b              | c   | Stack Effect                              | Behavior                         |
| --- | ---------- | --------- | -------------- | --- | ----------------------------------------- | -------------------------------- |
| 110 | STRUCT_NEW | numFields | typeIdConstIdx | -   | `[name1, v1, ..., nameN, vN] -> [struct]` | Create from field pairs          |
| 111 | STRUCT_GET | -         | -              | -   | `[struct, fieldName] -> [val]`            | Get field; uses fieldGetter hook |
| 112 | STRUCT_SET | -         | -              | -   | `[struct, fieldName, val] -> [struct]`    | Set field; uses fieldSetter hook |

### Generic Field Access

| Op  | Name      | a   | b   | c   | Stack Effect                           | Behavior                |
| --- | --------- | --- | --- | --- | -------------------------------------- | ----------------------- |
| 120 | GET_FIELD | -   | -   | -   | `[source, fieldName] -> [val]`         | Polymorphic field read  |
| 121 | SET_FIELD | -   | -   | -   | `[source, fieldName, val] -> [source]` | Polymorphic field write |

### Local Variables

| Op  | Name        | a     | b   | c   | Stack Effect      | Behavior                   |
| --- | ----------- | ----- | --- | --- | ----------------- | -------------------------- |
| 130 | LOAD_LOCAL  | index | -   | -   | `[] -> [val]`     | Push local from frame slot |
| 131 | STORE_LOCAL | index | -   | -   | `[val] -> []`     | Pop into frame slot        |

### Callsite Variables

| Op  | Name               | a     | b   | c   | Stack Effect  | Behavior                            |
| --- | ------------------ | ----- | --- | --- | ------------- | ----------------------------------- |
| 140 | LOAD_CALLSITE_VAR  | index | -   | -   | `[] -> [val]` | Push callsite-persistent variable   |
| 141 | STORE_CALLSITE_VAR | index | -   | -   | `[val] -> []` | Pop into callsite-persistent slot   |

### Type Introspection

| Op  | Name       | a      | b   | c   | Stack Effect       | Behavior                          |
| --- | ---------- | ------ | --- | --- | ------------------ | --------------------------------- |
| 150 | TYPE_CHECK | typeId | -   | -   | `[val] -> [bool]`  | Push true if value.t === typeId   |

### Indirect Calls

| Op  | Name          | a    | b   | c   | Stack Effect                       | Behavior                         |
| --- | ------------- | ---- | --- | --- | ---------------------------------- | -------------------------------- |
| 160 | CALL_INDIRECT | argc | -   | -   | `[func, arg1, ..., argN] -> [val]` | Call function value on stack     |

### Closures

| Op  | Name         | a      | b            | c   | Stack Effect                        | Behavior                          |
| --- | ------------ | ------ | ------------ | --- | ----------------------------------- | --------------------------------- |
| 170 | MAKE_CLOSURE | funcId | captureCount | -   | `[cap1, ..., capN] -> [func]`      | Create closure with captured vals |
| 171 | LOAD_CAPTURE | index  | -            | -   | `[] -> [val]`                       | Push captured value from closure  |

---

## Appendix B -- Compilation Diagnostic Codes

| Range       | Category    | Enum                  |
| ----------- | ----------- | --------------------- |
| 3000 - 3999 | Compilation | `CompilationDiagCode` |

These diagnostics are emitted by the bytecode compiler and are reported alongside parse
diagnostics (1000-1999) and type diagnostics (2000-2999) from the language pipeline.

---

## Appendix C -- VM Configuration Defaults

| Parameter        | Default | Description                                |
| ---------------- | ------- | ------------------------------------------ |
| maxFrameDepth    | 256     | Maximum call stack depth per fiber         |
| maxStackSize     | 4096    | Maximum operand stack size per fiber       |
| maxHandlers      | 64      | Maximum TRY handlers per fiber             |
| maxFibers        | 10000   | Maximum total fibers system-wide           |
| maxHandles       | 100000  | Maximum pending async handles              |
| defaultBudget    | 1000    | Instructions per fiber per scheduler tick  |
| maxFibersPerTick | 64      | Maximum fibers executed per scheduler tick |
| autoGcHandles    | true    | Auto-cleanup completed handles             |
| debugStackChecks | false   | Warn on stack height mismatch at RET       |
