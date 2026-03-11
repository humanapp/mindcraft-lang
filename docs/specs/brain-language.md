# Brain Language Architecture Spec

This document specifies the Mindcraft tile-based visual programming language architecture,
covering everything from the type system and tile schema through parsing and tile suggestions.
The bytecode compiler and runtime VM are out of scope -- they are covered by a separate spec.

The implementation target is `packages/core/src/brain/`. All code must follow the multi-target
constraints documented in `.github/instructions/core.instructions.md` (no `any`, no `typeof`,
no global `Error`, no Luau reserved words as identifiers, prefer `List`/`Dict` over native
`Array`/`Map`).

Each phase is a self-contained deliverable with its own tests. Complete one phase fully,
including passing tests, before moving to the next.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Phase 1 -- Platform Primitives & Type System](#2-phase-1----platform-primitives--type-system)
3. [Phase 2 -- Tile Schema & Tile Definitions](#3-phase-2----tile-schema--tile-definitions)
4. [Phase 3 -- Operator Table & Overloads](#4-phase-3----operator-table--overloads)
5. [Phase 4 -- Host Functions & Call Spec Grammar](#5-phase-4----host-functions--call-spec-grammar)
6. [Phase 5 -- Conversion Registry](#6-phase-5----conversion-registry)
7. [Phase 6 -- Tile Catalog, Factories & Builder](#7-phase-6----tile-catalog-factories--builder)
8. [Phase 7 -- Service Container & Registration](#8-phase-7----service-container--registration)
9. [Phase 8 -- AST & Expression Types](#9-phase-8----ast--expression-types)
10. [Phase 9 -- Parser (Pratt + Grammar)](#10-phase-9----parser-pratt--grammar)
11. [Phase 10 -- Type Inference Pipeline](#11-phase-10----type-inference-pipeline)
12. [Phase 11 -- Tile Suggestion Language Service](#12-phase-11----tile-suggestion-language-service)
13. [Phase 12 -- Brain Model Layer](#13-phase-12----brain-model-layer)
14. [Appendix A -- Core Operator Catalog](#appendix-a----core-operator-catalog)
15. [Appendix B -- Core Conversion Catalog](#appendix-b----core-conversion-catalog)
16. [Appendix C -- Diagnostic Code Ranges](#appendix-c----diagnostic-code-ranges)

---

## 1. Overview

### Pipeline

```
Tiles -> Parser (Pratt + grammar) -> AST (Expr) -> Type Inference -> Bytecode Compiler -> Program -> VM
```

This spec covers everything left of `-> Bytecode Compiler`. The bytecode compiler and VM
are covered in the VM spec.

### Key Design Principles

- **Tiles are tokens.** The language has no lexer; tiles arrive pre-tokenized from the UI.
- **Two parsing modes in one parser.** Expressions use Pratt (top-down operator precedence).
  Sensor/actuator argument lists use a grammar-based recursive descent with backtracking.
- **Type-safe overloaded operators.** Each operator (e.g. `+`) has multiple overloads keyed
  by argument types, resolved during type inference.
- **Implicit conversions.** A registry of typed conversion functions with costs enables
  automatic coercion (e.g. Number -> String) when no exact operator overload matches.
- **Grammar-driven argument parsing.** Each sensor/actuator defines a `BrainActionCallSpec`
  tree (bag, choice, seq, optional, repeat, conditional) that controls which arguments
  the parser will accept and in what order.
- **Multi-target.** All code must compile for Node.js, ESM, and Roblox-TS.

### File Layout

```
packages/core/src/brain/
  interfaces/        -- Pure types, enums, and interface contracts (no implementations)
    call-spec.ts     -- Call spec grammar helpers (mod, param, bag, choice, etc.)
    catalog.ts       -- ITileCatalog and IBrainTileDefBuilder interfaces
    conversions.ts   -- Conversion type and IConversionRegistry interface
    core-types.ts    -- CoreTypeIds, CoreTypeNames, mkTypeId
    emitter.ts       -- IBytecodeEmitter interface
    functions.ts     -- BrainActionCallSpec union, BrainFunctionEntry, IFunctionRegistry
    model.ts         -- IBrainDef, IBrainPageDef, IBrainRuleDef, IBrainTileSet
    operators.ts     -- OpSpec, OpOverload, IOperatorTable, IOperatorOverloads
    runtime.ts       -- Runtime interfaces (IBrain, etc.)
    tiles.ts         -- IBrainTileDef, TilePlacement, BrainTileKind, tile ID helpers
    type-system.ts   -- NativeType enum, TypeId, TypeDef, ITypeRegistry
    vm.ts            -- Value union, Op enum, HostFn types
  compiler/          -- Parser, type inference, bytecode emission
    types.ts         -- AST node types (Expr union), ExprVisitor, TypeEnv
    parser.ts        -- BrainParser (Pratt + grammar-based)
    expected-types.ts    -- Top-down expected type pass
    inferred-types.ts    -- Bottom-up inferred type pass
    diag-codes.ts    -- ParseDiagCode, TypeDiagCode, CompilationDiagCode
    expr-mapper.ts   -- AST node-ID -> Expr index
    expr-printer.ts  -- Debug printing
    index.ts         -- parseRule() and re-exports
  language-service/  -- IDE-like services
    tile-suggestions.ts  -- suggestTiles(), completeness checks, call-spec walking
  model/             -- Mutable document model
    braindef.ts      -- BrainDef (implements IBrainDef)
    pagedef.ts       -- BrainPageDef (implements IBrainPageDef)
    ruledef.ts       -- BrainRuleDef (implements IBrainRuleDef)
    tileset.ts       -- BrainTileSet (ordered tile list per rule side)
    tiledef.ts       -- BrainTileDefBase, BrainActionTileBase, serialization helpers
  runtime/           -- Concrete registry implementations, VM (VM out of scope here)
    type-system.ts   -- TypeRegistry
    operators.ts     -- OperatorTable, OperatorOverloads, RegisteredOperator, registerCoreOperators
    conversions.ts   -- ConversionRegistry, registerCoreConversions
    functions.ts     -- FunctionRegistry
  tiles/             -- Concrete tile definition classes
    operators.ts     -- BrainTileOperatorDef
    literals.ts      -- BrainTileLiteralDef
    variables.ts     -- BrainTileVariableDef
    factories.ts     -- BrainTileFactoryDef
    sensors.ts       -- BrainTileSensorDef
    actuators.ts     -- BrainTileActuatorDef
    parameters.ts    -- BrainTileParameterDef
    modifiers.ts     -- BrainTileModifierDef
    controlflow.ts   -- BrainTileControlFlowDef
    accessors.ts     -- BrainTileAccessorDef
    pagetiles.ts     -- BrainTilePageDef
    missing.ts       -- BrainTileMissingDef (placeholder for unresolved tiles)
    catalog.ts       -- TileCatalog (concrete ITileCatalog)
    builder.ts       -- BrainTileDefBuilder (concrete IBrainTileDefBuilder)
  services.ts        -- BrainServices container, get/set/reset global singleton
  services-factory.ts -- createBrainServices() wiring function
  index.ts           -- registerCoreBrainComponents(), barrel exports
```

---

## 2. Phase 1 -- Platform Primitives & Type System

### Goal

Establish the foundational type identifiers and type registry that every subsequent phase
depends on.

### 2.1 NativeType Enum

```typescript
enum NativeType {
  Unknown = -1,
  Void = 0,
  Nil = 1,
  Boolean = 2,
  Number = 3,
  String = 4,
  Enum = 5,
  List = 6,
  Map = 7,
  Struct = 8,
}
```

These are the fundamental categories. Concrete types are built on top.

### 2.2 TypeId

`TypeId` is a branded string: `"<nativeType>:<typeName>"` -- for example,
`"number:<number>"`, `"boolean:<boolean>"`, `"struct:<position>"`.

```typescript
type TypeId = string;
function mkTypeId(coreType: NativeType, typeName: string): TypeId;
```

### 2.3 CoreTypeIds

Well-known singletons:

| Constant              | TypeId pattern      |
| --------------------- | ------------------- |
| `CoreTypeIds.Unknown` | `unknown:<unknown>` |
| `CoreTypeIds.Void`    | `void:<void>`       |
| `CoreTypeIds.Nil`     | `nil:<nil>`         |
| `CoreTypeIds.Boolean` | `boolean:<boolean>` |
| `CoreTypeIds.Number`  | `number:<number>`   |
| `CoreTypeIds.String`  | `string:<string>`   |

### 2.4 TypeDef & Variants

```typescript
interface TypeDef {
  coreType: NativeType;
  typeId: TypeId;
  codec: TypeCodec; // encode/decode/stringify for serialization
  name: string;
}

// Specializations:
type EnumTypeDef = TypeDef & { symbols: List<{ key; label; deprecated? }>; defaultKey: string };
type ListTypeDef = TypeDef & { elementTypeId: TypeId };
type MapTypeDef = TypeDef & { valueTypeId: TypeId };
type StructTypeDef = TypeDef & { fields: List<{ name; typeId }>; fieldGetter?; fieldSetter?; snapshotNative? };
```

### 2.5 ITypeRegistry

```typescript
interface ITypeRegistry {
  get(id: TypeId): TypeDef | undefined;
  addVoidType(name: string): TypeId;
  addNilType(name: string): TypeId;
  addBooleanType(name: string): TypeId;
  addNumberType(name: string): TypeId;
  addStringType(name: string): TypeId;
  addEnumType(name: string, shape: EnumTypeShape): TypeId;
  addListType(name: string, shape: ListTypeShape): TypeId;
  addMapType(name: string, shape: MapTypeShape): TypeId;
  addStructType(name: string, shape: StructTypeShape): TypeId;
}
```

**Implementation:** `TypeRegistry` in `runtime/type-system.ts`. Each `add*` method constructs
a `TypeDef` with the appropriate `TypeCodec` (VoidCodec, NilCodec, BooleanCodec, NumberCodec,
StringCodec, EnumCodec, etc.) and registers it in an internal `Dict<TypeId, TypeDef>`.
Duplicate registrations throw.

### 2.6 Core Type Registration

`registerCoreTypes()` registers the six core types using `CoreTypeNames`:

```
Void, Nil, Boolean, Number, String
```

Each gets a codec that supports `encode(w, value)`, `decode(r): value`, and
`stringify(value): string`.

### Tests

- Registering each core type returns the expected `CoreTypeIds.*` value.
- `get()` retrieves the registered type.
- Duplicate registration throws.
- Each codec round-trips through `encode` / `decode`.
- `stringify` produces expected representations.

---

## 3. Phase 2 -- Tile Schema & Tile Definitions

### Goal

Define the tile type taxonomy, ID conventions, and the abstract base class that all concrete
tile kinds extend.

### 3.1 BrainTileKind

The `kind` discriminant for the tile definition union:

```
"literal" | "variable" | "operator" | "sensor" | "actuator" | "parameter" |
"modifier" | "controlFlow" | "factory" | "accessor" | "page" | "missing" | "undefined"
```

### 3.2 TilePlacement (bitflags)

```typescript
enum TilePlacement {
  WhenSide = 1, // Can appear on WHEN side
  DoSide = 2, // Can appear on DO side
  EitherSide = 3, // Both
  ChildRule = 4, // Can nest as child rule
  InsideLoop = 8, // Only valid inside loops
  Inline = 16, // Sensor/actuator participates in Pratt expressions like a literal
}
```

`Inline` is critical: an inline sensor is treated as an expression primary in the parser
(like a literal) and must have an empty call spec.

### 3.3 RuleSide

```typescript
enum RuleSide {
  When = 1,
  Do = 2,
  Either = When | Do,
}
```

### 3.4 Tile ID Conventions

All tile IDs follow `tile.<area>-><id>`, produced by `mkTileId(area, id)`.

| Tile Kind   | Pattern                                                       | Factory function               |
| ----------- | ------------------------------------------------------------- | ------------------------------ |
| operator    | `tile.op-><opId>`                                             | `mkOperatorTileId(opId)`       |
| controlFlow | `tile.cf-><cfId>`                                             | `mkControlFlowTileId(cfId)`    |
| variable    | `tile.var-><uniqueId>`                                        | `mkVariableTileId(uniqueId)`   |
| literal     | `tile.literal-><typeId>-><valueStr>` or `....[displayFormat]` | `mkLiteralTileId(...)`         |
| sensor      | `tile.sensor-><sensorId>`                                     | `mkSensorTileId(sensorId)`     |
| actuator    | `tile.actuator-><actuatorId>`                                 | `mkActuatorTileId(...)`        |
| parameter   | `tile.parameter-><parameterId>`                               | `mkParameterTileId(...)`       |
| modifier    | `tile.modifier-><modifierId>`                                 | `mkModifierTileId(...)`        |
| accessor    | `tile.accessor-><structTypeId>-><fieldName>`                  | `mkAccessorTileId(...)`        |
| page        | `tile.page-><pageId>`                                         | `mkPageTileId(pageId)`         |
| var.factory | `tile.var.factory-><factoryId>`                               | `mkVariableFactoryTileId(...)` |
| lit.factory | `tile.lit.factory-><factoryId>`                               | `mkLiteralFactoryTileId(...)`  |

### 3.5 IBrainTileDef Interface

```typescript
interface IBrainTileDef {
  readonly kind: BrainTileKind;
  readonly tileId: TileId;
  visual?: ITileVisual;
  placement?: TilePlacement;
  deprecated?: boolean;
  hidden?: boolean;
  persist?: boolean;
  capabilities(): ReadonlyBitSet;
  requirements(): ReadonlyBitSet;
  serializeHeader(stream: IWriteStream): void;
  serialize(stream: IWriteStream): void;
}
```

### 3.6 BrainTileDefBase (Abstract Class)

All concrete tile defs extend `BrainTileDefBase`:

- Stores `tileId`, placement flags, deprecated/hidden/persist flags, capabilities/requirements bitsets.
- `serializeHeader()` writes kind + tileId using tagged fields.
- `serialize()` calls `serializeHeader()` (subclasses extend with kind-specific data).

### 3.7 BrainActionTileBase

Extends `BrainTileDefBase`, implements `IBrainActionTileDef`, adding:

```typescript
readonly fnEntry: BrainFunctionEntry;
```

This is the shared base for `BrainTileSensorDef` and `BrainTileActuatorDef`.

### 3.8 Concrete Tile Definition Classes

| Class                     | Kind            | Key Properties                                                       |
| ------------------------- | --------------- | -------------------------------------------------------------------- |
| `BrainTileOperatorDef`    | `"operator"`    | `op: IReadOnlyRegisteredOperator`                                    |
| `BrainTileLiteralDef`     | `"literal"`     | `valueType: TypeId`, `value: unknown`, `displayFormat`, `valueLabel` |
| `BrainTileVariableDef`    | `"variable"`    | `varName: string`, `varType: TypeId`, `uniqueId: string`             |
| `BrainTileSensorDef`      | `"sensor"`      | `sensorId`, `outputType: TypeId`, extends `BrainActionTileBase`      |
| `BrainTileActuatorDef`    | `"actuator"`    | `actuatorId`, extends `BrainActionTileBase`                          |
| `BrainTileParameterDef`   | `"parameter"`   | `parameterId`, `dataType: TypeId`                                    |
| `BrainTileModifierDef`    | `"modifier"`    | `modifierId`                                                         |
| `BrainTileControlFlowDef` | `"controlFlow"` | `cfId`                                                               |
| `BrainTileAccessorDef`    | `"accessor"`    | `structTypeId`, `fieldName`, `fieldTypeId`, `readOnly`               |
| `BrainTileFactoryDef`     | `"factory"`     | `factoryId`, `producedDataType`, `manufacture()` callback            |
| `BrainTilePageDef`        | `"page"`        | `pageId`, page reference tile                                        |
| `BrainTileMissingDef`     | `"missing"`     | Placeholder for unresolvable tiles during deserialization            |

### 3.9 Literal Display Formats

Controls how numeric literal values display in the editor:

- `"default"` -- plain number
- `"percent"` / `"percent:N"` -- value \* 100 with "%" suffix
- `"fixed:N"` -- N decimal places
- `"thousands"` -- comma-separated groups
- `"time_seconds"` -- 2dp with "s" suffix
- `"time_ms"` -- value \* 1000 with "ms" suffix

### Tests

- Construct each tile def kind, verify `kind` discriminant and `tileId`.
- Verify tile ID factory functions produce the expected patterns.
- Round-trip serialization (binary): `serialize` -> `deserialize` reconstructs equivalent tile.
- Literal display format parsing: `parseDisplayFormat()` for each format string.

---

## 4. Phase 3 -- Operator Table & Overloads

### Goal

Implement the operator registry that maps operator IDs to parsing metadata and typed
overloads.

### 4.1 Operator Spec

```typescript
type OpSpec = {
  id: OpId;
  parse: OpParse;
};

type OpParse = {
  fixity: "infix" | "prefix" | "postfix";
  precedence: number;
  assoc?: "left" | "right" | "none";
};
```

### 4.2 Core Operator IDs

```typescript
const CoreOpId = {
  And: "and",
  Or: "or",
  Not: "not",
  Add: "add",
  Subtract: "sub",
  Multiply: "mul",
  Divide: "div",
  Negate: "neg",
  EqualTo: "eq",
  NotEqualTo: "ne",
  LessThan: "lt",
  LessThanOrEqualTo: "le",
  GreaterThan: "gt",
  GreaterThanOrEqualTo: "ge",
  Assign: "assign",
};
```

### 4.3 Precedence Table

| Precedence | Fixity | Assoc | Operators              |
| ---------- | ------ | ----- | ---------------------- |
| 30         | prefix | --    | `not`, `negate`        |
| 20         | infix  | left  | `mul`, `div`           |
| 10         | infix  | left  | `add`, `sub`           |
| 5          | infix  | none  | `lt`, `le`, `gt`, `ge` |
| 4          | infix  | none  | `eq`, `ne`             |
| 2          | infix  | left  | `and`                  |
| 1          | infix  | left  | `or`                   |
| 0          | infix  | right | `assign`               |

### 4.4 OpOverload

```typescript
type OpOverload = {
  argTypes: TypeId[];
  resultType: TypeId;
  fnEntry: BrainFunctionEntry;
};
```

Each operator can have multiple overloads (e.g. `add(Number,Number)->Number`,
`add(String,String)->String`). Overloads are keyed by the concatenation of arg TypeIds.

### 4.5 RegisteredOperator

Holds one `OpSpec` plus a `Dict<string, OpOverload>`. Methods:

- `add(overload)` -- register a typed overload. Throws on duplicate argTypes.
- `get(argTypes: TypeId[])` -- look up overload by arg types.
- `overloads()` -- return all overloads (needed by tile suggestions).

### 4.6 IOperatorTable

```typescript
interface IOperatorTable {
  add(op: OpSpec): IRegisteredOperator;
  get(id: OpId): IRegisteredOperator | undefined;
}
```

### 4.7 IOperatorOverloads

High-level convenience API:

```typescript
interface IOperatorOverloads {
  table(): IOperatorTable;
  binary(op, lhs, rhs, result, fn, isAsync): IRegisteredOperator;
  unary(op, arg, result, fn, isAsync): IRegisteredOperator;
  resolve(id, argTypes): { overload; parse } | undefined;
}
```

`binary()` and `unary()` internally register a `BrainFunctionEntry` with a synthetic name
(`$$op_<op>_<lhs>_<rhs>_to_<result>`) using the `IFunctionRegistry`, then add the overload.

### 4.8 Core Operator Registration

`registerCoreOperators()` registers all 15 operators in the table, then adds overloads.
See Appendix A for the full overload catalog.

### Tests

- Register operator, retrieve it, verify parse metadata.
- Add overloads, resolve by arg types.
- Duplicate overload throws.
- Conflicting parse metadata throws.
- Assignment operator is right-associative at precedence 0.

---

## 5. Phase 4 -- Host Functions & Call Spec Grammar

### Goal

Implement the function registry and the composable grammar-spec system that defines
sensor/actuator argument structures.

### 5.1 Host Function Types

```typescript
type HostSyncFn = { exec: (ctx: ExecutionContext, args: MapValue) => Value };
type HostAsyncFn = { exec: (ctx: ExecutionContext, args: MapValue, handleId: HandleId) => void };
type HostFn = HostSyncFn | HostAsyncFn;
```

### 5.2 BrainFunctionEntry

```typescript
type BrainFunctionCommon = { id: number; name: string; callDef: BrainActionCallDef };
type BrainSyncFunctionEntry = BrainFunctionCommon & { isAsync: false; fn: HostSyncFn };
type BrainAsyncFunctionEntry = BrainFunctionCommon & { isAsync: true; fn: HostAsyncFn };
type BrainFunctionEntry = BrainSyncFunctionEntry | BrainAsyncFunctionEntry;
```

`id` is assigned sequentially by the `FunctionRegistry`.

### 5.3 IFunctionRegistry

```typescript
interface IFunctionRegistry {
  register(name, isAsync, fn, callDef): BrainFunctionEntry;
  get(name): BrainFunctionEntry | undefined;
  getSyncById(id): BrainSyncFunctionEntry | undefined;
  getAsyncById(id): BrainAsyncFunctionEntry | undefined;
  size(): number;
}
```

### 5.4 BrainActionCallSpec (Grammar Nodes)

A recursive discriminated union describing argument grammars:

| Type          | Shape                                          | Semantics                           |
| ------------- | ---------------------------------------------- | ----------------------------------- |
| `arg`         | `{ tileId, name?, required?, anonymous? }`     | Single argument slot                |
| `seq`         | `{ items: CallSpec[] }`                        | All items in order                  |
| `choice`      | `{ options: CallSpec[] }`                      | Exactly one option                  |
| `optional`    | `{ item: CallSpec }`                           | Zero or one occurrence              |
| `repeat`      | `{ item: CallSpec, min?, max? }`               | Bounded repetition                  |
| `bag`         | `{ items: CallSpec[] }`                        | Unordered set                       |
| `conditional` | `{ condition: string, then: CallSpec, else? }` | Branch on named spec having matched |

Every node can carry an optional `name: string` used for `conditional` lookups.

### 5.5 Builder Helpers

```typescript
mod(tileId)                     // -> { type: "arg", tileId: mkModifierTileId(tileId) }
param(tileId, opts?)            // -> { type: "arg", tileId: mkParameterTileId(tileId), ... }
bag(...items)                   // -> { type: "bag", items }
choice(...options)              // -> { type: "choice", options }
seq(...items)                   // -> { type: "seq", items }
optional(item)                  // -> { type: "optional", item }
repeated(item, {min?, max?})    // -> { type: "repeat", item, min, max }
conditional(condition, then, else?) // -> { type: "conditional", condition, then, else }
```

### 5.6 BrainActionCallDef & Slot Flattening

```typescript
type BrainActionCallDef = {
  callSpec: BrainActionCallSpec;
  argSlots: ReadonlyList<BrainActionArgSlot>;
};

type BrainActionArgSlot = {
  slotId: number; // index in the flattened argSlots list
  argSpec: BrainActionCallArgSpec;
  choiceGroup?: number; // shared ID for mutual-exclusion
};
```

`mkCallDef(callSpec)` recursively walks the spec tree and collects all `arg` nodes into a
flat `argSlots` list. Slots inside a `choice` share a `choiceGroup` ID.

The `slotId` is the key used in the runtime `MapValue` passed to `HostFn.exec()`.

### 5.7 Anonymous vs Named Arguments

- **Anonymous** (`arg.anonymous = true`): the slot accepts any expression value directly.
  The parser parses an expression and assigns it to this slot.
- **Named parameter** (`arg.anonymous` is falsy, tile is a `parameter`): the parser looks
  for a specific parameter tile by `tileId`, then parses the subsequent expression as its value.
- **Modifier** (tile is a `modifier`): the parser looks for a specific modifier tile by
  `tileId`. No value follows -- modifiers are boolean flags.

### Tests

- `mkCallDef(bag(...))` flattens nested specs into correct `argSlots`.
- `choice` items share the same `choiceGroup`.
- `getSlotId(callDef, tileId)` returns correct index.
- Register function, retrieve by name and by ID.

---

## 6. Phase 5 -- Conversion Registry

### Goal

Implement the implicit type conversion system used by operators and action call arguments.

### 6.1 Conversion

```typescript
type Conversion = {
  id: number; // assigned by FunctionRegistry
  fromType: TypeId;
  toType: TypeId;
  cost: number; // lower is preferred
  fn: HostSyncFn; // the conversion function
  callDef: BrainActionCallDef;
};
```

### 6.2 IConversionRegistry

```typescript
interface IConversionRegistry {
  register(conv: Omit<Conversion, "id">): Conversion;
  get(fromType, toType): Conversion | undefined;
  findBestPath(fromType, toType, maxDepth?): List<Conversion> | undefined;
}
```

- `register` stores a conversion and registers the conversion function in the FunctionRegistry.
- `get` returns a single direct conversion (or undefined).
- `findBestPath` uses BFS with cost tracking to find the cheapest multi-hop conversion chain.
  Returns `undefined` if no path exists; returns an empty list if the types are already equal.

### 6.3 Core Conversions

See Appendix B for the full catalog.

| From    | To      | Cost |
| ------- | ------- | ---- |
| Number  | String  | 2    |
| String  | Number  | 2    |
| Number  | Boolean | 1    |
| Boolean | Number  | 1    |
| String  | Boolean | 2    |
| Boolean | String  | 1    |

### Tests

- Register a conversion, retrieve with `get`.
- `findBestPath` returns direct conversion when available.
- `findBestPath` returns multi-hop path (e.g. Number -> Boolean -> String finds Number -> String directly at cost 2).
- `findBestPath` returns `undefined` for disconnected types.
- `findBestPath` returns empty list when `fromType === toType`.
- Duplicate registration throws.

---

## 7. Phase 6 -- Tile Catalog, Factories & Builder

### Goal

Implement the tile catalog (registry of all tile definitions), the factory pattern for
creating user-defined tiles, and the builder that provides deserialization dispatch.

### 7.1 ITileCatalog

```typescript
interface ITileCatalog {
  has(tileId): boolean;
  add(tile): void;
  get(tileId): IBrainTileDef | undefined;
  delete(tileId): boolean;
  getAll(): List<IBrainTileDef>;
  find(predicate): IBrainTileDef | undefined;
  serialize(stream): void;
  deserialize(stream): void;
  registerTileDef(tile): void; // add + assign visual
}
```

**Implementation:** `TileCatalog` in `tiles/catalog.ts`. Uses `Dict<string, IBrainTileDef>`.
`registerTileDef` also assigns `tile.visual` via a pluggable `tileVisualProvider` function.

### 7.2 Tile Visual Provider

```typescript
function setTileVisualProvider(provider: (tileDef: IBrainTileDef) => ITileVisual): void;
```

Default provider: extracts label from the last segment of the tileId.

### 7.3 Factory Tiles

`BrainTileFactoryDef` is a special tile kind used in the UI to create new variable or
literal tiles on-the-fly. It has:

- `factoryId: string`
- `producedDataType: TypeId` -- the type of tile it creates
- `manufacture(factoryTileDef, opts)` -- callback that produces the actual tile

Core factories:

| Factory ID      | Produces                                                           |
| --------------- | ------------------------------------------------------------------ |
| `boolean`       | `BrainTileVariableDef` (Boolean)                                   |
| `number`        | `BrainTileVariableDef` (Number)                                    |
| `string`        | `BrainTileVariableDef` (String)                                    |
| `boolean` (lit) | `BrainTileLiteralDef` (Boolean -- via well-known true/false tiles) |
| `number` (lit)  | `BrainTileLiteralDef` (Number)                                     |
| `string` (lit)  | `BrainTileLiteralDef` (String)                                     |

Variable factories generate a unique `uniqueId` (via `SU.mkid()`) and create a variable
tile with that ID. Literal factories create a literal tile from the provided `value` option.

### 7.4 IBrainTileDefBuilder

Provides create and deserialize methods for each tile kind that needs custom serialization
(operator, controlFlow, variable, literal). Also provides a top-level `deserializeTileDef`
that peeks the kind from the stream header and dispatches.

### 7.5 Catalog Serialization

**Binary:** chunk-based format. `TCAT` chunk containing a count + each persistent tile's
serialized data. Only tiles with `persist = true` are serialized (literals, variables,
pages, missing).

**JSON:** parallel `toJson()` / `deserializeJson()` methods on TileCatalog. Each persistent
tile kind has `toJson()` and `fromJson()` on its class.

### Tests

- Add tiles to catalog, retrieve by ID.
- Duplicate ID insertion throws.
- `getAll()` returns all registered tiles.
- Binary round-trip: `serialize` -> `deserialize` reconstructs catalog.
- JSON round-trip: `toJson()` -> `deserializeJson()` reconstructs catalog.
- Factory `manufacture()` produces a valid tile with unique ID.

---

## 8. Phase 7 -- Service Container & Registration

### Goal

Wire all registries together in a single container and implement the one-shot initialization
function.

### 8.1 BrainServices

```typescript
class BrainServices {
  readonly tiles: ITileCatalog;
  readonly operatorTable: IOperatorTable;
  readonly operatorOverloads: IOperatorOverloads;
  readonly types: ITypeRegistry;
  readonly tileBuilder: IBrainTileDefBuilder;
  readonly functions: IFunctionRegistry;
  readonly conversions: IConversionRegistry;
}
```

### 8.2 Global Singleton

```typescript
function getBrainServices(): BrainServices; // throws if not initialized
function setBrainServices(services): void;
function hasBrainServices(): boolean;
function resetBrainServices(): void; // for testing only
```

### 8.3 createBrainServices()

Creates all registries in dependency order:

1. `TypeRegistry`
2. `FunctionRegistry`
3. `ConversionRegistry(functions)`
4. `OperatorTable` + `OperatorOverloads(table, functions)`
5. `TileCatalog`
6. `BrainTileDefBuilder`

Returns a `BrainServices` with all empty registries.

### 8.4 registerCoreBrainComponents()

One-shot initialization:

1. Skip if `hasBrainServices()` returns true (idempotent).
2. `createBrainServices()`
3. `setBrainServices(services)` -- must happen BEFORE registration so tile constructors
   can call `getBrainServices()`.
4. `registerCoreRuntimeComponents()`:
   - `registerCoreTypes()`
   - `registerCoreActuators()` (host functions for switch-page, restart-page, yield)
   - `registerCoreSensors()` (host functions for random, on-page-entered, timeout, current-page)
   - `registerCoreConversions()` (all six bidirectional conversions)
   - `registerCoreOperators()` (operator table + all overloads)
5. `registerCoreTileComponents()`:
   - `registerCoreOperatorTileDefs()` (one tile def per operator)
   - `registerCoreControlFlowTileDefs()` (open-paren, close-paren)
   - `registerCoreVariableFactoryTileDefs()` (boolean, number, string)
   - `registerCoreLiteralFactoryTileDefs()` (number, string factories + true/false/nil singletons)
   - `registerCoreParameterTileDefs()` (anonymous boolean, number, string parameters)
   - `registerCoreActuatorTileDefs()`
   - `registerCoreSensorTileDefs()`

### 8.5 Operator Tile Placement Rules

| Operator                         | Placement    |
| -------------------------------- | ------------ |
| `and`, `or`, `not`               | `EitherSide` |
| `+`, `-`, `*`, `/`, `neg`        | `EitherSide` |
| `==`, `!=`, `<`, `<=`, `>`, `>=` | `WhenSide`   |
| `=` (assign)                     | `DoSide`     |

### Tests

- `registerCoreBrainComponents()` succeeds.
- After registration, all expected tile IDs exist in the catalog.
- All core operators are in the operator table with correct precedence/fixity.
- All core conversions are in the conversion registry.
- Double-calling `registerCoreBrainComponents()` is a no-op.

---

## 9. Phase 8 -- AST & Expression Types

### Goal

Define the expression AST that the parser produces and the visitor interface for traversing it.

### 9.1 Span

```typescript
type Span = { from: number; to: number }; // half-open interval [from, to)
```

Tile indices, not character offsets (tiles are the tokens).

### 9.2 Expr (Discriminated Union)

```typescript
type Expr =
  | BinaryOpExpr // { kind: "binaryOp",   nodeId, operator, left, right, span }
  | UnaryOpExpr // { kind: "unaryOp",    nodeId, operator, operand, span }
  | LiteralExpr // { kind: "literal",    nodeId, tileDef, span }
  | VariableExpr // { kind: "variable",   nodeId, tileDef, span }
  | AssignmentExpr // { kind: "assignment",  nodeId, target: Variable|FieldAccess, value, span }
  | ParameterExpr // { kind: "parameter",  nodeId, tileDef, value: Expr, span }
  | ModifierExpr // { kind: "modifier",   nodeId, tileDef, span }
  | ActuatorExpr // { kind: "actuator",   nodeId, tileDef, anons, parameters, modifiers, span }
  | SensorExpr // { kind: "sensor",     nodeId, tileDef, anons, parameters, modifiers, span }
  | FieldAccessExpr // { kind: "fieldAccess", nodeId, object: Expr, accessor: BrainTileAccessorDef, span }
  | EmptyExpr // { kind: "empty",      nodeId }
  | ErrorExpr; // { kind: "errorExpr",  nodeId, expr?, message, span? }
```

Every node has a `nodeId: number` (monotonically increasing, assigned by the parser).
Non-trivial nodes have a `span`.

### 9.3 SlotExpr

For action call arguments:

```typescript
type SlotExpr = { slotId: number; expr: Expr };
```

`slotId` maps back to a `BrainActionArgSlot.slotId` in the tile's call definition.

### 9.4 ExprVisitor\<T\>

One method per `Expr` variant. Used by type inference, the bytecode compiler, the expression
printer, etc.

```typescript
interface ExprVisitor<T> {
  visitBinaryOp(expr: BinaryOpExpr): T;
  visitUnaryOp(expr: UnaryOpExpr): T;
  visitLiteral(expr: LiteralExpr): T;
  visitVariable(expr: VariableExpr): T;
  visitAssignment(expr: AssignmentExpr): T;
  visitParameter(expr: ParameterExpr): T;
  visitModifier(expr: ModifierExpr): T;
  visitActuator(expr: ActuatorExpr): T;
  visitSensor(expr: SensorExpr): T;
  visitFieldAccess(expr: FieldAccessExpr): T;
  visitEmpty(expr: EmptyExpr): T;
  visitError(expr: ErrorExpr): T;
}
```

### 9.5 acceptExprVisitor

Centralized switch dispatch:

```typescript
function acceptExprVisitor<T>(expr: Expr, visitor: ExprVisitor<T>): T;
```

### 9.6 ParseResult

```typescript
interface ParseResult {
  exprs: ReadonlyList<Expr>; // first is the main expr; rest are error-recovery
  diags: ReadonlyList<ParseDiag>;
  nextNodeId: number;
}
```

### 9.7 TypeEnv & TypeInfo

```typescript
type TypeEnv = Dict<number, TypeInfo>; // keyed by nodeId

type TypeInfo = {
  inferred: TypeId;
  expected: TypeId;
  isLVal?: boolean;
  overload?: OpOverload;
  conversion?: Conversion;
};
```

### Tests

- Construct each `Expr` variant and dispatch through `acceptExprVisitor`.
- Verify exhaustive handling (TypeScript enforces this at compile time).

---

## 10. Phase 9 -- Parser (Pratt + Grammar)

### Goal

Implement the parser that converts a `ReadonlyList<IBrainTileDef>` into a `ParseResult`.

### 10.1 Architecture

The parser is a single class `BrainParser` with:

- **Token stream:** the input `ReadonlyList<IBrainTileDef>`, indexed by `this.i`.
- **NUD handlers:** a `Dict<BrainTileKind, NudHandler>` mapping tile kinds to prefix parsers.
- **LED handling:** inline in `parseExpression()`, checking operator precedence.
- **Action call parsing:** a separate `parseActionCall()` method for sensors/actuators that
  uses grammar-based parsing with backtracking.

### 10.2 Entry Point

`parseBrainTiles(src, to?, from?, startNodeId?)` creates a `BrainParser` and calls `parse()`.

### 10.3 Top-Level Dispatch (`parseTop`)

For each token:

1. If `kind === "sensor" && !isInline(tok)` or `kind === "actuator"` -> `parseActionCall(opts)`.
2. Otherwise -> `parseExpression(opts)`.

The first expression is accepted as the main result. Subsequent expressions are wrapped in
`ErrorExpr` (extra expressions indicate a parse error but are preserved for tooling).

### 10.4 Expression Parsing (`parseExpression`) -- Pratt Algorithm

1. **NUD phase:** consume one token, dispatch to a NUD handler based on `kind`.
2. **LED loop:** while the next token is an infix operator with `precedence >= minOperatorPrecedence`:
   - If accessor tile -> wrap left in `FieldAccessExpr` (max precedence binding).
   - If infix operator -> consume, recursively parse right side, build `BinaryOpExpr`.
   - If assignment operator -> consume, recursively parse right side (right-associative
     by using same `minOperatorPrecedence` instead of `precedence + 1`), build `AssignmentExpr`.
   - If `primaryAdjacencyTerminates` and next token is a primary start -> break.

### 10.5 NUD Handlers

| Kind          | Handler               | Behavior                                                                      |
| ------------- | --------------------- | ----------------------------------------------------------------------------- |
| `literal`     | `parseNudLiteral`     | Consume, return `LiteralExpr`                                                 |
| `variable`    | `parseNudVariable`    | Consume, return `VariableExpr`                                                |
| `operator`    | `parseNudOperator`    | Consume prefix op, recursively parse operand, return `UnaryOpExpr`            |
| `controlFlow` | `parseNudControlFlow` | `(` -> parse inner expr with reset precedence, expect `)`, wrap               |
| `sensor`      | `parseNudSensor`      | Inline -> `SensorExpr` (empty args); non-inline -> back up, `parseActionCall` |
| `page`        | `parseNudLiteral`     | Treated as a literal (page reference value)                                   |

### 10.6 Accessor Tile Handling (LED position)

When the LED loop encounters an accessor tile:

1. Consume the accessor tile.
2. Wrap `left` in `FieldAccessExpr(left, accessorDef)`.
3. Continue loop (accessor binds at maximum precedence).

### 10.7 Assignment Handling

Assignment (`=`) is detected in the LED loop. The parser:

1. Verifies the left side is a `VariableExpr` or `FieldAccessExpr`. If not, emits
   `InvalidAssignmentTarget` diagnostic.
2. If `FieldAccessExpr` with `readOnly`, emits `ReadOnlyFieldAssignment` diagnostic.
3. Recursively parses the right side with `minOperatorPrecedence = 0` (right-associative).
4. Produces `AssignmentExpr { target, value }`.

### 10.8 Action Call Parsing (`parseActionCall`)

1. Consume the sensor/actuator tile.
2. Build `argSpecToSlotId` map from the tile's `callDef.argSlots`.
3. Create `ActionCallContext` (accumulates anons, parameters, modifiers).
4. Call `parseCallSpec(callSpec, opts, ctx)` on the tile's root call spec.
5. Return `ActuatorExpr` or `SensorExpr` with the accumulated slot lists.

### 10.9 Call Spec Parsing (Grammar Handlers)

Each call spec type has its own handler:

- **`arg`**: If anonymous, parse an expression. If modifier/parameter, match by `tileId`.
- **`seq`**: Parse all items in order. Return false if any required item fails.
- **`choice`**: Try each option with backtracking. First successful match wins.
- **`optional`**: Try inner item; always succeeds.
- **`repeat`**: Try inner item up to `max` times; succeed if count >= `min`.
- **`bag`**: Greedy unordered matching. Keep trying all items until none match. Items with
  `repeat` descendants are re-tried even after matching. Check that all required items matched.
- **`conditional`**: Check if a named spec was matched in context; parse `then` or `else` branch.

### 10.10 Backtracking

`tryParseWithBacktrack(spec, opts, ctx, outerCtx)`:

1. Save parser position.
2. Parse into temporary lists.
3. If successful AND tokens were consumed -> commit results, return true.
4. If failed or no tokens consumed -> restore position, return false.

### 10.11 `isPrimaryStart`

A token is a "primary start" if it's a modifier, parameter, or non-inline sensor/actuator.
Inline sensors are **not** primary starts -- they participate in normal expression parsing.

### 10.12 `primaryAdjacencyTerminates`

When true, the expression parser stops before consuming an adjacent primary. This prevents
action call arguments from swallowing each other: `[move] [forward]` should parse as
`ActuatorCall("move") + modifier("forward")`, not as the move actuator taking a variable
named "forward" as its value.

### 10.13 Error Recovery

The parser never throws (except for invalid configuration). Parse errors produce `ErrorExpr`
nodes wrapping any partial expression, with diagnostics pushed to the `diags` list.

### Tests

The parser spec file should test:

- Empty input -> `EmptyExpr`.
- Single literal -> `LiteralExpr`.
- Single variable -> `VariableExpr`.
- Binary operator: `[3] [+] [4]` -> `BinaryOpExpr`.
- Nested operators respect precedence: `[2] [+] [3] [*] [4]` -> `add(2, mul(3, 4))`.
- Unary prefix: `[not] [true]` -> `UnaryOpExpr`.
- Parentheses: `[(] [2] [+] [3] [)] [*] [4]` -> `mul(add(2, 3), 4)`.
- Assignment: `[$x] [=] [5]` -> `AssignmentExpr`.
- Assignment is right-associative: `[$x] [=] [$y] [=] [5]` -> `assign(x, assign(y, 5))`.
- Sensor with args: `[timeout] [5]` -> `SensorExpr` with anon slot.
- Actuator with modifiers: `[move] [forward] [quickly]` -> `ActuatorExpr` with modifier slots.
- Inline sensor in expression: `[random] [+] [1]` -> `BinaryOp(SensorExpr(random), 1)`.
- Action call with `bag` spec: modifiers in any order.
- Action call with `choice` spec: only one option accepted.
- Action call with `conditional` spec: dependent args only after condition met.
- Field access: `[$pos] [x]` -> `FieldAccessExpr`.
- Error recovery: extra expressions after first produce `ErrorExpr` wrappers.
- Unclosed parenthesis produces diagnostic.
- Invalid assignment target produces diagnostic.

---

## 11. Phase 10 -- Type Inference Pipeline

### Goal

Implement the two-pass type inference that populates `TypeEnv` with inferred types,
expected types, operator overloads, and conversions for every AST node.

### 11.1 Two-Pass Architecture

Type inference runs per rule (WHEN and DO sides combined):

1. **`computeExpectedTypes(expr, env)`** -- Top-down pass. Walks the tree and sets
   `TypeInfo.expected` and `TypeInfo.isLVal` based on structural context.
2. **`computeInferredTypes(expr, catalogs, env)`** -- Bottom-up pass. Walks the tree,
   sets `TypeInfo.inferred`, resolves operator overloads, and applies implicit conversions.

Both passes use `ExprVisitor<void>` implementations.

### 11.2 Expected Types Pass

| Node Kind   | Expected Type Logic                                          |
| ----------- | ------------------------------------------------------------ |
| literal     | `inferred = tileDef.valueType` (set eagerly)                 |
| variable    | `expected = tileDef.varType`, `isLVal = true`                |
| parameter   | `expected = tileDef.dataType`                                |
| modifier    | `expected = Void`                                            |
| actuator    | `expected = Void`, recurse into all slot exprs               |
| sensor      | `expected = tileDef.outputType`, recurse into all slot exprs |
| fieldAccess | `expected = accessor.fieldTypeId`, recurse into object       |
| binaryOp    | Recurse into left and right                                  |
| unaryOp     | Recurse into operand                                         |
| assignment  | Recurse into target and value                                |

### 11.3 Inferred Types Pass

| Node Kind   | Inference Logic                                                                   |
| ----------- | --------------------------------------------------------------------------------- |
| literal     | `inferred = tileDef.valueType`                                                    |
| variable    | `inferred = tileDef.varType`                                                      |
| fieldAccess | `inferred = accessor.fieldTypeId`                                                 |
| modifier    | `inferred = Void`                                                                 |
| parameter   | `inferred = value's inferred type`                                                |
| actuator    | `inferred = Void`; validate each slot's type against callDef                      |
| sensor      | `inferred = tileDef.outputType`; validate each slot's type against callDef        |
| assignment  | `inferred = value's inferred type`; check target type compatibility               |
| binaryOp    | Resolve overload: try exact match, then convert right to left, then left to right |
| unaryOp     | Resolve overload: try exact match, then try converting to common types            |

### 11.4 Operator Overload Resolution (Binary)

Algorithm within `visitBinaryOp`:

1. Get `leftType` and `rightType` (prefer `inferred` over `expected` when not `Unknown`).
2. Try `operator.get([leftType, rightType])` -- exact match.
3. If no match, try converting right to left: `findBestPath(rightType, leftType, 1)`.
   If conversion exists and `operator.get([leftType, leftType])` succeeds, apply.
4. If still no match, try converting left to right: `findBestPath(leftType, rightType, 1)`.
   If conversion exists and `operator.get([rightType, rightType])` succeeds, apply.
5. If no viable overload, emit `NoOverloadForBinaryOp` diagnostic.

When an implicit conversion is used, the `Conversion` object is stored on the
**operand node's** `TypeInfo.conversion` (not on the operator node).

### 11.5 Action Call Slot Validation

For each anonymous and parameter slot in an actuator/sensor:

1. Look up the slot's tile definition by `tileId` from the catalogs.
2. If in a choice group, check if any option accepts the inferred type.
3. Otherwise, check inferred type against the parameter's `dataType`.
4. If mismatch, try `findBestPath(inferred, expected, 1)` for implicit conversion.
5. Store conversion on the slot expr's `TypeInfo` if found.

### Tests

- Literal: inferred type matches value type.
- Variable: inferred type matches var type.
- Binary op with exact overload: inferred type is result type.
- Binary op with right-to-left conversion: conversion stored on right operand.
- Binary op with no overload: `NoOverloadForBinaryOp` diagnostic.
- Unary op with overload: correct inferred type.
- Sensor output type correct.
- Actuator slot type validation catches mismatch.
- Conversion applies to action call argument.

---

## 12. Phase 11 -- Tile Suggestion Language Service

### Goal

Implement `suggestTiles()` -- the function that determines which tiles are valid at a given
cursor position and returns them categorized by type compatibility.

### 12.1 InsertionContext

```typescript
interface InsertionContext {
  ruleSide: RuleSide;
  expectedType?: TypeId;
  expr?: Expr; // parsed AST at the insertion point
  replaceTileIndex?: number; // for replacement mode
}
```

### 12.2 TileSuggestionResult

```typescript
interface TileSuggestionResult {
  exact: List<TileSuggestion>; // exact match or unchecked
  withConversion: List<TileSuggestion>; // require conversion
}

interface TileSuggestion {
  tileDef: IBrainTileDef;
  compatibility: TileCompatibility; // Exact(0) | Conversion(1) | Unchecked(2)
  conversionCost: number;
}
```

### 12.3 Two Modes

**Append mode** (`replaceTileIndex` not set):

Dispatches on `expr.kind`:

| Expr Kind                              | Suggestions                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `empty` / `errorExpr`                  | All placement-compatible tiles in expression position (no infix operators)                   |
| `literal` / `variable` / `fieldAccess` | Infix operators + accessor tiles (value is complete)                                         |
| `binaryOp` / `assignment`              | If complete: infix operators. If incomplete: value tiles (valueOnly mode)                    |
| `actuator` / `sensor`                  | Call spec tiles (if unfilled slots remain) + infix operators (if trailing value is complete) |
| `unaryOp`                              | Depends on operand: delegates appropriately                                                  |
| `parameter` / `modifier`               | Nothing                                                                                      |

**Replacement mode** (`replaceTileIndex` is set):

Walks AST via `findReplacementRole` to determine the structural role at the tile index:

| Role                 | Suggestions                                             |
| -------------------- | ------------------------------------------------------- |
| `expressionPosition` | All placement-compatible tiles                          |
| `value`              | Value-producing tiles only                              |
| `infixOperator`      | Infix operator tiles only                               |
| `prefixOperator`     | Prefix operator tiles only                              |
| `actionCallArg`      | Call spec tiles (excluded slot removed from filled set) |
| `accessorPosition`   | Accessor tiles for the same struct type                 |

### 12.4 Call Spec Grammar Enforcement

`collectAvailableArgSlots(spec, argSlots, filledSlotIds, available, repeatMax, rootSpec)`:

Recursively walks the call spec tree to determine which arg slots are currently available:

- **`arg`**: available if fill count < `repeatMax`.
- **`bag`**: all items independently available.
- **`choice`**: if one option filled, others excluded; else all available.
- **`seq`**: all items suggested (ordering enforced by parser, not suggestions).
- **`optional`**: delegates to inner item.
- **`repeat`**: overrides `repeatMax` for descendants.
- **`conditional`**: evaluates condition, recurses into `then` or `else`.

### 12.5 Infix Operator Filtering

Infix operators are filtered by checking if they have any overload whose first argument type
matches the left operand's inferred type. Matching operators go to the `exact` result as
`Unchecked`. Non-matching operators are excluded entirely (no conversion-based operator
suggestions).

### 12.6 Type Compatibility Classification

`classifyTypeCompatibility(outputType, expectedType, conversions)`:

- If no `expectedType` or no `outputType` -> `Unchecked`.
- If `outputType === expectedType` -> `Exact`.
- If `findBestPath(outputType, expectedType)` succeeds -> `Conversion` with total cost.
- If output is a struct type and any field matches expected type -> `Conversion` (struct field fallback).
- Otherwise -> not compatible (excluded from results).

### 12.7 `valuePending` State

When suggesting tiles inside an action call, the system computes:

```
valuePending = unclosedParenDepth > 0
             || hasParametersNeedingValues(expr)
             || hasIncompleteAnonValues(expr)
             || hasStructValuePendingAccessor(expr)
```

When `valuePending` is true, named parameter and modifier tiles are suppressed because the
user needs to complete the current value expression first.

### 12.8 Expression Completeness

`isCompleteValueExpr(expr)` returns true when the expr produces a consumable value:

- Literals, variables, field accesses -> complete.
- Sensors (inline or not) with all required args filled -> complete.
- Unary ops with a complete operand -> complete.
- Binary ops with a complete right operand -> complete.
- Actuators, parameters, modifiers, empty, error -> not complete.
- Incomplete binary op (missing right) -> not complete.

### 12.9 Helper: `parseTilesForSuggestions`

Convenience function that parses a tile list into an AST suitable for `InsertionContext.expr`.
Returns `EmptyExpr` for empty lists.

### Tests

- Empty expr: suggests all expression tiles, no infix operators.
- After literal: suggests infix operators + accessor tiles.
- After incomplete binary op: suggests value tiles with type constraint.
- Inside actuator with unfilled slots: suggests correct call spec tiles.
- Replacement mode: `infixOperator` role suggests only infix operators.
- Replacement mode: `value` role suggests value tiles with expected type.
- Call spec with choice: after filling one option, others excluded.
- Call spec with conditional: dependent items only after condition met.
- Operator suggestion filtering: only operators whose LHS type matches.
- `valuePending` suppresses parameter/modifier suggestions.
- Type compatibility classifies exact, conversion, and unchecked.

---

## 13. Phase 12 -- Brain Model Layer

### Goal

Implement the mutable document model that represents a brain's pages, rules, and tile sets.

### 13.1 Model Hierarchy

```
IBrainDef
  |-- pages: List<IBrainPageDef>
        |-- children: List<IBrainRuleDef>
              |-- when: IBrainTileSet
              |-- do: IBrainTileSet
              |-- children: List<IBrainRuleDef>  (nested rules)
```

### 13.2 BrainDef

Concrete implementation of `IBrainDef`:

- `name` with max length (`kMaxBrainNameLength = 100`).
- Page management (append, insert, remove) with max count (`kMaxBrainPageCount = 20`).
- Owns a per-brain `TileCatalog` for persisted tiles (literals, variables).
- `compile()` creates a `Brain` (VM runner, out of scope).
- `typecheck()` delegates to each page.
- Events: `name_changed`, `brain_changed`.
- Serialization: binary (chunk-based) and JSON.

### 13.3 BrainPageDef

- `pageId` (unique string per page).
- `name` (display name).
- Children: `List<BrainRuleDef>` (rules are the top-level constructs within a page).
- Events: `name_changed`, `page_changed`.
- Serialization: binary and JSON.

### 13.4 BrainRuleDef

- `when()` -> `IBrainTileSet` (WHEN side tile list).
- `do()` -> `IBrainTileSet` (DO side tile list).
- `children()` -> nested child rules.
- `ancestor()` -> parent rule (for hierarchy nesting).
- Movement operations: `moveUp`, `moveDown`, `indent`, `outdent`.
- Depth-limited nesting: `myDepth()`, `maxDepth()`.
- Events: `rule_deleted`, `rule_dirtyChanged`.
- Serialization: binary and JSON.

### 13.5 BrainTileSet

An ordered list of tiles for one side of a rule:

- `tiles()` -> `ReadonlyList<IBrainTileDef>`.
- Mutation: `appendTile`, `insertTileAtIndex`, `replaceTileAtIndex`, `removeTileAtIndex`.
- `isDirty()` / `markDirty()` for incremental recompilation.
- Events: `tileSet_dirtyChanged`, `tileSet_typechecked`.
- Serialization: each tile written/read via the tile builder.

### 13.6 JSON Round-Trip

`BrainDef.toJson() -> BrainJson`, `BrainDef.fromJson(json, catalog) -> BrainDef`.

`brainJsonFromPlain(obj)` converts a raw `JSON.parse` output (with plain arrays) back into
`List`-based `BrainJson`.

### Tests

- Create brain, add pages, add rules, add tiles.
- Move rules (up/down/indent/outdent).
- Binary round-trip: serialize/deserialize full brain.
- JSON round-trip: `toJson()` -> JSON.stringify -> JSON.parse -> `brainJsonFromPlain` -> `fromJson`.
- Events fire on mutation.
- Max page limit enforced.
- `containsTileId` searches all pages and rules.

---

## Appendix A -- Core Operator Catalog

### Prefix Operators

| Op       | Arg Type | Result Type | Implementation |
| -------- | -------- | ----------- | -------------- |
| `not`    | Boolean  | Boolean     | `!a`           |
| `negate` | Number   | Number      | `-a`           |

### Binary Operators

| Op    | LHS     | RHS     | Result  | Implementation                 |
| ----- | ------- | ------- | ------- | ------------------------------ |
| `and` | Boolean | Boolean | Boolean | `a && b` (short-circuit)       |
| `or`  | Boolean | Boolean | Boolean | `a or b` (short-circuit)       |
| `add` | Number  | Number  | Number  | `a + b`                        |
| `add` | String  | String  | String  | concat                         |
| `sub` | Number  | Number  | Number  | `a - b`                        |
| `mul` | Number  | Number  | Number  | `a * b`                        |
| `div` | Number  | Number  | Number  | `a / b` (throws on /0)         |
| `eq`  | Boolean | Boolean | Boolean | `a === b`                      |
| `eq`  | Number  | Number  | Boolean | `a === b`                      |
| `eq`  | String  | String  | Boolean | `a === b`                      |
| `ne`  | Boolean | Boolean | Boolean | `a !== b`                      |
| `ne`  | Number  | Number  | Boolean | `a !== b`                      |
| `ne`  | String  | String  | Boolean | `a !== b`                      |
| `lt`  | Number  | Number  | Boolean | `a < b`                        |
| `le`  | Number  | Number  | Boolean | `a <= b`                       |
| `gt`  | Number  | Number  | Boolean | `a > b`                        |
| `ge`  | Number  | Number  | Boolean | `a >= b`                       |
| `=`   | Boolean | Boolean | Boolean | no-op (compiler special-cased) |
| `=`   | Number  | Number  | Number  | no-op (compiler special-cased) |
| `=`   | String  | String  | String  | no-op (compiler special-cased) |

---

## Appendix B -- Core Conversion Catalog

| From    | To      | Cost | Implementation            |
| ------- | ------- | ---- | ------------------------- |
| Number  | String  | 2    | `toString(n)`             |
| String  | Number  | 2    | `parseFloat(s)`, NaN -> 0 |
| Number  | Boolean | 1    | `n !== 0`                 |
| Boolean | Number  | 1    | `b ? 1 : 0`               |
| String  | Boolean | 2    | `trim(s).length > 0`      |
| Boolean | String  | 1    | `b ? "true" : "false"`    |

---

## Appendix C -- Diagnostic Code Ranges

| Range       | Category           | Enum                  |
| ----------- | ------------------ | --------------------- |
| 1000 - 1999 | Parser diagnostics | `ParseDiagCode`       |
| 2000 - 2999 | Type inference     | `TypeDiagCode`        |
| 3000 - 3999 | Compilation        | `CompilationDiagCode` |

### Parser Diagnostics (1000-1014)

| Code | Name                                | Meaning                                      |
| ---- | ----------------------------------- | -------------------------------------------- |
| 1000 | UnexpectedTokenAfterExpression      | Token found after complete expression        |
| 1001 | ExpectedExpressionFoundEOF          | Expected expr, hit end of input              |
| 1002 | UnexpectedActionCallAfterExpression | Action call where none expected              |
| 1003 | UnexpectedExpressionAfterExpression | Second expression where one expected         |
| 1004 | ExpectedSensorOrActuator            | Wrong tile kind                              |
| 1005 | ActionCallParseFailure              | Required args missing                        |
| 1006 | UnexpectedActionCallKind            | Neither sensor nor actuator                  |
| 1007 | ExpectedExpressionInSubExpr         | Missing expr in sub-expression               |
| 1008 | UnexpectedTokenKindInExpression     | Unknown tile kind                            |
| 1009 | UnexpectedOperatorInExpression      | Operator in unexpected position              |
| 1010 | ExpectedClosingParen                | Unclosed parenthesis                         |
| 1011 | UnexpectedControlFlowInExpression   | Bad control flow token                       |
| 1012 | UnknownOperator                     | Operator not in table                        |
| 1013 | InvalidAssignmentTarget             | LHS of `=` is not a variable or field access |
| 1014 | ReadOnlyFieldAssignment             | Assignment to read-only field access         |

### Type Diagnostics (2000-2005)

| Code | Name                  | Meaning                               |
| ---- | --------------------- | ------------------------------------- |
| 2000 | NoOverloadForBinaryOp | No matching overload for binary op    |
| 2001 | NoOverloadForUnaryOp  | No matching overload for unary op     |
| 2002 | DataTypeMismatch      | Inferred/expected type mismatch       |
| 2003 | TileTypeMismatch      | Tile kind mismatch for slot reference |
| 2004 | TileNotFound          | Tile ID not found in catalogs         |
| 2005 | DataTypeConverted     | Implicit conversion applied           |

Compilation diagnostics (3000+) are defined in the VM spec alongside the bytecode compiler.
