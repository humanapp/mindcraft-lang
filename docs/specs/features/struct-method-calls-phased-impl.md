# Struct Method Calls and Context Refactor -- Detour Phase Plan

**Status:** Implemented
**Created:** 2026-03-23
**Related:**

- [typescript-compiler-phased-impl.md](typescript-compiler-phased-impl.md) (detour between Phase 13 and Phase 14)
- [ctx-as-native-struct.md](ctx-as-native-struct.md) (design spec)
- [user-authored-sensors-actuators.md](user-authored-sensors-actuators.md) (Section E, "Property access")

---

## Motivation

Phase 13 of the TypeScript compiler phased plan revealed a design weakness: the `ctx`
parameter was implemented as a compile-time phantom with ~80 lines of special-case
logic. This prevents `ctx` from behaving like a regular value and diverges from the
spec (Section E of user-authored-sensors-actuators.md describes `LoadLocal(ctx_index)` +
`GetField("self")` -- ctx as a real value on the stack).

The fix is to make `ctx` a native-backed struct (consistent with `ActorRef` in
apps/sim). However, a gating feature is missing: the compiler has no general-purpose
mechanism for method calls on struct-typed values. The `fieldGetter` pattern handles
field reads (`obj.field` -> `GET_FIELD`), but method calls like
`ctx.self.getVariable("x")` require pushing arguments and dispatching to a host
function.

This detour implements struct method calls as a general-purpose compiler feature,
then refactors `ctx` to use it.

## Phasing Summary

| Phase | Scope                                       | Packages         | Effort |
| ----- | ------------------------------------------- | ---------------- | ------ |
| 13.5a | Struct method declarations in type registry | core             | Small  |
| 13.5b | Struct method call compilation              | typescript       | Medium |
| 13.5c | Context as native-backed struct             | core, typescript | Medium |

---

## Phase 13.5a: Struct method declarations in the type registry

**Objective:** Extend `StructTypeShape` with a `methods` field so that struct types
can declare typed methods. This metadata is consumed by the compiler (for method
call validation and ambient declaration generation) and the runtime (for host
function dispatch). No VM changes.

**Packages/files touched:**

- `packages/core/src/brain/interfaces/type-system.ts` -- add `StructMethodDecl`
  interface and `methods?: List<StructMethodDecl>` to `StructTypeShape`

**Design:**

```typescript
export interface StructMethodDecl {
  name: string;
  params: List<{ name: string; typeId: TypeId }>;
  returnTypeId: TypeId;
  isAsync?: boolean;
}

export interface StructTypeShape {
  fields: List<{ name: string; typeId: TypeId }>;
  /** Method declarations for ambient generation and compiler validation. */
  methods?: List<StructMethodDecl>;
  nominal?: boolean;
  fieldGetter?: StructFieldGetterFn;
  fieldSetter?: StructFieldSetterFn;
  snapshotNative?: StructSnapshotNativeFn;
}
```

The `methods` list declares the signatures but not the implementations. Runtime
dispatch uses the FunctionRegistry: the compiler resolves `expr.method(args)`
on a struct of type `T` to the host function name `"T.methodName"`. The host
function must be separately registered in the FunctionRegistry with that name.

This separation is intentional:

- Method metadata on the struct type enables ambient declaration generation
  and compile-time validation
- The FunctionRegistry handles runtime dispatch (host function lookup by ID)
- Apps register the host function implementations alongside the struct types

**Convention:** Host functions backing struct methods are registered in the
FunctionRegistry with the name `"TypeName.methodName"`. The compiler derives
this name from the struct type name and the method name at the call site.

**Concrete deliverables:**

1. `StructMethodDecl` interface added to `type-system.ts`
2. `StructTypeShape.methods` field added (optional, `List<StructMethodDecl>`)
3. Existing struct type registrations (e.g., `ActorRef` in apps/sim) are unaffected
   (the field is optional)
4. Core builds for all three targets (Node.js, ESM, Roblox-TS)

**Acceptance criteria:**

- `npm run build` succeeds in `packages/core` (all three targets)
- `npm run check` (biome) passes
- `npm test` passes in `packages/core` (no regressions)
- Existing struct type registrations compile without changes

**Key risks:**

- **`List` import in Roblox target.** The `List<StructMethodDecl>` type must use the
  platform `List` type, which is already used throughout `StructTypeShape`. No new
  import needed.
- **Minimal surface area.** This phase only adds a type interface and an optional
  field. No behavioral changes. Risk is low.

---

## Phase 13.5b: Struct method call compilation

**Objective:** Add general-purpose type-based method dispatch for struct types to the
compiler. When the compiler sees `expr.method(args)` where `expr` has a registered
struct type with a matching method declaration, it emits `HOST_CALL_ARGS` with the
struct value as the first argument.

**Prerequisites:** Phase 13.5a (struct method declarations in type registry).

**Packages/files touched:**

- `packages/ts-compiler/src/compiler/lowering.ts` -- add `lowerStructMethodCall()`
  dispatch function, wire it into `lowerCallExpression`
- `packages/ts-compiler/src/compiler/ambient.ts` -- extend `generateStructInterface()`
  to emit method signatures from `StructMethodDecl` metadata
- `packages/ts-compiler/src/compiler/codegen.spec.ts` -- new tests for struct method
  calls

**Design -- Compiler lowering:**

In `lowerCallExpression`, after the existing `lowerCtxMethodCall` dispatch (which
will be removed in Phase 13.5c) and before `lowerListMethodCall`, add a new check:

```
if (ts.isPropertyAccessExpression(expr.expression)) {
  if (lowerStructMethodCall(expr, expr.expression, ctx)) return;
  // ... existing list method dispatch ...
}
```

`lowerStructMethodCall` implementation:

1. Get the type of `propAccess.expression` (the receiver) via the TS checker
2. Call `resolveStructType()` (already exists) to get the `StructTypeDef`
3. If not a struct type, return false
4. Look up `propAccess.name.text` in `structDef.methods`
5. If no matching method, return false (fall through to other dispatch paths)
6. Derive the host function name: `"${structDef.name}.${methodName}"`
7. Look up the host function in `getBrainServices().functions.get(fnName)`
8. If not found, emit a diagnostic and return true (claimed the call but errored)
9. Lower the receiver expression (pushes the struct value onto the stack)
10. Lower all argument expressions
11. Emit `{ kind: "HostCallArgs", fnName, argc: args.length + 1 }` (receiver +
    user args)

The struct value is argument 0. The host function unwraps it:
`(args.v.get("0") as StructValue).native` to get the native handle.

**Design -- Ambient declaration generation:**

Extend `generateStructInterface()` to iterate `def.methods` (if present) and
emit method signatures:

```typescript
def.methods?.forEach((method) => {
  const params = method.params
    .toArray()
    .map((p) => `${p.name}: ${typeIdToTs(p.typeId)}`)
    .join(", ");
  const returnType = typeIdToTs(method.returnTypeId);
  const prefix = method.isAsync ? "async " : "";
  // or: wrap return type in Promise<T> for async methods
  const fullReturn = method.isAsync ? `Promise<${returnType}>` : returnType;
  result += `    ${method.name}(${params}): ${fullReturn};\n`;
});
```

For native-backed structs, methods are emitted alongside the readonly fields
and `__brand` symbol.

**Design -- Async method detection:**

The `StructMethodDecl.isAsync` flag is informational for ambient generation (to
emit `Promise<T>` return type). The actual async/sync dispatch decision for
`HOST_CALL_ARGS` vs `HOST_CALL_ARGS_ASYNC` is determined by the FunctionRegistry
entry's `isAsync` field (same as all other host function calls). Phase 18 will
handle async emission; this phase focuses on sync method dispatch only.

**Concrete deliverables:**

1. `lowerStructMethodCall()` function in `lowering.ts`
2. Struct method calls lower to `HostCallArgs` with the struct as arg 0
3. Unknown method names produce a compile diagnostic
4. `generateStructInterface()` in `ambient.ts` emits method signatures
5. End-to-end test: register a struct with a method, register the backing host
   function, compile a call to the method, execute in the VM, verify the result

**Acceptance criteria:**

- Test: `structExpr.method(arg)` -> `HostCallArgs("StructName.method", 2)` (struct + arg)
- Test: method with no args -> `HostCallArgs("StructName.method", 1)` (struct only)
- Test: method with multiple args -> correct argc (struct + all args)
- Test: unknown method on struct -> compile diagnostic
- Test: end-to-end execution - host function receives struct value as arg 0 and
  returns correct result
- Test: ambient declarations include method signatures for structs with methods
- Test: async method declaration generates `Promise<T>` return type in ambient
- `npm run typecheck` and `npm run check` pass in `packages/ts-compiler`
- `npm test` passes in `packages/ts-compiler` (existing + new tests)

**Key risks:**

- **Dispatch ordering in `lowerCallExpression`.** Struct method dispatch must be
  checked after ctx method dispatch (Phase 13's code, removed in 13.5c) but before
  list method dispatch. If a struct happens to have a method named `push` or
  `forEach`, the struct dispatch should take precedence. During Phase 13.5b, the ctx
  dispatch still exists (removed in 13.5c), so both paths coexist temporarily. Place
  struct method dispatch between ctx and list method dispatch. In Phase 13.5c, the
  ctx dispatch is removed, and struct method dispatch handles what ctx dispatch
  used to handle.

- **Method name collisions with fields.** A struct could declare both a field and a
  method with the same name. This would be a registration error. The TS checker
  prevents this at the source level (ambient interfaces cannot duplicate member
  names), so the compiler does not need to validate this.

- **Return type of host functions.** The VM's `HOST_CALL_ARGS` handler returns the
  value the host function returns. The compiler trusts the return type declared in
  `StructMethodDecl` (which flows to ambient declarations and TS type checking).
  There is no runtime type validation of host function return values.

- **Test harness setup.** Tests need a struct type with methods registered in the
  type registry AND a corresponding host function in the FunctionRegistry. This
  follows the same pattern as existing tests (e.g., the `NativeActor` struct in
  codegen.spec.ts) with one addition: the host function registration must use the
  `"TypeName.methodName"` naming convention.

---

## Phase 13.5c: Context as native-backed struct

**Objective:** Register `Context`, `SelfContext`, and `EngineContext` as native-backed
struct types with `fieldGetter`s and method declarations. Make `ctx` a real value on
the stack (passed as the first argument to `onExecute` / `onPageEntered`). Remove all
ctx compile-time phantom special-casing from the compiler. Remove the hardcoded
`Context` interface from ambient declarations. Update tests.

**Prerequisites:** Phase 13.5b (struct method call compilation).

**Packages/files touched:**

- `packages/core/src/brain/types/` (or `registration/`) -- register Context,
  SelfContext, EngineContext struct types with fieldGetters and method declarations.
  Exact location depends on where core type registration happens (likely alongside
  `registerCoreTypes()`)
- `packages/ts-compiler/src/runtime/authored-function.ts` -- update `createUserTileExec`
  to create a Context `StructValue` and prepend it to the fiber args
- `packages/ts-compiler/src/compiler/lowering.ts` -- remove all ctx special-casing:
  `ctxSymbol` from `LowerContext`, `isCtxExpression()`, `isCtxSelfAccess()`,
  `isCtxEngineAccess()`, `lowerCtxMethodCall()`, and the ctx-alias skip in
  `lowerVariableDeclarationList()`. Update `onExecute` / `onPageEntered` function
  lowering to allocate `ctx` as local 0 (a real parameter)
- `packages/ts-compiler/src/compiler/ambient.ts` -- remove the hardcoded `Context`
  interface from `AMBIENT_MODULE_END`. Context/SelfContext/EngineContext are now
  generated from the type registry like all other struct types. Update
  `SensorConfig` and `ActuatorConfig` interfaces to reference the generated
  `Context` type. Update `onPageEntered` signature
- `packages/ts-compiler/src/compiler/codegen.spec.ts` -- update existing Phase 13
  tests (ctx tests now follow the struct method pattern), register Context types
  in test harness, update host function names to match `"TypeName.methodName"`
  convention

**Design -- Type registration (core):**

Three struct types are registered, all native-backed with native = `ExecutionContext`:

**Context** -- registered with `addStructType("Context", { ... })`:

- Fields: `time: number`, `dt: number`, `tick: number`, `self: SelfContext`,
  `engine: EngineContext`
- Methods: none (all members are fields or sub-struct accessors)
- fieldGetter: returns `mkNumberValue(ctx.time)` for `"time"`, etc. For `"self"`
  and `"engine"`, lazily creates SelfContext / EngineContext struct values wrapping
  the same `ExecutionContext` native

**SelfContext** -- registered with `addStructType("SelfContext", { ... })`:

- Fields: none at core level (app may add fields like `position` via a separate
  registration or by including them at registration time)
- Methods: `getVariable(name: string): unknown`, `setVariable(name: string,
value: unknown): void`
- fieldGetter: returns app-injected field values (or undefined for unknown fields)
- Corresponding host functions: `"SelfContext.getVariable"`,
  `"SelfContext.setVariable"` registered in the FunctionRegistry

**EngineContext** -- registered with `addStructType("EngineContext", { ... })`:

- Fields: none at core level
- Methods: none at core level (app-specific methods like `queryNearby`,
  `moveAwayFrom` are registered by the app)
- fieldGetter: app-injected
- Corresponding host functions registered by the app (e.g., sim registers
  `"EngineContext.queryNearby"`, `"EngineContext.moveAwayFrom"`)

The registration site must be accessible to both core and app code. Core registers
the base struct types and core methods. Apps extend by registering additional host
functions for app-specific methods.

**Design -- Fiber arg passing:**

In `createUserTileExec`, the `exec` function currently passes args as:

```typescript
const fiberArgs = hasParams ? List.from<Value>([args]) : List.empty<Value>();
```

After this change, `ctx` occupies local slot 0:

```typescript
const ctxStruct = mkStructValue(contextTypeId, Dict.empty(), executionContext);
const fiberArgs = hasParams ? List.from<Value>([ctxStruct, args]) : List.from<Value>([ctxStruct]);
```

The function's `numParams` increases by 1 (ctx is always passed). The lowering
allocates `ctx` as local 0, params map as local 1 (if present).

Similarly, `onPageEntered` receives (ctxStruct) as its argument.

**Design -- Compiler ctx removal:**

Delete from `lowering.ts`:

1. `ctxSymbol: ts.Symbol | undefined` from `LowerContext` interface
2. The block in `lowerOnExecuteBody` / `lowerOnPageEnteredBody` that extracts and
   stores the ctx parameter symbol
3. `isCtxExpression()` function (~20 lines)
4. `isCtxSelfAccess()` function
5. `isCtxEngineAccess()` function
6. `lowerCtxMethodCall()` function (~35 lines)
7. The `if (isCtxExpression(...)) continue;` skip in `lowerVariableDeclarationList()`
8. The `if (isCtxExpression(expr.expression, ctx))` block in `lowerPropertyAccess()`
   that handles `ctx.time`, `ctx.dt`, `ctx.tick`, `ctx.self`, `ctx.engine`

After removal, `ctx` is a normal parameter:

- `ctx.time` resolves via: `LoadLocal(0)` (ctx) + `GetField("time")` (struct field
  read, dispatches to Context fieldGetter)
- `ctx.self.getVariable("x")` resolves via: `LoadLocal(0)` + `GetField("self")`
  (returns SelfContext struct) + struct method dispatch (pushes SelfContext, pushes
  "x", emits `HostCallArgs("SelfContext.getVariable", 2)`)
- `const c = ctx; c.time` works naturally (StoreLocal + LoadLocal + GetField)

The `lowerCallExpression` dispatch order becomes:

1. Direct function call (identifier)
2. Struct method call (`lowerStructMethodCall` -- now handles what `lowerCtxMethodCall`
   did, plus any other struct methods)
3. List method call (`lowerListMethodCall`)
4. Indirect call (CallIndirect)

**Design -- Ambient declaration removal:**

Remove the hardcoded `Context` interface from `AMBIENT_MODULE_END`:

```typescript
export interface Context {
  time: number;
  dt: number;
  self: {
    position: { x: number; y: number };
    getVariable(name: string): unknown;
    setVariable(name: string, value: unknown): void;
  };
  engine: {
    queryNearby(position: { x: number; y: number }, range: number): unknown[];
    moveAwayFrom(...): Promise<void>;
  };
}
```

This is replaced by the auto-generated interfaces from the type registry:

- `Context` is generated with fields (`time`, `dt`, `tick`, `self`, `engine`) and
  no methods
- `SelfContext` is generated with methods (`getVariable`, `setVariable`) and
  app-specific fields
- `EngineContext` is generated with app-specific methods

The `SensorConfig.onExecute(ctx: Context, ...)` and `ActuatorConfig.onExecute(ctx:
Context, ...)` references in `AMBIENT_MODULE_END` continue to reference `Context` by
name. Since `Context` is now a generated interface (rather than hardcoded), the name
must match the registered struct type name exactly.

**Design -- Host function name migration:**

Current host function names -> new names:

- `"ctx.time"` -> removed (field read via GetField, no host function needed)
- `"ctx.dt"` -> removed
- `"ctx.tick"` -> removed
- `"self.getVariable"` -> `"SelfContext.getVariable"`
- `"self.setVariable"` -> `"SelfContext.setVariable"`
- `"engine.queryNearby"` -> `"EngineContext.queryNearby"`
- `"engine.moveAwayFrom"` -> `"EngineContext.moveAwayFrom"`

Host function implementations change to receive the struct as arg 0:

```typescript
// Before (self.getVariable):
exec: (ctx, args) => {
  const name = (args.v.get("0") as StringValue).v;
  return ctx.getVariable(name) ?? NIL_VALUE;
};

// After (SelfContext.getVariable):
exec: (_ctx, args) => {
  const selfStruct = args.v.get("0") as StructValue;
  const execCtx = selfStruct.native as ExecutionContext;
  const name = (args.v.get("1") as StringValue).v;
  return execCtx.getVariable(name) ?? NIL_VALUE;
};
```

Note: for Context-based methods, the host function could also use the fiber's
`ExecutionContext` directly (it is always the first parameter of `exec`). Using
the struct's native is more general-purpose and consistent with non-Context
structs.

**Concrete deliverables:**

1. Context, SelfContext, EngineContext struct types registered with fieldGetters
   and method declarations
2. `SelfContext.getVariable` and `SelfContext.setVariable` host functions registered
   in the FunctionRegistry
3. `createUserTileExec` passes Context struct as fiber arg 0
4. All ctx special-casing removed from lowering.ts (~80 lines deleted)
5. Hardcoded Context interface removed from ambient.ts
6. Context/SelfContext/EngineContext appear in auto-generated ambient declarations
7. All existing ctx tests updated to use the struct method pattern
8. `const c = ctx; c.time` works naturally without compiler tricks
9. `ctx.self` and `ctx.engine` are regular struct field reads returning sub-structs

**Acceptance criteria:**

- Test: `ctx.time` compiles to `LoadLocal(0)` + `GetField("time")` (no HOST_CALL_ARGS)
- Test: `ctx.dt` compiles to `LoadLocal(0)` + `GetField("dt")`
- Test: `ctx.self.getVariable("x")` compiles to `LoadLocal(0)` + `GetField("self")`
  - `HostCallArgs("SelfContext.getVariable", 2)`
- Test: `ctx.self.setVariable("x", val)` -> correct method dispatch
- Test: `ctx.engine.queryNearby(pos, 5)` -> correct method dispatch
  (when app registers EngineContext methods)
- Test: `const c = ctx; c.time` works (StoreLocal + LoadLocal + GetField)
- Test: `const s = ctx.self; s.getVariable("x")` works (struct value stored, method
  called on stored value)
- Test: end-to-end execution - `ctx.time` returns the correct time value from
  ExecutionContext
- Test: end-to-end execution - `ctx.self.getVariable("x")` reads from the brain's
  variable store
- Test: `ctx.self = something` -> compile error (readonly field on native-backed struct)
- Test: ambient declarations contain `Context`, `SelfContext`, `EngineContext`
  interfaces with correct fields and methods
- Regression: `params.speed` still resolves to `LoadLocal` (not GetField)
- Regression: `items.length` still resolves to `IrListLen`
- Regression: struct property access (`pos.x`) still works via GetField
- `npm run typecheck` and `npm run check` pass in `packages/ts-compiler`
- `npm test` passes in both `packages/core` and `packages/ts-compiler`
- `npm run build` succeeds in `packages/core` (all three targets)

**Key risks:**

- **Context type registration location.** The Context types need to be registered
  after `registerCoreTypes()` but before the compiler runs. If they are registered in
  core, they are available everywhere. If they are registered in the typescript
  package, they are only available when the compiler is loaded. Core is the right
  place since the Context types are fundamental to the runtime. The exact registration
  file needs investigation -- it may be a new function called from the existing
  registration chain, or added to `registerCoreTypes()` directly.

- **App-specific methods and fields.** SelfContext and EngineContext may have
  app-specific members (e.g., sim's `queryNearby`). The struct type must be registered
  at the core level (for ambient generation), but app-specific methods are only known
  at app boot time. Options:
  - Register an "empty" SelfContext/EngineContext in core, and have the app add
    methods later (requires a mutable struct type definition or a re-registration API)
  - Have the app register the full struct types (core does not register them at all)
  - Use a two-pass registration: core registers base types, app calls an "extend"
    API to add methods

  The simplest approach for now: the app is responsible for registering SelfContext
  and EngineContext (similar to how apps register ActorRef). Core registrations only
  cover Context itself. The SelfContext/EngineContext types are app-specific.

  However, `getVariable`/`setVariable` are core methods (they use ExecutionContext
  directly). If SelfContext is app-registered, the app must include these core methods
  in its registration. This may require a helper function in core that returns the
  base method declarations that app registrations should include.

- **numParams adjustment.** The compiled function's `numParams` (in
  `FunctionBytecode`) must increase by 1 to account for the ctx argument. The
  lowering already calculates numParams based on the parameters it allocates. With
  `ctx` as a real parameter, this happens naturally. But the fiber spawn site in
  `createUserTileExec` must match -- it now always passes at least 1 argument (the
  ctx struct).

- **Test churn.** All Phase 13 ctx tests produce different bytecode after this
  change (LoadLocal + GetField instead of HostCallArgs; struct method dispatch
  instead of direct ctx host calls). The test assertions need systematic updating.
  The test harness also needs Context/SelfContext type registrations and host function
  registrations.

- **`onPageEntered` receives ctx.** Currently `onPageEntered(ctx: Context)` is
  compiled with `ctx` as a phantom. After this change, the wrapper function that
  calls `onPageEntered` must pass the Context struct. Both the wrapper and the user
  function body need the ctx parameter in local slot 0.

---

## Dependency Graph

```
Phase 13 (GET_FIELD -- done)
    |
    v
Phase 13.5a (StructMethodDecl in type-system.ts)
    |
    v
Phase 13.5b (lowerStructMethodCall in compiler)
    |
    v
Phase 13.5c (Context as native struct, remove ctx phantom)
    |
    v
Phase 14 (for...of -- existing plan)
```

Phases 13.5a and 13.5b could potentially be combined into a single phase since
13.5a is small. They are separated here for clarity and to keep each phase focused
on one package.

---

## Impact on Subsequent Phases

- **Phase 14 (for...of):** No impact. for...of does not interact with ctx or struct
  methods.

- **Phase 18 (async host call emission):** After this refactor, async method calls
  (e.g., `ctx.engine.moveAwayFrom(...)`) go through the struct method dispatch path.
  Phase 18 adds the async/sync distinction: when `lowerStructMethodCall` resolves a
  host function that is async (via `BrainFunctionEntry.isAsync`), it emits
  `IrHostCallArgsAsync` instead of `IrHostCallArgs`. The mechanism is identical to
  how Phase 18 would have worked with the old ctx direct dispatch -- the only
  difference is the host function name (`"EngineContext.moveAwayFrom"` instead of
  `"engine.moveAwayFrom"`).

- **Phase 19 (await emission):** No structural impact. `await` on an async struct
  method call follows the same pattern as any other async host call.

- **Phase 20 (async tile execution):** `createUserTileExec` already creates a shallow
  copy of ExecutionContext. After this refactor, it wraps the copy in a Context struct.
  The async execution path (scheduler-based fiber resumption) is unchanged.

---

## Open Questions (from ctx-as-native-struct.md)

1. **SelfContext and EngineContext fields at core level.** Proposed resolution:
   SelfContext and EngineContext are registered by the app, not core. Core provides
   Context only. Apps include core methods (getVariable, setVariable) in their
   SelfContext registration via a shared helper. This avoids the need for mutable
   type definitions or re-registration.

2. **Method registration API.** Resolved: methods are declared on `StructTypeShape`
   (for compile-time metadata) and registered as host functions in the FunctionRegistry
   (for runtime dispatch) using the `"TypeName.methodName"` naming convention. No new
   API surface.

3. **Return type of struct methods in ambient declarations.** Resolved:
   `StructMethodDecl` carries `returnTypeId` and `isAsync`. The ambient generator
   uses these to produce correct TypeScript signatures. Async methods are emitted
   with `Promise<T>` return type.
