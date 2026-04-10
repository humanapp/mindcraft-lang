# Class Getters and Setters -- Phased Implementation Plan

**Status:** G1 complete, G2 next
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

Every new codepath added to `lowering.ts` must either emit IR or push a
diagnostic. No codepath may silently fall through without producing output.
Verify this for each branch you add.

---

## Current State

The validator ban is removed and accessor funcIds are registered:

- `validator.ts` no longer blocks `GetAccessorDeclaration` or
  `SetAccessorDeclaration` class members.
- `ClassInfo` has four new maps: `getterFuncIds`, `setterFuncIds`,
  `staticGetterFuncIds`, `staticSetterFuncIds`.
- The class member scan (both local and imported classes) allocates funcIds for
  accessors and registers them in the function table as
  `ClassName$get_propName` / `ClassName$set_propName`.
- Accessor bodies are not yet lowered -- funcIds exist in the table but produce
  no `FunctionEntry`. Call sites are not yet desugared.

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
