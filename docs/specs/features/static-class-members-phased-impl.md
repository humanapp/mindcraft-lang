# Static Class Members -- Phased Implementation Plan

**Status:** S2 complete
**Created:** 2026-06-15
**Related:**

- [class-support.md](class-support.md)
- [typescript-compiler-phased-impl-p2.md](typescript-compiler-phased-impl-p2.md)
- [typescript-enum-support-phased-impl.md](typescript-enum-support-phased-impl.md)

Adds support for `static` fields and methods on user-defined TypeScript classes.
Static fields are stored as callsite variables (persisted per tile instance, same
as module-level `let`/`const`). Static methods are registered in the function
table with no implicit `this` parameter.

No new VM opcodes are required. The implementation reuses callsite variables for
storage and the existing function table + `Call` opcode for dispatch.

---

## Workflow Convention

Phases here are numbered S1-S7 to avoid collision with the C-series (class
support), D-series (destructuring), and E-series (enums).

Each phase follows this loop:

1. Copilot implements the phase.
2. Copilot stops and presents work for review.
3. The user reviews, requests changes or approves.
4. Only after the user declares the phase complete does the post-mortem happen.
5. Post-mortem writes the Phase Log entry, updates Current State, and any repo
   memory notes.

Do NOT write Phase Log entries or amend this spec during implementation. The
Phase Log is a post-mortem artifact.

---

## Current State

See [class-support.md](class-support.md) "Current State" for the full class
infrastructure inventory. Relevant highlights:

- Classes compile to `StructTypeDef` with typed fields and method declarations.
- Constructors registered as `ClassName$new` in the function table.
- Instance methods registered as `ClassName.methodName` in the function table.
- Instance methods receive `this` as implicit local 0 (argc is user params + 1).
- `extractClassFields` and `extractClassMethodDecls` in lowering.ts skip members
  with the `static` modifier via `hasStaticModifier()` continue guards.
- Validator no longer rejects `static` keyword. The `StaticMembersNotSupported`
  diagnostic (code 1017) is defined but unreferenced.
- `lowerClassDeclaration` skips static members in both its constructor property
  init loop and method body compilation loop.
- Top-level `lowerProgram` function-table registration loops (local and imported
  classes) skip static methods.
- `ClassInfo` has `staticFieldSlots: Map<string, number>` mapping field names to
  callsite var indices.
- Static fields are allocated as callsite vars with qualified names
  (`"ClassName.fieldName"`) in both local and imported class scan blocks.
- `generateModuleInitWithImports` accepts `classInfos` and emits static field
  initialization: initializer expressions are lowered with expected type;
  uninitialized fields get type-appropriate defaults (number->0, boolean->false,
  string->"", else nil). Unresolvable types emit `UnresolvableClassFieldType`.
- `lowerPropertyAccess` dispatches to params, Math, enum, `.length`, struct
  field, and generic TS property paths. No path exists for `ClassName.staticMember`.
- `lowerIdentifier` treats bare `ClassName` as an error ("Undefined variable")
  unless it appears in a `new` expression.
- `resolveStructType` resolves instance types to `StructTypeDef` but does not
  handle constructor types (`typeof ClassName`).
- Callsite variables (`callsiteVars` map) persist across invocations per tile.
- Enum member access (`EnumName.Member`) works via `resolveEnumPropertyAccess`
  which detects the LHS as a type reference rather than a runtime value -- the
  closest existing analog to `ClassName.staticField`.

---

## Scope

### In scope

- `static` fields with explicit type annotations and optional initializers.
- `static` methods.
- Access via `ClassName.staticField` and `ClassName.staticMethod()`.
- Assignment via `ClassName.staticField = value`.
- Compound assignment via `ClassName.staticField += value` (and other compound
  operators).
- Cross-file access: importing a class and accessing its static members.
- Static fields are per-tile-instance (same isolation as module-level variables).

### Out of scope (not planned for this work)

- `static` getters/setters.
- `static` blocks (`static { ... }`).
- Access to static members via an instance (`instance.staticField`).
- Class expressions (remain unsupported).
- Any runtime metadata or reflection for static members.
- StructTypeDef changes -- static members are not part of the struct shape. They
  live in callsite variables and the function table, not on instances.

---

## Compilation Model

A class with static members:

```typescript
class Counter {
  static count: number = 0;

  value: number;

  constructor(value: number) {
    this.value = value;
    Counter.count += 1;
  }

  static reset(): void {
    Counter.count = 0;
  }

  getValue(): number {
    return this.value;
  }
}
```

Compiles as follows:

1. **Type registration.** The `StructTypeDef` for `"Counter"` is registered with
   instance fields only: `[{ name: "value", typeId: "number" }]`. Static fields
   are excluded from the struct shape.

2. **Static field storage.** Each static field gets a callsite variable slot:
   `callsiteVars.set("Counter.count", nextCallsiteVar++)`. The qualified name
   (`ClassName.fieldName`) avoids collisions with module-level variables.

3. **Static field initialization.** During module init (`generateModuleInitWithImports`),
   static field initializers are emitted: evaluate initializer expression, emit
   `StoreCallsiteVar(slot)`. Fields without initializers get a default value
   (nil/0/false based on type, same as struct field defaults).

4. **Static method registration.** Static methods get function table entries with
   a distinct naming pattern: `Counter$reset` (dollar-separated, same as
   constructors, distinguishing from instance methods which use dot-separation).
   No implicit `this` parameter -- argc equals the user-visible parameter count.

5. **Access: `Counter.count`.** `lowerPropertyAccess` detects that the LHS
   (`Counter`) resolves to a class type reference (not a runtime value), then
   looks up `"Counter.count"` in `callsiteVars` and emits `LoadCallsiteVar(slot)`.

6. **Access: `Counter.reset()`.** `lowerCallExpression` detects
   `ClassName.staticMethod` pattern, looks up `Counter$reset` in the function
   table, emits `Call(funcId, argc)` with no receiver.

7. **Assignment: `Counter.count = 0`.** `lowerAssignment` detects the LHS is a
   static field reference and emits `StoreCallsiteVar(slot)` after evaluating RHS.

8. **Self-referencing from constructor/methods.** Inside the constructor body,
   `Counter.count += 1` follows the same property-access path -- `Counter`
   resolves to the class type reference regardless of whether we are inside or
   outside the class body.

---

## Phase S1 -- Lift Validator Ban and Filter Static Members

**Objective:** Remove the `StaticMembersNotSupported` diagnostic for valid static
fields and methods. Ensure static members are excluded from the instance
`StructTypeDef` (fields and method declarations).

**Packages/files touched:**

- `packages/ts-compiler/src/compiler/validator.ts`
- `packages/ts-compiler/src/compiler/diag-codes.ts` (remove or repurpose code 1017)
- `packages/ts-compiler/src/compiler/lowering.ts` (`extractClassFields`,
  `extractClassMethodDecls`)
- `packages/ts-compiler/src/compiler/codegen.spec.ts`

**Design:**

1. In `validateClassDeclaration`, remove the `static` keyword rejection. The
   `StaticMembersNotSupported` diagnostic code can be removed entirely or kept
   reserved.
2. In `extractClassFields`, skip members with the `static` modifier
   (`ts.canHaveModifiers(member)` + check for `StaticKeyword`).
3. In `extractClassMethodDecls`, skip members with the `static` modifier.
4. Existing tests for instance-only classes must continue to pass unchanged.

**Concrete deliverables:**

- Validator no longer rejects `static` keyword on class members.
- A class with both static and instance fields produces a `StructTypeDef`
  containing only instance fields.
- A class with both static and instance methods produces method declarations
  containing only instance methods.

**Acceptance criteria:**

- `class Foo { static x: number; y: number; }` passes validation.
- The registered `StructTypeDef` has fields `[{ name: "y", ... }]` only.
- `class Foo { static bar(): void {} baz(): number { return 1; } }` produces
  method declarations for `baz` only.
- Existing class tests pass without modification.

**Key risks:**

- None significant. This is a minimal gating change.

---

## Phase S2 -- Static Field Storage and Initialization

**Objective:** Allocate callsite variable slots for static fields and emit
initializer code during module init.

**Packages/files touched:**

- `packages/ts-compiler/src/compiler/lowering.ts` (top-level scan in
  `lowerProgram`, `generateModuleInitWithImports`)
- `packages/ts-compiler/src/compiler/codegen.spec.ts`

**Design:**

1. During the top-level class scan in `lowerProgram` (the block that creates
   `ClassInfo` entries and allocates function table slots), iterate static
   property declarations. For each, allocate a callsite var with a qualified name
   like `"ClassName.fieldName"`: `callsiteVars.set("ClassName.fieldName", nextCallsiteVar++)`.
2. Store the mapping of static field names to callsite var slots on `ClassInfo`
   (new field: `staticFieldSlots: Map<string, number>`).
3. In `generateModuleInitWithImports`, after existing module init code, for each
   class with static fields: if the field has an initializer, lower the
   initializer expression and emit `StoreCallsiteVar(slot)`. If no initializer,
   emit a default value (`PushConst(0)` for number, `PushConst(false)` for
   boolean, `PushNil` for reference types) followed by `StoreCallsiteVar(slot)`.
4. For imported classes with static fields, the same allocation must occur in the
   importing file's `lowerProgram` -- the imported class's static fields get
   fresh callsite var slots in the importer (per-tile isolation).

**Concrete deliverables:**

- `ClassInfo` extended with `staticFieldSlots`.
- Static fields allocated as callsite vars with qualified names.
- Module init emits initializer code for static fields.
- Imported classes also get static field callsite var slots in the importer.

**Acceptance criteria:**

- `class Foo { static x: number = 42; }` produces IR that stores 42 into a
  callsite var during module init.
- `class Foo { static x: number; }` produces IR that stores default 0 during
  module init.
- IR dump shows `StoreCallsiteVar` for each static field in the init function.
- Imported class static fields also get callsite var slots.

**Key risks:**

- Callsite var naming must not collide with module-level variables. Using
  `"ClassName.fieldName"` (with a dot) is safe since TypeScript identifiers cannot
  contain dots.
- Static field initializers may reference other static fields or module-level
  variables -- the lowering context for init code must have access to the full
  callsite var map. Verify that `generateModuleInitWithImports` has the right
  context.

---

## Phase S3 -- Static Method Registration and Compilation

**Objective:** Register static methods in the function table and compile their
bodies without an implicit `this` parameter.

**Packages/files touched:**

- `packages/ts-compiler/src/compiler/lowering.ts` (top-level scan,
  `lowerClassDeclaration` or new `lowerStaticMethod`)
- `packages/ts-compiler/src/compiler/codegen.spec.ts`

**Design:**

1. During the top-level class scan, for each static method, allocate a function
   table entry with naming pattern `"ClassName$methodName"` (dollar-separated to
   distinguish from instance methods which use `"ClassName.methodName"`).
2. Store the mapping on `ClassInfo` (new field: `staticMethodFuncIds:
   Map<string, number>`).
3. Compile static method bodies via `lowerHelperFunction` (or a thin wrapper).
   The key difference from instance methods: `thisLocalIndex` is NOT set on the
   `LowerContext`. The method's declared parameters map directly to locals
   starting at index 0 with no implicit receiver. If the body attempts to use
   `this`, the existing diagnostic for `this` outside class context fires.
4. For imported classes, static methods also get function table entries and their
   bodies are compiled.

**Concrete deliverables:**

- Static methods in function table as `"ClassName$methodName"`.
- Static method bodies compiled with no `this` local.
- `this` usage inside a static method produces a diagnostic.

**Acceptance criteria:**

- `class Foo { static bar(x: number): number { return x + 1; } }` compiles to a
  function entry with `argc = 1`, no `this` local.
- `class Foo { static bar(): void { this; } }` produces a diagnostic about
  `this` outside class context.
- Function table contains `"Foo$bar"` entry.

**Key risks:**

- Must ensure `lowerHelperFunction` or the compilation path does not
  unconditionally inject `this` as local 0 for class methods. The instance
  method path does this, so the static path must bypass it.

---

## Phase S4 -- Static Field Access (`ClassName.field`)

**Objective:** Support reading static fields via `ClassName.staticField` in
expressions.

**Packages/files touched:**

- `packages/ts-compiler/src/compiler/lowering.ts` (`lowerPropertyAccess`,
  possibly new `resolveStaticPropertyAccess`)
- `packages/ts-compiler/src/compiler/codegen.spec.ts`

**Design:**

This is the most complex phase. `lowerPropertyAccess` currently handles many
dispatch paths but has no path for `ClassName.staticField`. The challenge is
distinguishing a class type reference (the LHS `Counter` in `Counter.count`)
from a runtime value.

The enum access pattern (`EnumName.Member`) provides the template. In
`resolveEnumPropertyAccess`, the compiler detects that the LHS identifier's
symbol resolves to an enum declaration (via the TypeScript checker's symbol
flags). The same approach works for classes:

1. In `lowerPropertyAccess`, after checking for enum access and before the
   generic property path, add a check: if the LHS is an identifier whose symbol
   has `SymbolFlags.Class`, resolve it as a static member access.
2. New helper `resolveStaticMemberAccess(className, memberName, node, ctx)`:
   - Look up `className` in `classInfos` (or equivalent lookup).
   - Check if `memberName` exists in `staticFieldSlots` on the `ClassInfo`.
   - If found, emit `LoadCallsiteVar(slot)`.
   - If not found (could be a static method reference -- handle in S5 or emit
     diagnostic).
3. `lowerIdentifier` handling: bare `ClassName` should continue to be treated
   as an error (same as enum objects -- the class name is only valid as the LHS
   of a property access or in a `new` expression, not as a standalone value).

**Concrete deliverables:**

- `ClassName.staticField` in an expression emits `LoadCallsiteVar`.
- Works inside class methods, constructors, and module-level code.
- Works for imported classes (their static fields have callsite var slots in the
  importing file from S2).

**Acceptance criteria:**

- `class Foo { static x: number = 5; } const y = Foo.x;` compiles and `y`
  receives the value 5 at runtime.
- `Counter.count` inside a constructor body compiles correctly.
- Bare `ClassName` without property access still produces an error.
- Accessing a non-existent static field produces a diagnostic.

**Key risks:**

- Symbol flag check must correctly identify class declarations vs class
  instances. A variable typed as `Foo` should NOT trigger the static path --
  only the bare class name should.
- The `classInfos` array (or a derived lookup map) must be accessible from the
  property access lowering context. Currently `classInfos` is local to
  `lowerProgram`. It may need to be threaded through the `LowerContext` or a
  lookup helper.

---

## Phase S5 -- Static Method Calls (`ClassName.method()`)

**Objective:** Support calling static methods via `ClassName.staticMethod(args)`.

**Packages/files touched:**

- `packages/ts-compiler/src/compiler/lowering.ts` (`lowerCallExpressionCore`
  or `lowerPropertyAccessCall`)
- `packages/ts-compiler/src/compiler/codegen.spec.ts`

**Design:**

1. In the call expression lowering path, when the callee is a property access
   `ClassName.methodName` and the LHS resolves to a class type reference (same
   symbol check as S4):
   - Look up `"ClassName$methodName"` in the function table.
   - Lower the argument expressions (no receiver pushed).
   - Emit `Call(funcId, argc)` where `argc` is the number of user arguments (no
     +1 for `this`).
2. The dispatch must happen before the existing `lowerStructMethodCall` path,
   which expects an instance receiver.
3. If the method name is not found in `staticMethodFuncIds`, emit a diagnostic.

**Concrete deliverables:**

- `ClassName.staticMethod(args)` emits `Call` with correct argc.
- No receiver is pushed onto the stack.
- Works inside and outside the class body.
- Works for imported classes.

**Acceptance criteria:**

- `class Foo { static create(): Foo { return new Foo(); } }` followed by
  `const f = Foo.create();` compiles and executes correctly.
- `class Counter { static count: number = 0; static reset(): void { Counter.count = 0; } }`
  followed by `Counter.reset();` sets the static field to 0.
- Calling a non-existent static method produces a diagnostic.

**Key risks:**

- Must not intercept instance method calls (`foo.bar()` where `foo` is a
  variable). The class-type-reference check on the LHS is the gatekeeper.
- Static methods that access static fields must work correctly -- this depends
  on S4 being complete.

---

## Phase S6 -- Static Field Assignment and Compound Assignment

**Objective:** Support `ClassName.staticField = value` and compound variants
(`+=`, `-=`, etc.) as statements and in expressions.

**Packages/files touched:**

- `packages/ts-compiler/src/compiler/lowering.ts` (`lowerAssignment`,
  possibly `lowerCompoundAssignment`)
- `packages/ts-compiler/src/compiler/codegen.spec.ts`

**Design:**

1. In `lowerAssignment`, when the LHS is a property access of the form
   `ClassName.staticField` (detected via the same class-type-reference symbol
   check):
   - Look up the callsite var slot for `"ClassName.staticField"`.
   - Evaluate the RHS.
   - Emit `StoreCallsiteVar(slot)`.
   - If the assignment is used as an expression (not a statement), emit
     `LoadCallsiteVar(slot)` to leave the value on the stack.
2. For compound assignment (`ClassName.count += 1`):
   - Emit `LoadCallsiteVar(slot)` (read current value).
   - Evaluate the RHS.
   - Emit the binary operator.
   - Emit `StoreCallsiteVar(slot)`.
3. Prefix/postfix increment/decrement (`ClassName.count++`) follows the same
   pattern with appropriate pre/post value handling.

**Concrete deliverables:**

- `ClassName.field = expr` emits `StoreCallsiteVar`.
- `ClassName.field += expr` emits load-operate-store sequence.
- `ClassName.field++` and `++ClassName.field` work correctly.
- Works inside and outside class body.

**Acceptance criteria:**

- `Counter.count = 0;` stores 0 in the static field's callsite var.
- `Counter.count += 1;` increments by 1.
- `const x = (Counter.count = 5);` assigns 5 and `x` receives 5.
- Works for imported classes.

**Key risks:**

- Must not interfere with `this.field = value` path (existing instance field
  assignment). The `this` keyword is syntactically distinct from a class name
  identifier, so dispatch should be clean.
- Compound assignment must correctly sequence the load/operate/store to avoid
  double-evaluation of the slot lookup (the slot is a compile-time constant,
  so this is straightforward).

---

## Phase S7 -- Cross-File Static Access and Ambient Declarations

**Objective:** Ensure static members on imported classes work correctly
end-to-end, and that ambient `.d.ts` generation includes static member
signatures for cross-file type checking.

**Packages/files touched:**

- `packages/ts-compiler/src/compiler/lowering.ts` (`importedClasses` handling)
- `packages/ts-compiler/src/compiler/ambient.ts` (`buildAmbientDeclarations`)
- `packages/ts-compiler/src/compiler/project.ts` (`collectImports`)
- `packages/ts-compiler/src/compiler/codegen.spec.ts`

**Design:**

1. **Import collection:** In `collectImports` (project.ts), when collecting
   `ImportedClass` entries, no change is needed -- the full `ClassDeclaration`
   AST node is already passed, so the importer can inspect static members.
2. **Callsite var allocation for imported statics:** Already addressed in S2 --
   the importing file allocates fresh callsite var slots for the imported class's
   static fields. Verify this works end-to-end.
3. **Static method function table entries for imported classes:** Already
   addressed in S3 -- the importing file allocates function table slots for
   static methods. Verify this works end-to-end.
4. **Static field initialization for imported classes:** The importer's module
   init must evaluate static field initializers from the imported class. The
   initializer expressions are part of the AST node. Verify they are lowered
   correctly.
5. **Ambient declarations:** `buildAmbientDeclarations` in ambient.ts generates
   TypeScript `.d.ts` content for exported types. For classes with static
   members, the generated declarations must include `static` field and method
   signatures so the importing file's type checker sees them:
   ```typescript
   declare class Counter {
     value: number;
     constructor(value: number);
     getValue(): number;
     static count: number;
     static reset(): void;
   }
   ```
6. Verify that the TypeScript checker in the importing file correctly resolves
   `Counter.count` as `number` and `Counter.reset` as `() => void` from the
   ambient declarations.

**Concrete deliverables:**

- Ambient declarations include `static` members.
- Multi-file test: file A exports a class with static members, file B imports
  and accesses them.
- Type checking works across files for static access.

**Acceptance criteria:**

- Two-file test where file A defines `class Counter { static count: number = 0; static increment(): void { Counter.count += 1; } }` and file B does `Counter.increment(); const c = Counter.count;` -- compiles and executes correctly.
- Ambient `.d.ts` output includes `static count: number` and `static increment(): void`.
- Type errors (e.g., `Counter.count = "hello"`) are caught by the checker.

**Key risks:**

- Static field initializer expressions in imported classes may reference symbols
  from the exporting file's scope that are not available in the importer. If
  initializers reference module-level variables from the exporting file, those
  would need to be imported too. For S7, restrict to literal initializers and
  flag a diagnostic for initializers that reference out-of-scope symbols.
- Ambient generation currently emits `interface` declarations for structs. If
  classes are now emitted as `declare class` (to support `static`), ensure
  structural compatibility with existing consumers that may expect interfaces.

---

## Phase Log

### S1 -- Lift Validator Ban and Filter Static Members

**Date:** 2026-04-09

**Files changed:**

- `validator.ts` -- removed `StaticKeyword` rejection block from
  `validateClassDeclaration`.
- `lowering.ts` -- added `hasStaticModifier(node)` helper; added `continue`
  guards in `extractClassFields`, `extractClassMethodDecls`,
  `lowerClassDeclaration` (constructor init loop and method body loop), and both
  function-table registration loops (local and imported classes).
- `codegen.spec.ts` -- replaced old "class with static member produces
  diagnostic" test with three new tests: static field passes validation, static
  fields excluded from struct type, static methods excluded from method
  declarations.
- `diag-codes.ts` -- `StaticMembersNotSupported = 1017` left defined but
  unreferenced (reserved slot).

**Observations:**

- Six total `continue` guard sites were needed, not three. Beyond the two
  extraction helpers, `lowerClassDeclaration` has its own iteration loops for
  constructor property init and method body compilation, and the top-level
  `lowerProgram` scan has two function-table registration loops (local classes
  and imported classes). All required filtering.
- All new codepaths are skip guards only. No new error paths or diagnostics were
  needed. User code that references static members still gets a generic
  "Undefined variable" from `lowerIdentifier`, which S4/S5 will improve.
- The `hasStaticModifier` helper is reusable for S2/S3.

**Test results:** 646 tests, 0 failures. All existing class tests passed
without modification.

### S2 -- Static Field Storage and Initialization

**Date:** 2026-04-09

**Files changed:**

- `lowering.ts` -- extended `ClassInfo` interface with
  `staticFieldSlots: Map<string, number>`. In both local and imported class scan
  blocks, added loops to iterate static property declarations and allocate
  callsite vars with qualified names (`"ClassName.fieldName"`). Expanded
  `initFuncId` condition to also trigger when `classInfos` has static fields.
  Added `classInfos` parameter to `generateModuleInitWithImports` and appended a
  loop that emits static field initialization: lowers initializer expression with
  expected type for fields with initializers, pushes type-appropriate defaults
  (number->0, boolean->false, string->"", else nil) for fields without, followed
  by `StoreCallsiteVar(slot)`. Added `UnresolvableClassFieldType` diagnostic for
  uninitialized static fields whose type cannot be resolved (matching the
  existing non-static field behavior in `extractClassFields`).
- `codegen.spec.ts` -- added four tests: static field with initializer stores
  correct runtime value via callsite var, uninitialized static fields get
  type-appropriate defaults, STORE_CALLSITE_VAR bytecode appears in module-init
  function, uninitialized static field with unresolvable type emits diagnostic.

**Observations:**

- Qualified names with dots (`"Counter.count"`) are safe for callsite var keys
  since TypeScript identifiers cannot contain dots, avoiding collisions with
  module-level variables.
- The `initFuncId` condition needed expansion because a file with only static
  fields (no module-level variable initializers) would otherwise skip module-init
  function generation entirely.
- The `lowerExpressionWithExpectedType` function gracefully handles
  `undefined` expectedTypeId (skips conversion but still lowers the expression),
  so the initialized-field path works even with unresolvable types. The
  uninitialized-field path needed an explicit diagnostic because it would
  otherwise silently default to nil.
- `generateModuleInitWithImports` already had access to the full `callsiteVars`
  map and checker context, so static field initializers that reference other
  variables or call functions work without additional plumbing.

**Test results:** 650 tests, 0 failures.
