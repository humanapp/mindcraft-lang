# Core Type System -- Phased Implementation Plan

Companion to [core-type-system-evolution.md](core-type-system-evolution.md).
See also [typescript-compiler-phased-impl.md](typescript-compiler-phased-impl.md) --
Phase 12.1 (mixed-type lists via `Any` + `AnyList`) is the prerequisite for this work.
Focused on `packages/core` type system infrastructure, with compiler integration in
`packages/typescript` and `packages/core/src/brain/compiler/` as needed.

---

## Backward Compatibility

Backward compatibility is not a concern for this work. These changes will likely break
serialization (e.g., codec formats, type IDs, brain save data), and that is acceptable.
Do not let backward compatibility considerations constrain design decisions.

---

## Sim App Compatibility

The `apps/sim` webapp must be updated as needed in every phase. At the end of each
phase, the sim app must be fully functional -- it must build and run without errors.
Do not leave the sim app in a broken state at phase boundaries.

---

## Workflow Convention

Each phase follows this loop:

1. **Kick off** -- "Implement Phase N." The implementer reads this doc, the evolution
   design doc, and any relevant instruction files before writing code. After
   implementation, STOP and present the work for review. Do not write the Phase Log
   entry, amend the design doc, update the Current State section, or perform any
   post-mortem activity.
2. **Review + refine** -- Followup prompts within the same conversation.
3. **Declare done** -- "Phase N is complete." Only the user can declare the phase
   complete. Do not move to the post-mortem step until the user requests it.
4. **Post-mortem** -- "Run post-mortem for Phase N." This step:
   - Diffs planned deliverables vs what was actually built.
   - Records the outcome in the Phase Log (bottom of this doc). The Phase Log is
     a post-mortem artifact -- never write it during implementation.
   - Amends `core-type-system-evolution.md` with dated notes if the design was
     wrong or underspecified.
   - Propagates discoveries to upcoming phases in this doc (updated risks,
     changed deliverables, new prerequisites).
   - Writes a repo memory note with key decisions for future conversations.
5. **Next phase** -- New conversation (or same if context is not exhausted).

The planning doc is the source of truth across conversations. Session memory does
not survive. Keep this doc current.

---

## Current State

- (Written 2026-03-22) Phase 1 (nullable type support) is complete.
- (Written 2026-03-22) Phase 2 (generic type constructors) is complete.
- (Written 2026-03-22) Phase 3 (union types) is complete.
- (Written 2026-03-22) Phase 4 (`typeof` lowering) is complete.
- `TypeDef` now has optional `nullable?: boolean` and `autoInstantiated?: boolean`
  fields. `NullableTypeShape`/`NullableTypeDef` and `TypeConstructor` interfaces
  exist.
- `ITypeRegistry` exposes `addNullableType(baseTypeId)`,
  `registerConstructor(ctor)`, `instantiate(name, args)`, and
  `getOrCreateUnionType(memberTypeIds)`. `ListConstructor` and `MapConstructor`
  are registered in `registerCoreTypes()`.
- `NativeType.Union = 10` added. `UnionTypeShape`/`UnionTypeDef` interfaces and
  `UnionCodec` (tagged discriminant encode/decode) exist in the runtime.
- `getOrCreateUnionType()` normalizes unions: flatten nested, expand nullable to
  `[base, Nil]`, dedup, sort, collapse single-member, delegate `[T, Nil]` to
  `addNullableType`.
- The TS compiler resolves `T | null` / `T | undefined` to nullable TypeIds and
  multi-member unions to union TypeIds (falls back to `Any` only when a member
  is unresolvable).
- `expandTypeIdMembers()` replaces `unwrapNullableTypeId()` in `lowering.ts`.
  `resolveOperatorWithExpansion()` does cross-product operator lookup for union
  operands at all three operator lowering sites.
- The TS compiler uses `registry.instantiate("List", [elementTypeId])` in
  `resolveListTypeId()` instead of scanning all registered list types.
- `tsTypeToTypeId()` resolves named types (structs, enums) via symbol name
  lookup on the registry, not just primitives.
- `lowerPropertyAccess()` supports `.length` on list-typed expressions via
  `IrListLen` -> `Op.LIST_LEN`.
- Ambient generation (`buildAmbientDeclarations`) skips types with
  `autoInstantiated: true`. Union types emit `member1 | member2 | ...` syntax.
- Nullable TypeId convention: `"<coreType>:<name?>"` (e.g., `"number:<number?>"`).
- Auto-instantiated TypeId convention:
  `"<coreType>:<Constructor<arg1,arg2>>"` (e.g., `"list:<List<number:<number>>>"`).
- Union TypeId convention:
  `"union:<member1,member2,...>"` (e.g., `"union:<boolean:<boolean>,number:<number>>"`).
- Operator overloads and conversions still use exact `TypeId` matching in the core
  registry. The TS compiler's lowering pass handles nullable unwrapping and union
  expansion as fallbacks when exact match fails.
- `Op.TYPE_CHECK = 150` added. `IrTypeCheck` IR node and `lowerTypeofComparison()`
  lower `typeof x === "string"` patterns to a single `TYPE_CHECK` opcode.
  Supported typeof strings: `"number"`, `"string"`, `"boolean"`, `"undefined"`.
  `"object"` is rejected with a compile diagnostic.
- (Written 2026-03-22) Phase 5 (first-class function references) is complete.
  `NativeType.Function = 11`, `FunctionValue` in `Value` union,
  `Op.CALL_INDIRECT = 160`, `FunctionCodec` (non-serializable),
  `IrPushFunctionRef`/`IrCallIndirect` IR nodes, compiler + linker support.
  `typeof x === "function"` now compiles to `TYPE_CHECK(NativeType.Function)`.
- (Written 2026-03-22) Phase 6 (closures) is complete.
  `Op.MAKE_CLOSURE = 170`, `Op.LOAD_CAPTURE = 171` (no `STORE_CAPTURE` --
  capture-by-value). `FunctionValue` extended with optional `captures`.
  `Frame` extended with optional `captures`. Capture analysis via TS checker
  symbol resolution + `isDescendantOf`. Arrow functions and function expressions
  compile as separate closure function entries. Linker remaps `MAKE_CLOSURE` funcId.

---

## Phases

### Phase 1: Nullable type support

**Prerequisite:** Phase 12.1 (TypeScript compiler phased impl) must be complete so
that `NativeType.Any` and `AnyCodec` exist as reference patterns for tagged codecs.

**Objective:** Add the ability to register nullable variants of existing types. A
nullable type wraps a base type with nil-awareness: the codec can serialize/deserialize
either the base value or nil, and the `TypeDef` carries metadata indicating nullability.
The TypeScript compiler should emit nullable `TypeId`s when a TS type is `T | null` or
`T | undefined`, and ambient generation should produce `T | null` for nullable types.

**Packages/files touched:**

- `packages/core/src/brain/interfaces/type-system.ts`
  - Add `nullable?: boolean` field to `TypeDef`.
  - Add `addNullableType(baseTypeId: TypeId): TypeId` to `ITypeRegistry`. This derives
    a new type from an existing base type, wrapping its codec and marking
    `nullable: true`.
  - Add `NullableCodec` class implementing `TypeCodec`. This is a wrapper codec that
    writes a 1-byte "present" flag (`0` = nil, `1` = value follows) before delegating
    to the base type's codec.
- `packages/core/src/brain/interfaces/core-types.ts`
  - Decide on a TypeId naming convention for nullable types. Two options:
    (a) Use `mkTypeId` with the base type's `NativeType` and a `"?"` suffix on the
    name: `"number:<number?>"`. (b) Introduce a `mkNullableTypeId` helper. Option (a)
    is simpler.
- `packages/core/src/brain/runtime/type-system.ts`
  - Implement `NullableCodec`: `encode(w, value)` writes `U8(0)` for nil, `U8(1)` +
    delegate for non-nil. `decode(r)` reads the flag, returns `NIL_VALUE` or delegates.
    `stringify(value)` returns `"nil"` or delegates.
  - Implement `TypeRegistry.addNullableType(baseTypeId)`:
    1. `get(baseTypeId)` to retrieve the base `TypeDef` (throw if not found).
    2. Compute nullable `TypeId` (e.g., `"number:<number?>"`).
    3. If already registered, return existing `TypeId` (idempotent).
    4. Create a new `TypeDef` with `coreType` matching the base type's `coreType`,
       `codec: new NullableCodec(baseDef.codec)`, `nullable: true`, and the derived
       `TypeId`.
    5. Register and return.
  - Do not register any nullable types in `registerCoreTypes()` -- nullable types are
    created on demand by the compiler or app code.
- `packages/typescript/src/compiler/lowering.ts`
  - Update `tsTypeToTypeId()`: currently strips `null`/`undefined` members and returns
    the non-null TypeId. Change to: if the TS type is `T | null` or `T | undefined`
    (exactly one non-null member), call `registry.addNullableType(baseTypeId)` and
    return the nullable `TypeId`. If the result is a multi-member non-null union, the
    existing `Any` fallback from Phase 12.1 applies.
  - Update `resolveListTypeId()`: if element type resolves to a nullable TypeId, look
    for a list type with that nullable element TypeId. If none exists, fall back to
    the generic constructor approach (Phase 2) or register on demand.
- `packages/typescript/src/compiler/ambient.ts`
  - Update `typeDefToTs()`: if `typeDef.nullable` is `true`, emit `BaseType | null`
    instead of just `BaseType`.
  - Update `MindcraftTypeMap` generation accordingly.
- Test files:
  - `packages/core/src/brain/runtime/type-system.spec.ts` (new or extend
    `vm.spec.ts`) -- test `NullableCodec` round-trip, test `addNullableType`
    registration, test idempotent re-registration.
  - `packages/typescript/src/compiler/codegen.spec.ts` -- test that `T | null`
    parameter types compile correctly, test ambient generation includes `| null`.

**Concrete deliverables:**

1. `NullableCodec` class implementing `TypeCodec` with present-flag encoding.
2. `ITypeRegistry.addNullableType(baseTypeId): TypeId` registers a nullable variant
   with `nullable: true` on the `TypeDef`.
3. `TypeDef.nullable` field exists (optional boolean).
4. `tsTypeToTypeId()` returns a nullable `TypeId` for `T | null` / `T | undefined`
   union types.
5. `buildAmbientDeclarations()` emits `T | null` for nullable types.
6. End-to-end: a sensor with a `number | null` parameter compiles, and the parameter's
   `TypeId` is the nullable number type.

**Acceptance criteria:**

- Test: `NullableCodec` round-trips a non-nil value (writes `1` + value bytes, reads
  back identically).
- Test: `NullableCodec` round-trips a nil value (writes `0`, reads back `NIL_VALUE`).
- Test: `NullableCodec.stringify` returns `"nil"` for nil, delegates for non-nil.
- Test: `addNullableType(CoreTypeIds.Number)` returns a TypeId like
  `"number:<number?>"` with `nullable: true` on the def.
- Test: calling `addNullableType` twice with the same base returns the same TypeId
  (idempotent).
- Test: `addNullableType` throws if the base TypeId is not registered.
- Test: `tsTypeToTypeId` returns nullable TypeId for `number | null` union.
- Test: `tsTypeToTypeId` returns nullable TypeId for `string | undefined` union.
- Test: `tsTypeToTypeId` returns `CoreTypeIds.Any` (not nullable) for
  `number | string | null` (multi-member non-null union).
- Test: ambient output includes `| null` for nullable types.
- `npm run check` passes in `packages/core` and `packages/typescript`.
- `npm run build:rbx` passes (Luau transpile compatibility).

**Key risks:**

- **TypeId naming collision.** If an app already registered a type named `"number?"`,
  the nullable TypeId `"number:<number?>"` could collide. Unlikely but the
  `validateTypeNotRegistered` check will catch it. Decide whether the `?` suffix is
  the right convention or whether a different separator is needed (e.g., `"number:<number|nullable>"`).
- **Nullable of nullable.** `addNullableType` applied to an already-nullable type
  should be a no-op (return the input TypeId). The implementation must check the
  base def's `nullable` flag and short-circuit.
- **Interaction with operator overloads.** A nullable number (`number?`) used in
  `x + 1` should be a type error from the TS checker (cannot add null to number).
  The core operator overload system should NOT try to resolve `number? + number` --
  the TS compiler rejects this before it reaches overload resolution. No changes
  needed in `packages/core/src/brain/runtime/operators.ts` for this phase.
- **Brain compiler interaction.** The brain compiler's `InferredTypesVisitor` does
  not reason about nullable types. For this phase, nullable types are a
  TypeScript-compiler-only concern. If brain tiles later need nullable support,
  the inference pass will need updates -- but that is out of scope here.
- **Luau `NullableCodec` transpile.** The codec uses `writeU8`/`readU8` plus
  delegation -- all available in the Luau stream implementation. Verify the Luau
  build succeeds.

---

### Phase 2: Generic type constructors

**Prerequisite:** None (independent of Phase 1). Can be implemented in parallel or
in any order relative to Phase 1.

**Objective:** Eliminate the requirement that every concrete container type be
pre-registered by name. Introduce a `TypeConstructor` concept that allows the
registry to create concrete types on demand from a constructor name and type
arguments. The primary constructors are `List` and `Map`. The TypeScript compiler
should use `instantiate("List", [elementTypeId])` instead of scanning all registered
list types by element type.

**Packages/files touched:**

- `packages/core/src/brain/interfaces/type-system.ts`
  - Add `TypeConstructor` interface:
    ```
    interface TypeConstructor {
      name: string;
      arity: number;
      construct(registry: ITypeRegistry, args: TypeId[]): TypeDef;
    }
    ```
    The `construct` method receives the registry so it can look up argument types
    and their codecs.
  - Add to `ITypeRegistry`:
    ```
    registerConstructor(ctor: TypeConstructor): void;
    instantiate(constructorName: string, args: TypeId[]): TypeId;
    ```
    `instantiate` is memoized: same constructor + same args always returns the
    same `TypeId`.
- `packages/core/src/brain/runtime/type-system.ts`
  - Add `ListConstructor` class implementing `TypeConstructor`:
    - `name: "List"`, `arity: 1`.
    - `construct(registry, [elementTypeId])`: looks up the element def, creates a
      `ListTypeDef` with `ListCodec(elementDef.codec)`, generates a deterministic
      TypeId (see naming below).
  - Add `MapConstructor` class implementing `TypeConstructor`:
    - `name: "Map"`, `arity: 1` (string-keyed maps, single value type parameter).
    - `construct(registry, [valueTypeId])`: looks up the value def, creates a
      `MapTypeDef` with `MapCodec(valueDef.codec)`.
  - Implement `TypeRegistry.registerConstructor(ctor)`:
    - Store in a `Dict<string, TypeConstructor>` by name.
    - Throw if a constructor with the same name is already registered.
  - Implement `TypeRegistry.instantiate(constructorName, args)`:
    1. Look up the constructor by name (throw if not found).
    2. Validate `args.length === ctor.arity`.
    3. Compute a memoization key: deterministic TypeId derived from constructor name
       - arg TypeIds, e.g., `"list:<List<number:<number>>>"`.
    4. If already registered (check `defs.has(key)`), return existing TypeId.
    5. Otherwise: call `ctor.construct(this, args)`, override the generated def's
       `typeId` with the computed key, register it, return.
  - Register `ListConstructor` and `MapConstructor` in `registerCoreTypes()`.
  - **Backward compatibility:** Existing `addListType("NumberList", { elementTypeId })`
    continues to work independently. However, if an app calls both
    `addListType("NumberList", { elementTypeId: CoreTypeIds.Number })` and later
    `instantiate("List", [CoreTypeIds.Number])`, the system must not create a
    duplicate. Strategy: `instantiate` checks if a type with the computed TypeId
    already exists. If so, return it. `addListType` registers with a separate TypeId
    (e.g., `"list:<NumberList>"`). These are distinct TypeIds but the same shape.
    The TypeScript compiler should prefer `instantiate` for new code; existing
    explicit registrations remain valid.
- `packages/typescript/src/compiler/lowering.ts`
  - Update `resolveListTypeId()`:
    1. Try alias-symbol lookup (unchanged -- named types like `NumberList`).
    2. If no alias, resolve element TypeId via `tsTypeToTypeId(elementType)`.
    3. Call `registry.instantiate("List", [elementTypeId])` instead of scanning
       all registered list types.
    4. Return the TypeId from `instantiate`.
       This eliminates the O(N) scan of all registered list types and handles
       arbitrary element types (including nullable types from Phase 1 if implemented,
       and `CoreTypeIds.Any` from Phase 12.1).
  - If map literal support exists (Phase 12b), update map type resolution similarly
    to use `registry.instantiate("Map", [valueTypeId])`.
- `packages/typescript/src/compiler/ambient.ts`
  - Update `typeDefToTs()` for auto-instantiated list/map types:
    - If the list type was instantiated (not explicitly named), emit
      `ReadonlyArray<ElementType>` inline rather than generating a named type alias.
    - Explicitly registered types (e.g., `NumberList`) continue to emit named
      aliases for backward compatibility.
    - Detection: check whether the type name matches the auto-generated pattern
      (e.g., starts with `"List<"`) or add an `autoInstantiated?: boolean` flag to
      `TypeDef`.
  - Update `MindcraftTypeMap` generation: auto-instantiated types may not need
    entries if they're inlined. Only generate entries for explicitly named types.
- Test files:
  - `packages/core/src/brain/runtime/type-system.spec.ts` (new or extend
    existing) -- test constructor registration, instantiation, memoization,
    backward compatibility with explicit `addListType`.
  - `packages/typescript/src/compiler/codegen.spec.ts` -- test that
    `Vector2[]` compiles without a pre-registered `Vector2List` type (auto-
    instantiation), test that `NumberList` alias still works.

**Concrete deliverables:**

1. `TypeConstructor` interface in `type-system.ts`.
2. `ITypeRegistry.registerConstructor(ctor)` and `ITypeRegistry.instantiate(name, args)`
   methods.
3. `ListConstructor` and `MapConstructor` implementations.
4. Registration of both constructors in `registerCoreTypes()`.
5. Memoized instantiation: `instantiate("List", [CoreTypeIds.Number])` returns a
   stable TypeId on repeated calls.
6. `resolveListTypeId()` uses `instantiate` instead of scanning.
7. Ambient generation handles auto-instantiated types without generating unnecessary
   named aliases.

**Acceptance criteria:**

- Test: `registerConstructor(listCtor)` succeeds; duplicate registration throws.
- Test: `instantiate("List", [CoreTypeIds.Number])` returns a valid TypeId.
- Test: calling `instantiate("List", [CoreTypeIds.Number])` twice returns the same
  TypeId.
- Test: `instantiate("List", [CoreTypeIds.String])` returns a different TypeId from
  the number variant.
- Test: `instantiate("Map", [CoreTypeIds.Number])` works similarly.
- Test: the TypeDef returned by `get(instantiatedTypeId)` has `coreType: NativeType.List`,
  correct `elementTypeId`, and a working `ListCodec`.
- Test: `ListCodec` from an instantiated type round-trips values correctly.
- Test: `instantiate` with an unknown constructor name throws.
- Test: `instantiate` with wrong arity throws.
- Test: existing `addListType("NumberList", ...)` still works alongside constructors.
- Test: TypeScript source with `Vector2[]` compiles using auto-instantiation (no
  pre-registered `Vector2List` needed).
- Test: ambient generation for auto-instantiated types emits `ReadonlyArray<T>`
  inline rather than a named alias.
- `npm run check` passes in `packages/core` and `packages/typescript`.
- `npm run build:rbx` passes.

**Key risks:**

- **TypeId format for auto-instantiated types.** The computed TypeId
  (e.g., `"list:<List<number:<number>>>"`) is long and embeds the full element TypeId.
  This is acceptable for internal use but could be confusing in debug output. Consider
  a shorter format if it causes problems, but start with the descriptive one.
- **Memoization key determinism.** The key must be identical regardless of call order
  or which code path triggers instantiation. Using sorted, canonical TypeId strings
  as components ensures this.
- **Interaction with `addListType`.** An app may call `addListType("NumberList", ...)`
  before or after `instantiate("List", [CoreTypeIds.Number])`. Since these produce
  different TypeIds (`"list:<NumberList>"` vs `"list:<List<number:<number>>>"`) they
  are distinct registrations. The TypeScript compiler's `resolveListTypeId` uses alias
  lookup first (finds `NumberList`), then falls back to `instantiate`. This means
  explicit names take priority, which is correct.
- **Nested instantiation.** `instantiate("List", [instantiate("List", [CoreTypeIds.Number])])`
  creates a `List<List<number>>`. The inner `instantiate` runs first, registers the
  inner list type, then the outer `instantiate` uses the inner TypeId as the element
  type. The `construct` method must handle element types that are themselves list types.
  `ListCodec` already supports this since it delegates to the element codec, which would
  be another `ListCodec`.
- **Luau transpile.** The `TypeConstructor` interface and `instantiate` method use
  `Dict<string, TypeConstructor>` and `Dict<string, TypeId>` -- both available in Luau
  via platform `Dict`. The `construct` method creates objects, which transpile normally.

---

### Phase 3: Union types

(Revised 2026-03-22 after Phase 1 and Phase 2 completion.)

**Prerequisite:** Phase 1 (nullable types) and Phase 2 (generic constructors) must
be complete. Nullable types established the pattern for derived types and the
`unwrapNullableTypeId()` fallback for operator resolution. Generic constructors
enable `List<number | string>` via `instantiate("List", [unionTypeId])`.

**Objective:** Introduce union types to the core type system. A union type represents
"one of these specific types" with a tagged codec for serialization. This replaces the
blunt `Any` fallback for multi-member unions: `number | string` becomes a precise
2-member union rather than collapsing to `Any`.

**Scope decisions (revised post-Phase-1/2):**

- **Nullable subsumption:** When the union is exactly `[T, Nil]` (after normalization),
  produce the Phase 1 nullable type (`addNullableType(baseTypeId)`) rather than a
  union type. `NullableCodec` is more efficient than `UnionCodec` for this common
  case, and the existing `tsTypeToTypeId()` already handles `T | null` -> nullable.
  The `getOrCreateUnionType` normalization step should detect this case and delegate
  to `addNullableType`.
- **Core operator/conversion changes: deferred.** The core `operators.ts` `resolve()`
  and `conversions.ts` `findBestPath()` operate on exact TypeIds. Modifying them for
  union expansion is complex and primarily serves the brain compiler, which does not
  currently produce union types. Instead, the TS compiler's lowering pass handles
  union operands: generalize `unwrapNullableTypeId()` to an `expandTypeIdMembers()`
  helper that returns the member TypeIds of a union (or a single-element list for
  non-unions), and use it for operator overload lookup in `lowering.ts`. The core
  runtime stays union-unaware for now.
- **Brain compiler: deferred.** Union types are a TS-compiler feature. The brain tile
  system has no concept of union types. `InferredTypesVisitor` is not touched in this
  phase. If brain tiles later need union support, a follow-up phase will address it.
- **`Any` fallback: kept.** `Any` remains for cases where a member type cannot be
  resolved to a TypeId (e.g., unsupported TS type, complex generics). The change is:
  `tsTypeToTypeId()` returns a union TypeId when all members resolve, falls back to
  `Any` only when a member is unresolvable.

**Packages/files touched:**

- `packages/core/src/brain/interfaces/type-system.ts`
  - Add `NativeType.Union = 10` (next available value).
  - Add `UnionTypeShape`:
    ```
    interface UnionTypeShape {
      memberTypeIds: List<TypeId>;
    }
    ```
  - Add `UnionTypeDef = TypeDef & UnionTypeShape`.
  - Add `getOrCreateUnionType(memberTypeIds: List<TypeId>): TypeId` to
    `ITypeRegistry`. This normalizes, deduplicates, flattens nested unions, sorts
    member TypeIds lexicographically, and returns a deterministic TypeId. If a single
    member remains after dedup, return that member's TypeId directly (no wrapping).
    If the result is exactly `[T, Nil]`, delegate to `addNullableType(T)`.
- `packages/core/src/brain/interfaces/core-types.ts`
  - Add `nativeTypeToString` case for `NativeType.Union` returning `"union"`.
- `packages/core/src/brain/interfaces/vm.ts`
  - No new `Value` variant needed. Union types are a type-system concept; at runtime,
    a value in a union slot is just a concrete `NumberValue`, `StringValue`, etc. The
    `typeId` on the containing slot (e.g., list element, parameter) tracks the union,
    but the `Value` itself retains its concrete type.
- `packages/core/src/brain/runtime/type-system.ts`
  - Implement `UnionCodec`:
    - `encode(w, value)`: write a `U8` discriminant indicating which member type the
      value is (index into the sorted `memberTypeIds` list), then delegate to that
      member's codec. Determine the member by checking `value.t` (the `NativeType`
      discriminant on the `Value`) against the member TypeDefs' `coreType` values.
      For members sharing the same `NativeType` (e.g., two different struct types or
      two different enum types), additionally check `value.typeId`. Throw if no
      matching member is found.
    - `decode(r)`: read the `U8` discriminant, delegate to the indexed member codec,
      return the decoded value.
    - `stringify(value)`: delegate to the matching member codec's `stringify`.
  - Implement `TypeRegistry.getOrCreateUnionType(memberTypeIds)`:
    1. Flatten: if any member is itself a union, replace it with its members.
       If any member is nullable, replace it with `[baseType, Nil]`.
    2. Deduplicate by TypeId.
    3. Sort lexicographically.
    4. If 0 members, throw (invalid).
    5. If 1 member, return that member's TypeId (collapse).
    6. If exactly 2 members and one is `CoreTypeIds.Nil`, call
       `addNullableType(otherMemberId)` and return the nullable TypeId.
    7. Compute TypeId: `"union:<boolean:<boolean>,number:<number>>"` (sorted member
       TypeIds joined by `,`).
    8. If already registered, return existing TypeId.
    9. Look up each member's def and codec.
    10. Create `UnionTypeDef` with `UnionCodec(memberCodecs, memberDefs)`.
    11. Register and return.
- `packages/typescript/src/compiler/lowering.ts`
  - Update `tsTypeToTypeId()`: for multi-member non-null unions, instead of returning
    `CoreTypeIds.Any`, map each member via `tsTypeToTypeId`, then call
    `registry.getOrCreateUnionType(memberTypeIds)`. Return the union TypeId.
    If any member cannot be resolved, fall back to `CoreTypeIds.Any`.
  - Generalize `unwrapNullableTypeId()` to `expandTypeIdMembers(typeId)`: returns
    the member TypeIds of a union or nullable type as a `List<TypeId>`, or a
    single-element list containing `typeId` for non-union types. Use this in
    operator overload resolution: try each member type, and if all members resolve
    to the same overload, use it. This subsumes the Phase 1 nullable unwrap
    fallback.
  - Update `resolveListTypeId()`: if element type is a union, use `instantiate("List",
[unionTypeId])` (from Phase 2) to create a `List<union>` type. This already
    works with the existing `instantiate` code path -- no special handling needed
    beyond ensuring `tsTypeToTypeId` returns the union TypeId.
- `packages/typescript/src/compiler/ambient.ts`
  - Update `typeDefToTs()` for `UnionTypeDef`: emit `MemberType1 | MemberType2 | ...`
    using recursive `typeDefToTs` for each member.
  - Update `MindcraftTypeMap` for union types: auto-instantiated union types (like
    auto-instantiated list types) should be inlined rather than generating named
    aliases.

**Concrete deliverables:**

1. `NativeType.Union = 10` in the enum.
2. `UnionTypeShape` and `UnionTypeDef` interfaces.
3. `UnionCodec` with tagged encode/decode and member-dispatch `stringify`.
4. `ITypeRegistry.getOrCreateUnionType(memberTypeIds: List<TypeId>)` with
   normalization (flatten, dedup, sort, collapse single-member, delegate `[T, Nil]`
   to nullable).
5. `tsTypeToTypeId()` returns union TypeIds instead of `Any` for resolvable
   multi-member unions.
6. `expandTypeIdMembers()` generalizes `unwrapNullableTypeId()` for operator
   resolution fallback in `lowering.ts`.
7. Ambient generation emits TS union syntax for `UnionTypeDef`.
8. End-to-end: `[1, "hello"]` compiles to `List<number | string>` (a list with a
   union element type) rather than `AnyList`.

**Acceptance criteria:**

- Test: `getOrCreateUnionType([CoreTypeIds.Number, CoreTypeIds.String])` returns a
  stable TypeId and the def has `coreType: NativeType.Union`.
- Test: calling `getOrCreateUnionType` with reversed order returns the same TypeId
  (order-independent).
- Test: nested union flattening works:
  `getOrCreateUnionType([unionTypeId, CoreTypeIds.Boolean])` flattens the inner
  union's members.
- Test: single-member collapse: `getOrCreateUnionType([CoreTypeIds.Number])` returns
  `CoreTypeIds.Number`.
- Test: nullable subsumption: `getOrCreateUnionType([CoreTypeIds.Number, CoreTypeIds.Nil])`
  returns the same TypeId as `addNullableType(CoreTypeIds.Number)`.
- Test: `UnionCodec` round-trips a `NumberValue` through a `number | string` union.
- Test: `UnionCodec` round-trips a `StringValue` through a `number | string` union.
- Test: `UnionCodec.encode` throws for a value type not in the union.
- Test: `tsTypeToTypeId` returns a union TypeId for `number | string` (not `Any`).
- Test: `tsTypeToTypeId` returns `CoreTypeIds.Any` for `number | UnresolvableType`.
- Test: operator resolution in `lowering.ts`: `(number | string) + number` resolves
  via `expandTypeIdMembers` fallback.
- Test: ambient output for a union type emits `number | string`.
- Test: `[1, "hello"]` compiles to a list with a union element type, not `AnyList`.
- `npm run check` passes in `packages/core` and `packages/typescript`.
- `npm run build:rbx` passes.

**Key risks:**

- **`UnionCodec` member identification.** When encoding, the codec must determine
  which union member a given `Value` belongs to. For primitive types this is
  straightforward (check `value.t`). For two members with the same `NativeType`
  (e.g., two different struct types), the codec must also check `value.typeId` on the
  value. If neither `value.t` nor `value.typeId` uniquely identifies a member, the
  codec should throw. In practice, most unions will have members with distinct
  `NativeType` values. Ensure the codec handles the multi-struct case correctly.
- **`Any` type relationship.** `Any` remains the top type for truly unknown or
  open-ended types. After this phase, `Any` is used only when a TS union member
  cannot be resolved to a TypeId at all. The TS compiler should prefer union types
  over `Any` whenever possible.
- **Operator resolution approach.** Rather than modifying the core `operators.ts`
  resolve function, the TS compiler's `expandTypeIdMembers()` tries each union
  member for overload lookup. If members resolve to different overloads (e.g.,
  `number + number -> number` vs `string + number -> string`), the result becomes
  ambiguous. The TS checker already validates these operations, so the lowering pass
  can trust the checker's result type and map it via `tsTypeToTypeId`. If the
  checker's result type maps cleanly, no cross-product expansion is needed. If
  ambiguity arises, fall back to `Any`.
- **Luau `UnionCodec` transpile.** The codec uses standard stream operations and
  `NativeType` comparisons. The `getOrCreateUnionType` method uses `Dict` for
  memoization. Both transpile to Luau. Verify with `npm run build:rbx`.

---

### Phase 4: `typeof` lowering

**Prerequisite:** Phase 12.1 (TypeScript compiler phased impl) must be complete.
Useful independently but most valuable after Phase 3 (union types) since union-typed
values need runtime type narrowing.

**Objective:** Lower TypeScript `typeof x === "type"` checks into efficient VM
instructions that inspect the `NativeType` discriminant on a `Value`. This enables
runtime type narrowing for values retrieved from `AnyList` or union-typed containers.

**Packages/files touched:**

- `packages/core/src/brain/interfaces/vm.ts`
  - Add `TYPE_CHECK = 150` (or next available range) to `Op` enum. Operand `a` is a
    `NativeType` value. Pops one value from the stack, pushes `TRUE_VALUE` if the
    value's `.t` equals `a`, otherwise pushes `FALSE_VALUE`.
- `packages/core/src/brain/runtime/vm.ts`
  - Implement `execTypeCheck(instr)`:
    1. Pop the top value from `vstack`.
    2. Compare `value.t === instr.a` (where `instr.a` is the `NativeType` discriminant).
    3. Push `TRUE_VALUE` or `FALSE_VALUE`.
  - Add `case Op.TYPE_CHECK: this.execTypeCheck(instr); break;` to the dispatch loop.
- `packages/core/src/brain/compiler/emitter.ts`
  - Add `typeCheck(nativeType: NativeType)` method that emits
    `{ op: Op.TYPE_CHECK, a: nativeType }`.
- `packages/typescript/src/compiler/ir.ts`
  - Add `IrTypeCheck` node: `{ kind: "TypeCheck"; nativeType: NativeType }`.
- `packages/typescript/src/compiler/lowering.ts`
  - Detect `typeof x === "string"` patterns in binary expressions:
    - LHS is a `typeof` unary expression, RHS is a string literal.
    - Map the string literal to a `NativeType`: `"number"` -> `NativeType.Number`,
      `"string"` -> `NativeType.String`, `"boolean"` -> `NativeType.Boolean`,
      `"undefined"` -> `NativeType.Nil`, `"object"` -> `NativeType.Struct` (or
      handle as a special case).
    - Emit: lower the `typeof` operand (push value), emit `IrTypeCheck(nativeType)`.
    - The comparison operator (`===`, `!==`) wraps this: `===` keeps the boolean,
      `!==` follows with a `NOT`.
  - Also handle the reversed form: `"string" === typeof x`.
- `packages/typescript/src/compiler/emit.ts`
  - Emit `IrTypeCheck` as `Op.TYPE_CHECK` with `a: nativeType`.
- Test files:
  - `packages/core/src/brain/runtime/vm.spec.ts` -- test `TYPE_CHECK` opcode with
    each `NativeType`.
  - `packages/typescript/src/compiler/codegen.spec.ts` -- test `typeof x === "number"`
    compiles and runs correctly, test `typeof x !== "string"`, test reversed form.

**Concrete deliverables:**

1. `Op.TYPE_CHECK` opcode in the `Op` enum.
2. `execTypeCheck` implementation in the VM.
3. `IrTypeCheck` IR node.
4. Lowering of `typeof x === "string"` patterns to `TYPE_CHECK` + comparison.
5. End-to-end: code with `typeof` checks compiles, runs, and produces correct
   boolean results.

**Acceptance criteria:**

- Test: `TYPE_CHECK` with `NativeType.Number` on a `NumberValue` pushes `TRUE_VALUE`.
- Test: `TYPE_CHECK` with `NativeType.Number` on a `StringValue` pushes `FALSE_VALUE`.
- Test: `TYPE_CHECK` with `NativeType.Nil` on `NIL_VALUE` pushes `TRUE_VALUE`.
- Test: `typeof x === "number"` compiles to `LOAD_LOCAL` + `TYPE_CHECK(Number)` (or
  equivalent IR).
- Test: `typeof x !== "string"` produces the negated result.
- Test: `"boolean" === typeof x` (reversed form) compiles correctly.
- Test: end-to-end sensor using `typeof` to narrow an `AnyList` element:
  ```ts
  const arr: AnyList = [1, "hello"];
  const item = arr[0];
  if (typeof item === "number") {
    return true;
  }
  return false;
  ```
- Test: `typeof x === "object"` maps to an appropriate `NativeType` (decide whether
  this maps to `Struct`, or is unsupported with a diagnostic).
- `npm run check` passes in `packages/core` and `packages/typescript`.
- `npm run build:rbx` passes.

**Key risks:**

- **`typeof` mapping for non-primitive types.** TypeScript's `typeof` returns
  `"object"` for objects, arrays, and null. The mapping to `NativeType` must be
  carefully defined:
  - `"number"` -> `NativeType.Number`
  - `"string"` -> `NativeType.String`
  - `"boolean"` -> `NativeType.Boolean`
  - `"undefined"` -> `NativeType.Nil` (TS `undefined` maps to VM nil)
  - `"object"` -> ambiguous (could be Struct, List, Map). Options: map to multiple
    checks, reject with a diagnostic, or define as "is a struct" for now.
  - `"function"` -> not applicable until Phase 6 (first-class functions).
    Decide on behavior for `"object"` before implementation. Safest initial approach:
    support `"number"`, `"string"`, `"boolean"`, `"undefined"` only; reject others
    with a compile diagnostic.
- **TS checker narrowing vs VM narrowing.** The TS checker narrows the type of `x`
  inside the `if` block. The compiler must not emit incorrect code when the narrowed
  type triggers different operator overload resolution. In practice, the lowering
  pass does not re-run type inference after narrowing -- it uses the TS checker's
  already-narrowed types. This should be correct as long as the TS checker's
  narrowing is used during IR generation.
- **Luau transpile.** `Op.TYPE_CHECK` is a new opcode value. The Luau VM dispatch
  must include it. Since opcode dispatch is typically a numeric switch, adding a new
  case is straightforward.

---

### Phase 5: First-class function references (Phase A)

**Prerequisite:** Phase 3 (union types) should be complete so that
`NativeType.Union = 10` is assigned and `NativeType.Function = 11` follows
naturally. Phase 5 is otherwise independent.

**Objective:** Enable passing named functions as values. Add a `FunctionValue` to the
`Value` union, a `CALL_INDIRECT` opcode that calls a function by runtime-determined ID,
and compiler support for lowering function references (e.g., `myHelper` passed as an
argument) into `FunctionValue` constants + `CALL_INDIRECT` invocations.

This phase does NOT include closures (captured variables). Only top-level/module-level
named functions can be passed as references. Arrow functions and closures are Phase 6.

**Packages/files touched:**

- `packages/core/src/brain/interfaces/type-system.ts`
  - Add `NativeType.Function = 11` (or next available after `Union = 10`).
  - Update `nativeTypeToString` for `NativeType.Function`.
- `packages/core/src/brain/interfaces/core-types.ts`
  - Add `CoreTypeNames.Function = "function"` and
    `CoreTypeIds.Function = mkTypeId(NativeType.Function, "function")`.
- `packages/core/src/brain/interfaces/vm.ts`
  - Add `FunctionValue` type:
    ```
    interface FunctionValue {
      t: NativeType.Function;
      funcId: number;
    }
    ```
  - Add `FunctionValue` to the `Value` union.
  - Add `isFunctionValue` type guard.
  - Add `mkFunctionValue(funcId: number): FunctionValue` factory.
  - Add `Op.CALL_INDIRECT = 160` to `Op` enum. Operand `a` = argument count.
    Pops `argc` arguments, then pops a `FunctionValue`, calls the function by
    `funcId`. (150 is taken by `TYPE_CHECK` from Phase 4.)
- `packages/core/src/brain/runtime/vm.ts`
  - Implement `execCallIndirect(instr)`:
    1. Pop `instr.a` arguments from `vstack` into a temporary array.
    2. Pop the `FunctionValue` from `vstack`.
    3. Validate it is a `FunctionValue` (runtime type check -- throw if not).
    4. Look up `this.prog.functions.get(funcValue.funcId)`.
    5. Push a new `Frame` for the target function, same as `execCall`.
    6. Copy arguments into the new frame's locals.
  - Add `case Op.CALL_INDIRECT: this.execCallIndirect(instr); break;` to dispatch.
  - Update `deepCopyValue` to handle `FunctionValue` (it is immutable -- just return
    the same value, no deep copy needed).
  - Add `V.func(funcId)` to the `V` factory object.
- `packages/core/src/brain/compiler/emitter.ts`
  - Add `callIndirect(argc: number)` method that emits
    `{ op: Op.CALL_INDIRECT, a: argc }`.
- `packages/core/src/brain/runtime/type-system.ts`
  - Add `FunctionCodec` class: **non-serializable**. `encode` and `decode` throw
    with a clear error message ("function values cannot be serialized"). `stringify`
    returns `"<function:${funcId}>"`.
  - Register `Function` type in `registerCoreTypes()` using
    `addFunctionType(CoreTypeNames.Function)` (new method) or by manually adding a
    typed def.
  - Add `addFunctionType(name: string): TypeId` to `ITypeRegistry` and
    `TypeRegistry`.
- `packages/typescript/src/compiler/ir.ts`
  - Add `IrPushFunctionRef` node: `{ kind: "PushFunctionRef"; funcName: string }`.
    The function name is resolved to a `funcId` during emit, after all functions are
    registered.
  - Add `IrCallIndirect` node: `{ kind: "CallIndirect"; argc: number }`.
- `packages/typescript/src/compiler/lowering.ts`
  - Detect function references: when an identifier resolves to a function declaration
    (via the TS type checker) and is used as an expression (not a call), emit
    `IrPushFunctionRef(funcName)`.
  - When a call expression's callee is not a direct function name but is an expression
    (e.g., a variable holding a function reference), emit: lower the callee expression
    (pushes `FunctionValue`), lower arguments, emit `IrCallIndirect(argc)`.
- `packages/typescript/src/compiler/emit.ts`
  - Emit `IrPushFunctionRef`: resolve `funcName` to `funcId` from the function table,
    emit `PUSH_CONST(FunctionValue(funcId))`.
  - Emit `IrCallIndirect`: emit `Op.CALL_INDIRECT` with `a: argc`.
- `packages/typescript/src/compiler/ambient.ts`
  - No changes needed for this phase. Function types in ambient declarations are a
    Phase 7 concern (type-level function signatures).
- Test files:
  - `packages/core/src/brain/runtime/vm.spec.ts` -- test `CALL_INDIRECT` opcode:
    push function ref, push args, call indirect, verify correct function executed.
  - `packages/typescript/src/compiler/codegen.spec.ts` -- test passing a named function
    as argument, test calling via function reference.

**Concrete deliverables:**

1. `NativeType.Function = 11` in enum.
2. `FunctionValue` type in `Value` union.
3. `Op.CALL_INDIRECT` opcode with `execCallIndirect` implementation.
4. `FunctionCodec` (non-serializable, for type registration only).
5. `V.func(funcId)` factory.
6. `IrPushFunctionRef` and `IrCallIndirect` IR nodes.
7. Compiler support for function references and indirect calls.
8. End-to-end: passing a named function as an argument and calling it via
   `CALL_INDIRECT` works.

**Acceptance criteria:**

- Test: `FunctionValue` can be created via `mkFunctionValue(42)`.
- Test: `isFunctionValue` type guard works.
- Test: `CALL_INDIRECT` with `argc=2` pops 2 args + 1 function ref, calls the function.
- Test: `CALL_INDIRECT` with a non-`FunctionValue` on stack throws a runtime error.
- Test: `FunctionCodec.encode` throws with a clear error message.
- Test: `FunctionCodec.stringify` returns a descriptive string.
- Test: TypeScript source passing a named function works:
  ```ts
  function double(n: number): number {
    return n * 2;
  }
  function apply(fn: (n: number) => number, x: number): number {
    return fn(x);
  }
  const result = apply(double, 5); // result = 10
  ```
- Test: `deepCopyValue` for `FunctionValue` returns the same value (identity).
- `npm run check` passes in `packages/core` and `packages/typescript`.
- `npm run build:rbx` passes.

**Key risks:**

- **Function ID remapping in linker.** The linker (`linkUserPrograms`) remaps `CALL`
  operands when merging user programs into a brain program. `CALL_INDIRECT` uses
  runtime-determined function IDs stored as `FunctionValue` constants. The linker
  must also remap function IDs inside `FunctionValue` constants in the constant pool.
  Verify the linker handles this.
- **Function reference validity.** A `FunctionValue` holds a `funcId` index into
  `program.functions`. If a function reference escapes to a different program (via
  serialization or cross-program call), the `funcId` is meaningless. The
  non-serializable `FunctionCodec` prevents accidental serialization, but this is
  worth noting as a design constraint.
- **TypeScript type representation.** When the TS type of a parameter is `(x: number) => number`, the compiler needs to lower this to a `FunctionValue`-accepting parameter.
  For this phase, the parameter type in the VM is just the generic `Function` type
  (no parameter/return type checking at the VM level). Type-level function signatures
  (Phase 7) add compile-time checking. For now, runtime calls may fail with wrong
  argument counts or types.
- **Luau `CALL_INDIRECT` transpile.** The Luau VM dispatches opcodes via numeric switch.
  Adding `CALL_INDIRECT` follows the same pattern as existing opcodes. The function
  lookup is `self.prog.functions:get(funcId)`, same as `CALL` but with a
  runtime-determined ID.

---

### Phase 6: Closures (first-class functions Phase B)

**Prerequisite:** Phase 5 (function references).

**Objective:** Extend function references to support captured variables. Arrow functions
and inner functions that reference variables from their enclosing scope should work.
A `MAKE_CLOSURE` opcode captures specified local variables into a `ClosureValue`, and
`LOAD_CAPTURE` / `STORE_CAPTURE` opcodes access captured variables during closure
execution.

This is the highest-complexity phase in the plan. It enables idiomatic TypeScript
patterns like `items.filter(x => x > threshold)` where `threshold` is a local variable
from the enclosing scope.

**Packages/files touched:**

- `packages/core/src/brain/interfaces/vm.ts`
  - Extend `FunctionValue` to optionally carry captures:
    ```
    interface FunctionValue {
      t: NativeType.Function;
      funcId: number;
      captures?: List<Value>;
    }
    ```
    Or introduce a separate `ClosureValue` type (same `NativeType.Function` but with
    captures). Prefer extending `FunctionValue` to avoid a new `NativeType` member.
  - Add opcodes:
    - `Op.MAKE_CLOSURE`: operand `a` = funcId, operand `b` = capture count. Pops
      `b` values from the stack (the captured variables), creates a `FunctionValue`
      with those captures, pushes it.
    - `Op.LOAD_CAPTURE`: operand `a` = capture slot index. Loads from the current
      frame's closure captures.
    - `Op.STORE_CAPTURE`: operand `a` = capture slot index. Stores to the current
      frame's closure captures.
- `packages/core/src/brain/runtime/vm.ts`
  - Implement `execMakeClosure(instr)`: pop values, create `FunctionValue` with
    captures list, push.
  - Implement `execLoadCapture(instr)`: read from `frame.captures[instr.a]`.
  - Implement `execStoreCapture(instr)`: write to `frame.captures[instr.a]`.
  - Update `execCallIndirect` and frame setup: when calling a `FunctionValue` that
    has `captures`, attach the captures to the new `Frame`.
  - Add `captures?: List<Value>` to `Frame` interface.
- `packages/typescript/src/compiler/lowering.ts`
  - Detect arrow functions and inner function expressions.
  - Analyze captured variables: walk the function body's free variables and determine
    which reference locals from the enclosing scope.
  - Emit the closure body as a separate function entry (compiled like a helper
    function).
  - At the closure creation site, emit: push each captured variable onto the stack,
    emit `MAKE_CLOSURE(funcId, captureCount)`.
  - Inside the closure body, references to captured variables emit `LOAD_CAPTURE(slot)`
    instead of `LOAD_LOCAL`.
- `packages/typescript/src/compiler/scope.ts`
  - Extend `ScopeStack` with capture tracking: when a variable is accessed inside an
    inner function scope, mark it as captured, assign a capture slot index.
- `packages/typescript/src/compiler/ir.ts`
  - Add `IrMakeClosure`, `IrLoadCapture`, `IrStoreCapture` IR nodes.
- `packages/typescript/src/compiler/emit.ts`
  - Emit the new IR nodes as their corresponding opcodes.

**Concrete deliverables:**

1. `MAKE_CLOSURE`, `LOAD_CAPTURE`, `STORE_CAPTURE` opcodes.
2. `FunctionValue` extended with optional `captures`.
3. `Frame` extended with optional `captures`.
4. Capture analysis in the lowering pass.
5. Arrow functions and inner function expressions compile and execute correctly.
6. End-to-end: `items.filter(x => x > threshold)` works where `threshold` is a
   local variable.

**Acceptance criteria:**

- Test: `MAKE_CLOSURE` creates a `FunctionValue` with the correct captures.
- Test: `LOAD_CAPTURE` reads the correct captured value.
- Test: `CALL_INDIRECT` on a closure correctly attaches captures to the new frame.
- Test: simple closure over a number:
  ```ts
  function makeAdder(n: number): (x: number) => number {
    return (x: number) => x + n;
  }
  const add5 = makeAdder(5);
  const result = add5(3); // result = 8
  ```
- Test: closure over multiple variables.
- Test: closure used with array method (if list `.filter`/`.map` methods are
  available by this point).
- Capture-by-value semantics: modifying the captured variable after closure creation
  does not affect the closure's copy.
- `npm run check` passes.
- `npm run build:rbx` passes.

**Key risks:**

- **Capture semantics: by-value vs by-reference.** JavaScript captures variables by
  reference (mutations are shared). The simplest VM implementation captures by value
  (snapshot at closure creation time). This means `let x = 1; const f = () => x; x = 2; f()` returns `1` with capture-by-value, but `2` in JavaScript. Decide
  which semantics to implement. Capture-by-value is simpler and avoids shared mutable
  state. Document the deviation from JS semantics.
- **`STORE_CAPTURE` necessity.** If captures are by-value and immutable, `STORE_CAPTURE`
  is not needed. Only add it if mutable captures are supported. Starting without
  `STORE_CAPTURE` reduces complexity.
- **Capture analysis complexity.** Determining which variables are captured requires
  walking the function body and comparing against the enclosing scope's declarations.
  The TypeScript checker already has this information (bound names vs free names).
  Leverage TS API (`checker.getSymbolAtLocation`) to determine if a symbol is declared
  in an enclosing scope.
- **Nested closures.** A closure inside a closure captures variables from both
  enclosing scopes. The capture must transitively include variables from all outer
  scopes. This adds complexity to the capture analysis.
- **Memory management.** Closures keep captured values alive. Since the VM uses
  value semantics (no GC), captured container values (lists, maps) hold references
  that cannot be freed until the closure is discarded. This is the same as JS
  semantics and not a new concern.
- **Linker impact.** `MAKE_CLOSURE` stores a `funcId`. The linker must remap this
  operand, same as `CALL`. Add `MAKE_CLOSURE` to the linker's operand remapping.
- (Added 2026-03-22, Phase 5 post-mortem) **Async closures not supported.**
  `FunctionValue` has no async flag, and no `CALL_INDIRECT_ASYNC` opcode exists.
  Closures calling async host functions via `await` would not work correctly through
  indirect calls. This is an inherited limitation from Phase 5.
- (Added 2026-03-22, Phase 5 post-mortem) **`CallIndirect` bail-out pattern.**
  Phase 5 added an `ir.length` guard in `lowerCallExpression` to skip `CallIndirect`
  emission when the callee fails to lower. `MAKE_CLOSURE` emission should follow the
  same pattern if it depends on sub-expression lowering.

---

### Phase 7: Type-level function signatures

**Prerequisite:** Phase 5 (function references). Phase 6 (closures) is helpful but
not required.

**Objective:** Add `FunctionTypeShape` to the type system so that function parameters
and return types can be expressed and checked at compile time. This enables the
TypeScript compiler to validate callback signatures: `(x: number) => number` vs
`(x: string) => boolean` are different types. Without this, all function references
use the generic `Function` type with no signature checking.

**Packages/files touched:**

- `packages/core/src/brain/interfaces/type-system.ts`
  - Add `FunctionTypeShape`:
    ```
    interface FunctionTypeShape {
      paramTypeIds: List<TypeId>;
      returnTypeId: TypeId;
    }
    ```
  - Add `FunctionTypeDef = TypeDef & FunctionTypeShape`.
  - Add `addFunctionType(name: string, shape: FunctionTypeShape): TypeId` to
    `ITypeRegistry` (overload or rename the Phase 5 method).
  - Or: use generic constructors (Phase 2) to create function types on demand:
    `instantiate("Function", [paramType1, paramType2, ..., returnType])`. This
    is awkward because the arity varies. Better to have a dedicated method.
  - Add `getOrCreateFunctionType(shape: FunctionTypeShape): TypeId` to
    `ITypeRegistry` for on-demand creation with memoization.
- `packages/core/src/brain/runtime/type-system.ts`
  - Implement `getOrCreateFunctionType`: memoize by canonical key derived from
    param + return TypeIds.
- `packages/typescript/src/compiler/lowering.ts`
  - When a function type is encountered (callback parameter, function return type),
    call `registry.getOrCreateFunctionType(shape)` to get the TypeId.
  - Use this TypeId for parameter type annotations in the descriptor.
- `packages/typescript/src/compiler/ambient.ts`
  - Emit function type signatures: `(x: number, y: string) => boolean` for
    `FunctionTypeDef`.

**Concrete deliverables:**

1. `FunctionTypeShape` and `FunctionTypeDef` interfaces.
2. `getOrCreateFunctionType(shape)` with memoization.
3. TypeScript compiler resolves callback types to `FunctionTypeDef` TypeIds.
4. Ambient generation emits function type signatures.

**Acceptance criteria:**

- Test: `getOrCreateFunctionType({ paramTypeIds: [Number], returnTypeId: Number })`
  returns a stable TypeId.
- Test: different signatures produce different TypeIds.
- Test: ambient output emits `(arg0: number) => number` for a function type.
- `npm run check` passes.
- `npm run build:rbx` passes.

**Key risks:**

- **Arity in TypeId.** Function types have variable arity. The memoization key must
  encode all parameter types and the return type deterministically.
- **Interaction with closures.** A closure's type should match the declared function
  type. The compiler must check that the closure's inferred parameter/return types
  match the expected `FunctionTypeDef`.
- (Added 2026-03-22, Phase 6 post-mortem) **Closure function naming.** Closure
  functions use synthetic names like `<closure#N>` in the function table. Phase 7's
  type resolution must handle these entries or ignore them gracefully when building
  function type signatures.

---

### Phase 8: Structural subtyping

**Prerequisite:** None (independent). Can be implemented at any point when it becomes
a user pain point.

**Objective:** Allow struct types to be structurally compatible when one has a superset
of another's fields. This is a TypeScript compiler concern -- the VM already handles
it (extra fields are harmless, `GET_FIELD` returns `NIL_VALUE` for missing fields).

**Packages/files touched:**

- `packages/core/src/brain/interfaces/type-system.ts`
  - Add `isStructurallyCompatible(sourceTypeId: TypeId, targetTypeId: TypeId): boolean`
    to `ITypeRegistry`.
  - Add optional `nominal?: boolean` flag to `StructTypeShape` to opt out of
    structural compatibility (for domain types that should not be interchangeable
    despite having the same fields).
- `packages/core/src/brain/runtime/type-system.ts`
  - Implement `isStructurallyCompatible`:
    1. Both must be struct types (return `false` otherwise).
    2. If either has `nominal: true`, return `false` (exact TypeId match required).
    3. Check that the source has all fields the target has, with compatible field types
       (recursive check for nested structs).
- `packages/typescript/src/compiler/lowering.ts`
  - Use `isStructurallyCompatible` when validating assignments and function call
    arguments where the source struct TypeId differs from the target.
- `packages/typescript/src/compiler/ambient.ts`
  - No structural changes needed. The TS ambient types are already structural by
    default (TS interfaces are structural). Non-structural (nominal) types use the
    `__brand` pattern already in place.

**Concrete deliverables:**

1. `isStructurallyCompatible` method on `ITypeRegistry`.
2. `nominal?: boolean` flag on `StructTypeShape`.
3. TypeScript compiler uses structural compatibility for assignment validation.

**Acceptance criteria:**

- Test: two struct types with identical fields are structurally compatible.
- Test: a struct with extra fields is compatible with a struct with fewer fields
  (superset check).
- Test: a struct missing a required field is NOT compatible.
- Test: a struct with `nominal: true` is NOT compatible with any other struct type
  (even with identical fields).
- Test: recursive compatibility for nested struct fields.
- `npm run check` passes.
- `npm run build:rbx` passes.

**Key risks:**

- **Performance of recursive compatibility check.** For deeply nested struct types,
  the check could be expensive. Add a memoization cache for compatibility results.
- **Native-backed structs.** Native-backed structs (with `fieldGetter`/`fieldSetter`)
  should generally be nominal. Ensure the `__brand` pattern in ambient generation
  already handles this (it does, per the TS compiler phases).

---

## Implementation Order Summary

(Revised 2026-03-22 after Phase 1 and Phase 2 completion.)

| Phase | Name                           | Depends on         | Scope        | Status      |
| ----- | ------------------------------ | ------------------ | ------------ | ----------- |
| (0)   | Phase 12.1: `Any` + `AnyList`  | None               | Small        | Complete    |
| 1     | Nullable type support          | Phase 12.1         | Small-medium | Complete    |
| 2     | Generic type constructors      | None (independent) | Medium       | Complete    |
| 3     | Union types                    | Phase 1, Phase 2   | Medium       | Not started |
| 4     | `typeof` lowering              | Phase 12.1         | Small-medium | Not started |
| 5     | First-class function refs      | Phase 3            | Medium       | Complete    |
| 6     | Closures                       | Phase 5            | High         | Complete    |
| 7     | Type-level function signatures | Phase 5            | Small-medium | Not started |
| 8     | Structural subtyping           | None (independent) | Low-medium   | Not started |

Phase 12.1 is tracked in the TypeScript compiler phased impl doc and is
the prerequisite for all work here.

Phases 1-3 form the type expressiveness chain: nullable -> generic constructors ->
unions. Each works standalone but they compose best together. Phase 3's scope was
reduced post-Phase-1/2: core operator/conversion/brain-compiler changes are deferred;
the TS compiler handles union operands via `expandTypeIdMembers()` in `lowering.ts`.

Phase 4 (`typeof`) is independently useful after Phase 12.1 and becomes essential
after Phase 3 (union types). It can be implemented in any order relative to Phases 1-3.

Phases 5-7 form the first-class functions chain: references -> closures -> type
signatures. Phase 5 depends on Phase 3 for NativeType numbering (Union = 10,
Function = 11). Phase 6 (closures) is the highest-complexity phase. Phase 7 adds
compile-time checking.

Phase 8 (structural subtyping) is independent and low priority. Implement when
it becomes a user pain point.

---

## Phase Log

(Populated by post-mortem after each phase is declared complete. Do not write
entries here during implementation.)

### Phase 1: Nullable type support (completed 2026-03-22)

**Planned vs actual:**

All 6 concrete deliverables were delivered as specified. Two unplanned additions
were required:

1. `NullableTypeShape` interface + `NullableTypeDef` type alias added to
   `type-system.ts`. Follows the existing `ListTypeShape`/`ListTypeDef` pattern
   to carry `baseTypeId` on the def. This was implicit in the spec (the spec
   mentioned "TypeDef with coreType matching the base type's coreType") but
   needed a concrete interface to avoid ad-hoc casting.

2. Operator overload fallback via `unwrapNullableTypeId()` in `lowering.ts`.
   The spec's "Key risks" section predicted that nullable types would interact
   with operator overloads but concluded "No changes needed" because TS would
   reject `number? + number`. This was wrong for equality operators: `val === null`
   where `val: number | null` is valid TS but produced `eq(number?, nil)` which
   had no overload. The fix: binary operators, compound assignments, and unary `!`
   now fall back to unwrapped base types for overload resolution when the nullable
   TypeId has no direct match.

**Not changed (spec mentioned but unnecessary):**

- `resolveListTypeId()` -- no update needed; the existing scan handles nullable
  element types. Phase 2 will replace the scan with `instantiate()`.
- `core-types.ts` -- naming convention implemented entirely inside
  `addNullableType()` using existing `mkTypeId()`.

**All acceptance criteria passed.** All builds (Node, ESM, Roblox-TS) succeed.
`apps/sim` builds. 451 core tests pass, 129 typescript tests pass.

### Phase 2: Generic type constructors (completed 2026-03-22)

**Planned vs actual:**

All 7 concrete deliverables were delivered as specified. Three unplanned additions
were required:

1. `coreType` field added to `TypeConstructor` interface. The spec's interface
   definition omitted this, but `instantiate()` needs it to compute the
   deterministic TypeId (`mkTypeId(ctor.coreType, ...)`) before calling
   `construct()`. Without it, the TypeId format cannot include the correct
   NativeType prefix.

2. `tsTypeToTypeId()` enhanced to resolve named types (structs, enums) via
   symbol name lookup on the registry. The spec only described updating
   `resolveListTypeId()` to use `instantiate`, but `instantiate("List",
[elementTypeId])` requires `elementTypeId` to be resolved first. The
   existing `tsTypeToTypeId()` only handled primitives (number, boolean,
   string, null, undefined). Named types like `Vector2` needed a registry
   lookup via `registry.resolveByName(symbol.getName())`. This was a
   foundational gap that prevented `Vector2[]` from auto-instantiating.

3. `.length` property accessor on list-typed expressions. After Phase 2
   was functionally complete, the end-to-end test used `return 2` instead
   of `return vecs.length` because `lowerPropertyAccess()` only handled
   `params.foo` access. Added `IrListLen` IR node, wired it in `emit.ts`,
   and extended `lowerPropertyAccess()` to detect `.length` on list-typed
   expressions and emit the `IrListLen` -> `Op.LIST_LEN` pipeline.

**API deviation from spec:**

- `TypeId[]` changed to `List<TypeId>` throughout the `TypeConstructor` /
  `ITypeRegistry` API for Roblox (Luau) compatibility. The spec used JS
  arrays in its interface snippets.
- `autoInstantiated?: boolean` flag chosen for detection (spec listed this
  as one of two options; the other was pattern-matching on type names).

**All acceptance criteria passed.** All builds (Node, Roblox-TS) succeed.
463 core tests pass, 131 typescript tests pass.

### Phase 3: Union types (completed 2026-03-22)

**Planned vs actual:**

All 8 concrete deliverables were delivered as specified. Two unplanned additions
were required:

1. `expandTypeIdMembers()` does not expand nullable types to `[base, Nil]` for
   operator resolution. The spec said to generalize `unwrapNullableTypeId()`, but
   nullable expansion for operators was already handled by the Phase 1 fallback.
   `expandTypeIdMembers()` returns the base type only (not `[base, Nil]`) for
   nullable, matching the Phase 1 behavior. Unions are fully expanded.

2. `resolveOperatorWithExpansion()` added as a cross-product fallback. The spec's
   risk section noted that ambiguous overloads (different return types per member)
   should fall back to `Any`. The implementation is stricter: if any member pair
   resolves to a different overload function name than the others, the expansion
   returns `undefined` and the caller emits a diagnostic. All three operator
   lowering sites (binary, compound assignment, unary `!`) use this function.

**Silent failure fix (post-review):**

- `tsTypeToTypeId()` union branch: when all union members deduplicated to a single
  TypeId (e.g., `string | string`), the `deduped.size >= 2` guard failed and the
  function fell through to symbol resolution instead of returning the collapsed
  type. Added a `deduped.size === 1` branch to return the single member directly.

**Design doc alignment:**

- The design doc's `UnionTypeShape`, `UnionTypeDef`, and `UnionCodec` descriptions
  matched the implementation exactly. No amendments needed.
- Nullable subsumption (delegate `[T, Nil]` to `addNullableType`) implemented as
  specified in both the spec and design doc.

**Not changed (spec mentioned but unnecessary):**

- Core `operators.ts` and `conversions.ts` -- operator resolution for unions
  handled entirely in the TS compiler's lowering pass, as spec intended.
- Brain compiler (`InferredTypesVisitor`) -- not touched, as spec intended.

**All acceptance criteria passed.** All builds (Node, Roblox-TS) succeed.
Sim app builds (`vite build` + `tsc --noEmit`). 481 core tests pass (18 new),
135 typescript tests pass (4 new).

**Known limitation -- struct unions:**

`UnionCodec.findMemberIndex()` identifies members by primitive type checks only
(`TypeUtils.isBoolean`, `isNumber`, `isString`, nil check). Unions of struct types
(e.g., `Vector2 | Color3`) compile correctly (TypeIds resolve, union TypeId is
created) but fail at runtime because `findMemberIndex` cannot identify struct
values -- they fall through to `return -1` and `encode()` throws. Supporting struct
members requires the codec to inspect the value's type identity (e.g., a `typeId`
field on struct values or a registry lookup). A future phase must extend
`findMemberIndex` to handle `NativeType.Struct` (and potentially `List`, `Map`,
and other composite types) for full union support.

### Phase 4: `typeof` lowering (completed 2026-03-22)

**Planned vs actual:**

All 5 concrete deliverables were delivered as specified. No unplanned additions
were required -- the implementation matched the spec closely.

1. `Op.TYPE_CHECK = 150` added to the `Op` enum.
2. `execTypeCheck` in the VM: pops value, compares `value.t === instr.a`, pushes
   `TRUE_VALUE` or `FALSE_VALUE`.
3. `IrTypeCheck` IR node with `nativeType: number` field.
4. `lowerTypeofComparison()` detects `typeof x === "string"` and reversed
   `"string" === typeof x` patterns. Supports `===`, `!==`, `==`, `!=`.
   Negation for `!==`/`!=` reuses `CoreOpId.Not` on boolean.
5. End-to-end tests: `typeof` checks compile, run, and produce correct booleans.

**Design decisions matching spec recommendations:**

- `"object"` rejected with a diagnostic per the spec's "safest initial approach"
  recommendation. Only `"number"`, `"string"`, `"boolean"`, `"undefined"` are
  supported.
- `TYPE_CHECK` opcode chosen over alternatives (TYPEOF string push + equality,
  inline host call sequence) per the design doc's recommendation for efficiency
  (single instruction, integer compare, no allocation).
- TypeScript AST models `typeof x` as `TypeOfExpression`, not
  `PrefixUnaryExpression`. The spec described it as a "typeof unary expression"
  which was slightly imprecise but did not cause issues -- `ts.isTypeOfExpression`
  was the correct API.

**Not changed (spec mentioned but unnecessary):**

- No changes to the brain compiler -- `typeof` is a TS-compiler-only feature.
- No updates to `core-type-system-evolution.md` -- the design doc already listed
  `TYPE_CHECK` as the preferred approach and the implementation matched exactly.

**All acceptance criteria passed.** All builds (Node, ESM, Roblox-TS) succeed.
Sim app builds. 487 core tests pass (6 new), 141 typescript tests pass (6 new).

**End-to-end AnyList narrowing test not included.** The spec's acceptance criteria
included an `AnyList` narrowing test (`const arr: AnyList = [1, "hello"]`). This
was not tested because `AnyList` indexing (producing an `any`-typed element from a
list access) requires additional lowering support beyond `typeof`. The simpler
test using `typeof params.val` on a known-typed parameter exercises the same
codepath. AnyList narrowing will be testable after further list-access lowering
work.

### Phase 5 -- 2026-03-22

**Status:** Complete. All acceptance criteria met.

**Deliverables -- planned vs actual:**

| Planned                                                            | Actual | Notes                                                                                                               |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `NativeType.Function = 11` in enum                                 | Done   | Follows `Union = 10` from Phase 3                                                                                   |
| `FunctionValue` type in `Value` union                              | Done   | `{ t: NativeType.Function; funcId: number }`                                                                        |
| `mkFunctionValue(funcId)` factory + `isFunctionValue` guard        | Done   | --                                                                                                                  |
| `Op.CALL_INDIRECT = 160` with `execCallIndirect`                   | Done   | Pops argc args (reverse order), pops FunctionValue, validates type and bounds, pushes new frame                     |
| `FunctionCodec` (non-serializable)                                 | Done   | `encode`/`decode` throw; `stringify` returns `<function:N>`. Uses `undefined` (not `null`) for Roblox compatibility |
| `V.func(funcId)` factory                                           | Done   | --                                                                                                                  |
| `addFunctionType(name)` on `ITypeRegistry`/`TypeRegistry`          | Done   | Registered in `registerCoreTypes()`                                                                                 |
| `IrPushFunctionRef` + `IrCallIndirect` IR nodes                    | Done   | --                                                                                                                  |
| `PushFunctionRef` emit: resolves name -> funcId via function table | Done   | `emitFunction` takes optional `functionTable` parameter                                                             |
| `CallIndirect` emit: emits `Op.CALL_INDIRECT`                      | Done   | --                                                                                                                  |
| `lowerIdentifier` function ref detection                           | Done   | After param/local/callsiteVar checks, falls through to function table lookup                                        |
| `lowerCallExpression` indirect call detection                      | Done   | Uses `getCallSignatures().length > 0` to detect callable callee; early bail-out if callee lowering produces no IR   |
| `tsTypeToTypeId` for function types                                | Done   | `getCallSignatures().length > 0` -> `CoreTypeIds.Function`                                                          |
| `typeofStringToNativeType` for `"function"`                        | Done   | --                                                                                                                  |
| Linker `FunctionValue` constant remapping                          | Done   | `funcId + funcOffset` for all `isFunctionValue` constants                                                           |
| `deepCopyValue` for `FunctionValue`                                | Done   | Immutable, returned as-is                                                                                           |
| `isTruthy` for `FunctionValue`                                     | Done   | Returns `true`                                                                                                      |
| End-to-end: passing named function as argument + `CALL_INDIRECT`   | Done   | Two codegen tests, one linker test                                                                                  |

**Acceptance criteria results:**

| Criterion                                                   | Result              |
| ----------------------------------------------------------- | ------------------- |
| `mkFunctionValue(42)` creates FunctionValue                 | Pass                |
| `isFunctionValue` type guard works                          | Pass                |
| `CALL_INDIRECT` with argc=2 pops 2 args + 1 function ref    | Pass                |
| `CALL_INDIRECT` with non-FunctionValue throws runtime error | Pass (FAULT status) |
| `FunctionCodec.encode` throws with clear error              | Pass                |
| `FunctionCodec.stringify` returns descriptive string        | Pass                |
| End-to-end `apply(double, 5)` -> 10                         | Pass                |
| `deepCopyValue` for FunctionValue returns same value        | Pass                |
| `npm run check` passes in core and typescript               | Pass                |
| `npm run build` (including Roblox) passes                   | Pass                |

**Test counts:**

- packages/core: 493 total (487 prev + 6 new), 0 failures
- packages/typescript: 144 total (141 prev + 2 codegen + 1 linker), 0 failures

**Discoveries and deviations:**

1. **`typeof x === "function"` now supported.** Phase 4 rejected `"function"` as an
   unsupported typeof string. Phase 5 added `NativeType.Function` to
   `typeofStringToNativeType`, so `typeof x === "function"` now compiles to
   `TYPE_CHECK(NativeType.Function)`. Only `"object"` remains rejected.

2. **Async function references not supported.** `FunctionValue` carries only `funcId`
   with no async flag. No `CALL_INDIRECT_ASYNC` opcode exists. Async semantics only
   apply to host functions (`HOST_CALL_ARGS_ASYNC` / `HostAsyncFn`). Storing an async
   user-defined function in a variable and calling it indirectly would execute it
   synchronously with no suspension. This is a known gap for future work.

3. **CallIndirect bail-out on failed callee lowering.** Added an `ir.length` check
   before/after lowering the callee expression. If the callee produces no IR (e.g.,
   undefined variable -- diagnostic already pushed by `lowerIdentifier`), the
   `CallIndirect` emission is skipped to prevent stack corruption. This is a localized
   fix; the broader pattern of `lowerExpression` not signaling failure to callers
   exists elsewhere in the compiler.

4. **FunctionCodec uses `undefined` only (no `null`).** Roblox Luau does not support
   `null`, only `nil` (mapped to `undefined`). The `FunctionCodec.stringify` check
   uses `value !== undefined` rather than `value !== null`.

5. **`tsconfig.node.json` excludes `*.spec.ts` from type-checking.** A type error in
   `vm.spec.ts` (generic `getVariable` signature mismatch) was not caught by
   `npm run typecheck`. Fixed manually during review. Spec files are only
   type-checked by the IDE, not by the CI pipeline.

6. **Design doc NativeType numbering.** `core-type-system-evolution.md` says
   `NativeType.Function = 10`. Actual value is `11` because `Union = 10` was added
   in Phase 3. Noted with dated amendment in the design doc.

**Not changed (spec mentioned but unnecessary):**

- No changes to `ambient.ts` -- function types in ambient declarations are Phase 7.
- No changes to the brain compiler -- function references are a TS-compiler-only feature.

### Phase 6: Closures (completed 2026-03-22)

**Planned vs actual:**

| Planned                                                        | Actual  | Notes                                                                                                                         |
| -------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `MAKE_CLOSURE` opcode                                          | Done    | `Op.MAKE_CLOSURE = 170`, operand `a` = funcId, operand `b` = captureCount                                                     |
| `LOAD_CAPTURE` opcode                                          | Done    | `Op.LOAD_CAPTURE = 171`, operand `a` = capture slot index                                                                     |
| `STORE_CAPTURE` opcode                                         | Skipped | Capture-by-value semantics -- captures are immutable snapshots, no mutation needed                                            |
| `FunctionValue` extended with optional `captures`              | Done    | `captures?: List<Value>` on `FunctionValue`; `mkFunctionValue` accepts optional captures                                      |
| `Frame` extended with optional `captures`                      | Done    | `captures?: List<Value>` on `Frame`                                                                                           |
| Capture analysis in the lowering pass                          | Done    | `findCapturedVariables()` uses TS checker `getSymbolAtLocation` + `isDescendantOf` for declaration scope checking             |
| Arrow functions and inner function expressions compile/execute | Done    | Both `ts.isArrowFunction` and `ts.isFunctionExpression` handled via `lowerClosureExpression`                                  |
| `ScopeStack` capture tracking                                  | Skipped | Capture analysis done externally; `ScopeStack` not modified. Capture slots tracked in `LowerContext.capturedVars` Map instead |
| `IrMakeClosure` IR node                                        | Done    | `{ kind: "MakeClosure"; funcName: string; captureCount: number }`                                                             |
| `IrLoadCapture` IR node                                        | Done    | `{ kind: "LoadCapture"; index: number }`                                                                                      |
| `IrStoreCapture` IR node                                       | Skipped | Not needed -- no mutable captures                                                                                             |
| Emit new IR nodes as opcodes                                   | Done    | `MakeClosure` resolves funcName via functionTable; `LoadCapture` emits directly                                               |
| Linker remaps `MAKE_CLOSURE` funcId                            | Done    | Added alongside `Op.CALL` in `remapInstructions`                                                                              |
| End-to-end: `items.filter(x => x > threshold)`                 | Partial | Direct closure tests pass; `.filter` method not yet available on lists                                                        |

**Deviations from spec:**

1. **No `STORE_CAPTURE` opcode.** The spec listed `STORE_CAPTURE` as a deliverable
   but also noted in the Key Risks section that it could be omitted for
   capture-by-value semantics. Capture-by-value was chosen: closures snapshot
   variables at creation time; mutations to the original variable do not affect
   the closure's copy. This simplifies the implementation and avoids shared
   mutable state.

2. **No `ScopeStack` modification.** The spec suggested extending `ScopeStack` with
   capture tracking. Instead, capture analysis is done externally by
   `findCapturedVariables()` which walks the closure body and checks each identifier
   against the enclosing context's `paramLocals`, `scopeStack`, and `capturedVars`.
   The captured variable map is stored on `LowerContext.capturedVars` and consulted
   by `lowerIdentifier` when resolving names.

3. **Extended `FunctionValue` rather than separate `ClosureValue`.** The spec offered
   this as an option ("prefer extending `FunctionValue`"). `FunctionValue` gained an
   optional `captures?: List<Value>` field. A closure with zero captures emits
   `PushFunctionRef` (no `MAKE_CLOSURE` overhead).

4. **`LowerContext` extended with shared mutable state.** `funcIdCounter` is a
   `{ value: number }` object shared across all lowering calls so that closure
   funcIds don't collide with static function IDs. `closureFunctions` is a
   `Map<number, FunctionEntry>` that accumulates closure function entries, sorted
   by funcId and appended after static functions at the end of `lowerProgram`.

5. **Closure functions use TS checker for scope analysis.** Rather than tracking
   free/bound variables manually, `findCapturedVariables` uses
   `checker.getSymbolAtLocation()` to get the symbol for each identifier, then
   `isDescendantOf(decl, closureNode)` to determine whether the declaration is
   inside the closure (skip) or in an enclosing scope (capture). This leverages
   the TS compiler's existing symbol resolution.

**Dead code removed (post-review):**

- `CaptureInfo.source` had a `"callsiteVar"` variant that was never produced by
  `findCapturedVariables`. Callsite variables don't need capturing -- they're
  module-level state accessed directly via `LoadCallsiteVar` through the shared
  `callsiteVars` map on `LowerContext`. The dead variant and its switch case were
  removed.

**Acceptance criteria results:**

| Criterion                                                        | Result |
| ---------------------------------------------------------------- | ------ |
| `MAKE_CLOSURE` creates FunctionValue with correct captures       | Pass   |
| `LOAD_CAPTURE` reads the correct captured value                  | Pass   |
| `CALL_INDIRECT` on closure attaches captures to new frame        | Pass   |
| Simple closure: `makeAdder(5)(3)` -> 8                           | Pass   |
| Closure over multiple variables                                  | Pass   |
| Capture-by-value: mutation after creation doesn't affect closure | Pass   |
| `LOAD_CAPTURE` out of bounds faults                              | Pass   |
| Arrow with no captures emits `PushFunctionRef` (no overhead)     | Pass   |
| Concise arrow body (expression, not block)                       | Pass   |
| `npm run check` passes (core + typescript)                       | Pass   |
| `npm run build` (Node + ESM + Roblox-TS) passes                  | Pass   |
| Sim app builds                                                   | Pass   |

**Test counts:**

- packages/core: 498 total (493 prev + 5 new VM tests), 0 failures
- packages/typescript: 149 total (144 prev + 5 new codegen tests), 0 failures

**Discoveries:**

1. **Callsite variables don't need capturing.** They are module-level state shared
   via the `callsiteVars` map on `LowerContext`. The closure's `LowerContext` inherits
   the same `callsiteVars` map, so `lowerIdentifier` resolves them directly via
   `LoadCallsiteVar`. No snapshot/capture semantics needed.

2. **Nested closure transitive captures work.** A closure inside a closure captures
   from the outer closure's `capturedVars` map (source: `"capture"`, emitting
   `LoadCapture` to push the value before `MAKE_CLOSURE`). The inner closure gets
   its own `capturedVars` map. This is tested implicitly via the shared `funcIdCounter`
   and `closureFunctions` map.

3. **Closure funcId ordering matters.** Closure functions are assigned funcIds
   during lowering (when encountered in expression position), which may interleave
   with other funcIds. The `closureFunctions` map is sorted by funcId before
   appending to ensure correct array indexing in the final function list.

4. **`PushFunctionRef` vs `MAKE_CLOSURE` optimization.** Arrows with no captured
   variables emit `PushFunctionRef` instead of `MAKE_CLOSURE(funcId, 0)`. This
   avoids creating an unnecessary captures list. The closure body is still compiled
   as a separate function entry either way.

5. **`findCapturedVariables` silent drop for unknown identifiers.** If an identifier
   inside a closure body has no symbol (checker returns `undefined`) and does not
   appear in any of the lookup maps (`paramLocals`, `scopeStack`, `capturedVars`),
   it is silently skipped in capture analysis. This is benign: `lowerIdentifier` will
   later emit a diagnostic ("Undefined variable") when compiling the closure body.
   But the capture analysis itself produces no warning for unresolvable names.
