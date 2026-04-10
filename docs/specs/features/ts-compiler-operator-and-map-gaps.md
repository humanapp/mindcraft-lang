# ts-compiler -- Operator and Map Gaps -- Phased Implementation Plan

Phased plan to close six identified gaps in the TypeScript compiler's operator and
Map/Dict support. Each gap becomes one phase (G1-G6), ordered by dependency and
difficulty.

Companion to [typescript-compiler-phased-impl-p2.md](typescript-compiler-phased-impl-p2.md).

---

## Workflow Convention

Each phase follows this loop:

1. Copilot implements the phase.
2. Copilot performs "lowering.ts" audit (described below).
3. Copilot stops and presents work for review.
4. The user reviews, requests changes or approves.
5. Only after the user declares the phase complete does the post-mortem happen.
6. Post-mortem writes the Phase Log entry, updates Current State, and any repo
   memory notes.

**"lowering.ts" audit:** As part of each phase, you MUST audit your changes to "lowering.ts" to verify that every new codepath added must either emit IR or push a diagnostic. No codepath may silently fall through without producing output. Verify this for each branch you add. You are REQUIRED to do this if you make any changes to lowering.ts.

Additional Guidance:

* Avoid adding tests to "codegen.spec.ts". This file is huge and fills up session context. Prefer to extend or introduce feature-scoped spec files, e.g. "map-methods.spec.ts", "optional-chaining.spec.ts", etc. It's ok if the scope is imperfect (there can be overlap), main goal is to avoid filling context with largely irrelevant information.

---

## Current State

### What works

- Map literals: `{ key: value }` -> `MAP_NEW` + `MAP_SET`.
- Map read via bracket: `map[key]` -> `MAP_GET`.
- Map write via bracket: `map[key] = value` -> `MAP_SET`.
- Map compound bracket assignment: `map[key] += 1` -> read-modify-write via
  `MAP_GET` + operator + `MAP_SET`.
- Map methods: `.has()` -> `MAP_HAS`, `.delete()` -> `MAP_DELETE`,
  `.set(k, v)` -> `MAP_SET`, `.keys()` -> `$$map_keys`, `.values()` -> `$$map_values`,
  `.clear()` -> `$$map_clear`, `.forEach(cb)` -> inline loop, `.size` -> `$$map_size`.
- Map method chaining: `m.keys().length`, `m.values().length`.
- `for (const k in map)` -> `$$map_keys` host function.
- Arithmetic compound assignment: `+=`, `-=`, `*=`, `/=`.
- `Math.pow(a, b)` via `$$math_pow` host function.
- Binary operators: `+`, `-`, `*`, `/`, `%`, `<`, `>`, `<=`, `>=`, `==`/`===`,
  `!=`/`!==`.
- Logical short-circuit: `&&`, `||`, `??`.
- `typeof` -> `TYPE_CHECK` opcode (checks `NativeType` tag).

### What does not work

| Feature | Current behavior |
|---------|-----------------|
| `%=` | Not in `isAssignmentOperator`; falls through to binary expression path |
| `??=`, `\|\|=`, `&&=` | Not recognized as assignment; falls through to binary path |
| `instanceof` | `UnsupportedOperator` diagnostic |
| `**` (exponentiation) | `UnsupportedOperator` diagnostic |
| Bitwise operators (`&`, `\|`, `^`, `~`, `<<`, `>>`) | `UnsupportedOperator` diagnostic |
| `const k = m.keys(); k.length` | Unsupported property access (TS infers `Record` index type, not list) |

---

## Phase G1 -- Map element access assignment and mutation methods

**Goal:** Make maps mutable from user code via bracket assignment and method calls.

### Background

The VM already has `MAP_HAS` (103) and `MAP_DELETE` (104) opcodes implemented in
`vm.ts` (`execMapHas`, `execMapDelete`). The IR defines `IrMapSet` but only uses it
during literal initialization. The emitter already handles `MapSet`. Only the compiler
frontend is missing.

The `Dict` class in `packages/core/src/platform/dict.ts` has `has()`, `delete()`,
`size()`, `keys()`, `values()`, `entries()`, `forEach()`, `clear()` -- but none are
callable from user code.

### Deliverables

**G1a -- `map[key] = value` (bracket assignment)**

1. `lowering.ts` -- `lowerElementAccessAssignment()`: after the existing
   `resolveListTypeId()` check, add a `resolveMapTypeId()` branch. When the target
   is a map type, lower `expression`, `argumentExpression`, and `right`, then emit
   `{ kind: "MapSet" }`. No new IR nodes needed.
2. Tests: `map[key] = value` for string-keyed and number-keyed maps, compound
   assignment on map elements (`map[key] += 1`).

**G1b -- `.has(key)` and `.delete(key)` (VM opcodes already exist)**

1. `ir.ts` -- add `IrMapHas` and `IrMapDelete` node interfaces.
2. `lowering.ts` -- add `lowerMapMethodCall()` dispatcher, called from the method
   call routing logic alongside `lowerListMethodCall()`. Handle `.has()` (one arg,
   emit `IrMapHas`) and `.delete()` (one arg, emit `IrMapDelete`).
3. `emit.ts` -- add `MapHas` and `MapDelete` cases that call the corresponding
   emitter methods.
4. Tests: `.has()` returns boolean, `.delete()` removes key, `.has()` returns false
   after delete.

**G1c -- `.size` (property access)**

Two options: (a) add a `MAP_SIZE` VM opcode, or (b) use a `$$map_size` host function.

Recommendation: host function approach (`$$map_size`), consistent with `$$map_keys`.
Add to `map-builtins.ts`. In `lowerMapMethodCall()`, detect `.size` property access
(not a call) and emit a host call. Note: TypeScript's `Record<K, V>` does not have a
`.size` property natively -- this is a Mindcraft-specific extension on the mapped type.
If `.size` is accessible only via an ambient declaration, the ambient module must expose
it.

Alternative: treat `.size` as a lowering-only rewrite (no ambient needed) by detecting
the property access pattern on a resolved map type and emitting the host call directly.
This avoids polluting the ambient declarations.

**G1d -- `.keys()`, `.values()`, `.forEach()`**

These require iteration or callback dispatch. Recommended approach: inline lowering
(same pattern as list `.forEach()`, `.map()`, etc.).

- `.keys()` -- reuse `$$map_keys` host function, return the list directly.
- `.values()` -- new `$$map_values` host function in `map-builtins.ts`. Iterates
  map values into a `List<Value>`.
- `.forEach(callback)` -- inline lowering: get keys via `$$map_keys`, loop with
  index, call callback with `(value, key, map)` via `CALL_INDIRECT`. Follow the
  existing `lowerListForEach()` pattern.

**G1e -- `.set(key, value)` and `.clear()`**

- `.set(key, value)` -- emit `IrMapSet` (already exists). The method form pushes
  map, key, value onto the stack and emits `MapSet`. Return value is the map itself
  (for chaining).
- `.clear()` -- new `$$map_clear` host function. Clears all entries from the Dict.

### Risks

- Compound assignment on map elements (`map[key] += 1`) requires reading the old
  value first. The existing compound assignment lowering for list elements can serve
  as a template -- it reads, applies the operator, then stores.
- `.size` as a property (not a method call) needs careful AST detection. Could be
  a `PropertyAccessExpression` rather than a `CallExpression`.

### Tests

- `methods.spec.ts` or new `map-methods.spec.ts`: bracket write, `.has()`,
  `.delete()`, `.size`, `.keys()`, `.values()`, `.forEach()`, `.set()`, `.clear()`.
- Compound assignment: `map[k] += 1`, `map[k] -= 1`.

---

## Phase G1.5 -- Migrate maps to standard `Map<K, V>` interface

**Goal:** Replace the `Record<string, V>` ambient representation and named map type
aliases (`NumberMap`, `StringMap`, etc.) with a proper `Map<K, V>` interface that
matches standard TypeScript. This gives users method autocomplete, typed return
values (enabling `m.keys().length` via variable), and familiar `new Map()` syntax.

### Background

Map types are currently declared in the ambient module as type aliases:
```ts
export type NumberMap = Record<string, number>;
```

`Record<string, V>` is a plain mapped type with no method signatures. The lowering
pass handles `.has()`, `.delete()`, `.keys()`, etc. by detecting map-typed
expressions and emitting IR directly -- but TS intellisense cannot autocomplete
these methods, and return types of `.keys()`/`.values()` are untyped (preventing
`const k = m.keys(); k.length`).

Standard TypeScript uses `Map<K, V>` as a class with `new Map()` construction and
`.get()`/`.set()` for element access (no bracket access). Aligning with this
standard resolves all ambient type limitations.

### API changes for user code

| Before | After |
|--------|-------|
| `const m: NumberMap = { a: 1, b: 2 }` | `const m = new Map<string, number>([["a", 1], ["b", 2]])` |
| `m["key"]` | `m.get("key")` |
| `m["key"] = 5` | `m.set("key", 5)` |
| `.has()`, `.delete()`, `.keys()`, `.values()`, `.forEach()`, `.clear()`, `.size` | Same (unchanged) |
| `m.keys()` (no chaining) | `m.keys().length` (now works via variable too) |

No back-compat concerns -- no external users exist.

### Deliverables

**G1.5a -- Ambient `Map<K, V>` interface**

Add to the ambient header in `ambient.ts` (following the `Array<T>` pattern):

```ts
interface Map<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): this;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  keys(): K[];
  values(): V[];
  forEach(callbackfn: (value: V, key: K) => void): void;
  readonly size: number;
}

interface MapConstructor {
  new <K, V>(): Map<K, V>;
  new <K, V>(entries: readonly (readonly [K, V])[]): Map<K, V>;
}
declare var Map: MapConstructor;
```

Notes:
- `keys()` returns `K[]` (not `IterableIterator<K>`) so `m.keys().length` works
  through existing list infrastructure.
- `values()` returns `V[]` for the same reason.
- `delete()` returns `boolean` (matching standard TS).
- `set()` returns `this` for chaining.
- No index signature -- bracket access is not part of standard `Map`.
- Key type is generic `K`, but the runtime only supports string keys. Diagnostic
  for non-string K can be emitted during lowering.

**G1.5b -- `new Map()` constructor lowering**

In `lowerNewExpression` (lowering.ts), add special-case handling before the
function table lookup:

1. Detect `className === "Map"`.
2. No-arg form: `new Map<string, number>()` -- resolve the map type from the
   TS type of the expression (`ctx.checker.getTypeAtLocation(expr)`), emit
   `{ kind: "MapNew", typeId }`.
3. Array-of-tuples form: `new Map<string, number>([["a", 1], ["b", 2]])` --
   emit `MapNew`, then for each tuple element emit `PushConst(key)`,
   `lowerExpression(value)`, `MapSet`. The argument must be an array literal
   of array literals (`[[k, v], ...]`).
4. Dynamic form (variable as argument): emit diagnostic for now. Can be
   supported later.
5. Resolve the map type ID via `resolveMapTypeId` or the TS type checker's
   type arguments for `Map<K, V>`.

**G1.5c -- `.get(key)` method**

Add `"get"` case to `lowerMapMethodCall`: one argument, lower the map expression
and key, emit `{ kind: "MapGet" }`. Return type is naturally `V | undefined` per
the ambient declaration.

**G1.5d -- Update `resolveMapTypeId`**

`resolveMapTypeId` currently recognizes map types by:
1. Symbol name lookup in the type registry (for named aliases like `NumberMap`).
2. String index type fallback (`{ [key: string]: V }`).

Add a third path: recognize the `Map` symbol from its TS declaration. When the
type's symbol is `Map`, extract the value type from the second type argument and
use `registry.instantiate("Map", [valueTypeId])`.

**G1.5e -- Remove named map type aliases**

1. `ambient.ts`: Remove `generateMapInterface` (if it was added) and the
   `NativeType.Map` branch in `buildAmbientDeclarationsFromRegistry` that
   generates `export type NumberMap = ...`.
2. `ambient.ts`: Remove `NativeType.Map` from `typeDefToTs` (no longer needed
   for ambient generation -- but keep it if other callers use it).
3. Update `lowerObjectLiteral` -- map literals (`{ a: 1 }`) without a contextual
   `Map<K, V>` type should no longer resolve as maps. Object literals are for
   structs; maps use `new Map(...)`.

**G1.5f -- Remove `.keys().length` hack**

The special-case detection in `lowerPropertyAccess` for `.keys()`/`.values()`
chaining on map types (added in G1) can be removed. With `keys()` returning
`K[]` in the ambient declaration, `resolveListTypeId` will naturally recognize
the return type and `ListLen` will be emitted through the standard path.

**G1.5g -- Update tests**

Rewrite `map-methods.spec.ts` and update map-related tests in `codegen.spec.ts`
and `array.spec.ts`:
- Replace `types.addMapType("NumberMap", ...)` with appropriate type registration
  for `Map<string, number>`.
- Replace `const m: NumberMap = { a: 1 }` with `const m = new Map<string, number>([["a", 1]])`.
- Replace `m["key"]` reads with `m.get("key")`.
- Replace `m["key"] = value` writes with `m.set("key", value)`.
- Add tests for `new Map()` (empty), `new Map([...])` (with entries).
- Add test for `.get()` returning value.
- Test `const k = m.keys(); k.length` (previously broken, now works).
- Test that `.delete()` returns boolean.

**G1.5h -- Remove `for...in` on maps, use `for...of m.keys()` instead**

`lowerForInStatement` uses `resolveMapTypeId` to detect map iteration and emits
a `$$map_keys` loop. With the standard `Map<K, V>` interface, `for...in` on a
`Map` is not valid standard TypeScript.

Remove the map branch from `lowerForInStatement`. Users should write
`for (const k of m.keys())` instead. Since `keys()` returns `K[]` (a list),
`lowerForOfStatement` handles it naturally via `resolveListTypeId` -- no new
code is needed on the `for...of` side.

If the `for...in` map branch is hit after removal, it falls through to the
struct or error paths, which will emit an appropriate diagnostic.

### Risks

- **Type registry instantiation:** The runtime uses `addMapType("NumberMap", ...)`
  to register named map types. With generic `Map<string, V>`, the type registry
  must handle generic instantiation. `registry.instantiate("Map", [valueTypeId])`
  already exists -- verify it works for the `Map<K, V>` case when K is string.
- **`for...in` removal:** `for (const k in map)` will no longer work on maps.
  Users must use `for (const k of m.keys())`. This is the standard TS pattern.
  Update any existing tests that use `for...in` on maps.
- **Map literal sugar:** Removing `{ a: 1 }` as map syntax means users lose a
  concise initialization syntax. `new Map([["a", 1], ["b", 2]])` is more verbose.
  Acceptable trade-off for standard TS alignment.
- **Brain tile language:** The tile editor may reference named map types. Verify
  that tile compilation still works when the type registry uses instantiated
  generic map types instead of named aliases. The tile language compiles through
  the brain compiler (not ts-compiler), so this phase should not affect it.

### Tests

- `map-methods.spec.ts`: complete rewrite with `new Map(...)` syntax.
- Regression test: `for (const k in m)` (or replacement pattern).
- New: `m.get("key")`, `new Map()`, `new Map([...])`, `.delete()` returns boolean,
  `const k = m.keys(); k.length`.

---

## Phase G2 -- Exponentiation operator (`**`)

**Goal:** Support `a ** b` as a binary operator. Add a `CoreOpId` but do not register
a tile for it.

### Background

`Math.pow(a, b)` already works via `$$math_pow`. The `**` operator is syntactic sugar
for the same operation. Two implementation strategies:

- **Strategy A (desugar):** In `lowerBinaryExpression`, detect `AsteriskAsteriskToken`
  and emit the same host call sequence as `Math.pow(a, b)`. No new CoreOpId needed.
- **Strategy B (CoreOpId):** Add `Power` to `CoreOpId`, register it in the operator
  table with right-associative precedence 25 (between unary 30 and multiplicative 20),
  register the `(Number, Number) -> Number` overload, and map
  `AsteriskAsteriskToken` -> `CoreOpId.Power` in `tsOperatorToOpId`. Do not register
  a tile.

Per the user's direction: **use Strategy B** (add CoreOpId, no tile).

### Deliverables

1. `packages/core/src/brain/interfaces/operators.ts` -- add `Power: "pow"` to
   `CoreOpId`.
2. `packages/core/src/brain/runtime/operators.ts`:
   - Add `Precedence` entry: `[CoreOpId.Power]: { fixity: "infix", precedence: 25, assoc: "right" }`.
   - Add to `registerCoreOperators`: `operatorTable.add(...)`.
   - Add `operatorOverloads.binary(CoreOpId.Power, Number, Number, Number, ...)` with
     `exec: (ctx, args) => mkNumberValue(MathOps.pow(a.v, b.v))`.
3. `packages/ts-compiler/src/compiler/lowering.ts`:
   - `tsOperatorToOpId`: add `case ts.SyntaxKind.AsteriskAsteriskToken: return CoreOpId.Power`.
4. `packages/ts-compiler/src/compiler/lowering.ts`:
   - `compoundAssignmentToOpId`: add `case ts.SyntaxKind.AsteriskAsteriskEqualsToken: return CoreOpId.Power`.
   - `isAssignmentOperator`: add `case ts.SyntaxKind.AsteriskAsteriskEqualsToken`.
5. Tests: `2 ** 10 === 1024`, `9 ** 0.5 === 3`, `2 ** 2 ** 3 === 256`
   (right-associativity), `let x = 2; x **= 10; x === 1024`.

### Risks

- The `MathOps.pow` import is already available in `operators.ts` via the platform
  math module.
- Right-associativity (`2 ** 2 ** 3 === 256`) is handled by the TS parser, not
  our precedence table. The precedence table is used by the brain tile editor, not
  by the TS compiler lowering. So `assoc: "right"` is for correctness in the tile
  system only.

---

## Phase G3 -- Bitwise operators

**Goal:** Support `&`, `|`, `^`, `~`, `<<`, `>>` as operators. Add `CoreOpId` entries
but do not register tiles.

### Background

No bitwise infrastructure exists anywhere in the system. The Luau target
(`math.rbx.ts`) would use `bit32` library functions, but this is a platform detail --
the operator overload exec functions in `operators.ts` use platform-abstracted math.

For platform abstraction: Node uses native JS bitwise operators. Luau uses `bit32.band`,
`bit32.bor`, `bit32.bxor`, `bit32.bnot`, `bit32.lshift`, `bit32.rshift`. These should
be added to the platform `MathOps` abstraction in `math.node.ts` / `math.rbx.ts`.

### Deliverables

**G3a -- CoreOpId and platform math**

1. `packages/core/src/brain/interfaces/operators.ts` -- add to `CoreOpId`:
   - `BitwiseAnd: "bitand"`
   - `BitwiseOr: "bitor"`
   - `BitwiseXor: "bitxor"`
   - `BitwiseNot: "bitnot"` (unary)
   - `LeftShift: "shl"`
   - `RightShift: "shr"`
2. `packages/core/src/platform/math.node.ts` -- add to `MathOps`:
   - `bitAnd: (a, b) => a & b`
   - `bitOr: (a, b) => a | b`
   - `bitXor: (a, b) => a ^ b`
   - `bitNot: (a) => ~a`
   - `leftShift: (a, b) => a << b`
   - `rightShift: (a, b) => a >> b`
3. `packages/core/src/platform/math.rbx.ts` -- add corresponding `bit32.*` calls.
4. `packages/core/src/brain/runtime/operators.ts`:
   - Precedence entries (matching JS precedence relative to existing scale):
     - `BitwiseNot`: prefix, precedence 30 (same as unary `!` and `-`).
     - `LeftShift`, `RightShift`: infix, precedence 8, assoc left.
     - `BitwiseAnd`: infix, precedence 7, assoc left.
     - `BitwiseXor`: infix, precedence 6, assoc left.
     - `BitwiseOr`: infix, precedence 5 (but note: must not collide with existing
       comparison at 5). Adjust the scale if needed -- existing comparison is at 5,
       equality at 4. In JS, bitwise OR is between equality and logical AND. So:
       shifts 8, bitAnd 7, bitXor 6 is too high. Re-evaluate against JS precedence.

   JS precedence order (high to low): unary -> `**` -> `* / %` -> `+ -` ->
   `<< >>` -> `< > <= >=` -> `== !=` -> `&` -> `^` -> `|` -> `&&` -> `||`.

   Current scale: unary 30, mul/div/mod 20, add/sub 10, comparison 5, equality 4,
   and 2, or 1, assign 0.

   Proposed adjusted scale (only new entries shown, existing entries unchanged):
     - `Power`: 25, right-assoc (from G2).
     - `LeftShift`, `RightShift`: 8, left-assoc.
     - `BitwiseAnd`: 3.5 -- between equality (4) and and (2). Use integer: shift
       the existing scale or use fractional. Since the values are just numbers,
       3.5 works but is inelegant. Better: rescale.

   **Recommended rescale** (apply during G3, adjust existing entries):
     - unary (not, neg, bitnot): 150
     - power: 140
     - mul/div/mod: 130
     - add/sub: 120
     - shift: 110
     - comparison (lt, le, gt, ge): 100
     - equality (eq, ne): 90
     - bitand: 80
     - bitxor: 70
     - bitor: 60
     - logical and: 50
     - logical or: 40
     - assign: 10

   This rescale is purely internal to the `Precedence` table and the brain tile
   editor. The TS compiler does not use these values -- the TS parser handles
   precedence. The rescale avoids fractional values and leaves room for future
   operators.

   - Register all six operators in `registerCoreOperators`.
   - Register binary overloads for `(Number, Number) -> Number` for the five
     binary ops, and unary `(Number) -> Number` for `BitwiseNot`.
   - Do not register tiles.

**G3b -- ts-compiler lowering**

1. `lowering.ts` -- `tsOperatorToOpId`: add cases for `AmpersandToken`,
   `BarToken`, `CaretToken`, `LessThanLessThanToken`,
   `GreaterThanGreaterThanToken`. Map to corresponding `CoreOpId`.
2. `lowering.ts` -- unary prefix handling: add `TildeToken` case that emits
   `CoreOpId.BitwiseNot` (same pattern as `ExclamationToken` -> `Not` and
   `MinusToken` -> `Negate`).
3. `isAssignmentOperator` / `compoundAssignmentToOpId`: add compound variants
   (`&=`, `|=`, `^=`, `<<=`, `>>=`) mapping to the corresponding `CoreOpId`.
4. `>>>` (unsigned right shift): either support it as a separate CoreOpId or
   reject it with a diagnostic. Recommendation: reject with diagnostic for now
   (`UnsupportedOperator`). Luau `bit32.rshift` is already unsigned, so there
   is no clean cross-platform equivalent for signed vs unsigned distinction.
5. Tests: `5 & 3 === 1`, `5 | 3 === 7`, `5 ^ 3 === 6`, `~5 === -6`,
   `1 << 3 === 8`, `8 >> 2 === 2`, compound `x &= 3`.

### Risks

- Precedence rescale touches existing entries. Must verify that the brain tile
  editor still produces correct results. The relative ordering is preserved, so
  behavior should be identical.
- Luau `bit32` operates on 32-bit unsigned integers. JS bitwise operators convert
  to 32-bit signed integers. The semantics differ for negative numbers and for
  right-shift. Document this cross-platform discrepancy.
- `>>>` (unsigned right shift) is deferred.

---

## Phase G4 -- Compound and nullish assignment operators (`%=`, `??=`, `||=`, `&&=`)

**Goal:** Support `%=`, `??=`, `||=`, and `&&=`. No new CoreOpIds needed -- these use
special lowering.

### Background

`%=` is already in `compoundAssignmentToOpId` (maps to `CoreOpId.Modulo`) but missing
from `isAssignmentOperator`, so it is never routed to the assignment path.

`??=`, `||=`, `&&=` have short-circuit semantics:
- `x ??= expr` -- assign `expr` to `x` only if `x` is `null`/`undefined`.
- `x ||= expr` -- assign `expr` to `x` only if `x` is falsy.
- `&&= expr` -- assign `expr` to `x` only if `x` is truthy.

These cannot use the standard compound assignment pattern (read, op, store) because
the right-hand side must not be evaluated when the condition is not met.

### Deliverables

**G4a -- Fix `%=`**

1. `lowering.ts` -- `isAssignmentOperator`: add
   `case ts.SyntaxKind.PercentEqualsToken`.
2. Test: `let x = 10; x %= 3; x === 1`.

**G4b -- `??=` (nullish assignment)**

Lowering pattern for `x ??= expr` (local variable target):
```
LoadLocal x
Dup
TypeCheck(NativeType.Nil)   // pushes true if nil
JumpIfFalse endLabel        // if NOT nil, skip assignment
Pop                         // discard the duplicated non-nil value
<lower expr>
StoreLocal x
Label endLabel
```

Wait -- `TypeCheck` pops the value and pushes a boolean. So `Dup` first, then
`TypeCheck` consumes the dup, pushes bool. If nil -> true -> jump doesn't happen ->
fall through to pop + assign. If not nil -> false -> jump to end. But we still have
the original value on the stack from the Dup that wasn't consumed... Let me re-examine.

Revised pattern for `x ??= expr`:
```
LoadLocal x
TypeCheck(NativeType.Nil)     // pops x, pushes true if x is nil
JumpIfFalse endLabel          // if x is NOT nil, skip to end
<lower expr>                  // push new value
StoreLocal x                  // store new value into x
Label endLabel
```

This is the correct pattern. `TypeCheck` is destructive (pops its operand). If x is
nil, the boolean true remains, `JumpIfFalse` does not jump, we fall through, pop the
boolean (wait -- `JumpIfFalse` pops the condition). Let me trace more carefully.

After `TypeCheck`: stack has `[true]` (if nil) or `[false]` (if non-nil).
`JumpIfFalse` pops the condition: if false (non-nil), jumps to endLabel. If true (nil),
falls through to evaluate expr and store.

This is correct and clean. The original value of `x` is not needed on the stack
because we re-store from the expression result.

For property targets (`obj.prop ??= expr`) and element access targets
(`arr[i] ??= expr`), the pattern is more complex -- need to load the target,
check, conditionally evaluate RHS, and store back. Follow the existing compound
assignment patterns for property/element access targets.

1. `lowering.ts` -- `isAssignmentOperator`: add
   `case ts.SyntaxKind.QuestionQuestionEqualsToken`.
2. `lowering.ts` -- in `lowerAssignment` (or a new helper `lowerNullishAssignment`),
   detect `QuestionQuestionEqualsToken` and emit the pattern above. Handle local,
   property access, and element access targets.
3. Tests: `let x: number | null = null; x ??= 5; x === 5`,
   `let y = 10; y ??= 5; y === 10`, property target, element access target.

**G4c -- `||=` (logical OR assignment)**

Pattern for `x ||= expr`:
```
LoadLocal x
JumpIfTrue endLabel           // if x is truthy, skip (JumpIfTrue pops condition)
<lower expr>
StoreLocal x
Label endLabel
```

Wait -- need to check: does `JumpIfTrue` exist? Let me verify with the existing
short-circuit lowering.

The existing `&&`/`||` lowering uses `DUP` + `JumpIfFalse`/`JumpIfTrue` (where the
jump consumes the duplicated value). Check what jump instructions are available.

Revised approach -- use the same `DUP` + conditional jump pattern as `??`:

For `||=`, the semantics are: if `x` is falsy, assign. JS falsiness includes `0`,
`""`, `false`, `null`, `undefined`, `NaN`. The VM's `JumpIfFalse` checks the
top-of-stack value for truthiness/falsiness. We need it to consume the value.

The simplest correct pattern:
```
LoadLocal x
Dup
JumpIfTrue endLabel           // duplicated value consumed by jump; if truthy, skip
Pop                           // discard original x (it was falsy)
<lower expr>
StoreLocal x
Label endLabel
Pop                           // discard original x left by Dup (truthy path)
```

This gets messy with the extra Pop. Check how existing short-circuit `||` handles
cleanup. The existing `lowerShortCircuit` for `||` does:
```
lowerExpression(left)
Dup
JumpIfTrue endLabel     // if truthy, keep left value (from Dup), skip right
Pop                     // discard falsy left
lowerExpression(right)  // push right value
Label endLabel
// result is on stack: either left (truthy) or right
```

For `||=`, we don't want the result on the stack -- we want a store. And we need to
avoid leaving stale values. Cleaner approach:

```
LoadLocal x
JumpIfFalse assignLabel       // pops x; if falsy, jump to assign
Jump endLabel                 // truthy path: nothing to do
Label assignLabel
<lower expr>
StoreLocal x
Label endLabel
```

This requires `JumpIfFalse` to pop the value. Check: does the VM's `JumpIfFalse`
pop its operand? Yes -- conditional jumps consume the top of stack.

This pattern is correct and clean. Same structure for `&&=` but with `JumpIfTrue`:

```
LoadLocal x
JumpIfTrue assignLabel
Jump endLabel
Label assignLabel
<lower expr>
StoreLocal x
Label endLabel
```

Wait, that is inverted. `&&=` means: assign if truthy. So:
```
LoadLocal x
JumpIfFalse endLabel          // if falsy, skip assignment
<lower expr>
StoreLocal x
Label endLabel
```

And `||=`:
```
LoadLocal x
JumpIfTrue endLabel           // if truthy, skip assignment
<lower expr>
StoreLocal x
Label endLabel
```

These are the simplest correct patterns.

1. `lowering.ts`:
   - `isAssignmentOperator`: add `BarBarEqualsToken`, `AmpersandAmpersandEqualsToken`.
   - New helper `lowerLogicalAssignment()` that handles both `||=` and `&&=` using
     the conditional-jump-then-assign pattern above.
   - Handle local, property access, and element access targets.
2. Tests: `let x = 0; x ||= 5; x === 5`, `let y = 10; y ||= 5; y === 10`,
   `let x = 1; x &&= 5; x === 5`, `let y = 0; y &&= 5; y === 0`.

### Risks

- `||=` truthiness semantics: `JumpIfTrue`/`JumpIfFalse` in the VM must match JS
  truthiness rules (0, "", false, null, undefined are falsy). Verify the VM's
  conditional jump behavior. If it only checks boolean values, `||=` on a number
  would behave incorrectly. The existing `&&`/`||` short-circuit lowering works,
  so the VM likely handles general truthiness.
- Property access and element access targets for all three operators add complexity.
  For `obj.prop ??= expr`, must load `obj`, dup, get field, check, conditionally
  evaluate RHS, then set field on the original object reference.

---

## Phase G5 -- `instanceof`

**Goal:** Support `x instanceof ClassName` for user-defined classes.

### Background

Class inheritance (`extends`) is rejected by the validator
(`ClassInheritanceNotSupported`). Without inheritance, `instanceof` reduces to an
exact type-ID check: does `x`'s runtime struct type ID match `ClassName`'s type ID?

The existing `TYPE_CHECK` opcode checks `value.t === nativeType` (e.g., `Nil`,
`Number`, `Struct`). This checks the *native type tag*, not the specific struct
type ID. For `instanceof`, we need to check the full `TypeId` (which includes the
struct name), not just the `NativeType` tag.

The VM currently has no opcode for "is this value's TypeId equal to X?" but this is a
straightforward addition.

### Deliverables

**G5a -- VM opcode**

1. `packages/core/src/brain/interfaces/vm.ts` -- add `INSTANCE_OF = 151` (or next
   available slot near `TYPE_CHECK`).
2. `packages/core/src/brain/runtime/vm.ts` -- `execInstanceOf`: pop value, read
   operand as a type-ID constant index, compare `value.typeId === constantPool[operand]`.
   Push boolean result.

   The type ID is a string (`TypeId`). The operand encodes an index into the
   function's constant pool where the target TypeId string is stored.

**G5b -- IR and lowering**

1. `ir.ts` -- add `IrInstanceOf { kind: "InstanceOf"; typeId: string }`.
2. `lowering.ts` -- in `lowerBinaryExpression`, before the generic `tsOperatorToOpId`
   call, detect `InstanceOfKeyword`. Resolve the right-hand identifier to its
   class type ID via `tsTypeToTypeId`. Emit `lowerExpression(left)` then
   `{ kind: "InstanceOf", typeId }`.
3. `emit.ts` -- handle `InstanceOf`: push the typeId string into the constant pool,
   emit `INSTANCE_OF` with the constant index as operand.
4. Tests: `class Foo { x: number; } const f = new Foo(1); f instanceof Foo === true`,
   `const n = 5; n instanceof Foo === false`.

**G5c -- Future: inheritance support**

When class inheritance is eventually supported, `INSTANCE_OF` must be extended to
walk a type hierarchy. Options:
- The type registry could maintain a parent-chain lookup table. `INSTANCE_OF` would
  check the value's type ID and all ancestor type IDs.
- Alternatively, each struct value could carry a prototype chain or type-ID list.

This is out of scope for G5 -- document it as a known limitation. `instanceof`
checks exact type only, not subtype relationships.

### Risks

- `instanceof` on non-struct values (numbers, strings, etc.) should return `false`,
  not error. The VM implementation must handle this gracefully.
- Right-hand side must be a class name resolvable at compile time. Dynamic
  `instanceof` checks (`x instanceof someVariable`) are not supported. The lowering
  should emit a diagnostic if the RHS is not a class reference.
- Native-backed structs (Context, etc.) have different TypeId formats. Verify that
  `instanceof` works or is rejected for these.

---

## Phase G6 -- `**=` compound exponentiation assignment

**Goal:** Support `x **= expr` as compound assignment.

### Prerequisites

Phase G2 (exponentiation operator with CoreOpId).

### Background

G2 adds `CoreOpId.Power` and `AsteriskAsteriskToken` -> `CoreOpId.Power` mapping.
G6 adds the compound assignment variant.

### Deliverables

1. `lowering.ts` -- `isAssignmentOperator`: add
   `case ts.SyntaxKind.AsteriskAsteriskEqualsToken`.
2. `lowering.ts` -- `compoundAssignmentToOpId`: add
   `case ts.SyntaxKind.AsteriskAsteriskEqualsToken: return CoreOpId.Power`.
3. Test: `let x = 2; x **= 10; x === 1024`.

### Note

This is listed as a separate phase for sequencing clarity, but it is small enough
to be folded into G2 if convenient. Included in G2's deliverables as item 4.

---

## Suggested Ordering

| Phase | Depends on | Estimated scope |
|-------|------------|-----------------|
| G1 -- Map mutation | None | Medium (multiple sub-deliverables) |
| G1.5 -- Standard Map\<K,V\> | G1 | Medium (ambient + constructor + test rewrite) |
| G2 -- Exponentiation | None | Small |
| G3 -- Bitwise operators | None (but rescales precedence table) | Medium |
| G4 -- Nullish/logical assignment + `%=` | None | Medium (short-circuit lowering) |
| G5 -- `instanceof` | None | Medium (new VM opcode) |
| G6 -- `**=` compound | G2 | Trivial (fold into G2) |

G1.5 depends on G1 (builds on the mutation method infrastructure). All other phases
are independent. G6 depends on G2. Recommended order: G1 -> G1.5 -> G2 -> G4 -> G3
-> G5.

---

## Phase Log

### G1 -- Map element access assignment and mutation methods

**Date:** 2026-04-10

**Files changed (7, +728 -2):**

| File | Summary |
|------|---------|
| `packages/ts-compiler/src/compiler/lowering.ts` | +307: rewrote `lowerElementAccessAssignment` with map branch; added `lowerElementAccessAssignmentForList`, `lowerElementAccessAssignmentForMap`, `lowerCompoundElementAccessAssignment` (shared list/map read-modify-write); added `lowerMapMethodCall` dispatcher (has/delete/set/keys/values/clear/forEach + default diagnostic); added `lowerMapForEach` (inline $$map_keys loop with CallIndirectArgs); added `.size` detection in `lowerPropertyAccess`; added `.keys().length` / `.values().length` chaining detection in `.length` handler; wired `lowerMapMethodCall` into `lowerCallExpressionCore` |
| `packages/ts-compiler/src/compiler/ir.ts` | +10: `IrMapHas`, `IrMapDelete` interfaces added to `IrNode` union |
| `packages/ts-compiler/src/compiler/emit.ts` | +6: `MapHas` and `MapDelete` case handlers |
| `packages/ts-compiler/src/compiler/diag-codes.ts` | +4: `MapMethodWrongArgCount=3160`, `UnsupportedMapMethod=3161` |
| `packages/core/src/brain/runtime/map-builtins.ts` | +46: `$$map_values`, `$$map_size`, `$$map_clear` host functions |
| `packages/ts-compiler/src/compiler/map-methods.spec.ts` | +353: new test file, 16 tests across 10 suites |
| `docs/specs/features/ts-compiler-operator-and-map-gaps.md` | spec edits |

**Delivered beyond spec:**

- Compound element access assignment (`map[k] += 1`, `arr[i] += 1`) was broken for lists too -- the original code had no read-modify-write path. Fixed via `lowerCompoundElementAccessAssignment` shared by both list and map targets.
- `m.keys().length` and `m.values().length` chaining -- added special-case detection in `lowerPropertyAccess` `.length` handler that recognizes `.keys()`/`.values()` calls on map-typed expressions and emits `ListLen`.

**Known limitations:**

- Storing `.keys()`/`.values()` result in a variable then accessing `.length` does not work (`const k = m.keys(); k.length`). TS infers the type from the `Record<string, V>` ambient alias, not as an array. Fixing this requires either changing the ambient type representation (which breaks object literal initialization) or adding a lowering-pass type tracker. Flagged for future follow-up.
- Map types are declared as `Record<string, V>` in ambient declarations. TS does not know about `.has()`, `.delete()`, `.size`, etc. -- these are handled purely by the lowering pass detecting map-typed expressions. This means TS intellisense won't autocomplete these methods.

**Audit result:** All new codepaths in lowering.ts verified -- every branch emits IR or pushes a diagnostic, no silent fallthroughs.
