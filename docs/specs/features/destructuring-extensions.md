# Destructuring Extensions -- Phased Implementation Plan

Research and implementation plan for extending the TypeScript compiler's destructuring
support beyond the flat object/array destructuring delivered in Phase 16. Covers
nested destructuring, rest patterns, computed property names in destructuring, and
parameter-position destructuring.

Companion to [typescript-compiler-phased-impl-p2.md](typescript-compiler-phased-impl-p2.md).
Phase 16 post-mortem and current destructuring state are documented there.

---

## Workflow Convention

Same loop as the parent plan (typescript-compiler-phased-impl-p2.md, "Workflow
Convention" section). Phases here are numbered D1-D4 to avoid collision with the
main plan's numbering.

---

## Current State

(Updated 2026-04-01, after D4 completion)

### What works

- Object destructuring: `const { x, y } = pos` via `GetField`.
- Array destructuring: `const [a, b] = arr` via `ListGet`.
- Property rename: `const { x: posX } = pos`.
- Omitted array elements: `const [, b] = arr`.
- Default values: `const { x = 5 } = obj` with `TypeCheck(NativeType.Nil)` nil-check.
- Source evaluated once into a temp local via `allocLocal()`.
- **Nested destructuring** at arbitrary depth: `const { pos: { x, y } } = entity`,
  `const { items: [first, second] } = data`, mixed object/array nesting. Implemented
  via recursive `lowerObjectBindingPattern`/`lowerArrayBindingPattern` helpers.
- Default values on intermediate nested patterns (e.g., `{ pos: { x } = defaultPos }`).
- **Parameter-position destructuring** in helper functions and closures/arrow
  functions: `function f({ x, y }: Point)`, `({ x }: Point) => x`. Implemented
  by emitting destructuring IR after ctx creation, passing parameter slot directly
  as `srcLocal`.
- Capture analysis correctly excludes destructured param names from free-variable
  detection in closures.
- **Array rest patterns:** `const [first, ...rest] = arr`. Implemented via inline
  slice loop in `lowerArrayRestElement`. Rest element must be last. Supports
  nested binding on the rest target.
- **Object rest patterns:** `const { x, ...rest } = obj`. Implemented via
  `STRUCT_COPY_EXCEPT` VM opcode. Pops N excluded keys and source struct, pushes
  a new struct with remaining fields. Works for any struct at runtime (including
  native-backed). Supports nested binding on the rest target and nested
  destructuring combined with rest at any level.
- **Computed property names in destructuring:** `const { ["x"]: val } = obj`,
  `const { [key]: val } = obj`. Implemented via `IrGetFieldDynamic` IR node
  that emits the same `GET_FIELD` opcode but with the key expression already on
  the stack. Works with rest patterns: computed key is evaluated into a temp
  local, which is reused by `lowerObjectRestElement` to push the exclude key.
  Validator relaxed to allow non-literal computed keys in binding elements.

### What is rejected

| Pattern | Diagnostic code | Location |
|---|---|---|
| Array rest not in last position | `RestElementMustBeLast` (3025) | `lowerArrayBindingPattern` |
| Object rest not in last position | `RestElementMustBeLast` (3025) | `lowerObjectBindingPattern` |
| Destructuring in `onExecute` params | `DestructuringInOnExecuteNotSupported` (3024) | `lowerOnExecuteBody` |

### Known limitations

- `tsTypeToTypeId` returns `undefined` for `Omit<T, K>`, so the rest struct
  gets typeId `"struct:<anonymous>"`. Property access still works because
  `lowerPropertyAccess` falls back to TS `type.getProperties()` when
  `resolveStructType` returns `undefined`.

### Key existing infrastructure

- `IrGetField { fieldName: string }` -- static field name, emitter pushes string
  constant then emits `GET_FIELD`. The VM's `execGetField` pops fieldName + source
  from stack (already dynamic at the opcode level).
- `IrGetFieldDynamic` -- no embedded field name. Both source and key are already
  on the stack from the lowering. Emitter maps directly to `GET_FIELD`.
- `IrListGet` -- pops index + list from stack, pushes element.
- `lowerListSlice` -- inline expansion of `.slice(start, end?)` using a loop with
  `ListNew`/`ListGet`/`ListPush`. Reusable for array rest patterns.
- `allocLocal()` on `ScopeStack` -- anonymous temp locals.
- `collectBindingNames(pattern)` -- recursively collects all leaf identifier names
  from a binding pattern. Used for closure capture exclusion; reusable for D3b
  object rest field exclusion.
- `resolveStructType(type)` -- resolves a TS type to a `StructTypeDef` with
  compile-time field list (`StructTypeDef.fields: List<{ name, typeId }>`).
- `StructNew`/`StructSet` IR nodes for struct construction.
- `lowerDestructuringDefault(element, localIdx, ctx)` -- existing nil-check +
  default value pattern, reusable at any nesting depth.

---

## Phases

### Phase D1: Nested Destructuring

**Objective:** Support arbitrarily nested object and array destructuring in variable
declarations.

**Examples:**

```typescript
const { pos: { x, y } } = entity;
const [[a, b], c] = nested;
const { items: [first, second] } = data;
```

**Packages/files touched:**

- `packages/ts-compiler/src/compiler/lowering.ts` -- refactor
  `lowerObjectDestructuring` and `lowerArrayDestructuring` to support recursive
  binding patterns.

**Concrete deliverables:**

1. Refactor the two destructuring functions to accept a source local index instead
   of requiring a `ts.VariableDeclaration` with an initializer. Extract the
   "evaluate initializer into srcLocal" preamble into a wrapper, then the core
   logic operates on `(pattern, srcLocalIdx, ctx)`.

2. In the per-element loop, when `element.name` is an `ObjectBindingPattern` or
   `ArrayBindingPattern` instead of an identifier:
   - Emit the field/index access (`GetField` or `ListGet`) into a new temp local
     via `allocLocal()`.
   - Recursively call the appropriate destructuring function with the temp local
     as the source.

3. Default values work at every nesting level -- `lowerDestructuringDefault` is
   called per binding element regardless of depth.

4. Remove the `NestedDestructuringNotSupported` diagnostic. Optionally add a
   depth limit (e.g., 8 levels) with a new diagnostic to prevent pathological
   nesting.

**Refactoring sketch:**

Current signatures:
```
lowerObjectDestructuring(pattern, decl, ctx)   // decl has initializer
lowerArrayDestructuring(pattern, decl, ctx)     // decl has initializer
```

New signatures:
```
lowerObjectBindingPattern(pattern, srcLocalIdx, ctx)   // core logic
lowerArrayBindingPattern(pattern, srcLocalIdx, ctx)     // core logic
lowerObjectDestructuring(pattern, decl, ctx)            // wrapper: eval init -> call core
lowerArrayDestructuring(pattern, decl, ctx)             // wrapper: eval init -> call core
```

The per-element branch becomes:

```
if (ts.isIdentifier(element.name)) {
  // existing: declareLocal, GetField/ListGet, StoreLocal, default
} else if (ts.isObjectBindingPattern(element.name)) {
  const tempLocal = allocLocal();
  // emit GetField/ListGet into tempLocal
  lowerObjectBindingPattern(element.name, tempLocal, ctx);
} else if (ts.isArrayBindingPattern(element.name)) {
  const tempLocal = allocLocal();
  // emit GetField/ListGet into tempLocal
  lowerArrayBindingPattern(element.name, tempLocal, ctx);
}
```

**IR/emit changes:** None. Uses existing `GetField`, `ListGet`, `LoadLocal`,
`StoreLocal`, `allocLocal()`.

**Acceptance criteria:**

- Test: `const { pos: { x, y } } = entity` -> `x`, `y` have correct values
- Test: `const [[a, b], c] = nested` -> `a`, `b`, `c` correct
- Test: `const { items: [first, second] } = data` -> mixed nesting works
- Test: nested destructuring with default values at inner level
- Test: 3+ levels of nesting compiles and executes correctly

**Key risks:**

- **Temp local proliferation.** Each nesting level allocates a temp local that is
  never freed. Acceptable -- the scope stack does not reclaim locals, and nesting
  depth is bounded in practice.
- **Default values on nested patterns.** A default on an intermediate pattern
  (e.g., `const { pos: { x, y } = defaultPos } = entity`) requires nil-checking
  the intermediate value before recursing. The `lowerDestructuringDefault` helper
  works on a named local, so the temp local holding the intermediate value can be
  nil-checked and defaulted before the recursive call. This is a natural extension
  but should be tested explicitly.

**Complexity:** Low-medium. Primarily a structural refactor with recursion.

---

### Phase D2: Parameter-Position Destructuring

**Objective:** Support destructuring patterns in function parameter positions for
helper functions and closures/arrow functions.

**Examples:**

```typescript
function distance({ x, y }: Point): number {
  return Math.sqrt(x * x + y * y);
}

const getX = ({ x }: Point) => x;

function swap([a, b]: number[]): number[] {
  return [b, a];
}
```

**Prerequisites:** Phase D1 (nested destructuring) is complete. The shared
`lowerObjectBindingPattern`/`lowerArrayBindingPattern` helpers accept
`(pattern, srcLocal, ctx)` and are ready for direct reuse.

**D1 discoveries relevant to D2:**
- `lowerDestructuringDefault` works on any local index (named or temp), no
  modification needed.
- `types.instantiate("List", List.from([elementTypeId]))` is the API for list types
  (not `getOrCreateListType`).
- The core helpers can be called with the parameter slot index directly as `srcLocal`
  (no need for an intermediate temp unless default-value handling requires it).

**Packages/files touched:**

- `packages/ts-compiler/src/compiler/lowering.ts` -- extend `lowerHelperFunction`
  and `lowerClosureExpression` to handle binding patterns in parameter positions.

**Concrete deliverables:**

1. In `lowerHelperFunction`: when `p.name` is a binding pattern instead of an
   identifier, the parameter still occupies slot `i` (the VM calling convention
   places it there). After all parameter slots are assigned, emit destructuring IR
   at the top of the function body:
   - `LoadLocal(i)` to load the param value.
   - Store into a temp local via `allocLocal()`.
   - Call `lowerObjectBindingPattern` or `lowerArrayBindingPattern` with the temp
     local as the source.
   - Register the destructured names (e.g., `x`, `y`) in `paramLocals` so the
     function body can reference them.

2. In `lowerClosureExpression`: same approach. Additionally, update the capture
   analysis: `closureParamNames` currently collects identifier param names for
   exclusion from free-variable detection. For binding patterns, collect the
   destructured binding names instead (the leaf identifiers in the pattern).

3. `onExecute` parameter destructuring is out of scope. The `onExecute` params
   are extracted via the descriptor mechanism, not raw TS parameters. Supporting
   `async onExecute(ctx, { speed }: { speed: number })` would require descriptor
   extraction to recognize binding patterns. Defer this.

4. Add a diagnostic for destructuring in `onExecute` parameter position if
   someone attempts it (currently silently ignored).

**Helper for collecting binding names:**

A utility `collectBindingNames(pattern: ts.BindingPattern): string[]` that
recursively walks the pattern and returns all leaf identifier names. Needed for:
- Registering destructured params in `paramLocals`.
- Building `closureParamNames` for capture exclusion.

**Acceptance criteria:**

- Test: `function f({ x, y }: Point)` -> `x`, `y` accessible in body
- Test: `const fn = ({ x }: Point) => x` -> closure with destructured param
- Test: `function f([a, b]: number[])` -> array destructuring in params
- Test: closure with destructured param that also captures an outer variable
- Test: destructuring in `onExecute` param position -> diagnostic

**Key risks:**

- **Capture analysis correctness.** When a closure has `({ x, y }: Point) => x + z`
  where `z` is captured, the capture analysis must exclude `x` and `y` (they come
  from the parameter, not the outer scope) but include `z`. The `closureParamNames`
  set must contain `x` and `y`, not the original parameter name (which has no name
  since it is a binding pattern).
- **Parameter slot vs destructured locals.** The raw parameter at slot `i` is an
  unnamed struct/array. The destructured bindings (`x`, `y`) are new locals at
  higher slot indices. The function's `numParams` stays the same (it reflects the
  calling convention), but `numLocals` increases to account for the destructured
  bindings.

**Complexity:** Medium. Main work is the capture analysis update for closures.

---

### Phase D3: Rest Patterns

**Objective:** Support rest patterns (`...rest`) in both array and object
destructuring, in variable declarations and (if D2 is complete) parameter positions.

**Examples:**

```typescript
const [first, ...remaining] = items;
const { x, ...rest } = point3d;
```

#### D3a: Array Rest

**Packages/files touched:**

- `packages/ts-compiler/src/compiler/lowering.ts` -- extend array destructuring to
  handle `dotDotDotToken` on the last element.

**Concrete deliverables:**

1. When the last element in an `ArrayBindingPattern` has `dotDotDotToken`, emit
   a `.slice(restIndex)` inline expansion to capture the remaining elements:
   - `LoadLocal(srcLocal)` -- the source array.
   - Emit the same loop pattern used by `lowerListSlice`: `ListNew`, iterate from
     `restIndex` to `ListLen`, `ListGet` + `ListPush` each element.
   - `StoreLocal(restLocal)` -- the rest binding.

2. Validate that the rest element is the last element in the pattern (TypeScript
   enforces this, but a lowering-level guard is prudent).

3. If nested destructuring (D1) is complete, the rest element's name can be a
   binding pattern (e.g., `const [first, ...[a, b]] = arr`), though this is an
   unusual edge case.

**IR/emit changes:** None. Reuses `ListNew`, `ListLen`, `ListGet`, `ListPush`,
`LoadLocal`, `StoreLocal`, `Label`, `JumpIfFalse`, `HostCallArgs` (for `<` and
`+` operators on numbers).

**Acceptance criteria:**

- Test: `const [first, ...rest] = [1, 2, 3, 4]` -> `first === 1`,
  `rest === [2, 3, 4]`
- Test: `const [a, b, ...tail] = arr` -> `tail` contains remaining elements
- Test: `const [...all] = arr` -> `all` is a copy of `arr`
- Test: rest not in last position -> diagnostic or TS checker error

**Key risks:**

- **Operator resolution for loop.** The `.slice()` inline expansion requires
  resolving `<` and `+` operators for `Number`. These are always available in the
  core operator registry, but the lowering must call `resolveOperator` and handle
  failure (matching `lowerListSlice`'s pattern).
- **List type ID.** The `ListNew` IR node requires a `typeId`. For the rest
  variable, this should match the source array's element type. Use
  `tsTypeToTypeId()` on the rest binding's type to resolve this. If the type
  cannot be resolved, fall back to `AnyList`.
**Complexity:** Low. Direct reuse of the existing `.slice()` inline pattern.

#### D3b: Object Rest

**Packages/files touched:**

- `packages/ts-compiler/src/compiler/lowering.ts` -- extend object destructuring to
  handle `dotDotDotToken` on the last element.
- Possibly `packages/ts-compiler/src/compiler/ir.ts` and
  `packages/ts-compiler/src/compiler/emit.ts` if a new IR node is needed.
- Possibly `packages/core/src/brain/runtime/vm.ts` if a new opcode is needed.

**Analysis: three implementation options:**

**Option 1: Compile-time field enumeration (recommended for v1)**

Use `resolveStructType()` to get the `StructTypeDef.fields` list at compile time.
Compute the excluded field set from the explicitly destructured property names.
Emit `StructNew(typeId)` + for each remaining field: `LoadLocal(src)`,
`GetField(fieldName)`, `StructSet`. This produces a new struct with all
non-destructured fields.

Pros: No VM changes. No new opcodes. Uses existing IR nodes.
Cons: Only works when the struct type is statically known and all fields are
enumerable at compile time. Fails for native-backed structs with `fieldGetter`
(the compiler does not know the full field set). Fails for anonymous object types.

**Option 2: New VM opcode (`STRUCT_COPY_EXCEPT`)**

Add a new opcode that pops `N` string keys and a struct from the stack, pushes a
new struct containing all fields except the named keys.

Pros: Works for any struct at runtime, including native-backed structs.
Cons: Requires a core VM change (new opcode in `packages/core`), which means
a `packages/core` build cycle and Roblox-TS compatibility check.

**Option 3: Host function (`$$struct_rest`)**

Register a built-in host function `$$struct_rest(struct, ...excludedKeys)` that
returns a new struct with the excluded keys removed.

Pros: No new opcodes. Runtime-dynamic.
Cons: `HOST_CALL_ARGS` has a fixed arg count, so the excluded keys would need to
be passed as a list. Adds a runtime dependency on a special built-in function.

**Recommendation:** Start with Option 1 for v1. Emit a diagnostic when the struct
type cannot be statically resolved (e.g., anonymous types, native-backed structs
with `fieldGetter`). If broader support is needed later, add Option 2.

**Concrete deliverables (Option 1):**

1. When the last element in an `ObjectBindingPattern` has `dotDotDotToken`:
   - Collect the set of explicitly destructured property names.
   - Call `resolveStructType()` on the source expression's type.
   - If the struct type is resolved and is not native-backed: compute remaining
     fields = `structDef.fields.filter(f => !excludedSet.has(f.name))`.
   - Emit `StructNew(restTypeId)` for the rest variable's type.
   - For each remaining field: `LoadLocal(src)`, `GetField(fieldName)`,
     `StructSet`.
   - `StoreLocal(restLocal)`.
   - If the struct type cannot be resolved or is native-backed, emit a diagnostic.

2. The rest variable's type ID must be resolved. If TS gives a specific type for
   the rest (e.g., `Omit<T, "x">`), use `tsTypeToTypeId()`. Otherwise, construct
   a new anonymous struct type at compile time, or use the source struct's typeId
   as an approximation.

**Acceptance criteria:**

- Test: `const { x, ...rest } = { x: 1, y: 2, z: 3 }` -> `rest === { y: 2, z: 3 }`
- Test: `const { a, b, ...remainder } = obj` -> `remainder` has all other fields
- Test: object rest on an unresolvable type -> diagnostic

**Key risks:**

- **Type ID for the rest struct.** The rest object's type is an anonymous struct
  that does not exist in the type registry. Options: (a) register a new anonymous
  struct type at compile time with the remaining fields, (b) use the source
  struct's typeId (fields are a subset, so this is structurally compatible),
  (c) use a generic `struct:<anonymous>` typeId. Option (b) is simplest but
  slightly inaccurate. Option (a) is correct but adds type registry management
  complexity.
- **Native-backed structs.** `Context`, `SelfContext`, `EngineContext` have
  `fieldGetter` overrides. Their field list in `StructTypeDef.fields` may not
  enumerate all accessible fields. Object rest on these types should be rejected
  with a diagnostic for v1.
- **Anonymous/inline object types.** `const { x, ...rest } = { x: 1, y: 2 }`
  where the source is an inline object literal -- the TS type is an anonymous
  object type, not a registered struct. `resolveStructType()` returns `undefined`.
  Need to handle this case (either by inspecting the TS type's properties
  directly via `type.getProperties()`, or by emitting a diagnostic).

**Complexity:** Medium-high. The type resolution and struct construction for the
rest variable add significant complexity beyond the array case.

---

### Phase D4: Computed Property Names in Destructuring

**Objective:** Support computed property names in object destructuring patterns.

**Examples:**

```typescript
const key = "x";
const { [key]: value } = obj;

const { ["name"]: name } = obj;  // string literal -- already validator-allowed
```

**Packages/files touched:**

- `packages/ts-compiler/src/compiler/lowering.ts` -- handle `ComputedPropertyName`
  in object destructuring.
- `packages/ts-compiler/src/compiler/ir.ts` -- add `IrGetFieldDynamic` node (or
  extend the existing `IrGetField` pattern).
- `packages/ts-compiler/src/compiler/emit.ts` -- emit `GET_FIELD` with a
  dynamically-pushed field name.

**Analysis:**

The VM's `GET_FIELD` opcode already pops both field name and source from the stack
-- it is inherently dynamic. The constraint is at the IR/emit layer: `IrGetField`
embeds a static `fieldName: string`, and the emitter pushes it as a constant before
emitting the opcode. For computed keys, the field name is an arbitrary expression.

**Two approaches:**

**Approach A: `IrGetFieldDynamic` (recommended)**

Add a new IR node `IrGetFieldDynamic` with no embedded field name. The lowering
pushes the source (via `LoadLocal`), then evaluates the computed expression (which
pushes the key), then emits `IrGetFieldDynamic`. The emitter maps it to the same
`GET_FIELD` opcode but does not push a constant key -- it assumes both values are
already on the stack.

**Approach B: Dual-path in emit**

Keep `IrGetField` for the common static case. For computed keys, emit IR that
manually pushes the source and key expression, then emit a raw `GET_FIELD` via a
lower-level emit call. This avoids a new IR node but muddies the abstraction.

**Concrete deliverables:**

1. Add `IrGetFieldDynamic` to the IR node union:
   ```
   export interface IrGetFieldDynamic {
     kind: "GetFieldDynamic";
   }
   ```

2. In `lowerObjectDestructuring` (or `lowerObjectBindingPattern` after D1 refactor),
   when `element.propertyName` is a `ComputedPropertyName`:
   - Emit `LoadLocal(srcLocal)`.
   - Evaluate `element.propertyName.expression` via `lowerExpression`.
   - Emit `IrGetFieldDynamic`.
   - `StoreLocal(localIdx)`.

3. In `emitFunction`, handle `GetFieldDynamic`: emit `emitter.getField()` (the
   same opcode as `GET_FIELD`, but without the preceding constant push -- both
   values are already on the stack from the lowering).

4. Remove the `ComputedDestructuringKeyNotSupported` diagnostic.

5. The validator already allows computed property names with string/numeric literals.
   For full computed key support (arbitrary expressions), the validator's
   `ComputedPropertyName` check would need relaxing. For v1, if only literal
   computed keys are desired, the lowering can evaluate the literal expression
   at compile time and use the existing static `IrGetField`.

**Acceptance criteria:**

- Test: `const { ["x"]: val } = obj` -> `val` has correct value (literal key)
- Test: `const key = "x"; const { [key]: val } = obj` -> runtime key lookup
- Test: computed key with numeric literal `const { [0]: val } = obj`

**Key risks:**

- **Non-string computed keys.** The `GET_FIELD` opcode requires a string value as
  the field name. If the computed expression evaluates to a number, the VM throws
  `GET_FIELD: field name must be string`. The lowering may need to coerce numeric
  keys to strings, or the validator should restrict computed keys to string-typed
  expressions.
- **Interaction with object rest (D3b).** If both computed keys and rest patterns
  are used (`const { [key]: val, ...rest } = obj`), the compile-time field
  enumeration approach for rest cannot know which field was extracted by the
  computed key. This combination should be rejected for v1 if using the
  compile-time field enumeration strategy.

**Complexity:** Low-medium. The IR addition is minimal. The primary concern is
non-string key coercion.

---

## Implementation Order

Recommended sequence based on dependencies and complexity:

1. **Phase D1 (Nested destructuring)** -- prerequisite for the others; the refactor
   to extract `lowerObjectBindingPattern`/`lowerArrayBindingPattern` creates the
   shared helpers that D2 and D3 depend on.

2. **Phase D2 (Parameter-position destructuring)** -- uses the D1 helpers directly;
   the capture analysis update is self-contained.

3. **Phase D3a (Array rest)** -- straightforward reuse of the `.slice()` inline
   pattern. No new IR nodes or VM changes.

4. **Phase D4 (Computed property names)** -- small IR addition
   (`IrGetFieldDynamic`). Independent of the others but benefits from the D1
   refactor being in place.

5. **Phase D3b (Object rest)** -- most complex. Depends on D1 (nested patterns in
   rest position). Potentially deferred if the compile-time field enumeration
   limitation is acceptable for v1.

---

## Phase Log

Completed phases are recorded here with dates, actual outcomes, and deviations.

### D1: Nested Destructuring -- 2026-04-01

**Planned:** Refactor object/array destructuring into wrapper + core pattern; support
arbitrarily nested binding patterns via recursion; remove
`NestedDestructuringNotSupported` diagnostic.

**Actual:**

- Refactored exactly as specified: `lowerObjectDestructuring`/`lowerArrayDestructuring`
  are wrappers that eval the initializer into a temp local, then delegate to
  `lowerObjectBindingPattern`/`lowerArrayBindingPattern` which accept
  `(pattern, srcLocal, ctx)`.
- Nested binding patterns (`isObjectBindingPattern` / `isArrayBindingPattern`) handled
  by allocating a temp local, emitting GetField/ListGet into it, calling
  `lowerDestructuringDefault` on the temp, then recursing into the appropriate core
  function.
- `NestedDestructuringNotSupported` (3022) removed from `LoweringDiagCode` enum and
  all code paths. No depth limit added (deemed unnecessary given bounded practical
  nesting).
- 4 tests added; 1 rejection test removed. Net +3 tests (415 total).

**Deviations from plan:**

- The `const [[a, b], c] = nested` acceptance criterion was initially tested via
  struct fields because nested array literal type resolution (`number[][]`) was not
  supported at the time. This limitation was subsequently fixed (same day), so
  direct nested array literal tests are now viable.
- No dedicated test for default values at an inner nesting level. The mechanism works
  (`lowerDestructuringDefault` is called on temp locals), but a focused test was not
  written. Can be added later.
- No depth limit diagnostic added (the spec marked this as optional).

**Discoveries for future phases:**

- `types.instantiate("List", List.from([elementTypeId]))` is the correct API for
  creating parameterized list types. `getOrCreateListType` does not exist.
- `lowerDestructuringDefault` works on any local index (named or anonymous temp),
  so D2 can reuse it without modification for parameter-position destructuring.
- The wrapper + core pattern is clean; D2 can call the core functions directly with
  the parameter's slot index as `srcLocal`.

### D2: Parameter-Position Destructuring -- 2026-04-01

**Planned:** Support destructuring patterns in helper function and closure/arrow
function parameter positions; add `collectBindingNames` utility; add onExecute
destructuring diagnostic.

**Actual:**

- Added `collectBindingNames(pattern)` utility that recursively collects leaf
  identifier names from a binding pattern. Used in both `lowerClosureExpression`
  (for `closureParamNames` capture exclusion) and available for future use.
- `lowerHelperFunction`: after ctx creation, iterates parameters and calls
  `lowerObjectBindingPattern`/`lowerArrayBindingPattern` for binding pattern params,
  passing the parameter slot index `i` directly as `srcLocal`.
- `lowerClosureExpression`: same destructuring IR emission in the closure body.
  Capture analysis updated to add leaf binding names (via `collectBindingNames`)
  to `closureParamNames` so they are excluded from free-variable detection.
- `lowerOnExecuteBody`: emits `DestructuringInOnExecuteNotSupported` (3024) for
  any non-identifier parameter.
- 5 tests added. All 425 tests pass. Typecheck and lint clean.

**Deviations from plan:**

- The spec suggested allocating a temp local via `allocLocal()` and copying the
  param value before calling the core helpers. The implementation passes the
  parameter slot index directly as `srcLocal`, which is simpler and avoids an
  unnecessary temp allocation. This was a D1 discovery propagated into D2.
- No other deviations.

**Discoveries for future phases:**

- Passing parameter slot `i` directly to the core binding pattern helpers works
  without issues -- no temp local needed. D3 can reuse the same approach if rest
  patterns need parameter-position support.
- `collectBindingNames` is available for any future code that needs to enumerate
  the leaf names in a binding pattern (e.g., D3b object rest field exclusion).

### D3a: Array Rest -- 2026-04-01

**Planned:** Support `...rest` in array destructuring via inline slice loop;
validate rest-is-last; resolve list type for `ListNew`.

**Actual:**

- Added `lowerArrayRestElement(element, restIndex, srcLocal, ctx)` in lowering.ts.
  Emits `ListNew`, loop from `restIndex` to `ListLen` with `<` and `+` operators,
  `ListGet` + `ListPush` per iteration. Matches `lowerListSlice` pattern exactly.
- Rest-is-last guard in `lowerArrayBindingPattern` with new diag code
  `RestElementMustBeLast` (3025).
- List type resolved via `tsTypeToTypeId()` on the rest binding's type, fallback
  to source array type, then `"list:any"`.
- Nested binding on rest target supported (delegates to core helpers).
- 4 tests: `[first, ...rest]`, `[a, b, ...tail]`, `[...all]`, object rest still
  rejected. Replaced 1 old rejection test. All 428 tests pass.

**Deviations from plan:**

- Originally used `RestPatternsNotSupported` for the rest-not-last guard.
  Post-implementation, added dedicated `RestElementMustBeLast` (3025) to avoid
  conflating with the object rest rejection code.
- No dedicated "rest not in last position" test -- TypeScript enforces this at the
  parser level so it cannot be reached via `compileUserTile`. The guard is
  defense-in-depth.

**Discoveries for future phases:**

- `lowerArrayRestElement` can be called from parameter-position destructuring
  (D2 helpers) with no changes -- it just needs `srcLocal` and `restIndex`.
- The `resolveOperator` calls for `<` and `+` on Number never fail in practice
  (core operators are always registered), but the error paths are present.
- D3b (object rest) will need a different mechanism entirely (new opcode
  `STRUCT_COPY_EXCEPT` per user decision).

### D3b: Object Rest -- 2026-04-01

**Planned:** Support `const { x, ...rest } = obj` in object destructuring via a
new `STRUCT_COPY_EXCEPT` VM opcode (Option 2 from the spec). Deliver changes across
both `packages/core` (opcode, VM handler, emitter) and `packages/ts-compiler` (IR
node, emit handler, lowering logic).

**Actual:**

- **packages/core changes:**
  - Added `STRUCT_COPY_EXCEPT = 113` to `Op` enum in `vm.ts` (interfaces), after
    `STRUCT_SET = 112`.
  - Added `execStructCopyExcept(fiber, ins, frame)` VM handler: pops `ins.a`
    string keys into an exclude `Dict`, pops source struct, iterates
    `source.v.forEach()` to copy non-excluded fields into a new `Dict`, resolves
    typeId from constant pool at `ins.b`, pushes `V.struct(fields, typeId)`.
  - Added `structCopyExcept(numExclude, typeIdConstIdx)` method to
    `BytecodeEmitter`.
- **packages/ts-compiler changes:**
  - Added `IrStructCopyExcept { kind: "StructCopyExcept"; numExclude: number;
    typeId: string }` to the IR node union in `ir.ts`.
  - Added `case "StructCopyExcept"` emit handler in `emit.ts`: gets typeId
    constant pool index, calls `emitter.structCopyExcept(node.numExclude, typeIdIdx)`.
  - Replaced object rest rejection in `lowerObjectBindingPattern` with delegation
    to `lowerObjectRestElement`. Rest-not-last guard uses `RestElementMustBeLast`
    (3025).
  - Added `lowerObjectRestElement(element, pattern, srcLocal, ctx)`: collects
    excluded key names from non-rest siblings, resolves rest typeId via
    `tsTypeToTypeId` (fallback `"struct:<anonymous>"`), emits `LoadLocal(srcLocal)`,
    pushes each excluded key as `PushConst(mkStringValue(key))`, emits
    `StructCopyExcept`, stores into rest binding. Supports nested binding on
    the rest target (delegates to core helpers).
- 5 tests added, 1 rejection test replaced. 2 additional tests for property
  access on rest variables (434 total). Typecheck and lint clean across both
  packages.

**Deviations from plan:**

- The spec recommended Option 1 (compile-time field enumeration) for v1. The user
  chose Option 2 (new VM opcode) instead, providing broader runtime support
  including native-backed structs and anonymous types.
- The spec mentioned emitting a diagnostic when the struct type cannot be
  statically resolved. With Option 2, no such diagnostic is needed -- the opcode
  works on any struct at runtime.
- `RestPatternsNotSupported` (3021) is no longer emitted for object rest. It
  remains in the diag code enum but is unused for object destructuring. It may
  still be reachable via other future code paths or can be cleaned up later.
- Added a TS property fallback in `lowerPropertyAccess`: when `resolveStructType`
  returns `undefined`, the lowering now checks `type.getProperties()` from the
  TS checker. If the accessed property exists on the TS type, `GetField` is
  emitted directly. This fixes property access on rest variables whose type is
  `Omit<T, K>` (anonymous to the Mindcraft type registry).

**Discoveries:**

- Property access on the rest variable (e.g., `rest.y`) initially did not compile
  because `resolveStructType` cannot resolve the anonymous `Omit<...>` type that
  TS infers for rest bindings. Fixed by adding a fallback in `lowerPropertyAccess`
  that checks `type.getProperties()` from the TS checker when `resolveStructType`
  returns `undefined`. If the TS type has the property, `GetField` is emitted
  directly, trusting the TS checker's validation. 2 tests added (434 total).
- `tsTypeToTypeId` returns `undefined` for the `Omit<T, K>` utility type that TS
  assigns to rest bindings. The `"struct:<anonymous>"` fallback handles this
  gracefully at runtime.
- The opcode approach is clean: `ins.a` = number of exclude keys, `ins.b` =
  constant pool index for typeId. No variadic argument complexity.
- Registered a `Player` struct type (name: string, pos: Vector2, health: number)
  in tests to exercise 3-field rest scenarios.

### D4: Computed Property Names in Destructuring -- 2026-04-01

**Planned:** Support computed property names in object destructuring via a new
`IrGetFieldDynamic` IR node (Approach A from the spec). Remove the
`ComputedDestructuringKeyNotSupported` diagnostic. Support both string literal
and variable-expression computed keys.

**Actual:**

- Added `IrGetFieldDynamic { kind: "GetFieldDynamic" }` to the IR node union in
  `ir.ts`. No embedded field name -- both source and key are already on the stack.
- Added `case "GetFieldDynamic"` emit handler in `emit.ts`: calls
  `emitter.getField()` directly (same `GET_FIELD` opcode, no preceding constant
  push).
- In `lowerObjectBindingPattern`, replaced the `ComputedDestructuringKeyNotSupported`
  rejection with a computed-key handling path: when `element.propertyName` is a
  `ComputedPropertyName`, evaluates the expression via `lowerExpression`, emits
  `GetFieldDynamic`. Supports both identifier bindings and nested binding patterns
  on the computed-key target.
- Computed keys combined with rest patterns (e.g., `const { [key]: val, ...rest } = obj`)
  are fully supported. When `hasRest` is true, the computed key expression is
  evaluated into a temp local first. The temp is used for both the `GetFieldDynamic`
  field access and by `lowerObjectRestElement` (via `LoadLocal`) to push the exclude
  key onto the stack for `STRUCT_COPY_EXCEPT`.
- `lowerObjectRestElement` signature extended to accept a
  `computedKeyLocals: Map<ts.BindingElement, number>` parameter. For siblings with
  computed keys, it emits `LoadLocal(tempKeyLocal)` instead of
  `PushConst(mkStringValue(key))`.
- Removed `ComputedDestructuringKeyNotSupported` (3023) from the diag codes enum.
  Initially replaced with `ComputedKeyWithRestNotSupported` (3023) for the
  computed+rest rejection, then removed entirely when computed+rest was implemented.
- Relaxed the validator: `ComputedPropertyName` nodes whose parent is a
  `BindingElement` (destructuring) are now allowed regardless of whether the
  expression is a literal. Non-literal computed keys in object literals are still
  rejected.
- 3 tests added (437 total): string literal computed key `{ ["x"]: val }`,
  variable computed key `{ [key]: val }`, computed key + rest
  `{ ["x"]: val, ...rest }` with `val + rest.y` verification.
- No VM or `packages/core` changes needed. `GET_FIELD` was already dynamic at the
  opcode level.

**Deviations from plan:**

- The spec suggested potentially rejecting computed keys + rest for v1. Both were
  implemented in a single pass by storing the evaluated key in a temp local.
- The spec mentioned adding a `ComputedDestructuringKeyNotSupported` removal. In
  practice the code went 3023 -> `ComputedKeyWithRestNotSupported` -> removed
  entirely within the same implementation pass.
- The spec mentioned non-string computed keys as a risk (VM throws
  `GET_FIELD: field name must be string`). No coercion was added -- the TS checker
  constrains the key type, and runtime type mismatches throw at the VM level.

**Discoveries:**

- The validator's `ComputedPropertyName` check (`ts.SyntaxKind.ComputedPropertyName`)
  fires for all computed property names including those in destructuring binding
  elements. Scoping the relaxation to `ts.isBindingElement(node.parent)` keeps
  object literal computed keys restricted while allowing destructuring.
- Computed keys + rest naturally requires two uses of the key value: once for field
  access, once for rest exclusion. Evaluating the expression once into a temp local
  avoids double evaluation and handles expressions with side effects correctly.
