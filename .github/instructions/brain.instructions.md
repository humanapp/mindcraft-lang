---
applyTo: 'packages/core/src/brain/**'
---
<!-- Last reviewed: 2026-02-22 -->

# Brain Language & VM Architecture

The brain module (`packages/core/src/brain/`) implements a tile-based visual programming language with a bytecode compiler and stack-based VM. This document captures the full architecture to avoid repeated re-analysis.

## Quick Reference

- **Adding a sensor/actuator**: see "Adding New Sensors / Actuators" below
- **Adding an operator**: see "Adding New Operators" below
- **Call spec grammar helpers**: `mod()`, `param()`, `bag()`, `choice()`, `seq()`, `optional()`, `repeated()`, `conditional()` from `interfaces/call-spec.ts`
- **VM runtime details**: see `vm.instructions.md` (loaded only for `runtime/` files)

## High-Level Pipeline

```
Tiles -> Parser (Pratt + grammar) -> AST (Expr) -> Type Inference -> Bytecode Compiler -> Program -> VM (fiber-based)
```

## Tile System

**Tiles** are the fundamental tokens of the language. Each tile is a typed, identifiable unit.

### Tile Kinds (`BrainTileKind`)

| Kind | Class | Purpose |
|------|-------|---------|
| `literal` | `BrainTileLiteralDef` | Constant values (numbers, strings, booleans, nil) |
| `variable` | `BrainTileVariableDef` | Named mutable storage |
| `operator` | `BrainTileOperatorDef` | Binary/unary operators (+, -, ==, &&, etc.) |
| `sensor` | `BrainTileSensorDef` | Reads environment state (HOST_CALL) |
| `actuator` | `BrainTileActuatorDef` | Performs actions (HOST_CALL) |
| `parameter` | `BrainTileParameterDef` | Named parameter for action calls |
| `modifier` | `BrainTileModifierDef` | Boolean flag for action calls |
| `controlFlow` | `BrainTileControlFlowDef` | Parens, done-executing, etc. |
| `factory` | `BrainTileFactoryDef` | Creates new variable/literal tiles at runtime (UI concern) |

### Tile ID Convention

All tile IDs follow the pattern `tile.<area>-><id>`, built via `mkTileId(area, id)`:
- Operators: `tile.op->add`
- Sensors: `tile.sensor->random`
- Actuators: `tile.actuator->switch-page`
- Literals: `tile.literal-><typeId>-><valueStr>` (e.g., `tile.literal->number:<number>->42`)
- Variables: `tile.var-><uniqueId>`

### TilePlacement (bitflags)

- `WhenSide (1)` -- can appear on WHEN side of a rule
- `DoSide (2)` -- can appear on DO side of a rule
- `EitherSide (3)` -- both sides
- `ChildRule (4)` -- can nest as child rule
- `InsideLoop (8)` -- only valid inside loops
- `Inline (16)` -- sensor/actuator participates in Pratt expressions like a literal (no arguments allowed)

### Tile Class Hierarchy

```
BrainTileDefBase (abstract) -> all tile kinds
  \- BrainActionTileBase -> BrainTileSensorDef, BrainTileActuatorDef
       \-- fnEntry: BrainFunctionEntry (links tile to its host function)
```

## Host Functions & Call Specs

### BrainFunctionEntry

Links a tile to its runtime implementation. Two variants:
- `BrainSyncFunctionEntry`: `fn: HostSyncFn` = `{ exec: (ctx: ExecutionContext, args: MapValue) => Value }`
- `BrainAsyncFunctionEntry`: `fn: HostAsyncFn` = `{ exec: (ctx: ExecutionContext, args: MapValue, handleId: HandleId) => void }`

Each entry has: `id: number` (assigned by FunctionRegistry), `name: string`, `callDef: BrainActionCallDef`.

### Call Spec Grammar (`BrainActionCallSpec`)

Sensors and actuators define argument grammars using a recursive spec:

| Spec Type | Purpose |
|-----------|---------|
| `arg` | Single argument slot (anonymous, parameter, or modifier tile) |
| `seq` | All items in order |
| `choice` | Exactly one of N options |
| `optional` | Zero or one occurrence |
| `repeat` | Multiple with min/max bounds |
| `bag` | Unordered set (items in any order) |
| `conditional` | Branch based on whether a named spec matched |

`mkCallDef(callSpec)` flattens specs into `BrainActionArgSlot[]`, each with a `slotId` used as the key in the runtime MapValue argument.

**Inline sensors** must use an empty call spec (e.g., `{ type: "bag", items: [] }`) -- they cannot accept arguments because it would create grammar ambiguities with the Pratt parser.

## Parser (`compiler/parser.ts`)

**Architecture:** Pratt parser (top-down operator precedence) combined with grammar-based parser for sensor/actuator call specs.

**Input:** `ReadonlyList<IBrainTileDef>` -- tiles are already tokenized by their nature.

**Output:** `ParseResult = { exprs: ReadonlyList<Expr>, diags: ReadonlyList<ParseDiag> }`

### Parsing Flow

1. `parseTop()` dispatches top-level tokens:
   - Non-inline sensors and actuators -> `parseActionCall()` (grammar-based with backtracking)
   - Everything else (including inline sensors) -> `parseExpression()` (Pratt parsing)
2. `parseExpression()` -> Pratt loop: NUD prefix, then LED infix operators by precedence
3. `parseActionCall()` -> consumes action tile, then parses arguments according to call spec

### NUD Handlers (prefix position)

| Kind | Handler | Behavior |
|------|---------|----------|
| `literal` | `parseNudLiteral` | Creates `LiteralExpr` |
| `variable` | `parseNudVariable` | Creates `VariableExpr` |
| `operator` | `parseNudOperator` | Prefix operators (NOT, negate) -> `UnaryOpExpr` |
| `controlFlow` | `parseNudControlFlow` | `(` -> recursively parse inner expression with reset precedence |
| `sensor` | `parseNudSensor` | Inline sensors -> `SensorExpr` with empty arg lists; non-inline sensors -> backs up and delegates to `parseActionCall()` (enables `[not] [see ...]` etc.) |

### LED (infix) -- handled inline in `parseExpression()`

- Checks operator precedence against `minOperatorPrecedence`
- Assignment (`=`) is right-associative -> `AssignmentExpr`
- All others -> `BinaryOpExpr`

### Operator Precedence (higher binds tighter)

| Precedence | Operators |
|-----------|-----------|
| 30 | `not`, `negate` (prefix) |
| 20 | `*`, `/` |
| 10 | `+`, `-` |
| 5 | `<`, `<=`, `>`, `>=` |
| 4 | `==`, `!=` |
| 2 | `and` |
| 1 | `or` |
| 0 | `=` (assign, right-assoc) |

### Key Parser Behaviors

- **`primaryAdjacencyTerminates`**: Prevents action-call args from consuming adjacent primaries (e.g., "move forward" -> action("move") + expr("forward")).
- **Inline sensors** are excluded from `isPrimaryStart()` -- they don't terminate adjacency. They are expression primaries like literals.
- **Error recovery**: First expression is primary; subsequent produce `ErrorExpr` wrappers. Parser always returns results + diagnostics (never throws).
- **Call spec backtracking**: `tryParseWithBacktrack()` saves position, attempts parse, restores on failure.

## AST (`compiler/types.ts`)

**Expr** discriminated union on `kind`:

| Kind | Key Fields |
|------|-----------|
| `binaryOp` | `operator: BrainTileOperatorDef`, `left`, `right` |
| `unaryOp` | `operator: BrainTileOperatorDef`, `operand` |
| `literal` | `tileDef: BrainTileLiteralDef` |
| `variable` | `tileDef: BrainTileVariableDef` |
| `assignment` | `target: VariableExpr`, `value: Expr` |
| `parameter` | `tileDef: BrainTileParameterDef`, `value: Expr` |
| `modifier` | `tileDef: BrainTileModifierDef` |
| `actuator` | `tileDef`, `anons`, `parameters`, `modifiers` (all `List<SlotExpr>`) |
| `sensor` | same structure as actuator |
| `empty` | intentionally empty input |
| `errorExpr` | parse error with optional partial `expr` |

All non-trivial nodes have `nodeId: number` (for TypeEnv lookups) and `span: { from, to }`.

**ExprVisitor\<T\>** interface + `acceptExprVisitor(expr, visitor)` for type-safe dispatch.

## Type System

### Types

- **NativeType** enum: `Unknown(-1)`, `Void(0)`, `Nil(1)`, `Boolean(2)`, `Number(3)`, `String(4)`, `Enum(5)`, `List(6)`, `Map(7)`, `Struct(8)`
- **TypeId** = string, pattern `"nativeType:<name>"` (e.g., `"number:<number>"`)
- **CoreTypeIds**: `Unknown`, `Void`, `Nil`, `Boolean`, `Number`, `String`

### Type Inference Pipeline (per rule)

1. `computeExpectedTypes()` -- top-down pass propagating expected types
2. `computeInferredTypes()` -- bottom-up pass resolving operator overloads and conversions
3. Both populate `TypeEnv` = `Dict<number, TypeInfo>` keyed by `nodeId`

**TypeInfo**: `{ inferred, expected, isLVal?, overload?: OpOverload, conversion?: Conversion }`

## Bytecode Compiler

### Expression Compiler (`rule-compiler.ts`)

`ExprCompiler` implements `ExprVisitor<void>`, emitting bytecode via `IBytecodeEmitter`:

| Node Type | Emitted Code |
|-----------|-------------|
| Literal | `PUSH_CONST <idx>` |
| Variable | `LOAD_VAR <nameIdx>` |
| Assignment | `<value>, DUP, STORE_VAR <nameIdx>` (assignment is an expression) |
| BinaryOp | `<left>, [conversion], <right>, [conversion], HOST_CALL <opFnId>` |
| BinaryOp (&&) | Short-circuit: `<left>, DUP, JMP_IF_FALSE end, POP, <right>` |
| BinaryOp (\|\|) | Short-circuit: `<left>, DUP, JMP_IF_TRUE end, POP, <right>` |
| UnaryOp | `<operand>, [conversion], HOST_CALL <opFnId>` |
| Sensor/Actuator | Build arg MapValue, `HOST_CALL[_ASYNC] <fnId>` |

**All operators are HOST_CALLs** -- the compiler resolves `typeInfo.overload.fnEntry.id` at compile time.

**Action arguments** are marshaled into a single `MapValue` keyed by slotId (number):
- Anonymous args: `{ slotId: value }`
- Named parameters: `{ slotId: value }`
- Modifiers: `{ slotId: true }`

**Call-site IDs**: Unique per HOST_CALL, shared counter across all rules. Used for per-call-site persistent state.

### Brain Compiler (`brain-compiler.ts`)

Compiles an entire brain (multiple pages, each with multiple rules, each with children).

**Two-pass approach:**
1. **Pass 1**: Assign function IDs in depth-first order
2. **Pass 2**: Compile each rule body

**Rule function layout:**
```
WHEN_START
  <when bytecode>
WHEN_END -> skip_label
DO_START
  <do bytecode>
DO_END
CALL child_rule_0, 0
CALL child_rule_1, 0
skip_label:
  PUSH_CONST NIL
  RET
```

**Output**: `BrainProgram = { version, functions, constants, variableNames, entryPoint, ruleIndex, pages }`

## Value Model (`interfaces/vm.ts`)

All runtime values are tagged unions with `.t: NativeType`:

```
Value = UnknownValue | VoidValue | NilValue | BooleanValue | NumberValue
      | StringValue | EnumValue | ListValue | MapValue | StructValue
      | HandleValue (VM-internal) | ErrorValue (VM-internal)
```

Singletons: `UNKNOWN_VALUE`, `VOID_VALUE`, `NIL_VALUE`, `TRUE_VALUE`, `FALSE_VALUE`

Builders: `mkBooleanValue(v)`, `mkNumberValue(v)`, `mkStringValue(v)`

**Truthiness**: `nil/void/unknown/false/0/""` -> falsy; everything else -> truthy.

## ExecutionContext (`interfaces/runtime.ts`)

The bridge between the VM and host functions:

- `brain: IBrain` -- parent brain
- `getVariable(varId)` / `setVariable(varId, value)` -- local variable access
- `resolveVariable?(name)` / `setResolvedVariable?(name, value)` -- resolution chain
- `parentContext?`, `sharedScope?` -- for nesting
- `data?: unknown` -- application-specific data (game entity, DOM, etc.)
- `callSiteState?: CallSiteStateMap` -- per-HOST_CALL persistent state (keyed by callSiteId)
- `currentCallSiteId?: number` -- set by VM before each HOST_CALL
- `time`, `dt`, `currentTick` -- timing info
- `fiberId` -- current fiber ID

**IBrain**: `getVariable`, `setVariable`, `initialize`, `startup`, `shutdown`, `think(currentTime)`, `rng()`, `setContextData(data)`, `requestPageChange(pageIndex)`

## Services & Initialization

### BrainServices (DI container, global singleton)

- `tiles: ITileCatalog`
- `operatorTable: IOperatorTable`
- `operatorOverloads: IOperatorOverloads`
- `types: ITypeRegistry`
- `functions: IFunctionRegistry`
- `conversions: IConversionRegistry`
- `tileBuilder: IBrainTileDefBuilder`

Access: `getBrainServices()` / `setBrainServices()` / `hasBrainServices()`

### Initialization Order (`brain/index.ts` -> `registerCoreBrainComponents()`)

1. `createBrainServices()` -- creates empty registries
2. `setBrainServices(services)` -- sets global singleton BEFORE registration
3. `registerCoreRuntimeComponents()`:
   - `registerCoreTypes()` -- Void, Nil, Boolean, Number, String
   - `registerCoreActuators()` -- SwitchPage, Yield functions
   - `registerCoreSensors()` -- Random function
   - `registerCoreConversions()` -- type conversion functions
   - `registerCoreOperators()` -- operator specs + overloads
4. `registerCoreTileComponents()`:
   - Operators, control flow, variable factories, literal factories, parameters, actuators, sensors
   - Tile defs look up their `fnEntry` from functions registry, then register in tile catalog

**Runtime registration happens BEFORE tile registration.** Runtime registers functions by ID; tile defs then look up those entries to bind.

## Adding New Sensors / Actuators

Follow the existing pattern (3 files + 2 wiring changes):

1. **Runtime function** (e.g., `runtime/sensors/my-sensor.ts`): Define `callSpec`, `callDef`, host function, export descriptor `{ fnId, tileId, isAsync, fn, callDef }`
2. **Register runtime function** in `runtime/sensors/index.ts` (or `runtime/actuators/index.ts`): `fns.register(id, isAsync, fn, callDef)`
3. **Register tile def** in `tiles/sensors.ts` (or `tiles/actuators.ts`): Create `BrainTileSensorDef` / `BrainTileActuatorDef`, pass `fnEntry` from function registry
4. **Add ID** to `CoreSensorId` / `CoreActuatorId` enum in `interfaces/tiles.ts`

For **inline sensors** (no arguments, participate in Pratt expressions): set `placement: TilePlacement.EitherSide | TilePlacement.Inline` and use an empty call spec.

## Adding New Operators

1. Add operator ID to the `CoreOpId` const object in `interfaces/operators.ts`
2. Register operator spec in `runtime/operators.ts` (precedence, fixity, associativity)
3. Register overloads for type combinations (each overload is a HOST_CALL)
4. Register operator tile def in `tiles/operators.ts`
