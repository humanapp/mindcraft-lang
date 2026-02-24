---
applyTo: 'packages/core/src/brain/language-service/**'
---
<!-- Last reviewed: 2026-02-23 -->

# Tile Suggestion Language Service

The tile suggestion subsystem (`packages/core/src/brain/language-service/tile-suggestions.ts`) determines which tiles are valid to place at a given insertion point in the brain's tile-based visual programming language. It powers the tile picker UI.

## Quick Reference

- **Tests**: `cd packages/core && npm test` (runs all `*.spec.ts` files via `node:test`; tile suggestion tests are in `src/brain/language-service/tile-suggestions.spec.ts`)
- **Import path**: `@mindcraft-lang/core/brain/language-service`
- **Main entry point**: `suggestTiles(context, catalogs, operatorOverloads?)`
- **Parser helper**: `parseTilesForSuggestions(tiles)` -- parses tiles into AST for `InsertionContext.expr`

## Public API

### `suggestTiles(context, catalogs, operatorOverloads?): TileSuggestionResult`

Main entry point. Given an `InsertionContext`, enumerates tiles from provided catalogs and returns those valid at the position, separated into exact type matches and conversion-based matches. Conversions are obtained internally via `getBrainServices().conversions`.

When `operatorOverloads` is provided, infix operator suggestions are filtered by whether they have overloads whose first argument type exactly matches the left operand's type. Matching operators go to `exact` (as `Unchecked`), and non-matching operators are excluded entirely. No conversion-based operator suggestions are produced. When omitted, all infix operators are suggested as `Unchecked` (backward-compatible default).

### `parseTilesForSuggestions(tiles): Expr`

Convenience function that parses a tile list into an AST expression suitable for `InsertionContext.expr`. Returns `EmptyExpr` for empty lists.

### `getTileOutputType(tileDef): TypeId | undefined`

Extracts the output type from a tile definition. Returns `undefined` for tiles whose output depends on context (operators, control flow).

## Core Types

### `InsertionContext`

Describes the insertion point:

| Field | Type | Purpose |
|-------|------|---------|
| `ruleSide` | `RuleSide` | Which side of the rule: When, Do, or Either |
| `expectedType?` | `TypeId` | Type constraint at this position (undefined = no constraint) |
| `expr?` | `Expr` | Parsed AST at the insertion point -- drives behavior |
| `replaceTileIndex?` | `number` | When replacing a tile, index in the flat tile list |

### `TileSuggestionResult`

| Field | Type | Purpose |
|-------|------|---------|
| `exact` | `List<TileSuggestion>` | Tiles that match exactly or are type-unchecked |
| `withConversion` | `List<TileSuggestion>` | Tiles that require type conversion |

### `TileSuggestion`

| Field | Type | Purpose |
|-------|------|---------|
| `tileDef` | `IBrainTileDef` | The suggested tile definition |
| `compatibility` | `TileCompatibility` | Exact / Conversion / Unchecked |
| `conversionCost` | `number` | Total conversion cost (0 for exact/unchecked) |

### `TileCompatibility` (enum)

- `Exact (0)` -- output type exactly matches expected type
- `Conversion (1)` -- output type can be converted to expected type
- `Unchecked (2)` -- type could not be checked (operators, no constraint, etc.)

## Suggestion Modes

`suggestTiles` operates in two modes based on whether `replaceTileIndex` is set.

### Append Mode (default)

Dispatches based on `expr.kind`:

| Expr Kind | Behavior |
|-----------|----------|
| `empty` / `errorExpr` | All placement-compatible tiles (expression position): value tiles, prefix operators, actuators, sensors. Infix operators always excluded. |
| `actuator` / `sensor` | Call spec tiles if unfilled slots remain; infix operators + accessor tiles if trailing complete value or completed sensor |
| `unaryOp` | If operand is a sensor/actuator: same as sensor/actuator case (call spec tiles + infix operators). If complete non-sensor operand: infix operators + accessor tiles. If incomplete: value tiles including non-inline sensors (operand of prefix operator). |
| `literal` / `variable` / `fieldAccess` | Infix operators + accessor tiles (value is complete) |
| `binaryOp` / `assignment` | Infix operators + accessor tiles if complete; value tiles (valueOnly mode -- no actuators) if incomplete, with expected type inferred from context via `incompleteExprExpectedType` |
| `parameter` / `modifier` | Nothing (argument-level nodes) |

**Key behavior for actuator/sensor:**
1. Walk the call spec tree to compute `availableArgSlots`
2. `needsSlots = availableArgSlots.size() > 0 || hasParametersNeedingValues(expr) || hasIncompleteAnonValues(expr)`
3. If `needsSlots` -> suggest call spec tiles via `suggestActionCallTiles` (but named parameter/modifier tiles are suppressed when `valuePending` -- see below)
4. If trailing child is a complete value expression -> also suggest infix operators + accessor tiles (using `trailingPrimaryExpr` for accessor type)
5. If completed sensor with no trailing value -> suggest infix operators (sensor produces a value)
6. If completed actuator with no trailing value -> suggest nothing (Void return)

### Replacement Mode (`replaceTileIndex` is set)

Walks the AST via `findReplacementRole` to determine the structural role at the tile index:

| Role | Suggestions |
|------|-------------|
| `expressionPosition` | All placement-compatible tiles |
| `value` | Value-producing tiles, optionally with expected type |
| `infixOperator` | Infix operator tiles only |
| `prefixOperator` | Prefix operator tiles only |
| `actionCallArg` | Call spec tiles (with the replaced slot excluded from filled set) |
| `accessorPosition` | Accessor tiles for the same struct type |

## Call Spec Grammar Enforcement

The tile suggestion system respects the grammar-like call spec structure when suggesting tiles inside actuator/sensor argument lists. This is the most complex part of the subsystem.

### Call Spec Types (from `BrainActionCallSpec`)

| Type | Constraint | Suggestion Behavior |
|------|-----------|---------------------|
| `arg` | Single argument slot | Available if fill count < repeatMax |
| `bag` | Unordered set | All items independently available |
| `choice` | Exactly one option | If one option filled -> others excluded; else all available |
| `seq` | Items in order | All items suggested (ordering enforced by parser, not suggestions) |
| `optional` | Zero or one | Delegates to inner item |
| `repeat` | Min/max bounds | Overrides repeatMax for descendants |
| `conditional` | Branch on named spec fill | Evaluates condition -> recurse into `then` or `else` branch |

### Tree Walk: `collectAvailableArgSlots`

Central function that recursively walks the call spec tree to collect which `BrainActionArgSlot`s are currently available:

```
collectAvailableArgSlots(spec, argSlots, filledSlotIds, available, repeatMax, rootSpec)
```

- **`repeatMax`**: inherited cardinality limit. Default is `1` (each arg used once). The `repeat` spec overrides this with `spec.max` for its descendants. `undefined` means unlimited.
- **`rootSpec`**: the original root of the call spec tree, passed through for `conditional` condition lookup via `findNamedSpec`.

### Supporting Functions

| Function | Purpose |
|----------|---------|
| `collectFilledSlotIds(expr, excludeSlotId?)` | Collects slot IDs from expr's anons, parameters, and modifiers |
| `countSlotFills(slotId, filledSlotIds)` | Counts occurrences of a slotId in filled list (for repeat cardinality) |
| `findArgSlotByTileId(tileId, argSlots)` | Finds `BrainActionArgSlot` by tile ID in flat list |
| `specHasAnyFill(spec, argSlots, filledSlotIds)` | Recursive check: does any constituent arg in a spec node have fills? |
| `findNamedSpec(spec, name)` | Finds a spec node by its `name` property (for conditional evaluation) |
| `hasIncompleteAnonValues(actionExpr)` | Returns true if any filled anonymous slot has an incomplete value expression (e.g., `[say] ["hi"] [+]`) |
| `trailingPrimaryExpr(expr)` | Walks to the rightmost primary (leaf) expression in the tree -- used for accessor tile type determination since accessors bind at max precedence |
| `incompleteExprExpectedType(expr, overloads?, conversions?)` | Infers the expected type of a missing sub-expression from context (e.g., assignment target type, field access type) |
| `structFieldTypeCompatibility(structType, expectedType, conversions)` | Checks if a struct type has any field matching the expected type (directly or via conversion) -- used as a fallback in type compatibility |
| `hasStructValuePendingAccessor(actionExpr, catalogs, excludeSlotId?)` | Returns true if any slot contains a complete struct-typed value that doesn't match the expected type -- the user likely needs to drill down via accessor tiles |

### How `suggestActionCallTiles` Uses the Tree Walk

1. Collects filled slot IDs from the actuator/sensor expr (optionally excluding a slot being replaced)
2. Calls `collectAvailableArgSlots` to get the set of available arg slots
3. Computes `valuePending = hasParametersNeedingValues(expr) || hasIncompleteAnonValues(expr) || hasStructValuePendingAccessor(expr, catalogs)`
4. For each available slot:
   - **Anonymous slots** -> collect expected type for expression suggestions
   - **Named parameters/modifiers** -> suggest the tile directly, but only when `valuePending` is false
5. Also collects expected types from filled parameters whose value is still missing
6. Also collects expected types from filled anonymous slots with incomplete values
7. If any value types are expected -> suggest matching expression tiles + prefix operators

### Real-World Call Spec Examples

**Move actuator** (`apps/sim/src/brain/fns/actuators/move.ts`):
```ts
bag(
  choice(choice(Forward, Toward, AwayFrom, Avoid), Wander),  // direction group
  choice(repeated(Quickly, {max:3}), repeated(Slowly, {max:3})),  // speed group
  Priority  // optional priority parameter
)
```
- Direction: nested choice -- pick one direction modifier
- Speed: pick fast or slow, each repeatable up to 3x
- Priority: always available (optional by nature of bag)

**Timeout sensor** (`apps/sim/src/brain/fns/sensors/timeout.ts`):
```ts
bag(
  AnonNumber,                  // { name: "anonNumber", anonymous: true }
  conditional("anonNumber",   // only available when number is provided
    optional(choice(TimeMs, TimeSecs))
  )
)
```
- Number value is anonymous (user types a number directly)
- Time unit modifiers only appear after the number is placed (conditional)

## Expression Completeness

Several functions assess whether expressions are "complete" (can be extended with operators) or "incomplete" (need more input):

### `isCompleteValueExpr(expr)`
Returns true for expressions that represent a complete value:
- `literal`, `variable`, `sensor`, `fieldAccess` -> always complete
- `binaryOp` -> complete if right operand is complete (recursive)
- `unaryOp` -> complete if operand is complete (recursive)
- `assignment` -> complete if value is complete (recursive)
- Everything else -> incomplete

### `isParameterValueMissing(value)`
Returns true if a parameter's value expression indicates no value was provided:
- `empty`, `errorExpr` -> missing
- `binaryOp` -> missing if right operand is missing (recursive -- catches `[param] [1] [+]`)
- `unaryOp` -> missing if operand is missing (recursive -- catches `[param] [negative]`)
- Everything else -> not missing

### `trailingValueExpr(actionExpr)`
Finds the rightmost complete value expression among an action's children (by span position). Used to decide if infix operators should be offered. Checks anonymous slots and parameter values, then verifies no modifier appears after the trailing value -- if a modifier has a higher span, `undefined` is returned (infix operators should not follow modifiers).

### `hasParametersNeedingValues(actionExpr, excludeSlotId?)`
Returns true if any filled parameter slot has a missing value (parameter tile placed but no value follows).

### `hasIncompleteAnonValues(actionExpr)`
Returns true if any filled anonymous slot has a non-empty, non-error expression that is not complete (e.g., `[say] ["hi"] [+]` -- the binary op in the anon slot needs a right operand). This is the anonymous-slot counterpart of `hasParametersNeedingValues`.

### `trailingPrimaryExpr(expr)`
Walks to the rightmost primary (leaf) expression in the tree by following `binaryOp->right`, `unaryOp->operand`, `assignment->value` recursively. Used for accessor tile type determination because accessors bind at maximum precedence (postfix). For example, in `[$vec].[x] = [$vec]`, the trailing primary is the rightmost `[$vec]`, whose struct type determines which accessors are valid -- not the assignment's output type.

### `trailingPrimaryAcceptedTypes(expr, operatorOverloads?, conversions?)`
Computes the accepted types for the trailing primary's position within a complete expression. Walks the same path as `trailingPrimaryExpr` but collects the innermost type constraint from enclosing expressions. Returns `undefined` when no constraint exists (standalone value), or a `ReadonlyList<TypeId>` of accepted types. Used to filter accessor suggestions so that only accessors whose field type is compatible with the enclosing context are suggested.
- `assignment` -> recurse into value; if no deeper constraint, return the target type (variable type or field access type)
- `binaryOp` -> recurse into right; if no deeper constraint and `operatorOverloads` provided, infer expected RHS type from overloads matching the LHS type (returns undefined if ambiguous or no match)
- `unaryOp` -> recurse into operand
- Everything else (leaf) -> `undefined`

### `incompleteExprExpectedType(expr, operatorOverloads?, conversions?)`
Infers the expected type of the missing sub-expression in an incomplete expression:
- `assignment` -> target's type: `fieldAccess` target -> `accessor.fieldTypeId`, variable target -> `tileDef.varType`
- `binaryOp` -> if right is incomplete, first recurse into right; if that returns undefined AND `operatorOverloads` is provided, infer from operator overloads by finding all overloads that accept the LHS type -- if all matching overloads expect the same RHS type, return it (returns undefined if ambiguous or no match)
- `unaryOp` -> if operand is incomplete, recurse into operand; otherwise `undefined`
- Everything else -> `undefined`

## Suggestion Functions

| Function | What it suggests | When used |
|----------|-----------------|-----------|
| `suggestExpressionTiles` | All value-producing tiles + prefix operators (filtered by type/placement). Infix operators always excluded. When `valueOnly=true`, actuators are also excluded. | Empty position, incomplete expressions |
| `suggestInfixOperators` | Infix operator tiles, optionally filtered by LHS type | After complete value expressions |
| `suggestAccessorTiles` | Accessor tiles whose `structTypeId` matches the trailing primary expression's output type, optionally filtered by accepted field types | After complete value expressions producing a struct type |
| `getExprOutputType` | Output type of an expression (for LHS type determination) | Called before `suggestInfixOperators` when overload info is available |
| `operatorHasLhsOverload` | Checks if operator has any overload with exact LHS type match | Called by `suggestInfixOperators` for each operator |
| `suggestPrefixOperators` | Prefix operator tiles only | Replacement mode at prefix operator position |
| `suggestPrefixOperatorsForValue` | Prefix operator tiles filtered by result type | Inside action calls when value expressions are needed |
| `suggestActionCallTiles` | Call spec tiles + value expressions for anonymous slots | Inside actuator/sensor argument lists |
| `suggestExpressionsForAnonymousSlots` | Value tiles matching expected types | Called by `suggestActionCallTiles` for anonymous parameters |
| `suggestForReplacementRole` | Dispatches to appropriate function based on role | Replacement mode |

### `suggestExpressionTiles` Value-Only Flag

When `valueOnly = true`, actuators are excluded (they return Void, not a value) and non-inline sensors are excluded (they can only appear at the top level, not inside Pratt expressions). This is used when suggesting tiles for incomplete expressions like `[1] [+] _` or `[$v] [=] _` where a value-producing tile is required. Infix operators are always excluded from `suggestExpressionTiles` regardless of flags -- they require a left-hand operand and can never start an expression. Prefix operators are allowed (e.g., `[negative] [1]`) but are filtered by result type when an expected type constraint exists -- only prefix operators with at least one overload whose result type exactly matches the expected type are included (like infix operators, no conversion-based matching is used).

### `suggestActionCallTiles` Value-Pending Suppression

When `valuePending` is true (either `hasParametersNeedingValues` or `hasIncompleteAnonValues` or `hasStructValuePendingAccessor` returns true), named parameter and modifier tiles are suppressed from suggestions. Only value expression tiles for the pending slot are suggested. This prevents the user from placing additional parameter/modifier tiles before completing the value for the current one.

## Type Compatibility

Tiles are classified against the expected type at the insertion point:

1. **No constraint** (`expectedType` undefined or `CoreTypeIds.Unknown`) -> `Unchecked`
2. **Unknown output type** -> `Unchecked`
3. **Exact match** (`outputType === expectedType`) -> `Exact`, cost 0
4. **Conversion available** -> `Conversion`, cost = sum of conversion steps
5. **Struct field matching** -- if the tile produces a struct type and any field of that struct matches the expected type (directly or via conversion), the tile is classified as `Conversion` with cost = 1 (accessor step) + conversion cost. This allows struct-typed variables to be suggested when a field matches the expected type (the user can then add an accessor tile).
6. **No match** -> tile is excluded

**Without operator overload info:** Operators always get `Unchecked` compatibility (their result type depends on operand types, which aren't known at suggestion time).

**With operator overload info** (`operatorOverloads` parameter provided to `suggestTiles`):
- Operators with at least one overload whose first argType matches the left operand type exactly -> `exact` list, `Unchecked` compatibility
- Operators with no matching overloads -> excluded entirely
- No conversion-based operator suggestions are produced (conversions are only used for value tile suggestions)

## Operator Overload Filtering

When `operatorOverloads` is provided to `suggestTiles`, infix operators are filtered based on whether they have overloads compatible with the left operand's type. This uses two helper functions:

### `getExprOutputType(expr, operatorOverloads?, conversions?)`

Determines the static output type of an expression from its AST node:

| Expr Kind | Output Type |
|-----------|-------------|
| `literal` | `tileDef.valueType` |
| `variable` | `tileDef.varType` |
| `sensor` | `tileDef.outputType` |
| `actuator` | `CoreTypeIds.Void` |
| `assignment` | Target type: `fieldAccess` target -> `accessor.fieldTypeId`, variable target -> `tileDef.varType` |
| `fieldAccess` | `accessor.fieldTypeId` |
| `binaryOp` | Resolves overload from operand types -> `resultType` |
| `unaryOp` | Resolves overload from operand type -> `resultType` |
| everything else | `undefined` (can't determine) |

### `operatorHasLhsOverload(opDef, leftOperandType)`

For each overload registered on the operator, checks if the first argType exactly matches the left operand type. Returns `true` if any overload matches, `false` otherwise.

Conversion-based matching is intentionally not used -- operators are only suggested when they have a direct overload for the LHS type. This prevents confusing suggestions like `subtract` for string operands (which would require String->Number conversion).

### Example: Core Operator Filtering

| Left Operand | Suggested Operators | Excluded |
|-------------|--------------------|---------|
| Number | `+`, `-`, `*`, `/`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `=` | `and`, `or` |
| Boolean | `and`, `or`, `==`, `!=`, `=` | `+`, `-`, `*`, `/`, `<`, `<=`, `>`, `>=` |
| String | `+`, `==`, `!=`, `=` | `-`, `*`, `/`, `<`, `<=`, `>`, `>=`, `and`, `or` |

## Placement Filtering

Every tile has an optional `placement` bitflag (`TilePlacement`). `isPlacementValid` checks that the tile's placement is compatible with the current `RuleSide`:
- `WhenSide (1)` -- When side only
- `DoSide (2)` -- Do side only
- `EitherSide (3)` -- both sides
- Undefined placement -> always valid

Tiles with `kind === "modifier"` or `kind === "parameter"` are excluded from expression-position suggestions (they're only valid inside action calls).

## Tests

**File:** `packages/core/src/brain/language-service/tile-suggestions.spec.ts`

**Run:** `cd packages/core && npm test`

Uses `node:test` and `node:assert/strict` (Node.js built-ins, zero dependencies). Tests cover: basic suggestions, type constraints, placement filtering, action call specs (choice exclusion, repeat cardinality, optional, conditional), replacement mode, operator overload filtering, accessor tiles, struct field matching, value-pending suppression, prefix operator type filtering, and non-inline sensor scoping.

Spec files use package imports (`@mindcraft-lang/core/brain`, etc.) that resolve to the built `dist/node/` output. The `pretest` script runs `npm run build:node` automatically before tests execute.

## Architecture Notes

### Data Flow

```
InsertionContext
  v
suggestTiles()
  |- Append mode: dispatch on expr.kind
  |   |- empty/error -> suggestExpressionTiles (no infix ops, includes actuators)
  |   |- actuator/sensor -> collectAvailableArgSlots (tree walk) -> suggestActionCallTiles (valuePending suppresses named tiles)
  |   |   \- trailing complete value -> suggestInfixOperators + suggestAccessorTiles (via trailingPrimaryExpr)
  |   |- unaryOp with sensor/actuator operand -> same as sensor/actuator case on the inner expr
  |   |- unaryOp incomplete -> suggestExpressionTiles (valueOnly=true, allowNonInlineSensors=true)
  |   |- complete value -> suggestInfixOperators + suggestAccessorTiles (via trailingPrimaryExpr)
  |   \- incomplete value -> incompleteExprExpectedType -> suggestExpressionTiles (valueOnly=true, no actuators)
  \- Replacement mode: findReplacementRole (AST walk) -> suggestForReplacementRole
       |- expressionPosition -> suggestExpressionTiles
       |- value -> suggestExpressionTiles (with expectedType)
       |- infixOperator -> getExprOutputType(leftExpr) -> suggestInfixOperators(leftType)
       |- prefixOperator -> suggestPrefixOperators
       |- actionCallArg -> suggestActionCallTiles (excludeSlotId set)
       \- accessorPosition -> suggestAccessorTiles (structTypeId from accessor)
```

### Key Invariants

1. **Modifiers and parameters are never suggested in expression position** -- they are only valid inside action calls.
2. **Call spec tree walk starts with `repeatMax = 1`** -- each arg slot is used once unless wrapped in a `repeat` spec.
3. **Choice exclusion is determined by fill state** -- `specHasAnyFill` checks recursively whether any arg under a choice option has been placed.
4. **Conditional evaluation uses `findNamedSpec`** -- searches the root spec tree for a node with matching `name`, then checks if it has any fills.
5. **Infix operators are always excluded from `suggestExpressionTiles`** -- they require a left-hand operand and can never start an expression. They are only suggested via `suggestInfixOperators` after a complete value.
6. **Prefix operators are filtered by result type** -- `suggestPrefixOperatorsForValue` only includes prefix operators whose result type exactly matches at least one expected type. In `suggestExpressionTiles`, prefix operators are also filtered when an expected type constraint exists. Like infix operators, no conversion-based matching is used.
7. **Sensors always get infix operators when complete** -- because they produce a value that can be extended with operators.
7. **Actuators get nothing when complete** -- because they return Void.
8. **Replacement mode excludes the replaced slot** -- `excludeSlotId` ensures the slot being replaced doesn't count as "filled" when computing available args.
9. **Operator overload filtering is opt-in** -- `operatorOverloads` parameter is optional for backward compatibility. Without it, all infix operators are `Unchecked`.
10. **Replacement mode captures `leftExpr`** -- `findReplacementRole` stores the left expression in the `infixOperator` role so the replacement-mode suggestion can compute LHS type.
11. **Value-pending suppresses named tiles** -- when `hasParametersNeedingValues`, `hasIncompleteAnonValues`, or `hasStructValuePendingAccessor` returns true, `suggestActionCallTiles` suppresses named parameter/modifier tiles. Only value expressions for the pending slot are suggested.
12. **Modifier span blocks infix operators** -- `trailingValueExpr` returns `undefined` if any modifier has a span past the trailing value, preventing infix operator suggestions after modifiers.
13. **Accessor type uses trailing primary** -- `suggestAccessorTiles` uses `trailingPrimaryExpr` to determine the struct type for accessor suggestions, not the overall expression type. This is because accessors bind at maximum precedence.
14. **Struct field matching is a type compatibility fallback** -- `classifyTypeCompatibility` falls through to `structFieldTypeCompatibility` when direct and conversion matching both fail. This places struct-typed variables in `withConversion` when a field matches the expected type.
15. **Incomplete expressions use valueOnly mode** -- when the expression is incomplete (e.g., `[$v] [=] _`), `suggestExpressionTiles` is called with `valueOnly=true` to exclude actuators and non-inline sensors.
16. **Accessor replacement stays within the struct** -- `findReplacementRole` returns `accessorPosition` with the struct type when the tile being replaced is an accessor tile in a `fieldAccess` expression, so only other accessors for the same struct are suggested.
17. **Struct value pending accessor suppresses modifiers** -- when a slot's complete value produces a struct type that doesn't match the slot's expected type, modifiers are suppressed because the user likely needs to apply accessor tiles to drill into the struct (e.g., `[me] [position]` in a Number slot needs `[x]` or `[y]` first).
18. **Non-inline sensors excluded from sub-expression positions (except prefix operand)** -- non-inline sensors can only appear at the top level (parsed via `parseActionCall`) or as the operand of a prefix operator (e.g., `[not] [see]`). In other sub-expression positions (`valueOnly=true` and action call anonymous slots), only inline sensors (`TilePlacement.Inline`) are included. The `allowNonInlineSensors` flag on `suggestExpressionTiles` enables them for the prefix operator operand case.
19. **Incomplete binary op infers RHS type from operator overloads** -- `incompleteExprExpectedType` can infer the expected RHS type when `operatorOverloads` is provided by finding overloads matching the LHS type. This enables type-constrained suggestions (e.g., `["hello"] [!=] _` expects String).
20. **UnaryOp with sensor/actuator operand delegates to action call handling** -- when a `unaryOp`'s operand is a sensor or actuator (e.g., `[not] [see ...]`), the append mode dispatches to the same call spec handling as the top-level sensor/actuator case. This ensures sensor argument tiles are suggested when unfilled slots remain, and infix operators are offered when the sensor is fully complete.
21. **Accessor suggestions filtered by enclosing expression type** -- in non-action-call positions, `suggestAccessorTiles` receives `acceptedFieldTypes` computed by `trailingPrimaryAcceptedTypes`. For assignments, this is the target type: `[$actor] [=] [it] _` with ActorRef target filters out all ActorRef accessors that produce non-ActorRef types. For binary ops with operator overloads, the expected RHS type is used. Standalone struct values have no constraint (all accessors suggested).

### Dependencies

- **Parser** (`compiler/parser.ts`): `parseBrainTiles` for `parseTilesForSuggestions`
- **AST types** (`compiler/types.ts`): `Expr`, `ActuatorExpr`, `SensorExpr`, `SlotExpr`, `Span`
- **Call spec types** (`interfaces/functions.ts`): `BrainActionCallSpec`, `BrainActionArgSlot`, `BrainActionCallDef`
- **Call spec factories** (`interfaces/call-spec.ts`): `mod`, `param`, `bag`, `choice`, `seq`, `optional`, `repeated`, `conditional`
- **Tile definitions** (`tiles/*.ts`): Concrete tile def classes for type narrowing
- **Type system** (`interfaces/type-system.ts`): `StructTypeDef` for struct field matching in `structFieldTypeCompatibility`
- **Platform containers** (`platform/list.ts`, `platform/uniqueset.ts`): `List`, `ReadonlyList`, `UniqueSet`
- **Conversion registry** (`services.ts`): `getBrainServices().conversions` -- accessed internally by `suggestTiles`\n- **Operator overloads** (`interfaces/operators.ts`): `IOperatorOverloads`, `IReadOnlyRegisteredOperator.overloads()`

### Deferred Work (documented in code)

- InsideLoop placement flag checking
