# TypeScript Enum Support -- Phased Implementation Plan

**Status:** E1 complete, E2 pending
**Created:** 2026-04-04
**Related:**

- [core-type-system-phased-impl.md](core-type-system-phased-impl.md)
- [typescript-compiler-phased-impl-p2.md](typescript-compiler-phased-impl-p2.md)
- [user-authored-sensors-actuators.md](user-authored-sensors-actuators.md)

Focused on three linked changes:

1. Expanding Mindcraft's core enum representation so numeric-enum behavior can be modeled.
2. Making the TypeScript lowering pass conversion-aware in the same spirit as the tile-language compiler.
3. Adding user-authored TypeScript enum declarations and enum-member lowering.

This plan is intentionally separate from the large archived compiler plans. The goal is
to keep enum work reviewable and phase-sized.

---

## Workflow Convention

Phases here are numbered E1-E5.

Each phase follows this loop:

1. **Kick off** -- "Implement Phase EX." The implementer reads this doc, the relevant
   parent plans, and any instruction files before writing code. After implementation,
   STOP and present the work for review. Do not write the Phase Log entry, amend this
   plan, or perform post-mortem activity.
2. **Review + refine** -- Followup prompts within the same conversation.
3. **Declare done** -- "Phase EX is complete." Only the user can declare a phase
   complete.
4. **Post-mortem** -- "Run post-mortem for Phase EX." This step:
   - Diffs planned deliverables vs actual implementation.
   - Records the outcome in the Phase Log at the bottom of this doc.
   - Propagates discoveries into later phases.
   - Writes any repo memory notes if useful.
5. **Next phase** -- New conversation or same conversation if context remains.

The planning doc is the source of truth across conversations. Session memory does not
survive. Keep this doc current.

---

## Current State

- (Updated 2026-04-04) Phase E1 is complete. `EnumTypeShape.symbols` and
  `EnumTypeDef.symbols` now carry explicit declared primitive values for each
  enum member.
- `EnumValue` in `packages/core` still stores `typeId` plus the enum member key.
  `ITypeRegistry.getEnumSymbol(typeId, key)` resolves the normalized enum-member
  metadata.
- `TypeRegistry.addEnumType()` requires explicit member values, rejects
  heterogeneous enums, and allows duplicate underlying values.
- `TypeRegistry.addEnumType()` still auto-registers `EqualTo` and `NotEqualTo`
  overloads, but they now compare underlying primitive values within the same enum
  type.
- `EnumCodec.stringify()` now returns the underlying primitive value, not the
  symbolic key.
- Core conversions only cover primitive boolean/number/string conversions.
- The tile-language compiler already uses conversion search for operator inference in
  `packages/core/src/brain/compiler/inferred-types.ts`.
- The TypeScript lowering pass mostly uses exact type/operator matching. It only uses
  conversions in a few bespoke places such as template-literal interpolation and some
  string-building helpers.
- The TypeScript compiler already supports enum-typed string literals for pre-registered
  Mindcraft enum types, but it rejects user-authored `enum` declarations entirely.
- Imported symbols currently include functions, variables, and classes. Imported enums
  are not collected or registered.

---

## Scope and Non-Goals

### In scope

- String enums and numeric enums in user-authored TypeScript.
- Enum-to-string and enum-to-number coercion where the runtime semantics are well-defined.
- Conversion-aware lowering for binary expressions and target-typed sites.
- Imported enums, aliased enum imports, and enum member access.

### Out of scope for this plan

- Heterogeneous enums (`string` and `number` values mixed in one enum).
- JavaScript-style runtime enum object reflection such as `Object.keys(E)`, `for (const k in E)`,
  or reverse lookup like `E[0]`.
- Bitflag helper semantics beyond plain numeric conversion.
- Preserving any old enum serialization format if it conflicts with the cleaner runtime model.

If one of these becomes important, create a detour or follow-on plan rather than stretching
this one.

---

## Phasing Summary

| Phase | Scope | Packages | Effort |
| ----- | ----- | -------- | ------ |
| E1 | Core enum value model | core | Medium |
| E2 | Core enum conversions | core | Small-Medium |
| E3 | Conversion-aware binary lowering | typescript | Medium |
| E4 | Target-typed coercion sites | typescript | Medium |
| E5 | TypeScript enum syntax support | typescript | Medium-Large |

---

## Phase E1: Core Enum Value Model

**Objective:** Expand the core enum type definition so each enum member preserves its
declared underlying runtime value. This phase establishes the runtime semantics needed
for numeric enums before any coercion or TypeScript syntax work lands.

**Packages/files touched:**

- `packages/core/src/brain/interfaces/type-system.ts`
- `packages/core/src/brain/runtime/type-system.ts`
- `packages/core/src/brain/interfaces/vm.ts` if the runtime `EnumValue` shape needs
  to change; prefer not to change it unless lookup-by-key proves insufficient
- `packages/core/src/brain/tiles/literals.ts`
- `packages/core/src/brain/compiler/conversion.spec.ts` and/or new runtime specs

**Design direction:**

- Extend `EnumTypeShape.symbols` entries from `{ key, label, deprecated? }` to
  `{ key, label, value, deprecated? }` where `value` is either `string` or `number`.
- Keep `defaultKey` as the symbolic member key.
- Prefer keeping runtime `EnumValue` keyed by symbolic member key. Resolve the
  underlying primitive through the type registry when needed.
- Update enum equality/inequality semantics to compare declared underlying values,
  not symbolic keys. This matches TypeScript numeric/string enum behavior more closely,
  including duplicate-value members.
- Update enum stringification semantics to stringify the declared underlying value,
  not the symbolic key.
- Reject heterogeneous enums at registration time.

**Concrete deliverables:**

1. `EnumTypeShape` carries the declared underlying primitive for each member.
2. `TypeRegistry.addEnumType()` requires explicit member values, validates
  homogeneous member values, and still permits duplicate primitive values.
3. A helper exists to resolve enum-member metadata from `typeId + key`.
4. Enum `EqualTo` / `NotEqualTo` overloads use underlying primitive semantics.
5. `EnumCodec.stringify()` reflects the underlying primitive semantics.

**Acceptance criteria:**

- Test: string enum type can be registered with explicit string member values.
- Test: numeric enum type can be registered with explicit numeric member values.
- Test: enum registration rejects a member with no declared primitive value.
- Test: heterogeneous enum registration is rejected.
- Test: duplicate numeric values are allowed and compare equal.
- Test: enum stringification returns `"on"` for a string enum member and `"0"` for
  a numeric enum member.
- `npm run check`, `npm run build`, and `npm test` pass in `packages/core`.

**Key risks:**

- Changing enum stringification may affect literal-tile defaults. Review any caller
  that relies on enum keys being displayed verbatim.
- If key-based `EnumValue` proves too awkward, phase E1 may need to extend the runtime
  value shape. Do not do that casually; it will ripple into constants, VM helpers,
  and serialization.

---

## Phase E2: Core Enum Conversions

**Objective:** Register enum conversions in `packages/core` so the runtime can coerce
enum values into primitive `string` or `number` values where the type system allows it.

**Prerequisites:** Phase E1.

**Packages/files touched:**

- `packages/core/src/brain/runtime/conversions.ts`
- `packages/core/src/brain/runtime/type-system.ts`
- `packages/core/src/brain/interfaces/conversions.ts` only if a helper API is needed
- `packages/core/src/brain/compiler/conversion.spec.ts`

**Design direction:**

- Auto-register conversions when an enum type is registered.
- All enums get an enum-to-string conversion that stringifies the underlying primitive.
- Numeric enums also get an enum-to-number conversion.
- Conversion host functions will need to resolve `EnumValue.v` through
  `getEnumSymbol(typeId, key)` because E1 kept `EnumValue` keyed by symbolic member
  name.
- Do not register implicit primitive-to-enum conversions in this phase.
- Keep conversion search single-step for implicit coercion. Do not rely on chained
  implicit conversions such as enum -> number -> string.

**Concrete deliverables:**

1. String enums register enum-to-string conversion.
2. Numeric enums register enum-to-number conversion.
3. Numeric enums also register direct enum-to-string conversion so string contexts do
   not require multi-hop implicit coercion.
4. Conversion registration happens automatically from enum type registration.

**Acceptance criteria:**

- Test: `findBestPath(enumTypeId, CoreTypeIds.String, 1)` returns a direct path.
- Test: `findBestPath(numericEnumTypeId, CoreTypeIds.Number, 1)` returns a direct path.
- Test: executing the registered conversions produces the declared primitive values.
- Test: a string enum does not expose enum-to-number conversion.
- `npm run check`, `npm run build`, and `npm test` pass in `packages/core`.

**Key risks:**

- Conversion registration must not clash with existing host-function names.
- If enum conversion registration lives in `addEnumType()`, ensure it is safe in
  environments where brain services are not fully initialized.

---

## Phase E3: Conversion-Aware Binary Lowering

**Objective:** Make binary operator lowering in `packages/typescript` use conversion
search before failing overload resolution. This establishes the same broad coercion model
already used in the tile-language compiler.

**Prerequisites:** Phase E2.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts`
- `packages/typescript/src/compiler/diag-codes.ts`
- `packages/typescript/src/compiler/codegen.spec.ts`

**Design direction:**

- Mirror the operator-resolution precedence used in
  `packages/core/src/brain/compiler/inferred-types.ts`:
  1. direct overload
  2. right operand converted to left type
  3. left operand converted to right type
- Keep implicit conversion search at `maxDepth = 1`.
- Add a reusable lowering helper that emits the conversion host call when a
  conversion has been selected.
- Prefer direct overloads over conversions even if a cheaper conversion exists.
- Emit a dedicated diagnostic if both conversion directions are viable but resolve to
  different result semantics and the implementation cannot choose unambiguously.

**Concrete deliverables:**

1. Binary operator lowering can apply a single-step conversion to one operand.
2. The lowering has a reusable helper for emitting one conversion host call.
3. Existing string-concat special-casing is reduced where possible in favor of the
   same conversion-aware path.
4. Diagnostics clearly distinguish "no overload" from "ambiguous implicit conversion".

**Acceptance criteria:**

- Test: direct overload still wins when available.
- Test: binary expression succeeds when exactly one operand can be converted to match
  a valid overload.
- Test: binary expression reports a clear diagnostic when no valid direct or converted
  overload exists.
- Test: pre-registered enum value plus string uses enum-to-string conversion rather
  than failing overload resolution.
- `npm run typecheck`, `npm run check`, and `npm test` pass in `packages/typescript`.

**Key risks:**

- Left-to-right stack order matters. Conversions must be emitted without corrupting the
  operand order expected by `HostCallArgs`.
- Conversion-aware lowering should not silently change semantics for existing code that
  already had a direct overload.

---

## Phase E4: Target-Typed Coercion Sites

**Objective:** Apply the same single-step conversion model at target-typed boundaries:
function arguments, return statements, variable initializers, and assignments.

**Prerequisites:** Phase E3.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts`
- `packages/typescript/src/compiler/codegen.spec.ts`
- `packages/typescript/src/compiler/compile.spec.ts` if new diagnostics are needed

**Design direction:**

- Introduce a helper that lowers an expression and then converts it to an expected
  target type when a direct single-step conversion exists.
- Use TS checker information for the expected target type at each boundary.
- Keep coercion single-step and explicit in lowering; do not broaden TypeScript's own
  type system or bypass TS errors.
- Reuse this helper in return statements, assignments, variable initializers, and
  function-call argument lowering.

**Concrete deliverables:**

1. Return statements can insert a conversion to the declared function return type.
2. Variable initializers and simple assignments can insert a conversion to the target type.
3. Function-call arguments can insert a conversion to the declared parameter type.
4. Conversion-aware string helpers (`template literals`, `.join()`) reuse the same
   underlying emission logic where practical.

**Acceptance criteria:**

- Test: returning a pre-registered enum value from a function declared to return
  `string` inserts enum-to-string conversion.
- Test: passing a pre-registered enum value to a `string` parameter inserts
  enum-to-string conversion.
- Test: assigning a pre-registered numeric enum value to a `number` target inserts
  enum-to-number conversion.
- Test: missing conversion at a target-typed boundary produces a clear diagnostic.
- `npm run typecheck`, `npm run check`, and `npm test` pass in `packages/typescript`.

**Key risks:**

- TypeScript already rejects many invalid primitive assignments, so the new coercion
  sites should only activate where TS permits the source expression but the Mindcraft
  runtime value still needs conversion.
- Argument conversion for indirect calls and closures may require extra care if the
  parameter types are not fully recoverable from the checker.

---

## Phase E5: TypeScript Enum Syntax Support

**Objective:** Support user-authored `enum` declarations, imported enums, and enum-member
access in `packages/typescript`, compiling them down onto the enum runtime and coercion
infrastructure established by E1-E4.

**Prerequisites:** Phase E4.

**Packages/files touched:**

- `packages/typescript/src/compiler/validator.ts`
- `packages/typescript/src/compiler/project.ts`
- `packages/typescript/src/compiler/lowering.ts`
- `packages/typescript/src/compiler/compile.spec.ts`
- `packages/typescript/src/compiler/multi-file.spec.ts`
- `packages/typescript/src/compiler/codegen.spec.ts`

**Design direction:**

- Remove the blanket validator rejection for enum declarations.
- Support top-level enum declarations whose member values are compile-time constants
  recoverable from the TS checker via `checker.getConstantValue(member)`.
- For numeric enums, the TypeScript compiler must compute and pass explicit member
  values into `addEnumType()`. The core registry does not infer TS auto-increment
  behavior from omitted values.
- Register user-authored enums before lowering function bodies, using file-qualified
  names where needed to avoid cross-module collisions.
- Extend import collection to include exported enums and aliased enum imports.
- Lower enum member access like `Direction.Up` directly to an enum constant.
- Reuse the existing contextual-literal logic so enum-typed literals become enum values
  rather than raw strings or numbers.
- Continue to reject heterogeneous enums and enum-object reflection patterns.

**Concrete deliverables:**

1. Local top-level string enums compile.
2. Local top-level numeric enums compile, including auto-incremented members.
3. Imported enums compile across files, including aliased imports.
4. Enum member access lowers directly to enum constants.
5. Existing conversion-aware lowering makes common string/number enum usage work
   without special cases.

**Acceptance criteria:**

- Test: local string enum member can be returned, compared, and concatenated in a
  string context.
- Test: local numeric enum member can be compared against numeric contexts and used in
  arithmetic-compatible numeric contexts where appropriate.
- Test: imported enum member works across files.
- Test: aliased enum import works across files.
- Test: heterogeneous enum declaration still produces a diagnostic.
- Test: enum-object reflection patterns that remain unsupported still produce explicit
  diagnostics rather than lowering incorrectly.
- `npm run typecheck`, `npm run check`, and `npm test` pass in `packages/typescript`.

**Key risks:**

- `tsTypeToTypeId()` currently tends to collapse enum-member types to primitive
  `string` or `number` too early. Enum-aware type resolution may need to inspect the
  symbol declarations and parent enum declaration explicitly.
- Imported enums cannot be treated like imported mutable variables. They need their own
  collection/registration path.
- Numeric enum contextual literals are more subtle than string enums. Use TS checker
  constant information rather than hand-rolled initializer evaluation.

---

## Suggested Implementation Order

1. Implement E1 and E2 fully in `packages/core` and stop for review.
2. Implement E3 next so binary-expression coercion semantics are stable.
3. Implement E4 before enum syntax so target-typed enum coercion is already solved.
4. Implement E5 last.

Do not try to land all five phases in one pass. The value model and coercion rules need
to settle before the TypeScript syntax support is reviewed.

---

## Phase Log

### Phase E1 -- 2026-04-04

**Planned vs actual:**

All 5 concrete deliverables were implemented.

- `EnumTypeShape` now carries declared primitive values through `EnumSymbolDef`
  member data.
- `TypeRegistry.addEnumType()` validates homogeneous member values and still permits
  duplicate primitive values.
- A helper exists to resolve enum-member metadata from `typeId + key` via
  `ITypeRegistry.getEnumSymbol()`.
- Enum `EqualTo` / `NotEqualTo` overloads now use underlying primitive semantics.
- `EnumCodec.stringify()` now reflects the underlying primitive semantics.

Two planned files did not need changes:

- `packages/core/src/brain/interfaces/vm.ts` stayed unchanged because the existing
  key-based `EnumValue` shape was sufficient for E1.
- `packages/core/src/brain/tiles/literals.ts` stayed unchanged because it already
  delegates display text to `TypeCodec.stringify()`.

**Unplanned additions:**

1. `TypeRegistry.getEnumSymbol()` was added as shared lookup infrastructure. This will
   also be the natural hook for E2 enum conversions.

**Follow-up cleanup:**

- Removed the temporary omitted-value fallback after confirming backward
  compatibility is not a concern.
- Enum registrations now require explicit `value` fields for every member.

**Design decisions:**

- Kept `EnumValue` unchanged as `{ typeId, key }`, avoiding VM and constant-pool churn
  in E1.
- Equality remains exact by enum type. Different enum types do not compare equal even
  if their underlying primitive values match.
- Duplicate underlying values are allowed and compare equal within the same enum type,
  while serialization still preserves the original symbolic key.

**Files changed:**

- `packages/core/src/brain/interfaces/type-system.ts`
- `packages/core/src/brain/runtime/type-system.ts`
- `packages/core/src/brain/runtime/type-system.spec.ts`

**Verification:**

- `npm run typecheck`
- `npm run check`
- `npm run build`
- `npm test`

**Acceptance criteria result:**

All acceptance criteria passed. Added runtime tests for explicit string and numeric
enum values, missing-value rejection, heterogeneous rejection, duplicate numeric
aliases comparing equal, and underlying-value stringification.