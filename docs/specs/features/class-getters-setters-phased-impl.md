# Class Getters and Setters -- Phased Implementation Plan

**Status:** G5 complete (all phases done)
**Created:** 2026-04-09
**Related:**

- [class-support.md](class-support.md)
- [static-class-members-phased-impl.md](static-class-members-phased-impl.md)
- [typescript-compiler-phased-impl-p2.md](typescript-compiler-phased-impl-p2.md)

Adds support for `get` and `set` accessor declarations on user-defined TypeScript
classes, for both instance and static members.

Getters and setters are syntactic sugar for method calls. No new VM opcodes or
core type system changes are required. The compiler desugars property reads via
getters into function calls, and property writes via setters into function calls.
The bodies of getters/setters are lowered using the same infrastructure as
instance methods (for instance accessors) and static methods (for static
accessors).

---

## Workflow Convention

Phases here are numbered G1-G5 to avoid collision with the C-series (class
support), D-series (destructuring), E-series (enums), and S-series (static
members).

Each phase follows this loop:

1. Copilot implements the phase.
2. Copilot stops and presents work for review.
3. The user reviews, requests changes or approves.
4. Only after the user declares the phase complete does the post-mortem happen.
5. Post-mortem writes the Phase Log entry, updates Current State, and any repo
   memory notes.

Do NOT write Phase Log entries or amend this spec during implementation. The
Phase Log is a post-mortem artifact.

As part of each phase, you MUST audit your changes to lowering.ts to verify that every new codepath added to `lowering.ts` must either emit IR or push a diagnostic. No codepath may silently fall through without producing output. Verify this for each branch you add. You are REQUIRED to do this if you make any changes to lowering.ts.

---

## Current State

Accessor funcIds are registered, bodies are lowered, and getter call sites are
desugared to function calls:

- `validator.ts` no longer blocks `GetAccessorDeclaration` or
  `SetAccessorDeclaration` class members.
- `ClassInfo` has four new maps: `getterFuncIds`, `setterFuncIds`,
  `staticGetterFuncIds`, `staticSetterFuncIds`.
- The class member scan (both local and imported classes) allocates funcIds for
  accessors and registers them in the function table as
  `ClassName$get_propName` / `ClassName$set_propName`.
- `lowerClassDeclaration` compiles accessor bodies into FunctionEntry using the
  same infrastructure as instance/static methods. Instance accessors receive
  `this` as param 0; static accessors have no implicit receiver.
- `StaticMemberAccessResolution` has a `"getter"` variant:
  `{ kind: "getter"; funcName: string }`.
- `resolveStaticMemberAccess` and `resolveThisStaticAccess` check
  `staticGetterFuncIds` after field/method checks.
- `lowerPropertyAccess` desugars getter reads:
  - Static: `ClassName.x` -> `Call(funcId, 0)`
  - This-static: `this.x` in static context -> `Call(funcId, 0)`
  - Instance: `obj.x` -> `lowerExpression(receiver) / Call(funcId, 1)`,
    with optional chaining support.
- `StaticMemberAccessResolution` has a `"setter"` variant:
  `{ kind: "setter"; funcName: string }`.
- `resolveStaticMemberAccess` and `resolveThisStaticAccess` check
  `staticSetterFuncIds` after getter checks.
- Setter call sites are desugared:
  - Static: `ClassName.x = v` -> `[lower v] / Dup / Call(setterFuncId, 1) / Pop`
  - This-static: `this.x = v` in static context -> same pattern.
  - Instance `this.x = v`: checks `setterFuncIds` via `resolveStructType` +
    `bareClassName`, emits `[lower v] / Dup / LoadLocal(this) / Swap /
    Call(setterFuncId, 2) / Pop`.
  - Instance `obj.x = v`: same pattern with `lowerExpression(receiver)` instead
    of `LoadLocal(this)`.
- `lowerStaticFieldAssignment` getter branch performs a companion-setter lookup
  via ClassInfo when the resolve result is `"getter"` (since resolve returns
  getter before setter). If a companion setter exists, it redirects to the
  setter Call path.
- Compound assignment (`+=`, `-=`, etc.) on getter+setter properties:
  - Instance `this.x += v`: `LoadLocal(this) / Call(getter, 1) / [RHS] /
    HostCallArgs(op, 2) / Dup / LoadLocal(this) / Swap / Call(setter, 2) / Pop`.
  - Instance `obj.x += v`: receiver evaluated once into a temp local via
    `allocLocal()`, then used for both getter and setter calls.
  - Static `ClassName.x += v`: `Call(getter, 0) / [RHS] / HostCallArgs(op, 2) /
    Dup / Call(setter, 1) / Pop`.
  - Compound on setter-only (no getter) emits diagnostic 3158
    (`CompoundAssignRequiresGetterAndSetter`).
- Prefix/postfix increment/decrement on getter+setter properties:
  - Six helper functions: `resolveStaticGetterSetterPair`,
    `resolveInstanceGetterSetterPair`, `lowerPrefixIncDecStaticGetterSetter`,
    `lowerPostfixIncDecStaticGetterSetter`, `lowerPrefixIncDecInstanceGetterSetter`,
    `lowerPostfixIncDecInstanceGetterSetter`.
  - Prefix: get -> +1 -> dup (new value) -> set. Postfix: get -> dup (old value)
    -> +1 -> set.
  - Instance helpers return `true | undefined` to signal whether they handled
    the operation, allowing fallthrough to existing field-based inc/dec paths.

Relevant existing infrastructure:

- `ClassInfo` tracks `constructorFuncId`, `methodFuncIds` (instance),
  `staticMethodFuncIds`, and `staticFieldSlots`.
- Instance method bodies are lowered with `this` as param 0 (implicit receiver).
- Static method bodies are lowered with no implicit `this`; `staticClassInfo` is
  set on the context instead.
- `lowerPropertyAccess` dispatches reads through: params, Math, enum, static
  member access, `this` static access, `.length`, struct field resolution, then
  generic TS property fallback. The struct field path checks `hasField` against
  the struct's `fields` list and emits `GetField` IR.
- `lowerThisFieldAssignment` handles `this.field = value` for instance fields
  by emitting `LoadLocal(this) / PushConst(fieldName) / [rhs] / StructSet /
Dup / StoreLocal(this)`.
- `lowerAssignment` dispatches writes through: element access, `this` static
  field, `this` instance field, `ClassName.staticField`, then variable targets.
- `STRUCT_SET` (used for `this.field = value` in constructors/methods) mutates
  the struct Dict in-place. No deep-copy occurs during `CALL` argument passing
  or `STORE_LOCAL`. Deep-copy only occurs at brain variable boundaries
  (`STORE_VAR`, `SET_FIELD`). This means a setter function that does
  `this._backing = value` mutates the same object the caller holds -- identical
  semantics to a regular instance method.
- `extractClassFields` scans `PropertyDeclaration` members (skipping `static`)
  and constructor `this.field = value` assignments to build the struct `fields`
  list for type registration.
- `extractClassMethodDecls` scans `MethodDeclaration` members (skipping
  `static`) to build the struct `methods` list for type registration.
- Static fields are stored in callsite variable slots. Static methods are
  registered in the function table with no receiver.

---

## Design

### Core principle

Getters and setters desugar to function calls at compile time. No new opcodes,
no core type system changes.

### Instance getter: `get x()`

- Allocate a funcId; register as `ClassName$get_x` in the function table.
- Lower the body identically to an instance method: `this` is param 0, zero
  user params, must return a value.
- At call sites, `obj.x` where `x` is a getter emits:
  ```
  [lower receiver]       // push struct
  Call(getterFuncId, 1)  // call getter with receiver as sole arg
  ```
- `this.x` inside the same class emits:
  ```
  LoadLocal(thisLocal)
  Call(getterFuncId, 1)
  ```

### Instance setter: `set x(value)`

- Allocate a funcId; register as `ClassName$set_x` in the function table.
- Lower the body identically to an instance method: `this` is param 0, one
  user param at index 1, return value discarded.
- At call sites, `obj.x = expr` where `x` has a setter emits:

  ```
  [lower expr]                // push RHS value
  Dup                         // keep value on stack (assignment expression result)
  [lower receiver]            // push struct
  Swap                        // stack: ..., value(result), struct, value(arg)
  -- wait, we need: struct, value for the Call
  ```

  Actually, the simpler approach matching existing method-call patterns:

  ```
  [lower receiver]            // push struct
  [lower expr]                // push RHS value
  Call(setterFuncId, 2)       // call setter with (this, value)
  Pop                         // discard setter return
  [lower expr again?]         // NO -- need to handle expression value
  ```

  For statement-position assignments (`foo.x = 5;` as a statement), we can
  discard the return. For expression-position assignments (`y = foo.x = 5`),
  the lowering must preserve the RHS value. The approach:

  ```
  [lower expr]                // push RHS value
  Dup                         // copy for expression result
  [lower receiver]            // push struct
  Swap                        // stack: ..., result, struct, value
  Call(setterFuncId, 2)       // call setter with (this=struct, value)
  Pop                         // discard setter return (void)
  ```

  This leaves the original RHS value on the stack as the expression result.
  If the assignment is a statement (expression result unused), the existing
  Pop at the statement level handles cleanup.

- `this.x = expr` inside the same class emits:
  ```
  [lower expr]
  Dup
  LoadLocal(thisLocal)
  Swap
  Call(setterFuncId, 2)
  Pop
  ```

### Static getter: `static get x()`

- Allocate a funcId; register as `ClassName$get_x` in the function table (same
  naming as constructor uses `$`).
- Lower the body as a static method: no `this`, zero params.
- At call sites, `ClassName.x` where `x` is a static getter emits:
  ```
  Call(staticGetterFuncId, 0)
  ```

### Static setter: `static set x(value)`

- Allocate a funcId; register as `ClassName$set_x` in the function table.
- Lower the body as a static method: no `this`, one param.
- At call sites, `ClassName.x = expr` where `x` is a static setter emits:
  ```
  [lower expr]
  Dup
  Call(staticSetterFuncId, 1)
  Pop
  ```

### Compound assignment: `obj.x += 5`

Requires both getter and setter. Desugars to:

```
[lower receiver]
Dup                         // duplicate receiver (needed for both get and set)
Call(getterFuncId, 1)       // get current value
[lower 5]
HostCallArgs(addOp, 2)     // apply operator
Dup                         // result is the expression value
[receiver is consumed -- need it again for setter]
```

This gets tricky because the receiver is consumed by the getter call. The
receiver must be evaluated once and reused for both the getter and setter calls.
Approach: evaluate receiver once, store in a temp local, use for both calls.

```
[lower receiver]
StoreLocal(tempLocal)       // save receiver
LoadLocal(tempLocal)        // push for getter
Call(getterFuncId, 1)       // get current value
[lower 5]
HostCallArgs(addOp, 2)     // apply operator
Dup                         // expression result
LoadLocal(tempLocal)        // push receiver for setter
Swap                        // stack: result, receiver, newValue
Call(setterFuncId, 2)       // set new value
Pop                         // discard setter return
```

For `this.x += 5`, the temp local is unnecessary since `thisLocal` is stable.

### Struct type registration

Getter-backed properties should NOT appear in the struct `fields` list (they
have no storage). They must be excluded from `extractClassFields`. The lowering
already skips non-`PropertyDeclaration` members, and `GetAccessorDeclaration`
is a distinct AST node kind, so getters will be naturally skipped.

However, `lowerPropertyAccess` validates property reads against `hasField` on
the struct type. Getter properties won't be in `fields` and would produce a
false `PropertyNotOnStruct` diagnostic. The fix: check for getter funcIds
before falling into the struct field path.

### ClassInfo changes

Add two new maps to `ClassInfo`:

```
getterFuncIds: Map<string, number>       // propertyName -> funcId
setterFuncIds: Map<string, number>       // propertyName -> funcId
staticGetterFuncIds: Map<string, number> // propertyName -> funcId
staticSetterFuncIds: Map<string, number> // propertyName -> funcId
```

---

## Scope

### In scope

- Instance getters (`get x() { ... }`).
- Instance setters (`set x(value) { ... }`).
- Static getters (`static get x() { ... }`).
- Static setters (`static set x(value) { ... }`).
- Simple assignment through setters (`obj.x = value`).
- Compound assignment through getter+setter pairs (`obj.x += value`).
- Prefix/postfix increment/decrement through getter+setter (`obj.x++`).
- `this.x` getter/setter access within the same class.
- Cross-file: importing a class and accessing getter/setter properties.
- Optional chaining on getters (`obj?.x` where `x` is a getter).

### Out of scope

- Getter/setter on object literals or interfaces (only classes).
- Abstract getters/setters.
- Override/decorator syntax on accessors.
- Getter/setter with different visibility (all public, matching existing class
  constraint of no private fields).

---

## Phased Plan

### Phase G1: Remove validator ban + register accessor funcIds

**Goal:** Allow getters/setters to parse without error and allocate function
table entries for them. No lowering of bodies or call-site desugaring yet.

**Changes:**

1. **validator.ts**: Remove the `isGetAccessorDeclaration || isSetAccessorDeclaration`
   diagnostic block. Delete or deprecate `ClassGettersSettersNotSupported`.

2. **lowering.ts -- ClassInfo**: Add `getterFuncIds`, `setterFuncIds`,
   `staticGetterFuncIds`, `staticSetterFuncIds` maps.

3. **lowering.ts -- class member scan** (in `lowerScriptModule`, both local and
   imported class blocks): For each `GetAccessorDeclaration` and
   `SetAccessorDeclaration` member:
   - Allocate a funcId.
   - Register in function table as `ClassName$get_propName` or
     `ClassName$set_propName` (instance and static).
   - Store in the appropriate `ClassInfo` map.

4. **Tests**: A class with getters/setters should compile without validator
   errors. The accessor bodies are not yet lowered (they will produce empty
   functions or be skipped), but compilation doesn't crash.

**Verification:** `npm run typecheck && npm run check && npm test`

---

### Phase G2: Lower getter/setter bodies

**Goal:** Compile the bodies of getters and setters into function entries, using
the same infrastructure as instance/static methods.

**Changes:**

1. **lowering.ts -- `lowerClassDeclaration`**: After the existing method-lowering
   loops, add loops for getter and setter members:
   - **Instance getter**: Lower like an instance method with `this` as param 0,
     zero user params. NumParams = 1 (just `this`).
   - **Instance setter**: Lower like an instance method with `this` as param 0,
     one user param. NumParams = 2.
   - **Static getter**: Lower like a static method, zero params.
   - **Static setter**: Lower like a static method, one param.

2. **Tests**: A class with getters/setters compiles successfully. The function
   entries are generated. Call sites are not yet desugared (accessing the
   property still goes through the field path and may error), but the bodies
   themselves compile.

**Verification:** `npm run typecheck && npm run check && npm test`

---

### Phase G3: Instance getter call-site desugaring

**Goal:** `obj.x` and `this.x` where `x` is a getter-backed property emit a
function call instead of `GetField`.

**Changes:**

1. **lowering.ts -- `lowerPropertyAccess`**: Before the struct `hasField` check,
   check if the property name matches a getter in the receiver's class. If so,
   emit `[lower receiver] / Call(getterFuncId, 1)` instead of `GetField`.

   Detection approach: resolve the receiver's type to a struct type, find the
   matching `ClassInfo`, and check `getterFuncIds.has(propName)`.

2. **lowering.ts -- `lowerPropertyAccess` `this` path**: When
   `expr.expression.kind === ThisKeyword` and the property is a getter on the
   current class, emit `LoadLocal(thisLocal) / Call(getterFuncId, 1)`.

3. **Static getter call sites**: In `resolveStaticMemberAccess` (or a new check
   before it), check `staticGetterFuncIds`. Return a new discriminated union
   variant `{ kind: "getter"; funcName }`. Update `lowerPropertyAccess` to
   handle this variant by emitting `Call(funcId, 0)`.

   Similarly for `resolveThisStaticAccess` inside static methods.

4. **Optional chaining**: If the getter property is accessed via `obj?.x`,
   apply the same nil-guard pattern used for struct field access.

5. **Tests**: Write tests covering:
   - `obj.x` reads through a getter.
   - `this.x` reads through a getter inside a method.
   - `ClassName.x` reads through a static getter.
   - `this.x` reads through a static getter inside a static method.
   - Getter returning a computed value (not just a backing field).

**Verification:** `npm run typecheck && npm run check && npm test`

---

### Phase G4: Instance setter call-site desugaring

**Goal:** `obj.x = value` and `this.x = value` where `x` has a setter emit a
function call instead of `StructSet`.

**Changes:**

1. **lowering.ts -- `lowerAssignment`**: In the `this.field = value` branch,
   before calling `lowerThisFieldAssignment`, check if the property has a setter
   on the current class. If so, emit the setter call pattern:

   ```
   [lower RHS]
   Dup                       // expression result
   LoadLocal(thisLocal)
   Swap
   Call(setterFuncId, 2)
   Pop
   ```

2. **lowering.ts -- `lowerAssignment`**: For non-`this` property access
   assignments (e.g., `obj.x = value`), check for setters on the receiver's
   class before falling through to the existing paths. Emit:

   ```
   [lower RHS]
   Dup
   [lower receiver]
   Swap
   Call(setterFuncId, 2)
   Pop
   ```

3. **Static setter call sites**: In the static member assignment path
   (`lowerStaticFieldAssignment` or before it), detect static setters via
   `staticSetterFuncIds`. Emit `[lower RHS] / Dup / Call(setterFuncId, 1) / Pop`.

4. **Tests**: Write tests covering:
   - `obj.x = 5` through a setter.
   - `this.x = 5` through a setter inside a method/constructor.
   - `ClassName.x = 5` through a static setter.
   - Expression-position assignment: `y = (obj.x = 5)` evaluates to 5.
   - Setter that validates/transforms (e.g., clamping).

**Verification:** `npm run typecheck && npm run check && npm test`

---

### Phase G5: Compound assignment and increment/decrement

**Goal:** `obj.x += 5`, `obj.x++`, `++obj.x` work when `x` has both a getter
and a setter.

**Changes:**

1. **lowering.ts -- `lowerThisFieldAssignment` compound path**: When the
   property has both a getter and setter, replace the current
   `LoadLocal(this) / GetField / [rhs] / op / StructSet` pattern with:

   ```
   LoadLocal(thisLocal)
   Call(getterFuncId, 1)     // get current
   [lower RHS]
   HostCallArgs(op, 2)       // apply operator
   Dup                       // expression result
   LoadLocal(thisLocal)
   Swap
   Call(setterFuncId, 2)     // set new value
   Pop
   ```

2. **Non-`this` compound assignment** (`obj.x += 5`): Evaluate receiver once
   into a temp local if needed, then use for both getter and setter calls.

3. **Prefix/postfix increment/decrement** (`lowerPrefixIncDec`,
   `lowerPostfixIncDec`): Detect getter/setter properties and emit the
   appropriate get-modify-set sequence. For postfix, the pre-modification value
   is the expression result. For prefix, the post-modification value is the
   result.

4. **Static compound assignment** (`ClassName.x += 5`). Similar approach using
   static getter/setter funcIds.

5. **Diagnostics**: If a compound assignment or increment/decrement targets a
   property with a getter but no setter (or vice versa), emit a diagnostic
   (e.g., `GetterSetterMismatchForCompoundAssign`).

6. **Tests**: Write tests covering:
   - `obj.x += 5` (getter + setter + operator).
   - `this.x -= 1` inside a method.
   - `obj.x++` and `++obj.x` (postfix vs prefix).
   - `ClassName.x += 5` (static compound).
   - Error: `obj.x += 5` when only a getter exists (no setter).

**Verification:** `npm run typecheck && npm run check && npm test`

---

## Gotchas and Risk Notes

1. **Property validation against struct fields**: Getter properties are not
   stored in the struct `fields` list. The `hasField` check in
   `lowerPropertyAccess` must be bypassed when a getter exists for the property.
   This is the most likely source of false-negative diagnostics during
   development.

2. **Receiver evaluation order for compound assignment**: The receiver
   expression must be evaluated exactly once. For `this.x += 5` this is trivial
   (thisLocal is stable). For `getObj().x += 5` a temp local is needed to avoid
   double evaluation. The existing compound assignment code for struct fields
   already evaluates `this` from a local, so the pattern exists.

3. **`extractClassFields` and `extractClassMethodDecls`**: These functions scan
   `PropertyDeclaration` and `MethodDeclaration` respectively. Since
   `GetAccessorDeclaration` and `SetAccessorDeclaration` are distinct AST node
   kinds, they are naturally excluded. No changes needed to these functions.

4. **Naming collisions**: The naming convention `ClassName$get_x` /
   `ClassName$set_x` must not collide with user-defined methods. Since `$` is
   not a valid TypeScript identifier start in this context, and method names
   use `ClassName.methodName` (dot-separated), there is no collision risk.

5. **Getter-only properties**: A property with only a getter and no setter is
   read-only. TypeScript enforces this at the type level, but the compiler
   should also emit a diagnostic if a setter call site is encountered for a
   getter-only property (in case the TS checker is bypassed or for better error
   messages).

6. **Setter-only properties**: A property with only a setter and no getter is
   write-only. Reading it should fall through to struct field access (which may
   return nil if the backing field doesn't exist under that name) or emit a
   diagnostic. TypeScript's checker should catch this, but a defensive
   diagnostic is worthwhile.

7. **Cross-file accessor imports**: The existing imported-class scan in
   `lowerScriptModule` processes full `ClassDeclaration` AST nodes. The accessor
   member scan (G1) processes the same node kind, so cross-file access should
   work with no additional import handling -- same as static methods.

8. **`deepCopy` boundary irrelevance**: Since `STRUCT_SET` mutates in-place and
   `CALL` passes arguments by reference, setter bodies that do
   `this._backing = value` mutate the caller's struct. This matches regular
   method semantics. No value-type issues.

---

## Phase Log

(Written during post-mortem, not during implementation.)

### G1 -- Remove validator ban + register accessor funcIds

**Files changed:**

- `validator.ts`: Removed the `isGetAccessorDeclaration || isSetAccessorDeclaration`
  diagnostic block from the class member loop.
- `lowering.ts`: Added `getterFuncIds`, `setterFuncIds`, `staticGetterFuncIds`,
  `staticSetterFuncIds` maps to `ClassInfo`. Added accessor scanning loops in
  both the local class block and the imported class block, allocating funcIds
  and registering them in the function table.
- `codegen.spec.ts`: Replaced the "class with getter produces diagnostic" test
  with a test that verifies a class containing instance + static getters and
  setters compiles without diagnostics.

**Kept unchanged:** `diag-codes.ts` -- `ClassGettersSettersNotSupported` enum
value retained (unreferenced) to avoid shifting numeric codes.

**Lesson:** The G1 test initially tried to assert accessor names in
`prog.functions`, but those entries only appear after body lowering (G2).
Adjusted to verify zero diagnostics + program produced.

### G2 -- Lower getter/setter bodies

**Files changed:**

- `lowering.ts`: Added four accessor-lowering loops in `lowerClassDeclaration`,
  after the static method loop and before `return entries;`. Instance getter
  (this=param 0, 0 user params), instance setter (this=param 0, N user params),
  static getter (no this, 0 params), static setter (no this, N params). Each
  follows the same LowerContext/ScopeStack/lowerStatements/NIL+Return pattern
  as existing method lowering.
- `codegen.spec.ts`: Updated the G1 test to now verify accessor function names
  (`Foo$get_x`, `Foo$set_x`, `Foo$get_count`, `Foo$set_count`) appear in
  `prog.functions`.

**Silent-failure audit:** The `!isIdentifier(member.name)` continue guard
skips computed-name accessors without a diagnostic. This is a pre-existing
pattern shared with the method-lowering loops (line ~7510) and the G1 scan
code. Both G1 registration and G2 body lowering have the same guard, so no
funcId/body mismatch can occur. No new silent-failure paths introduced beyond
what methods already have.

**Lesson:** `prog.functions` is a `List<FunctionBytecode>`, not a native array.
`List.map()` returns a `List` which lacks `.includes()`. Used `.some()` for
assertion checks instead.

### G3 -- Getter call-site desugaring

**Files changed:**

- `lowering.ts`:
  - Added `{ kind: "getter"; funcName: string }` variant to
    `StaticMemberAccessResolution` type union.
  - `resolveStaticMemberAccess`: checks `ci.staticGetterFuncIds.has()` after
    field/method, returns getter variant.
  - `resolveThisStaticAccess`: same pattern for `this.x` in static methods.
  - `lowerPropertyAccess` static handler: emits `Call(funcId, 0)` for getter.
  - `lowerPropertyAccess` this-static handler: same.
  - `lowerPropertyAccess` struct path: before `hasField` check, looks up
    receiver's ClassInfo via `bareClassName()`, checks `getterFuncIds`, emits
    `lowerExpression(receiver) / Call(funcId, 1)` with optional chaining.
  - `lowerStaticFieldAssignment`: added `"getter"` to the `"method"` diagnostic
    branch (not assignable).
  - `lowerPrefixIncDec` / `lowerPostfixIncDec`: added `"getter"` to the
    `"method"` diagnostic branch (not incrementable).
- `codegen.spec.ts`: Four new runtime tests:
  - Instance getter reads via function call (`b.width` returns 42).
  - `this.x` getter inside a method (`r.area()` uses getters for w/h).
  - Static getter reads via function call (`Config.limit` returns 99).
  - Getter returning computed value (`c.diameter` returns radius * 2).

**Silent-failure audit:** All new codepaths emit IR or produce a diagnostic.
Defensive `funcId !== undefined` guards in the static/this-static/instance
paths fall through to existing `NoSuchStaticMember` or `PropertyNotOnStruct`
diagnostics if the function table lookup fails (which cannot happen in practice
because G1 registers funcIds in both ClassInfo maps and the function table
simultaneously).

**Lesson:** Adding a new variant to the `StaticMemberAccessResolution` union
broke three other consumers (`lowerStaticFieldAssignment`, `lowerPrefixIncDec`,
`lowerPostfixIncDec`) that exhaustively checked the union. These needed getter
handling added (diagnostic: not assignable) before typecheck would pass.

### G4 -- Setter call-site desugaring

**Files changed:**

- `lowering.ts`:
  - Added `{ kind: "setter"; funcName: string }` variant to
    `StaticMemberAccessResolution` type union.
  - `resolveStaticMemberAccess`: checks `ci.staticSetterFuncIds.has()` after
    getter, returns setter variant.
  - `resolveThisStaticAccess`: same pattern.
  - `lowerStaticFieldAssignment`: split method/getter into separate branches.
    New setter branch emits `[lower RHS] / Dup / Call(funcId, 1) / Pop`.
    Getter branch checks for companion setter via ClassInfo lookup and
    redirects to setter path if found.
  - `lowerThisFieldAssignment`: added instance setter check before field
    assignment via `resolveStructType(thisType)` + `bareClassName()` +
    `ClassInfo.setterFuncIds`. Emits `[lower RHS] / Dup / LoadLocal(this) /
    Swap / Call(funcId, 2) / Pop`.
  - `lowerAssignment`: added `obj.X = v` instance setter path after static
    member check, before variable target. Uses `resolveStructType` +
    `ClassInfo.setterFuncIds`.
  - `lowerPrefixIncDec` / `lowerPostfixIncDec`: added `"setter"` to
    method/getter diagnostic branch.
- `codegen.spec.ts`: Five new runtime tests:
  - Instance setter (`b.width = 42`).
  - `this.x` setter inside a method (Counter.increment mutates via setter).
  - Static setter (`Config.limit = 77`).
  - Expression-position assignment (`y = (b.width = 99)`).
  - Clamping setter (setter body clamps value to range).

**Silent-failure audit:** All new codepaths emit IR or produce a diagnostic.
The `"setter"` kind in `lowerPrefixIncDec`/`lowerPostfixIncDec` falls into the
existing method/getter diagnostic branch. The companion-setter check in the
getter branch of `lowerStaticFieldAssignment` either finds the setter (emits
Call) or falls through to the existing "getter not assignable" diagnostic.

**Lesson:** `resolveStaticMemberAccess` checks getter before setter, so for
properties with both a getter and setter, the resolve result is `"getter"`.
The assignment handler (`lowerStaticFieldAssignment`) must perform a secondary
ClassInfo lookup for a companion setter when it receives a `"getter"` result
in a write context. A single resolve function cannot serve both read and write
contexts without this secondary check.

### G5 -- Compound assignment and increment/decrement

**Files changed:**

- `diag-codes.ts`: Added `CompoundAssignRequiresGetterAndSetter = 3158`.
- `lowering.ts`:
  - `lowerThisFieldAssignment`: Compound path now detects getter+setter pair
    via `resolveStructType` + `bareClassName` + `ClassInfo`. Emits
    `LoadLocal(this) / Call(getter, 1) / [RHS] / HostCallArgs(op, 2) / Dup /
    LoadLocal(this) / Swap / Call(setter, 2) / Pop`.
  - `lowerAssignment` (obj.X compound path): Evaluates receiver once into a
    temp local via `ctx.scopeStack.allocLocal()`, then uses it for both getter
    and setter calls. Emits `StoreLocal(temp) / LoadLocal(temp) / Call(getter, 1) /
    [RHS] / HostCallArgs(op, 2) / Dup / LoadLocal(temp) / Swap / Call(setter, 2) /
    Pop`.
  - `lowerStaticFieldAssignment` (getter branch): Compound path resolves
    companion setter via `resolveStaticGetterSetterPair`. Emits
    `Call(getter, 0) / [RHS] / HostCallArgs(op, 2) / Dup / Call(setter, 1) / Pop`.
    Setter-only compound emits diagnostic 3158.
  - Six new helper functions:
    - `resolveStaticGetterSetterPair`: Finds getter+setter funcId pair for
      static properties.
    - `resolveInstanceGetterSetterPair`: Same for instance properties via
      `resolveStructType` + `bareClassName` + `ClassInfo`.
    - `lowerPrefixIncDecStaticGetterSetter`: Static prefix inc/dec.
    - `lowerPostfixIncDecStaticGetterSetter`: Static postfix inc/dec.
    - `lowerPrefixIncDecInstanceGetterSetter`: Instance prefix inc/dec
      (returns `true | undefined`).
    - `lowerPostfixIncDecInstanceGetterSetter`: Instance postfix inc/dec
      (returns `true | undefined`).
  - `lowerPrefixIncDec`: Dispatches `"getter"` kind to static helper, then
    falls through to instance helper for property access expressions.
  - `lowerPostfixIncDec`: Same pattern.
- `codegen.spec.ts`: Six new tests:
  - Instance compound: `obj.x += 5` (expects 15).
  - Instance `this.x -= 1` inside a method (Wallet.spend, expects 55).
  - Instance postfix/prefix: `c.count++` and `++c.count` (expects 22).
  - Static compound: `ClassName.x += 5` (expects 18).
  - Static postfix/prefix: `Stats.total++` and `++Stats.total` (expects 577).
  - Getter-only compound error: produces diagnostic.

**Silent-failure audit:** All new codepaths emit IR or produce a diagnostic.
No pre-existing silent failures found in the areas touched.

**Lesson:** The `return void_function()` pattern triggers biome's
`noVoidTypeReturn` lint. Void-returning helpers dispatched from void-returning
callers must be separated into `helper(); return;` instead of `return helper();`.
