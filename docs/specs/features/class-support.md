# Class Support -- Phased Implementation Plan

Research and implementation plan for adding user-defined class support to the
TypeScript compiler (`packages/typescript`). Classes compile down to the existing
struct + function infrastructure -- no new VM opcodes are required.

Companion to [typescript-compiler-phased-impl-p2.md](typescript-compiler-phased-impl-p2.md).

---

## Workflow Convention

Same loop as the parent plan (typescript-compiler-phased-impl-p2.md, "Workflow
Convention" section). Phases here are numbered C1-C6 to avoid collision with the
main plan's numbering and the D-series (destructuring).

---

## Current State

(As of 2026-04-01, before implementation)

### What exists

- **Struct type system:** `StructTypeDef` in `packages/core` with typed fields,
  optional `fieldGetter`/`fieldSetter` for native-backed structs, optional
  `methods: List<StructMethodDecl>` for method metadata, `nominal` flag.
- **Struct creation:** `STRUCT_NEW` opcode creates a struct value with typed fields.
  IR node `IrStructNew { typeId }` + `IrStructSet` for field initialization.
- **Field access:** `GET_FIELD` / `SET_FIELD` opcodes, mapped from `IrGetField` /
  `IrGetFieldDynamic` IR nodes.
- **Struct method calls:** `lowerStructMethodCall` in lowering.ts dispatches
  `obj.method(args)` on struct types to host functions named
  `"StructType.methodName"` via `HostCallArgs` / `HostCallArgsAsync`. Receiver is
  pushed as the first argument.
- **Function compilation:** `lowerHelperFunction` compiles top-level function
  declarations into `FunctionEntry` objects with parameter locals, scope stacks,
  and IR bodies. Functions are registered in `functionTable` (name -> funcId).
- **Closures:** `lowerClosureExpression` compiles arrow functions and function
  expressions with capture-by-value semantics via `MakeClosure` / `LoadCapture`.
- **Ambient generation:** `buildAmbientDeclarations()` in ambient.ts generates
  TypeScript interface declarations for registered struct types, including method
  signatures. Used for cross-file type checking.
- **Type registry:** `ITypeRegistry` in packages/core provides `addStructType`,
  `addStructMethods`, `resolveByName`, `get`, `isStructurallyCompatible`.

### What does not exist

- No `ClassDeclaration` or `ClassExpression` handling in lowering.ts.
- No `NewExpression` handling (`new Foo(...)` syntax).
- No `this` keyword support (no `ThisKeyword` handling in expression lowering).
- No `this.field = value` assignment support.
- Validator explicitly rejects `ClassDeclaration` and `ClassExpression` with
  `"Classes are not supported"` (validator.ts line 42).
- No mechanism for user-compiled method dispatch (struct methods currently dispatch
  to host functions via `HostCallArgs`, not to compiled function-table entries).

### Key existing infrastructure for reuse

- `lowerHelperFunction(funcNode, checker, ...)` -- compiles a function declaration
  body. Class methods follow the same pattern with `this` as an additional leading
  parameter.
- `lowerObjectLiteralAsStruct(expr, structDef, ctx)` -- emits `StructNew` + field
  `StructSet` for each property. Constructor lowering reuses this pattern.
- `resolveStructType(type)` -- resolves a TS type to a `StructTypeDef`. Reusable
  for resolving class types to their registered struct definitions.
- `functionTable: Map<string, number>` -- maps function names to indices.
  Class constructors and methods can be registered here.
- `callsiteVars: Map<string, number>` -- module-level persistent variables. Not
  needed for class instance state (that lives in struct fields), but relevant if
  static members are supported.
- `ScopeStack` -- manages local variable allocation per function body.
- `FunctionEntry` with `injectCtxTypeId` -- already supports injecting a typed
  first parameter (used for `ctx` in onExecute). Could potentially be reused for
  `this` binding, though the mechanism is different (constructor creates the
  instance, methods receive it as an explicit argument).

---

## Compilation Model

A class declaration:

```typescript
class Point {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  distanceTo(other: Point): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}

const p = new Point(3, 4);
p.distanceTo(new Point(0, 0));
```

Compiles as follows:

1. **Type registration.** A `StructTypeDef` named `"Point"` is registered with
   fields `[{ name: "x", typeId: "number" }, { name: "y", typeId: "number" }]`
   and method declarations `[{ name: "distanceTo", params: [...], returnTypeId: "number" }]`.

2. **Constructor -> function.** The constructor becomes a compiled function
   `"Point$new"` in the function table. Its body:
   - Receives user-declared parameters (`x`, `y`) at local slots 0, 1.
   - Emits `StructNew("struct:<Point>")`.
   - Stores the struct into a dedicated `this` local slot.
   - For each `this.field = value` assignment in the constructor body: loads `this`,
     pushes field name, pushes value, emits `StructSet`, stores result back to `this`.
   - Returns the `this` local.

3. **Methods -> functions.** Each method becomes a compiled function with the
   instance (`this`) as an implicit first parameter (local 0). `"Point.distanceTo"`
   takes `(this: Point, other: Point)` -- 2 params total.
   - `this.x` compiles to `LoadLocal(0)` + `GetField("x")`.
   - User-declared parameters start at local 1.

4. **`new Point(3, 4)` -> function call.** `NewExpression` compiles to
   `Call(funcIndex("Point$new"), argc: 2)` -- a normal compiled function call.

5. **`p.distanceTo(q)` -> method call.** Property access on a class-typed variable
   resolves to a compiled method. Emits: push receiver (`p`), push args (`q`),
   `Call(funcIndex("Point.distanceTo"), argc: 2)`. This differs from existing
   struct method dispatch which uses `HostCallArgs` for host-registered functions.

---

## Scoping Decisions

### MVP scope (C1-C4)

- Class declarations with constructor and typed fields
- Property declarations with type annotations (e.g., `x: number`)
- Property declarations with initializers (e.g., `x: number = 0`)
- Instance methods (non-static, non-generic)
- `this` binding within constructors and methods
- `new ClassName(args)` expression
- Classes usable as types (variable annotations, parameter types, return types)
- Multiple classes per file

### Deferred (not in MVP)

| Feature | Rationale |
|---------|-----------|
| `extends` / inheritance | Requires field merging, `super()` chaining, method override dispatch. Roughly doubles effort. |
| `static` methods/properties | Needs a separate dispatch mechanism (module-level functions/vars). |
| `#private` fields | Compile-time access enforcement within class body scope. |
| Getters/setters (`get x()`, `set x()`) | Compile to `fieldGetter`/`fieldSetter` or inline expansion. |
| Abstract classes | Purely compile-time, but depends on inheritance. |
| `instanceof` operator | Needs runtime type tagging (hidden field or separate opcode). |
| Parameter properties (`constructor(public x: number)`) | Sugar; can be added as a follow-on. |
| Generic classes (`class Foo<T>`) | Requires generic type instantiation in struct registration. |
| Class expressions (`const Foo = class { ... }`) | Lower priority than declarations. |
| Decorators | Not supported anywhere in the compiler. |
| `implements` clause | Purely a TS compile-time check; could be enabled with no lowering changes. |

---

## Phases

### Phase C1: Class Declaration Scaffolding and Type Registration

**Objective:** Allow class declarations to pass validation, register their struct
types, and allocate function table slots for constructors and methods. No body
compilation yet -- constructor and method bodies emit placeholder returns.

**Packages/files touched:**

- `packages/typescript/src/compiler/validator.ts` -- remove class rejection; add
  targeted rejections for unsupported class features.
- `packages/typescript/src/compiler/lowering.ts` -- handle `ClassDeclaration` in
  the top-level `lowerProgram` scan and in `lowerStatement`.
- `packages/typescript/src/compiler/diag-codes.ts` -- add diagnostic codes for
  unsupported class features.

**Concrete deliverables:**

1. **Validator changes.** Remove the `ClassDeclaration` / `ClassExpression`
   rejection (validator.ts line 42-44). Add new targeted rejections:
   - `ClassExpression` remains rejected (MVP is declaration-only).
   - Class with `extends` clause -> `"Class inheritance is not supported"`.
   - `static` members -> `"Static class members are not supported"`.
   - Private identifiers (`#field`) -> `"Private fields are not supported"`.
   - Getter/setter declarations -> `"Class getters/setters are not supported"`.
   - Decorators on class or members -> already rejected by existing decorator check.

2. **Top-level scan in `lowerProgram`.** In the first pass over
   `sourceFile.statements`, when encountering a `ClassDeclaration`:
   - Extract the class name.
   - Allocate a function table slot for the constructor: `"ClassName$new"`.
   - Allocate a function table slot for each method: `"ClassName.methodName"`.
   - Collect the class node for later body compilation.
   - Extract field declarations from property declarations and constructor
     `this.field = value` assignments. Register a `StructTypeDef` via
     `getBrainServices().types.addStructType(name, shape)` with the extracted
     fields and method declarations.

3. **`lowerStatement` dispatch.** Add `ts.isClassDeclaration(stmt)` branch. In
   C1 this is a no-op (the class was pre-processed in the top-level scan; methods
   are compiled in a later loop like helper functions).

4. **Stub function entries.** For each constructor and method, emit a minimal
   `FunctionEntry` with `PushConst(NIL_VALUE)` + `Return`. This allows the
   compilation pipeline to complete without errors, enabling incremental testing.

**Field extraction strategy:**

Fields come from two sources:
- **Property declarations** in the class body: `x: number`, `x: number = 0`.
  These are `ts.PropertyDeclaration` nodes with a `name` and optional `type`
  and `initializer`.
- **Constructor `this.field = value` assignments.** Scan the constructor body for
  `ExpressionStatement` nodes containing `BinaryExpression` with
  `operatorToken === EqualsToken` where the LHS is `PropertyAccessExpression` on
  `this`. Extract the field name and infer the type from the RHS.

For type resolution, use `ctx.checker.getTypeAtLocation(node)` on the property
declaration or the assignment RHS, then map via `tsTypeToTypeId()`.

**Acceptance criteria:**

- Test: class declaration with constructor and method compiles without error
  (stub bodies).
- Test: class with `extends` -> diagnostic.
- Test: class with `static` member -> diagnostic.
- Test: class with `#private` field -> diagnostic.
- Test: registered struct type has correct fields and method declarations.
- Test: function table contains entries for `"ClassName$new"` and
  `"ClassName.methodName"`.

**Key risks:**

- **Type registration timing.** The struct type must be registered before any code
  that references the class type is compiled. Since `lowerProgram` does a first
  pass to collect all declarations before compiling bodies, this should work
  naturally. However, if a class references another class's type in its field
  declarations, the order of type registration matters. Both classes must be
  registered before either is compiled.
- **Field extraction from constructor.** Scanning for `this.field = value` in the
  constructor body is a heuristic. It handles the common pattern but may miss
  fields assigned conditionally or in nested blocks. TypeScript's type checker
  handles this correctly (it knows all properties from the class declaration),
  so the compiler can cross-reference extracted fields against the TS type to
  ensure completeness.
- **`tsTypeToTypeId` failures.** Fields whose types don't map to registered
  Mindcraft types (e.g., generic types, intersection types) will cause
  `tsTypeToTypeId` to return `undefined`. Need a diagnostic for unresolvable
  field types.

**Complexity:** Medium. The validator changes are trivial. The top-level scan and
type registration require careful field extraction logic.

---

### Phase C2: Constructor Compilation

**Objective:** Compile constructor bodies to create struct instances and initialize
fields. Support `new ClassName(args)` expressions.

**Prerequisites:** C1 (class type registration and function table slots).

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- implement constructor body
  lowering and `NewExpression` handling.

**Concrete deliverables:**

1. **Constructor body lowering.** Replace the C1 stub with a real
   `lowerClassConstructor` function:
   - Create a `LowerContext` with parameter locals for the constructor's declared
     parameters (starting at local 0 for the first user param -- constructors
     do not receive an implicit `this` parameter; they create it).
   - Emit `StructNew(typeId)` to create the instance.
   - Store the new struct into a dedicated local (`thisLocal`, allocated via
     `ScopeStack`).
   - Process **property declarations with initializers** (e.g., `x: number = 0`):
     for each, load `thisLocal`, push field name, evaluate initializer, emit
     `StructSet`, store back to `thisLocal`. These run before the constructor body.
   - Lower the constructor body statements. Within this body, `this` references
     resolve to `thisLocal` (see `this` handling below).
   - Emit `LoadLocal(thisLocal)` + `Return` at the end (constructor returns the
     new instance).

2. **`this` keyword support in constructors.** When `lowerExpression` encounters
   `ts.SyntaxKind.ThisKeyword`:
   - Look up `thisLocal` from the `LowerContext`. A new optional field
     `thisLocalIndex?: number` on `LowerContext` indicates we are inside a class
     constructor or method.
   - Emit `LoadLocal(thisLocalIndex)`.
   - If `thisLocalIndex` is undefined (not in a class context), emit a diagnostic.

3. **`this.field = value` assignment.** When `lowerBinaryExpression` encounters
   an assignment where the LHS is a `PropertyAccessExpression` on `this`:
   - Evaluate the RHS (pushes value onto stack).
   - Load `thisLocal` (pushes struct onto stack).
   - Push the field name as a string constant.
   - Swap stack positions so the struct is on top, then value, then field name
     (matching `StructSet` stack order: struct, fieldName, value -> struct).
   - Emit `StructSet`.
   - Store the result back to `thisLocal` (since `StructSet` returns the updated
     struct -- struct values are immutable and `StructSet` produces a new copy).

   Note: `StructSet` pops `struct, fieldName, value` and pushes a new struct.
   The actual stack order needs to match the VM's expectation. Check the existing
   `lowerObjectLiteralAsStruct` for the pattern (it pushes fieldName then value
   before `StructSet`, with the struct already below them on the stack).

4. **`new ClassName(args)` expression.** In `lowerExpression`, handle
   `ts.isNewExpression(expr)`:
   - Resolve the class name from `expr.expression` (must be an identifier).
   - Look up `"ClassName$new"` in the function table.
   - Lower each argument expression.
   - Emit `Call(funcIndex, argc)`.
   - If the class name is not in the function table, emit a diagnostic.

**Stack order detail for StructSet:**

From existing `lowerObjectLiteralAsStruct`:
```
StructNew(typeId)          // stack: [struct]
PushConst("fieldName")     // stack: [struct, "fieldName"]
<evaluate value>           // stack: [struct, "fieldName", value]
StructSet                  // stack: [struct'] (new struct with field set)
```

For `this.x = value` in constructor:
```
LoadLocal(thisLocal)       // stack: [struct]
PushConst("x")             // stack: [struct, "x"]
<evaluate value expr>      // stack: [struct, "x", value]
StructSet                  // stack: [struct'] (updated struct)
StoreLocal(thisLocal)      // stack: [] (thisLocal now holds updated struct)
```

If the assignment is used as an expression (rare but valid), the result value
should remain on the stack. This needs care -- `StructSet` pushes the struct, not
the assigned value. May need to `Dup` the value before `StructSet` and `Swap`
after, or accept that `this.x = value` as an expression yields the struct (which
differs from JS semantics). For MVP, treat `this.x = value` as a statement only
and handle expression context later if needed.

**Acceptance criteria:**

- Test: `new Point(3, 4)` creates a struct with `x: 3, y: 4`.
- Test: property initializer (`x: number = 0`) sets default before constructor body.
- Test: constructor body with `this.x = value` assignments.
- Test: constructor with multiple parameters.
- Test: `new` with wrong class name -> diagnostic.
- Test: `this` outside class context -> diagnostic.

**Key risks:**

- **Struct immutability semantics.** `StructSet` returns a *new* struct with the
  field updated (the brain runtime uses value semantics for structs). Every
  `this.field = value` must store the result back to `thisLocal`. Missing a
  store-back would lose the field assignment. This pattern is unusual compared to
  JS class semantics and must be handled carefully.
- **Property initializer ordering.** Property declarations with initializers
  (`x: number = 0`) execute before the constructor body in TS/JS semantics. The
  lowering must emit these initializations after `StructNew` but before the
  constructor body statements.
- **`this` before full initialization.** If the constructor body reads `this.x`
  before assigning it, the field will have the type's default value (nil). This
  matches the struct's initial state after `StructNew` but may surprise users.
  TypeScript's strict property initialization checks (`strictPropertyInitialization`)
  partially mitigate this.

**Complexity:** Medium-high. The `this` binding mechanism and struct immutability
(store-back pattern) are the main sources of complexity.

---

### Phase C3: Method Compilation

**Objective:** Compile instance method bodies. Support method calls on class-typed
variables.

**Prerequisites:** C2 (constructor compilation, `this` keyword support).

**Packages/files touched:**

- `packages/typescript/src/compiler/lowering.ts` -- implement method body lowering
  and method call dispatch for user-compiled methods.

**Concrete deliverables:**

1. **Method body lowering.** For each method declaration in the class:
   - Create a `FunctionEntry` similar to `lowerHelperFunction`.
   - Local 0 is the implicit `this` parameter (the instance struct).
   - User-declared parameters start at local 1.
   - Set `ctx.thisLocalIndex = 0` so `this` keyword resolves to `LoadLocal(0)`.
   - Lower the method body statements.
   - Emit `PushConst(NIL_VALUE)` + `Return` as the default tail (for methods
     that don't explicitly return).
   - The `FunctionEntry.name` is `"ClassName.methodName"`.
   - `FunctionEntry.numParams` = user params + 1 (for `this`).

2. **`this.field` read access in methods.** Already works from C2 -- `this` ->
   `LoadLocal(0)`, property access -> `GetField("fieldName")`.

3. **`this.field = value` in methods.** Same store-back pattern as C2, but
   `thisLocal` is at index 0 (the parameter slot). After `StructSet`, emit
   `StoreLocal(0)` to update the parameter's local. Callers will not see this
   mutation (struct values are passed by value in the VM), but the rest of the
   method body will see the updated field.

4. **Method call dispatch.** Modify `lowerStructMethodCall` (or add a parallel
   path) to distinguish between:
   - **Host-registered methods** (existing): dispatched via
     `HostCallArgs("StructType.methodName", argc)`.
   - **User-compiled methods** (new): dispatched via
     `Call(funcIndex("ClassName.methodName"), argc)` where the receiver is pushed
     as the first argument.

   Detection: check if the method name exists in the `functionTable`. If so, it
   is a user-compiled method and uses `Call`. Otherwise, fall back to the existing
   host function lookup via `getBrainServices().functions.get(fnName)`.

5. **`this.method(args)` calls.** When `this.methodName(args)` is used inside a
   method body, the receiver is `this` (LoadLocal 0). The dispatch follows the
   same user-compiled path: push `this`, push args, `Call(funcIndex, argc)`.

**Acceptance criteria:**

- Test: method body reads `this.x` correctly.
- Test: method body writes `this.x = value` (store-back pattern).
- Test: `obj.method(args)` calls a user-compiled method.
- Test: method calls another method on `this` (`this.someMethod()`).
- Test: method returns a computed value.
- Test: method with no explicit return -> returns nil.
- Test: multiple methods on the same class.

**Key risks:**

- **User-compiled vs host-registered disambiguation.** The `functionTable` check
  is the simplest approach but assumes no naming collisions between user classes
  and host-registered struct methods. Since host struct types (Context, SelfContext,
  etc.) are registered by the runtime and user classes are registered by the
  compiler, name collisions are unlikely but should be guarded against (diagnostic
  if a user class name matches a host struct name).
- **Struct value semantics in method calls.** Since structs are values (not
  references), mutations to `this` inside a method are local to that method
  invocation. The caller's copy of the struct is unchanged. This is a fundamental
  semantic difference from JS classes. Users must use return values to propagate
  state changes: `p = p.move(1, 2)` instead of `p.move(1, 2)`. This may be
  surprising and should be documented. Alternatively, the initial pass could
  defer mutable field writes in methods to a later phase and focus on read-only
  methods first.
- **Recursive method calls.** `this.methodName()` inside a method body should
  work naturally -- `this` (local 0) is pushed as the receiver, and the method
  is a compiled function. No special handling needed.

**Complexity:** Medium. The method body lowering reuses `lowerHelperFunction`'s
pattern closely. The dispatch disambiguation is the main new logic.

---

### Phase C4: Integration, Ambient Generation, and Multi-File Support

**Objective:** Ensure classes work end-to-end: ambient type generation for
cross-file references, interaction with existing language features (closures,
destructuring, callsite variables), and comprehensive edge case handling.

**Prerequisites:** C3 (method compilation and dispatch).

**Packages/files touched:**

- `packages/typescript/src/compiler/ambient.ts` -- ensure user-registered struct
  types appear in ambient declarations.
- `packages/typescript/src/compiler/compile.ts` / `project.ts` -- coordinate class
  type registration in multi-file compilation.
- `packages/typescript/src/compiler/lowering.ts` -- edge cases and integration.

**Concrete deliverables:**

1. **Ambient generation.** `buildAmbientDeclarations()` already generates
   interfaces for registered struct types via `generateStructInterface`. User class
   types registered as `StructTypeDef` will automatically appear as interfaces in
   the ambient declarations. Verify that:
   - Field types are correctly emitted.
   - Method signatures match the class declaration.
   - The generated interface is usable as a type annotation in other files.

2. **Multi-file class usage.** When a class is defined in an imported module:
   - The class type must be registered before the importing module is compiled.
   - The constructor function (`"ClassName$new"`) and methods
     (`"ClassName.methodName"`) must be in the function table of the importing
     module.
   - `new ClassName(args)` in the importing module must resolve to the correct
     function table entry.
   - This may require extending the `ImportedFunction` mechanism to include
     class constructors and methods, or registering class functions as imported
     functions during `collectImports`.

3. **Classes as parameter/return types.** Verify that class-typed variables can
   be passed to functions, returned from functions, stored in arrays, used in
   destructuring, and used in type annotations.

4. **Classes and closures.** Verify that closures can capture class-typed
   variables and call methods on them. The closure capture mechanism
   (capture-by-value) copies the struct value, so mutations inside the closure
   do not affect the outer scope (consistent with existing struct semantics).

5. **Edge cases:**
   - Class with no constructor (implicit default constructor: creates struct with
     property initializers only).
   - Class with no methods (data-only class).
   - Class with no fields (marker/tag class -- struct with no fields).
   - Constructor that calls a method on `this`.
   - Method that creates a new instance of its own class (`new Point(0, 0)` inside
     a Point method).

**Acceptance criteria:**

- Test: class defined in one file, used in another (multi-file).
- Test: class-typed variable passed to a function.
- Test: class-typed variable captured in a closure.
- Test: class with no explicit constructor compiles with default constructor.
- Test: class used with destructuring (`const { x } = point`).
- Test: array of class instances (`Point[]`).

**Key risks:**

- **Multi-file function table coordination.** The current multi-file system
  uses `ImportedFunction` for functions from other modules. Class constructors
  and methods need the same treatment. The function table is per-compilation-unit,
  so imported class functions must be allocated slots in the importing module's
  table.
- **Type registration ordering.** In multi-file scenarios, class types must be
  registered before any module that references them is compiled. The
  `moduleInitOrder` in `lowerProgram` handles initialization ordering but may
  need extension for type registration.
- **Ambient declaration correctness.** The generated interface must not have
  a `__brand` symbol (that is for native-backed structs only). User-created
  class structs should generate plain interfaces.

**Complexity:** Medium. Most of the infrastructure exists; the main work is
ensuring correct coordination across the multi-file pipeline.

---

## Deferred Phases (Post-MVP)

### Phase C5: Inheritance (`extends`)

**Objective:** Support single-class inheritance with constructor chaining and
method overrides.

**Scope:**

- `class Child extends Parent { ... }` syntax.
- Field merging: child struct includes all parent fields plus child-specific fields.
- `super(args)` in child constructor -> calls parent constructor, merges fields.
- Method override: child method with same name as parent method takes precedence.
- `super.method(args)` calls the parent's version of an overridden method.

**Design sketch:**

- **Struct registration:** Child struct type includes parent fields (flattened).
  No runtime prototype chain -- fields are statically merged at compile time.
- **Constructor chaining:** `super(args)` compiles to
  `Call("Parent$new", args)`, then copies returned parent fields into the child
  struct via `StructSet` for each parent field.
- **Method override dispatch:** At compile time, the function table maps
  `"Child.methodName"` to the child's version. When calling a method on a
  variable typed as `Parent`, if the runtime value is actually a `Child`, the
  call would go to `Parent.method` -- no polymorphism. True polymorphism requires
  vtable dispatch, which is a significant runtime addition.
- **Without vtable:** Method dispatch is static (based on the declared type, not
  the runtime type). This is a limitation but avoids VM complexity.

**Estimated complexity:** High. Field merging and `super()` are moderate; true
polymorphic dispatch is a major runtime undertaking.

---

### Phase C6: Static Members

**Objective:** Support `static` methods and properties on classes.

**Design sketch:**

- Static methods compile to top-level functions in the function table, named
  `"ClassName.staticMethodName"`.
- Static properties compile to callsite variables (module-level persistent state),
  named `"ClassName.staticPropName"`.
- `ClassName.staticMethod(args)` compiles to `Call(funcIndex)`.
- `ClassName.staticProp` compiles to `LoadCallsiteVar(index)`.

**Estimated complexity:** Low-medium. Mostly naming convention and dispatch
routing.

---

## Implementation Order

Recommended sequence based on dependencies:

1. **Phase C1 (Scaffolding and type registration)** -- prerequisite for everything;
   establishes the class-to-struct registration pipeline and function table layout.

2. **Phase C2 (Constructor compilation)** -- enables `new ClassName(args)` and
   field initialization; introduces `this` keyword support.

3. **Phase C3 (Method compilation)** -- enables instance methods; introduces
   user-compiled method dispatch alongside existing host method dispatch.

4. **Phase C4 (Integration)** -- ambient generation, multi-file support, and edge
   cases. Polishes the feature for production use.

5. **Phase C5 (Inheritance)** -- deferred. Only pursued if the use case demands it.

6. **Phase C6 (Static members)** -- deferred. Low complexity but low priority.

---

## Phase Log

Completed phases are recorded here with dates, actual outcomes, and deviations.

(No phases completed yet.)
