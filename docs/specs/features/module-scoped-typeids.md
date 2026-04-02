# Module-Scoped TypeIds

Design and implementation plan for scoping user-defined TypeIds by source module,
enabling multiple files to define classes with the same name without collision in
the global type registry.

Companion to [class-support.md](class-support.md). Blocks C4 (multi-file class
support). Replaces C3.5 deliverables D3/D4 (type registry scoping).

---

## Workflow Convention

Same loop as [class-support.md](class-support.md) and
[typescript-compiler-phased-impl-p2.md](typescript-compiler-phased-impl-p2.md).
Phases numbered M1-M3.

---

## Problem Statement

The type registry (`getBrainServices().types`) is a global flat namespace.
`nameToId` maps `"Foo"` to `"struct:<Foo>"`. This creates three problems:

1. **Cross-compilation leakage.** Types registered during one `compileAll()` call
   persist into the next. A class deleted from source remains in the registry
   until the app restarts.

2. **Same-name collision.** If `a.ts` defines `class Foo { x: number }` and
   `b.ts` defines `class Foo { name: string }`, whichever registers first wins.
   The second is silently skipped via the `resolveByName` guard in
   `registerClassStructType`.

3. **Stale shape.** If a user modifies a class (adds/removes fields or methods)
   and recompiles, the old registration persists and the new shape is silently
   dropped.

All three problems must be solved together. Problem 1 requires cleanup between
compilations. Problem 2 requires unique registration keys. Problem 3 is solved
by the combination of 1 and 2.

---

## Architecture Context

### TypeId format

```
mkTypeId(NativeType.Struct, "Foo")  ->  "struct:<Foo>"
```

TypeId is `string` (branded type alias). Constructed by `mkTypeId` in
`packages/core/src/brain/interfaces/core-types.ts`. The string is opaque to all
downstream consumers -- emit, constant pool, bytecode, and VM.

### TypeId lifecycle

```
Source: class Foo { x: number }
    |
    v
Lowering (registerClassStructType):
    registry.addStructType("Foo", { fields, methods })
    -> typeId = "struct:<Foo>"
    |
    v
IR: StructNew(typeId = "struct:<Foo>")
    |
    v
Emit: pool.add(mkStringValue("struct:<Foo>"))  ->  constant pool index
    Bytecode: STRUCT_NEW b=<poolIdx>
    |
    v
VM: constants.get(ins.b).v  ->  "struct:<Foo>"
    V.struct(fields, "struct:<Foo>")
    |
    v
Runtime: GET_FIELD reads source.typeId -> types.get("struct:<Foo>")
    -> dispatches to fieldGetter/fieldSetter if registered, else direct Dict access
```

Key property: **every stage after `mkTypeId` treats TypeId as an opaque string.**
Changing the string format propagates automatically with zero downstream changes.

### Registry consumers

| Consumer | What it does with TypeId | Location |
|----------|--------------------------|----------|
| `addStructType` | Stores TypeDef keyed by TypeId | type-system.ts L267 |
| `get(typeId)` | O(1) lookup for TypeDef | type-system.ts L475 |
| `resolveByName(name)` | Maps human name -> TypeId | type-system.ts L479 |
| `isStructurallyCompatible` | Compares two TypeIds | type-system.ts L511 |
| `STRUCT_NEW` | Reads TypeId from constant pool | vm.ts L1368 |
| `GET_FIELD` / `SET_FIELD` | Reads `source.typeId`, looks up TypeDef | vm.ts L1455, L1485 |
| `deepCopyValue` | Reads `v.typeId` for snapshot hook | vm.ts L205 |
| `injectCtxTypeId` | Prepends context struct to args | vm.ts L396 |
| `registration-bridge.ts` | `types.resolveByName(p.type)` for param types | registration-bridge.ts L13 |
| `project.ts` | `types.resolveByName(descriptor.outputType)` | project.ts L242 |
| `extractDescriptor` | Extracts param/output type names from source | lowering.ts (via descriptor) |
| `StructCodec` | Serializes struct fields using per-field codecs | type-system.ts L267 |

### Host vs user types

Host-registered types (Context, Vector2, ActorRef, etc.) have distinguishing
properties on their `StructTypeDef`:

- `fieldGetter` / `fieldSetter` -- native field access hooks
- `snapshotNative` -- deep copy hook for native handles
- `nominal: true` -- opt out of structural compatibility

User-defined class types have none of these. This heuristic reliably
distinguishes the two categories.

### Compilation entry points

All compilation goes through `UserTileProject.compileAll()`:

- `apps/sim` calls `compileAll()` after every file mutation
- `compileUserTile()` in `compile.ts` creates a single-file project and calls
  `compileAll()`
- There is no single-file compilation path

### File path format

| Context | Format | Example |
|---------|--------|---------|
| `compilerFiles` keys | Leading `/` | `/user-code.ts`, `/src/sensors/MySensor.ts` |
| `_files` keys (VFS) | No leading `/` | `user-code.ts`, `sensors/MySensor.ts` |
| `sourceFile.fileName` | Leading `/` | `/user-code.ts` |
| `moduleInitOrder` | Leading `/` | `["/helpers.ts", "/user-code.ts"]` |

---

## Design

### Module-qualified names

Register user-defined class types with a module-qualified name instead of a bare
class name:

```
Current:    "Foo"           ->  typeId = "struct:<Foo>"
Proposed:   "/a.ts::Foo"    ->  typeId = "struct:</a.ts::Foo>"
```

The module path is derived from `sourceFile.fileName` (compiler path format,
always starts with `/`). The separator `::` is chosen because it cannot appear
in TypeScript identifiers or file paths.

### Deriving the qualified name

Every site that registers or resolves a user-defined type already has access to
the TS type checker. The checker can resolve any type reference to its declaring
source file:

```
type.getSymbol().getDeclarations()[0].getSourceFile().fileName
```

This works transparently for cross-file references. When `b.ts` imports `Foo`
from `a.ts`, `checker.getTypeAtLocation(someVarTypedAsFoo)` returns a type whose
symbol declarations point to `a.ts`. So `tsTypeToTypeId` naturally derives
`"/a.ts::Foo"` regardless of which file is being compiled.

### Host types are unchanged

Host-registered types continue to use bare names (`"Context"`, `"Vector2"`,
etc.). They are registered during `registerCoreBrainComponents()` before any
compilation runs. The qualified-name logic only applies when:

1. The type is being registered by `registerClassStructType` (user code), or
2. The type is being resolved by `tsTypeToTypeId` / `resolveStructType` and the
   symbol's declaration is in a user file (not a `.d.ts` ambient)

For case 2: if the symbol is declared in a `.d.ts` file, use the bare symbol
name (existing behavior). If declared in a `.ts` user file, use the qualified
name.

### Pre-compilation cleanup

Before each `compileAll()` call, remove all user-registered struct types from the
registry. This handles stale types from previous compilations (deleted classes,
renamed classes, changed shapes).

Detection: iterate all registered types; remove those where `coreType` is
`NativeType.Struct` and none of `fieldGetter`, `fieldSetter`, `snapshotNative`,
or `nominal` are set.

### Descriptor param/output types

`extractDescriptor` extracts parameter and output type names from the source
(e.g., `params: { distance: { type: "number" } }` or inferred return types).
For user-defined class types used as parameter or output types, the descriptor
must carry the qualified name so that `registration-bridge.ts` can resolve it.

Currently `extractDescriptor` emits bare type names. It will need the checker
and source file context to derive qualified names for class-typed parameters.

### resolveByName callers outside the compiler

Two sites:

1. **`registration-bridge.ts` L13:** `types.resolveByName(p.type)` where `p.type`
   comes from `program.params[].type`. This string comes from
   `extractDescriptor`, so it will carry the qualified name after that function
   is updated.

2. **`project.ts` L242:** `types.resolveByName(descriptor.outputType)` -- same
   pattern, descriptor-driven.

Both are compiler-produced strings, not user-facing. No breaking change.

---

## Phases

### Phase M1: Registry Cleanup (User Type Wipe)

**Objective:** Ensure stale user types do not persist across compilations.

**Packages/files touched:**

- `packages/core/src/brain/runtime/type-system.ts` -- add `removeUserTypes()`
  method.
- `packages/core/src/brain/interfaces/type-system.ts` -- add
  `removeUserTypes()` to `ITypeRegistry` interface.
- `packages/typescript/src/compiler/project.ts` -- call `removeUserTypes()`
  at the start of `compileAll()` (or in the private `_compile` method, before
  the per-file loop).

**Concrete deliverables:**

1. **`removeUserTypes()` on `TypeRegistry`.** Iterates `defs`, removes entries
   where `coreType === NativeType.Struct` and `fieldGetter`, `fieldSetter`,
   `snapshotNative`, and `nominal` are all absent/falsy. Also removes the
   corresponding `nameToId` entry and clears `compatCache`.

2. **Call site in `_compile()`.** Before the `for (const entry of entries)` loop
   that compiles each file, call `getBrainServices().types.removeUserTypes()`.

3. **`registerClassStructType` guard behavior.** Keep the silent-return guard
   (`if (existing) return`). After cleanup, it serves the legitimate purpose of
   deduplication when multiple files in the same batch import and register the
   same class from a shared source.

**Acceptance criteria:**

- Test: register a user struct type, call `removeUserTypes()`, verify it is gone
  from both `get()` and `resolveByName()`.
- Test: register a host struct type (with `fieldGetter`), call
  `removeUserTypes()`, verify it survives.
- Test: compile a class, recompile with a different shape, verify the new shape
  is registered (not the old one).
- Existing tests continue to pass.

**Key risks:**

- **Host type identification heuristic.** Must validate against all registered
  host types in the sim app. A false positive (removing a host type) would be
  catastrophic.
- **Test isolation.** The test suite shares a global `getBrainServices()`. If
  tests register user struct types, cleanup between tests may be needed. Or
  the tests already work because they use unique names.

**Complexity:** Low. Small, well-scoped change to one class and one call site.

---

### Phase M2: Module-Qualified TypeId Registration

**Objective:** Register user-defined class types with module-qualified names so
that same-named classes in different files get distinct TypeIds.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- update
  `registerClassStructType`, `resolveStructType`, `tsTypeToTypeId` to use
  qualified names for user types.

**Concrete deliverables:**

1. **Helper: `qualifiedClassName(classNode, sourceFile)`.** Derives the
   module-qualified name: `${sourceFile.fileName}::${className}`. Example:
   `/tiles/a.ts::Foo`. Used by registration and resolution.

2. **Update `registerClassStructType`.** Change from:
   ```
   registry.addStructType(ci.name, { fields, methods })
   ```
   to:
   ```
   const qualName = qualifiedClassName(ci.node, ci.sourceFile);
   registry.addStructType(qualName, { fields, methods })
   ```
   Requires adding `sourceFile: ts.SourceFile` to `ClassInfo`.

3. **Update `resolveStructType`.** When the TS symbol's declaration is in a user
   `.ts` file (not `.d.ts`), look up `registry.resolveByName(qualifiedName)`
   instead of `registry.resolveByName(bareSymName)`. Detection: check
   `declaration.getSourceFile().fileName` does not end with `.d.ts`.

4. **Update `tsTypeToTypeId`.** Same logic as `resolveStructType` -- for
   struct-like types declared in user `.ts` files, resolve using qualified name.
   For types declared in `.d.ts` (host types), continue using bare name.

5. **Update `lowerNewExpression`.** The constructor key `"ClassName$new"` in
   `functionTable` does not change (it is per-compilation-unit and already
   scoped). But the resolved TypeId used in `StructNew` must be the qualified
   name. Verify this flows correctly from `registerClassStructType` through to
   `lowerClassDeclaration`.

6. **Update `lowerStructMethodCall`.** Method lookup key
   `"ClassName.methodName"` in `functionTable` does not change. But when looking
   up the struct type for method signature validation, use the qualified name.

**Acceptance criteria:**

- Test: two files each define `class Foo` with different fields. Both compile
  without collision. Each file's `Foo` gets a distinct TypeId.
- Test: file a.ts defines `class Foo`. File b.ts imports `Foo` from a.ts and
  uses it. The resolved TypeId in b.ts matches a.ts's registration.
- Test: host struct type (e.g., from ambient `.d.ts`) resolves with bare name
  as before.
- Existing single-file class tests continue to pass (the single file still
  gets a qualified name, e.g., `"/user-code.ts::Point"`).

**Key risks:**

- **TS checker symbol resolution edge cases.** Union types, type aliases,
  re-exports -- must ensure the declaration source file is always reachable.
  The fallback for unresolvable declarations should be the bare name (graceful
  degradation to current behavior).
- **`functionTable` key format.** Constructor and method keys in `functionTable`
  use bare class names (`Point$new`, `Point.move`). These are per-compilation-
  unit and never cross file boundaries, so they don't need qualification. But
  C4 (multi-file class support) will need to address this when classes from
  imported files need function table entries in the importing module.
- **Ambient generation.** `buildAmbientDeclarations()` generates interfaces
  from registered struct types. Interface names in `.d.ts` cannot contain `::`
  or `/`. The ambient generator must strip the module prefix and emit the bare
  class name. This is safe because ambient declarations are per-project (the
  compiler generates one `.d.ts` for the whole project), and same-named classes
  from different modules would need different interface names. This is a C4
  concern -- punt to that phase.

**Complexity:** Medium. The main work is threading source file context through
type resolution functions. The TS checker does the heavy lifting for cross-file
references.

---

### Phase M3: Descriptor Qualified Types

**Objective:** Ensure that class-typed parameter and output types in
`ExtractedDescriptor` carry qualified names, so that
`registration-bridge.ts` can resolve them in the type registry.

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` or wherever
  `extractDescriptor` lives -- update param/output type name extraction.
- `packages/typescript/src/compiler/project.ts` -- verify
  `resolveByName(descriptor.outputType)` works with qualified names.

**Concrete deliverables:**

1. **Update param type resolution in `extractDescriptor`.** When a parameter
   type refers to a user-defined class (declared in a `.ts` file), emit the
   qualified name instead of the bare name. For primitive types and host types,
   continue emitting bare names.

2. **Update output type resolution.** Same treatment for the descriptor's
   `outputType` field.

3. **Verify `registration-bridge.ts`.** Confirm that `types.resolveByName(p.type)`
   correctly resolves qualified names passed through from the descriptor.

**Acceptance criteria:**

- Test: user tile with a class-typed parameter compiles and the descriptor
  carries the qualified type name.
- Test: user tile returning a class-typed value has the correct qualified
  output type.
- `registration-bridge.ts` resolves the qualified name and creates the
  parameter tile definition.

**Key risks:**

- **User-facing type names.** If qualified type names leak into UI-facing
  contexts (tile labels, parameter descriptions), they would look ugly
  (`/tiles/a.ts::Foo`). Verify that display names are derived from the bare
  class name, not the qualified TypeId.

**Complexity:** Low. Localized change in the descriptor extraction, piping
through existing infrastructure.

---

## Relationship to C3.5

C3.5 in class-support.md covers three concerns:

1. **Export-only collection in `collectImports`** -- remains in C3.5, unchanged.
2. **Collision diagnostic for duplicate exports** -- remains in C3.5, unchanged.
3. **Type registry scoping (D3/D4)** -- replaced by this spec (M1 + M2).

After this spec is implemented, C3.5 retains deliverables D1 and D2 only.

---

## Implementation Order

Recommended sequence:

1. **M1 (Registry cleanup)** -- smallest change, immediately fixes problem 1
   (stale types) and problem 3 (stale shapes). Can be done independently.

2. **C3.5 D1+D2 (Export filtering + collision diagnostics)** -- fixes function
   and variable collisions. Independent of M2.

3. **M2 (Module-qualified TypeIds)** -- fixes problem 2 (same-name classes).
   Depends on M1 (cleanup ensures fresh state). Can be done before or after
   C3.5 D1+D2.

4. **M3 (Descriptor qualified types)** -- depends on M2. Required before
   class-typed parameters/outputs work in the registration bridge.

5. **C4 (Multi-file class support)** -- depends on M1, M2, and C3.5 D1+D2.

M1 and C3.5 D1+D2 are independently valuable and can ship in any order. M2
depends on M1. M3 depends on M2.

---

## Phase Log

(To be filled in during post-mortem after each phase.)
