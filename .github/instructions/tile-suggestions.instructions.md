---
applyTo: "packages/core/src/brain/language-service/**"
---

<!-- Last reviewed: 2026-03-12 -->

# Tile Suggestion Language Service

The tile suggestion subsystem (`tile-suggestions.ts`) determines which tiles are valid to
place at a given insertion point. It powers the tile picker UI. Read the source for
function-level details; this file captures rules and key behaviors.

## Quick Reference

- **Tests**: `cd packages/core && npm test` (tile suggestion tests in `tile-suggestions.spec.ts`)
- **Import path**: `@mindcraft-lang/core/brain/language-service`
- **Main entry point**: `suggestTiles(context, catalogs)`
- **Parser helper**: `parseTilesForSuggestions(tiles)` -- returns `EmptyExpr` for empty lists

## Core Types

- **`InsertionContext`**: `{ ruleSide, expectedType?, expr?, replaceTileIndex? }`
- **`TileSuggestionResult`**: `{ exact, withConversion }` -- both `List<TileSuggestion>`
- **`TileSuggestion`**: `{ tileDef, compatibility, conversionCost }`
- **`TileCompatibility`**: `Exact (0)` / `Conversion (1)` / `Unchecked (2)`

## Two Modes

**Append** (default): Dispatches on `expr.kind` -- empty/error gets all expression tiles;
complete values get infix operators + accessors; incomplete values get value-only tiles;
actuators/sensors get call spec tiles + infix ops after trailing complete values.

**Replacement** (`replaceTileIndex` set): Walks AST via `findReplacementRole` to determine
structural role (expressionPosition, value, infixOperator, prefixOperator, actionCallArg,
accessorPosition) and suggests accordingly.

## Key Invariants

1. Modifiers and parameters are never suggested in expression position -- only inside action calls
2. Infix operators are always excluded from `suggestExpressionTiles` -- only via `suggestInfixOperators` after a complete value
3. Prefix operators are filtered by result type when an expected type constraint exists (no conversion-based matching)
4. Completed sensors get infix operators (they produce a value); completed actuators get nothing (Void return)
5. Operator overload filtering is opt-in via the `operatorOverloads` parameter
6. Value-pending suppresses named tiles -- when `hasParametersNeedingValues`, `hasIncompleteAnonValues`, or `hasStructValuePendingAccessor` is true, named parameter/modifier tiles are suppressed
7. Unclosed parens also trigger value-pending suppression
8. Accessor type uses `trailingPrimaryExpr` (rightmost leaf), not the overall expression type
9. Non-inline sensors are excluded from sub-expression positions except as prefix operator operands (`allowNonInlineSensors` flag)
10. Incomplete binary ops infer RHS type from operator overloads via `incompleteExprExpectedType`
11. Struct field matching is a type compatibility fallback -- struct-typed tiles go to `withConversion` when a field matches the expected type
12. Replacement mode excludes the replaced slot from filled-slot computation
13. Precedence-aware operator suggestions: after `[a] [>] [b]`, higher-precedence operators like `*` check against the right operand type via `effectiveLhsType`
14. Operator-derived type overrides slot type for incomplete anon values (exact match on operand type, not conversion via outer slot type)
15. Insert-before uses truncated tile context: `tiles.slice(0, N)` for inserting at position N

## Call Spec Grammar Enforcement

`collectAvailableArgSlots` recursively walks the call spec tree:

- `arg`: available if fill count < repeatMax
- `bag`: all items independently available
- `choice`: filled option excludes others (via `specHasAnyFill`)
- `seq`: all items suggested (ordering enforced by parser)
- `optional`: delegates to inner item
- `repeat`: overrides repeatMax for descendants
- `conditional`: evaluates condition via `findNamedSpec` -> then/else branch

`suggestActionCallTiles` collects filled slots, computes available arg slots, then:

- Anonymous slots -> collect expected types for expression suggestions
- Named parameters/modifiers -> suggest directly (suppressed when valuePending)
- Filled parameters with missing values -> collect expected types
- Incomplete anon slots -> collect expected types (operator-derived type overrides slot type)

## Type Compatibility

1. No constraint -> `Unchecked`
2. Unknown output type -> `Unchecked`
3. Exact match -> `Exact`, cost 0
4. Conversion available -> `Conversion`, cost = sum of steps
5. Struct field match fallback -> `Conversion`, cost = 1 + conversion cost
6. No match -> excluded

## Tests

Uses `node:test` and `node:assert/strict`. Spec files use package imports
(`@mindcraft-lang/core/brain`, etc.). The `pretest` script runs `npm run build:node`
automatically.
