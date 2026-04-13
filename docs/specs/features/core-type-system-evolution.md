# Core Type System Evolution Plan

Companion to [typescript-compiler-phased-impl.md](typescript-compiler-phased-impl.md).
Phased implementation plan: [core-type-system-phased-impl.md](core-type-system-phased-impl.md).
Depends on the `@mindcraft-lang/core` type system defined in
`packages/core/src/brain/interfaces/type-system.ts` and implemented in
`packages/core/src/brain/runtime/type-system.ts`.

Written 2026-03-22. Captures the planned changes to the core type system that
will improve TypeScript integration and long-term expressiveness.

---

## Context

The core type system was designed for a visual tile-based brain language. Every type
is concrete, every container is homogeneous, and the full set of types is known at
brain-compile time. This design is sound for visual tiles but creates friction when
compiling TypeScript, which has structural typing, generics, unions, and inference.

Phase 12.1 (mixed-type lists via `NativeType.Any` + `AnyList`) is the first targeted
fix. This document captures the broader set of type system changes needed for full
TypeScript expressiveness, ordered by priority and dependency.

All changes in this document are planned to be implemented **after Phase 12.1** of
the TypeScript compiler phased implementation plan.

---

## Current Architecture (as of 2026-03-22)

### Type registry

- `ITypeRegistry` is the central interface
  (`packages/core/src/brain/interfaces/type-system.ts`).
- Types are registered by name via `add*Type(name, shape?)` methods. Each returns a
  `TypeId` (a string of the form `"nativeType:<name>"`, e.g., `"number:<number>"`).
- Registration methods: `addVoidType`, `addNilType`, `addBooleanType`, `addNumberType`,
  `addStringType`, `addEnumType`, `addListType`, `addMapType`, `addStructType`.
  Phase 12.1 adds `addAnyType`.
- `TypeDef` carries `coreType: NativeType`, `typeId: TypeId`, `codec: TypeCodec`,
  and `name: string`. Extended interfaces (`ListTypeDef`, `MapTypeDef`, `StructTypeDef`,
  `EnumTypeDef`) add shape-specific fields.
- `resolveByName(name)` returns a `TypeId` by name lookup.
- `entries()` exposes all registered types for iteration (used by ambient generation).

### NativeType enum

```
enum NativeType {
  Unknown = -1,  // sentinel for error/uninitialized states
  Void = 0,
  Nil = 1,
  Boolean = 2,
  Number = 3,
  String = 4,
  Enum = 5,
  List = 6,
  Map = 7,
  Struct = 8,
  // Any = 9  (added by Phase 12.1)
}
```

### Value type (runtime)

All VM values are represented as a discriminated union in
`packages/core/src/brain/interfaces/vm.ts`:

```
type Value =
  | UnknownValue      // { t: NativeType.Unknown }
  | VoidValue         // { t: NativeType.Void }
  | NilValue          // { t: NativeType.Nil }
  | BooleanValue      // { t: NativeType.Boolean; v: boolean }
  | NumberValue       // { t: NativeType.Number; v: number }
  | StringValue       // { t: NativeType.String; v: string }
  | EnumValue         // { t: NativeType.Enum; typeId: TypeId; v: string }
  | ListValue         // { t: NativeType.List; typeId: TypeId; v: List<Value> }
  | MapValue          // { t: NativeType.Map; typeId: TypeId; v: ValueDict }
  | StructValue       // { t: NativeType.Struct; typeId: TypeId; v?: Dict<string, Value>; native?: unknown }
  | { t: "handle"; id: HandleId }  // VM-internal
  | { t: "err"; e: ErrorValue };   // VM-internal
```

Containers (`ListValue`, `MapValue`, `StructValue`) carry a `typeId` for the container
type, but their contents are untyped `Value` slots. The VM performs **zero element-type
validation** on `LIST_PUSH`, `LIST_SET`, `MAP_SET`, `STRUCT_SET`, or `SET_FIELD`.

### Codec system

Every `TypeDef` has a `codec: TypeCodec` for serialization:

```
interface TypeCodec {
  encode(w: IWriteStream, value: unknown): void;
  decode(r: IReadStream): unknown;
  stringify(value: unknown): string;
}
```

Container codecs delegate to their element/value codec:

- `ListCodec` is constructed with a single `elementCodec` and writes/reads each element
  using that codec.
- `MapCodec` is constructed with a single `valueCodec`.
- `StructCodec` is constructed with per-field codecs.

This means the codec layer **enforces homogeneous typing** even though the VM does not.
Any heterogeneous container support requires a tagged/self-describing codec.

### Operator overloads

Operators are registered with exact type pairs:
`binary(op, lhsTypeId, rhsTypeId, resultTypeId, fn, isAsync)`.

The brain compiler's `InferredTypesVisitor` resolves operators by looking up overloads
for the inferred operand types, trying type conversions if no direct match exists. The
TypeScript compiler resolves operators similarly via `HostCallArgs` emission.

### Conversion registry

Type conversions are registered as `(fromType, toType, cost, fn)` tuples. The
registry supports pathfinding (`findBestPath`) for multi-step conversions via BFS.

### Brain compiler type inference

The brain compiler (`packages/core/src/brain/compiler/`) tracks types via a `typeEnv`
map (`nodeId -> TypeInfo`) where `TypeInfo = { inferred: TypeId, expected: TypeId,
overload?, conversion? }`. It performs a pre-pass (`InferredTypesVisitor`) to resolve
all expression types before code generation. The code generator (`RuleCompiler`) uses
the resolved types to emit conversion calls and operator host calls.

### Variable slots

`Fiber.locals`, `Fiber.callsiteVars`, and the value stack (`Fiber.vstack`) are all
`List<Value>` -- untyped bags. `STORE_LOCAL`, `LOAD_LOCAL`, `STORE_CALLSITE_VAR`,
`LOAD_CALLSITE_VAR` perform no type checking.

### Constants

`ConstantPool` stores `Value` instances. Constants carry their own `NativeType`
discriminant but no separate type metadata.

---

## Planned Changes

### Change 1: Nullable type support

**Priority:** First after Phase 12.1.

**Problem:** TypeScript's most common union is `T | null`. The core type system cannot
express "this value is a number or nil." `tsTypeToTypeId()` currently strips
`null`/`undefined` and returns the non-null member's `TypeId`. This loses information:

- A sensor returning `number | null` cannot declare that in its output type.
- A parameter typed `number | null` vs `number` should have different validation
  at the tile level.
- `null` values silently flow into number-typed operations, producing `NaN` or
  VM errors rather than type-check-time diagnostics.

**Design:**

Add a `nullable` boolean flag to `TypeDef`:

```
interface TypeDef {
  coreType: NativeType;
  typeId: TypeId;
  codec: TypeCodec;
  name: string;
  nullable?: boolean;  // NEW
}
```

When `nullable` is `true`, the codec wraps the underlying codec with a nil-check:
write a 1-byte "present" flag (0 = nil, 1 = value present), then the value codec if
present. This is the standard Option/Maybe serialization pattern.

A nullable `TypeId` can be derived from the base `TypeId` by convention, e.g.,
`"number:<number>?"` or by having a separate `NullableTypeDef` that references the
base `TypeId`. The convention approach is simpler and avoids a new `TypeDef` variant.

**Files touched:**

- `packages/core/src/brain/interfaces/type-system.ts` -- add `nullable?: boolean` to
  `TypeDef`; add `NullableCodec` wrapper class; consider adding
  `addNullableType(baseTypeId): TypeId` to `ITypeRegistry` for convenience
- `packages/core/src/brain/runtime/type-system.ts` -- implement `NullableCodec` and
  registration
- `packages/ts-compiler/src/compiler/lowering.ts` -- `tsTypeToTypeId()` returns nullable
  TypeId when the TS type is `T | null | undefined`
- `packages/ts-compiler/src/compiler/ambient.ts` -- emit `T | null` for nullable types

**Nuances:**

- The `NullableCodec` must handle the case where the value is `NIL_VALUE` (the
  canonical nil singleton) vs `undefined` (JavaScript's undefined). In the VM,
  `NIL_VALUE = { t: NativeType.Nil }`. The codec writes 0 for nil, 1 + delegate
  for non-nil.
- Operator overloads: `number? + number` should either auto-unwrap (risky) or
  require explicit null-checking. The Phase 6.5 nil operator overloads already
  handle `== null` and `!= null` comparisons. Arithmetic on nullable types should
  remain a type error -- TS enforcement handles this.
  - (2026-03-22) Phase 1 implementation discovered that equality operators
    (`=== null`, `!== null`) on nullable types produce `eq(number?, nil)` which
    has no direct overload. The TS compiler now falls back to unwrapping nullable
    TypeIds to their base types for operator resolution. This applies to all binary
    operators, compound assignments, and unary `!`.
- The brain compiler's `InferredTypesVisitor` does not currently reason about
  nullable types. It may need to treat nullable types as compatible with their base
  types for overload resolution, with an implicit "nil check" conversion.
- The Luau runtime must handle the `NullableCodec` correctly. Since it's a simple
  wrapper (1-byte flag + delegate), transpilation should be straightforward.
- **Relationship to union types (Change 3):** Nullable is a degenerate union
  (`T | Nil`). If full union types are implemented, nullable becomes a special case
  of unions. The implementation should be designed so that nullable types either
  become syntactic sugar over unions, or are a parallel concept that unions subsume.
  A `nullable` flag on `TypeDef` is simpler to implement first and can be deprecated
  in favor of unions later, or kept as an optimization (common case deserves fast path).

**Cross-platform impact:** Low. `NullableCodec` uses only `writeU8`/`readU8` plus
delegation, all of which exist in the Luau stream implementation.

---

### Change 2: Generic type constructors

**Priority:** Second. This is the highest-impact structural change.

**Problem:** Every concrete container type must be pre-registered by name.
`NumberList`, `StringList`, `Vector2List` are all separate registrations. If an app
defines 10 struct types, it needs 10 list types, 10 map types, and potentially list
and map combinations of each. This combinatorial explosion gets worse with nesting
(list of list of X, map of X to list of Y).

For TypeScript users, writing `const positions: Vector2[] = [...]` should work without
needing an explicit `Vector2List` type registration in the app. The compiler should be
able to synthesize the list type on demand.

**Design:**

Introduce a `TypeConstructor` concept to the registry:

```
interface TypeConstructor {
  name: string;           // e.g., "List", "Map"
  arity: number;          // number of type parameters (List=1, Map=1 for value-keyed)
  construct(args: TypeId[]): TypeDef;
}
```

(2026-03-22, Phase 2 implementation note) The actual interface adds a `coreType:
NativeType` field so that `instantiate()` can compute a deterministic TypeId via
`mkTypeId(ctor.coreType, ...)` before calling `construct()`. The `construct` method
also receives the registry as its first argument so it can look up argument type
codecs. The args use `List<TypeId>` (not `TypeId[]`) for Roblox compatibility.

The registry gains:

- `registerConstructor(ctor: TypeConstructor): void` -- registers `List`, `Map`, etc.
  as constructors
- `instantiate(constructorName: string, args: TypeId[]): TypeId` -- creates a concrete
  type from a constructor + type arguments, or returns the existing TypeId if already
  instantiated
- The existing `addListType`, `addMapType` remain as explicit registration methods
  for backward compatibility. Internally they use the constructor.

**Concrete example:**

```
// Before (current):
types.addListType("NumberList", { elementTypeId: CoreTypeIds.Number });
types.addListType("StringList", { elementTypeId: CoreTypeIds.String });
types.addListType("Vector2List", { elementTypeId: myTypeIds.Vector2 });

// After (with constructors):
// "List" and "Map" constructors registered in registerCoreTypes()
// Explicit registration still works:
types.addListType("NumberList", { elementTypeId: CoreTypeIds.Number });
// But the compiler can also auto-instantiate:
const vec2ListId = types.instantiate("List", [myTypeIds.Vector2]);
// Returns "list:<List<Vector2>>" or similar
// If called again with same args, returns the same TypeId (memoized)
```

**TypeId naming for instantiated types:**

Either:

- Convention-based: `"list:<List<struct:<Vector2>>>"` -- embeds the full type path
- Registry-generated: `"list:<__auto_0>"` with an internal counter -- opaque but unique

Convention-based is preferable for debugging and logging. The `mkTypeId` function
would need a variant for parameterized types.

**Codec construction for instantiated types:**

The constructor's `construct` method creates the `TypeDef` including the codec.
For `List`, the constructor:

1. Looks up the element type's codec
2. Creates a `ListCodec(elementCodec)`
3. Returns a complete `ListTypeDef`

This is exactly what `addListType` already does internally. The constructor merely
automates it.

**Ambient generation:**

When `buildAmbientDeclarations()` encounters an auto-instantiated list type, it can
either:

- Generate a named type alias: `type List_Vector2 = ReadonlyArray<Vector2>`
- Inline the type: use `ReadonlyArray<Vector2>` directly in parameter/return types

The inline approach is cleaner. Named aliases should only be generated for explicitly
registered types (backward compat with `NumberList`, etc.).

**Compiler lowering changes:**

`resolveListTypeId()` currently does:

1. Alias symbol lookup (for named types like `NumberList`)
2. Element type scan (iterate all registered list types, match by elementTypeId)

With constructors, step 2 becomes: 2. Resolve element TypeId via `tsTypeToTypeId` 3. Call `registry.instantiate("List", [elementTypeId])` to get-or-create the list type

This eliminates the scan and handles arbitrary element types.

**Files touched:**

- `packages/core/src/brain/interfaces/type-system.ts` -- add `TypeConstructor`
  interface; add `registerConstructor`, `instantiate` to `ITypeRegistry`
- `packages/core/src/brain/runtime/type-system.ts` -- implement constructor
  registration, memoized instantiation, List/Map constructors
- `packages/ts-compiler/src/compiler/lowering.ts` -- update `resolveListTypeId` to
  use `instantiate` instead of scanning
- `packages/ts-compiler/src/compiler/ambient.ts` -- handle auto-instantiated types
  in ambient generation

**Nuances:**

- **Memoization key:** The `instantiate` method must produce the same `TypeId` for
  the same constructor + arguments regardless of call order. Use a deterministic
  naming scheme (e.g., `"list:<List<number:<number>>>"`) and check the registry
  before creating.
- **Backward compatibility:** Existing explicit registrations (`NumberList`) must
  continue to work. The `instantiate` method should check if a type with the
  target `TypeId` already exists and return it. If both `NumberList` (explicit) and
  `List<number>` (instantiated) exist, they should be the same TypeId -- the explicit
  name is an alias for the instantiated type.
- **Name conflicts:** If an app registers `VectorList` explicitly with different
  fields than what `instantiate("List", [vectorTypeId])` would produce, the
  registry should detect the conflict. A simple rule: explicit registrations take
  precedence; `instantiate` checks for an existing type with matching shape first.
- **Registry iteration:** `entries()` will return auto-instantiated types alongside
  explicit ones. Consumers that iterate (ambient generation, brain compiler type
  inference) must handle both. Auto-instantiated types may not have user-friendly
  names, so ambient generation should prefer the constructor form
  (`ReadonlyArray<T>`) over a generated name.
- **Luau transpile:** The `TypeConstructor` interface and `instantiate` method must
  transpile to Luau. The memoization map (`Dict<string, TypeId>`) uses existing
  platform primitives.
- **Struct constructors:** Structs are not parameterized in the same way -- they have
  fixed field layouts. This feature is primarily for `List` and `Map`. A
  `Struct` constructor is not needed unless generic struct types are desired, which
  is unlikely.
- **Nested generics:** `List<List<number>>` should work: `instantiate("List",
[instantiate("List", [CoreTypeIds.Number])])`. The `ListCodec` for the outer list
  would use the `ListCodec` of the inner list as its element codec. This nesting
  is already supported by the codec architecture.
- **The `AnyList` from Phase 12.1 should remain as a named type** even after
  constructors are implemented. `instantiate("List", [CoreTypeIds.Any])` would
  return the same TypeId as `AnyList`. This preserves the simple name for
  ambients.

**Cross-platform impact:** Medium. New interfaces and implementation in core. The
Luau transpile must handle the new `TypeConstructor` type and the `instantiate`
method.

---

### Change 3: Union types

**Priority:** Third. Generalizes nullable support; enables full TypeScript
expressiveness.

**Problem:** The type system has no representation for "this value is X or Y."
Beyond nullable types, TypeScript uses unions pervasively:

- Function overloads: `function process(x: number | string): void`
- Discriminated unions: `type Shape = Circle | Square`
- Return type widening: `number | boolean`
- Enum-like string unions: `type Direction = "north" | "south" | "east" | "west"`
  (already handled by `EnumTypeDef` for Mindcraft enums, but not for arbitrary
  string unions)

Phase 12.1's `Any` type is a blunt instrument -- it collapses all union information.
`number | string` and `number | boolean | string` both resolve to `Any`, losing the
ability to type-check element access.

**Design:**

Add `UnionTypeDef` to the type system:

```
interface UnionTypeShape {
  memberTypeIds: TypeId[];  // ordered, deduplicated
}

type UnionTypeDef = TypeDef & UnionTypeShape;
```

A `UnionCodec` is a tagged codec (similar to `AnyCodec`) but restricted to the
union's members. Each value is serialized with a 1-byte discriminant indicating
which member type it is, followed by that member's codec.

**TypeId for unions:** Use a deterministic string derived from sorted member TypeIds,
e.g., `"union:<boolean,number>"`. This ensures the same union type always produces
the same TypeId regardless of the order members are specified.

**ITypeRegistry additions:**

```
addUnionType(name: string, shape: UnionTypeShape): TypeId;
```

Or, more naturally:

```
getOrCreateUnionType(memberTypeIds: TypeId[]): TypeId;
```

The second form is better because union types are structural (order-independent) and
auto-naming is preferred over manual naming.

**Operator overload resolution with unions:**

This is the most complex impact. When the operator system encounters
`unionType + number`, it must:

1. For each member type in the union, look up `memberType + number`
2. All members must have a valid overload (otherwise the operation is invalid)
3. The result type is the union of all result types (which may simplify if they're
   all the same)

Example: `(number | string) + number`

- `number + number -> number` (valid)
- `string + number -> string` (valid)
- Result: `number | string`

This is computationally manageable for small unions (2-4 members) but could be
expensive for larger ones. In practice, TypeScript unions used in Mindcraft code
will be small.

**Conversion registry with unions:**

Conversions from a union type should unwrap to conversions from each member.
`findBestPath(union<number, string>, boolean)` should try both
`findBestPath(number, boolean)` and `findBestPath(string, boolean)` and pick
the cheapest common path.

**Ambient generation:**

`typeDefToTs` for `UnionTypeDef` emits the TS union syntax:
`number | string | boolean`. The `MindcraftTypeMap` entry uses the union type.

**Compiler lowering:**

`tsTypeToTypeId()` currently returns `undefined` for multi-member unions (after
stripping null). With union types, it would:

1. Map each union member to its TypeId via recursive `tsTypeToTypeId`
2. Call `registry.getOrCreateUnionType(memberTypeIds)`
3. Return the union TypeId

**Relationship to nullable types (Change 1):**

Nullable types are the 2-member union `T | Nil`. If Change 1 is implemented first
as a `nullable` flag, then when unions are added:

- Nullable types can be migrated to union types (`getOrCreateUnionType([T, Nil])`)
- Or the `nullable` flag can be kept as an optimization shorthand
- The nullable codec (1-byte present flag + delegate) is more efficient than the
  general union codec (1-byte discriminant + delegate), so keeping it as a special
  case is defensible

**Relationship to Any type (Phase 12.1):**

With union types, `AnyList` could be replaced by `List<number | string | boolean | null>`.
However, `Any` remains useful as a top type -- a union of all types without
enumeration. Keep `Any` as a separate concept meaning "any value, type unknown at
compile time." Union types mean "one of these specific types."

**Files touched:**

- `packages/core/src/brain/interfaces/type-system.ts` -- add `UnionTypeShape`,
  `UnionTypeDef`; add `getOrCreateUnionType` to `ITypeRegistry`
- `packages/core/src/brain/runtime/type-system.ts` -- implement `UnionCodec`,
  `getOrCreateUnionType`
- `packages/core/src/brain/runtime/operators.ts` -- extend `resolve` to handle
  union-typed operands
- `packages/core/src/brain/runtime/conversions.ts` -- extend `findBestPath` for
  union sources
- `packages/core/src/brain/compiler/inferred-types.ts` -- extend type inference
  to handle union types in the brain compiler
- `packages/ts-compiler/src/compiler/lowering.ts` -- `tsTypeToTypeId` returns union
  TypeIds
- `packages/ts-compiler/src/compiler/ambient.ts` -- emit TS union syntax

**Nuances:**

- **Union flattening:** `union<number, union<string, boolean>>` should flatten to
  `union<boolean, number, string>`. The `getOrCreateUnionType` method must normalize
  by flattening nested unions and sorting member TypeIds lexicographically.
- **Single-member unions:** `union<number>` should collapse to `number`. The method
  should return the single member's TypeId directly.
- **Empty union:** `union<>` is `never` in TypeScript. Decide whether to support
  this (probably not needed -- reject as an error).
- **Union discriminant byte range:** With a 1-byte discriminant, the codec supports
  up to 256 member types. More than sufficient.
- **Brain compiler impact:** The brain compiler's `InferredTypesVisitor` tries
  operator overloads for specific types, then tries conversions to common types
  (`Number`, `Boolean`, `String`). Union types add a third resolution path: try
  each member type. Ensure the brain compiler is not made significantly slower by
  union resolution. A cache of resolved union operations would help.
- **Enum types vs string unions:** Mindcraft enums are registered via `addEnumType`
  with specific symbols. TypeScript string-union types that match a Mindcraft enum
  should still resolve to the `EnumTypeDef`, not to a union type. The compiler
  already handles this (Phase 12c). Union types are for cases where the union
  does NOT match a registered enum.
- **Luau transpile:** `UnionCodec` and `getOrCreateUnionType` must transpile. The
  codec uses existing stream operations. The dynamic creation in
  `getOrCreateUnionType` requires a memoization Dict, which is available in Luau.

**Cross-platform impact:** Medium-high. New types, codec, and changes to operator
resolution and conversion pathfinding.

---

### Change 4: First-class function types

**Priority:** Fourth. Enables callbacks, closures, and higher-order functions.

**Problem:** Functions in the VM exist only as `BrainFunctionEntry` records in the
`FunctionRegistry`, identified by numeric IDs. There is no `Value` variant for
"a function reference." The `CALL` opcode takes a compile-time-constant function ID
operand. This means:

- Cannot pass a function as an argument
- Cannot store a function in a variable
- Cannot return a function from a function
- Cannot use array methods like `.map()`, `.filter()`, `.forEach()` with callbacks

TypeScript code that uses callbacks or closures is extremely common. Without
first-class functions, a large class of idiomatic TS patterns is unusable.

**Design:**

**Phase A: Function references (no closures)**

Add a new `Value` variant:

```
type FunctionValue = { t: NativeType.Function; funcId: number };
```

Add `NativeType.Function = 10` (or next available value after `Any = 9`).\n(Updated 2026-03-22) Actual value is `NativeType.Function = 11` because\n`NativeType.Union = 10` was added in Phase 3.

Add a `CALL_INDIRECT` opcode:

- Pops a `FunctionValue` from the stack
- Pops `argc` arguments
- Calls the function by `funcId`
- Same semantics as `CALL` but with a runtime-determined function ID

The `V` factory gains `V.func(funcId)`.

The TypeScript compiler, when encountering a function reference (e.g., passing a
named helper function as argument), emits `PushConst(FunctionValue(funcId))` to put
the function reference on the stack. The caller emits `CALL_INDIRECT` to invoke it.

**Phase B: Closures (captured variables)**

Closures require captured-variable slots. A closure function reference must carry
not just the `funcId` but also the captured variable values:

```
type ClosureValue = {
  t: NativeType.Function;
  funcId: number;
  captures: List<Value>;
};
```

The VM would need `LOAD_CAPTURE` / `STORE_CAPTURE` opcodes alongside
`LOAD_LOCAL` / `STORE_LOCAL`. The closure's `captures` list is attached to the
fiber alongside locals when the closure is called.

Closure creation (`MAKE_CLOSURE`) copies the specified local variables from the
enclosing scope into a new `ClosureValue`.

(Amended 2026-03-22) Phase B implemented. Key deviations from the above sketch:
(1) No separate `ClosureValue` type -- `FunctionValue` extended with optional
`captures?: List<Value>`. (2) No `STORE_CAPTURE` -- capture-by-value semantics
means captures are immutable snapshots. Only `MAKE_CLOSURE` (170) and
`LOAD_CAPTURE` (171) opcodes added. (3) Capture analysis uses TS checker's
`getSymbolAtLocation` + `isDescendantOf` rather than manual free-variable
tracking. (4) Callsite variables (module-level) are accessed directly via
`LoadCallsiteVar` and do not need capturing.

**Phase C: Type-level function types**

Add `FunctionTypeShape` with parameter types and return type:

```
interface FunctionTypeShape {
  paramTypes: TypeId[];
  returnType: TypeId;
}
```

This enables type-checking of function arguments, return values, and callback
types at compile time.

> **Amendment (2025-06-26):** Implementation used `paramTypeIds: List<TypeId>`
> and `returnTypeId: TypeId` (naming consistent with `elementTypeId` in
> `ListTypeShape`). `tsTypeToTypeId` in `lowering.ts` needed an optional
> `checker?: ts.TypeChecker` parameter threaded from `LowerContext` to resolve
> call-signature parameter/return types. `ts.TypeFlags.Void` -> `CoreTypeIds.Void`
> mapping was also required for void-returning callbacks. Ambient generation
> (`typeDefToTs`) added Void -> `"void"`, Nil -> `"null"`, and Function arrow
> syntax cases.

**Files touched:**

Phase A:

- `packages/core/src/brain/interfaces/vm.ts` -- add `FunctionValue` to `Value` union;
  add `NativeType.Function`; add `CALL_INDIRECT` to `Op` enum
- `packages/core/src/brain/runtime/vm.ts` -- implement `execCallIndirect`; add
  `V.func()` factory
- `packages/core/src/brain/compiler/emitter.ts` -- add `callIndirect` method
- `packages/ts-compiler/src/compiler/ir.ts` -- add `IrCallIndirect`
- `packages/ts-compiler/src/compiler/lowering.ts` -- handle function references
- `packages/ts-compiler/src/compiler/emit.ts` -- emit `CALL_INDIRECT`

Phase B:

- Additional opcodes and closure capture machinery in VM and compiler

Phase C:

- `packages/core/src/brain/interfaces/type-system.ts` -- `FunctionTypeShape`
- Type-checking in the compiler

**Nuances:**

- **Phase A is useful without Phase B.** Named function references (passing a
  top-level helper function as an argument) do not require closures. This covers
  use cases like `array.forEach(myHelper)` where `myHelper` is a module-level
  function with no captured variables.
- **Closures (Phase B) are significantly more complex.** Closure creation requires
  determining which variables are captured (already done by the TS type checker
  for type analysis, but the compiler must extract this information). Mutable
  captured variables require additional complexity (shared mutable cells). Consider
  starting with read-only captures (capture-by-value at closure creation time).
- **Arrow functions in TS are extremely common.** `items.filter(x => x > 5)` is
  a closure over the threshold `5` (trivial) and the variable `items` (already on
  the parent stack). Full arrow function support depends on closures.
- **`FunctionCodec`:** Serializing function references is problematic. A `funcId` is
  only meaningful within a specific `Program`. Serializing it for networking or
  persistence requires a function name or stable identifier. For v1, `FunctionValue`
  should be non-serializable (codec throws on encode). Functions are execution-time
  values, not data.
- **Garbage collection concern:** If closures hold references to large data
  structures, they prevent garbage collection. Since the VM uses a value-based model
  (no reference counting or GC -- values are copied on assignment, containers are
  shared by reference), closures could hold references to shared container instances.
  This is the same semantics as storing a list in a variable -- not a new concern,
  but worth noting.
- **Luau transpile:** `CALL_INDIRECT` must work in the Luau VM. The Luau runtime
  already has function lookup by ID (`self.prog.functions:get(funcId)`), so indirect
  calls would use the same mechanism with a runtime-determined ID.
- **Impact on the brain compiler:** The visual tile language does not currently have
  a concept of "pass a function as an argument." This feature would be
  TypeScript-only initially. The brain compiler would not need to change unless
  first-class functions are later exposed as a tile concept.

**Cross-platform impact:** Medium. New opcode, new `Value` variant, new `NativeType`
member. Closures (Phase B) are high complexity.

---

### Change 5: Structural subtyping

**Priority:** Fifth. Improves TypeScript integration but is largely a compiler-level
concern.

**Problem:** TypeScript is structurally typed: `{ x: number, y: number }` is
assignable to any interface with those fields. The core type system is nominal: every
struct has a `TypeId` and only that exact `TypeId` matches. This means:

- Two user-creatable structs with identical field layouts are incompatible at the
  type level, even though they're interchangeable at runtime.
- An object literal `{ x: 1, y: 2 }` can only be assigned to the specific struct
  type determined by contextual type, not to any compatible struct.
- TypeScript's structural compatibility allows implicit widening (assigning
  `{ x: number, y: number, z: number }` to `{ x: number, y: number }`) which
  would work at the VM level (extra fields are just ignored by `GET_FIELD`) but is
  rejected by the nominal type system.

**Design:**

Add a structural compatibility check to `ITypeRegistry`:

```
isStructurallyCompatible(sourceTypeId: TypeId, targetTypeId: TypeId): boolean;
```

Two struct types are compatible if:

- Both are struct types
- The source has all fields the target has (may have extras)
- Each field's type is compatible (recursive check for nested structs)

This check is used by:

- The TypeScript compiler, to validate assignments and function calls
- The ambient generator, to decide whether to generate structural or nominal
  interfaces

**The VM does not need to change.** `GET_FIELD` already works on any `StructValue`
regardless of `typeId` -- it looks up the field name in the `Dict`. If a struct
has extra fields, they're harmlessly present. If it's missing a field, `GET_FIELD`
returns `NIL_VALUE`.

**Nuances:**

- **Intentional incompatibility:** Some struct types should NOT be structurally
  compatible even if their fields match. For example, two struct types representing
  different domain concepts (e.g., `ScreenCoord { x: number, y: number }` vs
  `WorldCoord { x: number, y: number }`) should not be interchangeable. The
  `__brand` pattern (used for native-backed structs) prevents this at the TS level.
  Consider adding an opt-in `nominal?: boolean` flag to `StructTypeShape` that
  produces a branded interface even for user-creatable structs.
- **Structural subtyping does not affect the codec.** The codec always uses the
  declared type's field layout. If a `ScreenCoord` is assigned to a `Vector2`
  variable, the serialized value uses the `Vector2` codec. This is fine as long
  as the fields are compatible.
- **Brain compiler impact:** The brain compiler resolves struct types by tile
  definition, which already provides exact `TypeId`s. Structural subtyping is
  a TypeScript-only concern.
- **Variable assignment semantics:** When a value with `typeId: "ScreenCoord"` is
  stored in a variable typed as `Vector2`, should the stored value's `typeId`
  change to `Vector2`? Probably not -- the `typeId` on a `StructValue` is
  informational and used for `GET_FIELD` dispatch (fieldGetter lookup). Changing
  it could break native-backed struct access. Variables should allow structural
  compatibility at the type-check level but preserve the original `typeId` at
  runtime.

**Cross-platform impact:** Low. This is primarily a compiler/type-check concern.
No VM changes needed.

---

## Additional Considerations

### `typeof` operator lowering

After Phase 12.1 introduces `AnyList`, users will retrieve elements of type
`number | string | boolean | null`. They need a way to narrow:

```ts
const item = arr[0];
if (typeof item === "number") {
  // item is narrowed to number
}
```

The TypeScript checker already narrows types through `typeof` checks. The compiler
must:

1. Lower `typeof x` to a runtime operation that inspects the `Value.t` discriminant
2. Compare the result to the string `"number"`, `"string"`, `"boolean"`, `"object"`,
   `"undefined"` (for nil)
3. Emit the appropriate jump based on the comparison

Options for implementation:

- A `TYPEOF` opcode that pushes a string ("number", "string", etc.) based on the
  top-of-stack value's `NativeType`
- Inline the check: `DUP`, `HOST_CALL_ARGS(typeof, 1)`, `PUSH_CONST("number")`,
  `HOST_CALL_ARGS(equal, 2)`, `JUMP_IF_FALSE(...)` -- using a registered `typeof`
  host function
- Direct discriminant check via a new `TYPE_CHECK` opcode with NativeType operand,
  pushing a boolean

The `TYPE_CHECK` opcode approach is most efficient (single instruction, no string
allocation). Define `TYPE_CHECK(nativeType)` that pops a value, checks
`value.t === nativeType`, pushes `true`/`false`.

This should be planned as a follow-up phase in the TypeScript compiler phased
implementation plan after Phase 12.1.

### `deepCopyValue` for lists and maps

The current `deepCopyValue` only deep-copies `StructValue` instances. All other
value types -- including `ListValue` and `MapValue` -- are returned by reference.

This means:

```ts
const a = [1, 2, 3];
const b = a;
b.push(4); // a is also [1, 2, 3, 4]
```

This is actually correct JavaScript/TypeScript reference semantics. Arrays and
objects are reference types in JS. The current behavior is aligned with TS
expectations, so no change is needed. However, this is worth documenting because it
differs from the brain language's value-copy-on-assignment semantics for variables
(brain variables deep-copy on assignment to prevent aliasing).

If list/map deep-copy is desired for the brain language's assignment semantics, it
would need to be implemented in `deepCopyValue` by recursively copying list elements
and map entries. This would be a brain-language concern, not a TypeScript concern.

### Impact on Luau / Roblox runtime

All changes in this document affect `packages/core`, which is transpiled to Luau
via `roblox-ts` for the Roblox target. Key constraints:

- **No `globalThis` in shared code.** (Already a project rule.)
- **No `typeof` operator in production Luau code.** Luau has `type()` instead.
  The `TYPE_CHECK` opcode approach avoids this problem since it's implemented in
  the VM, not in user code.
- **Platform primitives only.** Use `List`, `Dict`, `Error` from
  `packages/core/src/platform/`, not native `Array`, `Map`, or global `Error`.
- **Verify `npm run build:rbx` succeeds** after any core type system change.

### Impact on brain compiler

The brain compiler (`packages/core/src/brain/compiler/`) has its own type inference
pass (`InferredTypesVisitor`). Changes to the type registry affect it:

- **Nullable types:** The inference pass may need to unwrap nullable types when
  resolving operator overloads. Currently it tries direct overloads, then
  conversions to common types. Nullable unwrapping would be a third resolution step.
- **Union types:** Similar to nullable but more general. The inference pass must try
  overloads for each union member.
- **Generic constructors:** The inference pass does not need generic types because
  brain tiles have explicit, concrete types. Auto-instantiation is a compiler concern.
- **First-class functions:** Not applicable to brain tiles unless the visual language
  adds function-reference tiles.

### Testing strategy

Each change should include:

- **Unit tests** in `packages/core` for the type registry, codec, and any VM changes
- **Integration tests** in `packages/ts-compiler` for end-to-end compilation and
  execution (source string -> compile -> link -> VM -> correct result)
- **Luau build verification** (`npm run build:rbx` in `packages/core`)
- **Biome check** (`npm run check` in both packages)

---

## Implementation Order Summary

| Order | Change                                    | Depends on             | Estimated scope                                  |
| ----- | ----------------------------------------- | ---------------------- | ------------------------------------------------ |
| 0     | Phase 12.1: `Any` type + `AnyList`        | None                   | Small (core + typescript)                        |
| 1     | Nullable type support                     | Phase 12.1             | Small-medium (core + typescript)                 |
| 2     | Generic type constructors                 | None (independent)     | Medium (core + typescript)                       |
| 3     | Union types                               | Nullable (subsumes it) | Medium-high (core + brain compiler + typescript) |
| 4     | First-class functions (Phase A: refs)     | None                   | Medium (core + typescript)                       |
| 4b    | First-class functions (Phase B: closures) | Phase A                | High (core + typescript)                         |
| 5     | Structural subtyping                      | None                   | Low-medium (typescript only)                     |
| --    | `typeof` lowering                         | Phase 12.1             | Small (typescript only)                          |

Changes 1-3 form a dependency chain: nullable is a special case of union, and
generic constructors interact with union types (e.g., `List<number | string>`
needs both features). However, each can be implemented incrementally -- nullable
works standalone, generics work standalone, unions generalize both.

Change 4 (function types) is fully independent and can be implemented at any point.

Change 5 (structural subtyping) is a compiler-only concern and can be implemented
whenever it becomes a user pain point.
