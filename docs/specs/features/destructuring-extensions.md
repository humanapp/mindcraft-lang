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

(As of 2026-04-01)

### What works

- Object destructuring: `const { x, y } = pos` via `GetField`.
- Array destructuring: `const [a, b] = arr` via `ListGet`.
- Property rename: `const { x: posX } = pos`.
- Omitted array elements: `const [, b] = arr`.
- Default values: `const { x = 5 } = obj` with `TypeCheck(NativeType.Nil)` nil-check.
- Source evaluated once into a temp local via `allocLocal()`.

### What is rejected

| Pattern | Diagnostic code | Location |
|---|---|---|
| Nested destructuring | `NestedDestructuringNotSupported` (3022) | `lowerObjectDestructuring`, `lowerArrayDestructuring` |
| Rest patterns (`...rest`) | `RestPatternsNotSupported` (3021) | Both functions |
| Computed property names | `ComputedDestructuringKeyNotSupported` (3023) | `lowerObjectDestructuring` |
| Parameter-position destructuring | Silent skip (no diagnostic) | `lowerHelperFunction`, `lowerClosureExpression` |

### Key existing infrastructure

- `IrGetField { fieldName: string }` -- static field name, emitter pushes string
  constant then emits `GET_FIELD`. The VM's `execGetField` pops fieldName + source
  from stack (already dynamic at the opcode level).
- `IrListGet` -- pops index + list from stack, pushes element.
- `lowerListSlice` -- inline expansion of `.slice(start, end?)` using a loop with
  `ListNew`/`ListGet`/`ListPush`. Reusable for array rest patterns.
- `allocLocal()` on `ScopeStack` -- anonymous temp locals.
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

- `packages/typescript/src/compiler/lowering.ts` -- refactor
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

**Prerequisites:** Phase D1 (nested destructuring) should be complete so the shared
`lowerObjectBindingPattern`/`lowerArrayBindingPattern` helpers are available.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- extend `lowerHelperFunction`
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

- `packages/typescript/src/compiler/lowering.ts` -- extend array destructuring to
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

- `packages/typescript/src/compiler/lowering.ts` -- extend object destructuring to
  handle `dotDotDotToken` on the last element.
- Possibly `packages/typescript/src/compiler/ir.ts` and
  `packages/typescript/src/compiler/emit.ts` if a new IR node is needed.
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

- `packages/typescript/src/compiler/lowering.ts` -- handle `ComputedPropertyName`
  in object destructuring.
- `packages/typescript/src/compiler/ir.ts` -- add `IrGetFieldDynamic` node (or
  extend the existing `IrGetField` pattern).
- `packages/typescript/src/compiler/emit.ts` -- emit `GET_FIELD` with a
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

(No phases completed yet.)
