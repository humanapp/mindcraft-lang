# Context as Native-Backed Struct

**Status:** Implemented
**Created:** 2026-03-23
**Related:** [user-authored-sensors-actuators.md](user-authored-sensors-actuators.md), [typescript-compiler-phased-impl.md](typescript-compiler-phased-impl.md) (Phase 13)

## Problem

Phase 13 of the TypeScript compiler implemented `ctx` (the execution context parameter
in `onExecute` / `onPageEntered`) as a compile-time phantom -- the compiler tracks its
TypeScript symbol, intercepts property accesses (`ctx.time`, `ctx.self.getVariable(...)`),
and rewrites them to `HOST_CALL_ARGS` instructions. The `ctx` parameter is never passed
as a VM argument; it has no runtime representation on the stack.

This creates hidden limitations:

- `ctx` cannot be stored in a variable (`const c = ctx` requires special-case alias
  tracking that skips bytecode emission)
- `ctx.self` and `ctx.engine` cannot be standalone values -- they are prefixes in a
  naming convention for host function dispatch
- The compiler has ~80 lines of ctx-specific logic (symbol tracking, alias detection,
  recursive initializer following, method dispatch) that would be unnecessary if ctx
  were a regular value
- The ambient `Context` interface is hardcoded in a string template rather than generated
  from the type registry like all other types

The proposal: make `ctx` a regular native-backed struct, consistent with the existing
pattern used by `ActorRef` in apps/sim.

## Background: Native-Backed Structs

The codebase already has full support for native-backed structs. A `StructTypeDef` can
declare:

- `fieldGetter`: called by `GET_FIELD` instead of Dict lookup. Receives `(source, fieldName, executionContext)`.
- `fieldSetter`: called by `SET_FIELD` instead of Dict mutation.
- `snapshotNative`: called during deep-copy to materialize the `native` handle.

The `native` field on a `StructValue` holds an opaque host reference. For example,
`ActorRef` in apps/sim stores an `Actor` (or a resolver function) as its native, and
the fieldGetter reads live properties from the Actor.

The GET_FIELD opcode handler (vm.ts) already checks for `typeDef?.fieldGetter` and
dispatches accordingly. No VM changes are needed for the field-read path.

## Design

### Type Registration (packages/core)

Register three struct types with fieldGetters:

**Context** -- native = `ExecutionContext`

- Fields: `time: number`, `dt: number`, `tick: number`, `self: SelfContext`, `engine: EngineContext`
- fieldGetter returns:
  - `"time"` -> `mkNumberValue(ctx.time)`
  - `"dt"` -> `mkNumberValue(ctx.dt)`
  - `"tick"` -> `mkNumberValue(ctx.currentTick)`
  - `"self"` -> a SelfContext struct value wrapping the same ExecutionContext
  - `"engine"` -> an EngineContext struct value wrapping the same ExecutionContext

**SelfContext** -- native = `ExecutionContext`

- Fields: (position, etc. -- app-dependent; potentially none at the core level)
- Methods: `getVariable(name)`, `setVariable(name, value)`, `switchPage(id)`, `restartPage()`

**EngineContext** -- native = `ExecutionContext`

- Fields: (none at core level)
- Methods: `queryNearby(position, range)`, `moveAwayFrom(actor, position, speed)`

Sub-struct values (SelfContext, EngineContext) can be lazily created by the Context
fieldGetter rather than allocated up-front.

### Compiler Changes (packages/typescript)

1. **Argument passing**: `onExecute(ctx, params)` currently compiles to `numParams: 0`
   (no tile params) or `numParams: 1` (with tile params, where local 0 is the params
   map). After this change, ctx occupies a real local slot. The function would have
   `numParams: 1` (ctx only) or `numParams: 2` (ctx + params map).

2. **Remove all ctx special-casing**: Delete `ctxSymbol` from `LowerContext`,
   `isCtxExpression`, `isCtxSelfAccess`, `isCtxEngineAccess`, `lowerCtxMethodCall`,
   and the ctx-alias skip in `lowerVariableDeclarationList`. Property accesses like
   `ctx.time` become normal GetField on a struct. `const c = ctx` becomes a normal
   StoreLocal/LoadLocal.

3. **Ambient declarations**: Remove the hardcoded `Context` interface from the string
   template in ambient.ts. Register Context/SelfContext/EngineContext in the type
   registry so `buildAmbientDeclarations()` generates them automatically like all
   other struct types.

### Fiber Spawn Changes (packages/core)

Every site that calls `spawnFiber` for user-authored tile functions must create a
Context `StructValue` (with native = ExecutionContext) and prepend it to the args list.
This is a small change at the Brain's think/tick loop level.

### Gating Feature: Struct Method Calls

This is the **central design challenge**. The fieldGetter pattern handles `obj.prop`
(field reads). But `ctx.self.getVariable("x")` and `ctx.engine.queryNearby(pos, range)`
are method calls with arguments -- not field reads.

The compiler currently has two patterns for method calls on non-function values:

- List methods (`.push()`, `.filter()`, etc.) -- hard-coded in the compiler
- ctx methods -- the special-cased `lowerCtxMethodCall` being removed

Neither is a general-purpose mechanism. A new feature is needed: **type-based method
dispatch for structs**.

#### Proposed approach

The compiler resolves `structExpr.method(args)` by:

1. Determine the type of `structExpr` (via the TypeScript checker)
2. If it resolves to a registered struct type, look up `"TypeName.methodName"` in
   the FunctionRegistry
3. If found, push the struct value, then push args, emit
   `HOST_CALL_ARGS("TypeName.methodName", argc + 1)` where the struct is the first
   argument
4. The host function receives the struct as arg 0, unwraps the native, and dispatches

This is a generalization of the current ctx method dispatch. Any native-backed struct
could benefit (e.g., ActorRef could gain methods in the future). The key difference
from the current approach: the struct value is on the stack as a real argument, and
the name is derived from the type name rather than hard-coded.

Alternatively, the struct value does not need to be on the stack at all for Context
methods -- the host function already receives the `ExecutionContext` via the fiber
context argument. But passing the struct makes the mechanism general-purpose for
non-Context native structs.

## Complexity Assessment

| Area                                                    | Effort       | Notes                                                         |
| ------------------------------------------------------- | ------------ | ------------------------------------------------------------- |
| Type registration (Context, SelfContext, EngineContext) | Small        | Follows existing ActorRef pattern                             |
| Remove compiler ctx special-casing                      | Small        | Delete ~80 lines                                              |
| Struct method call support in compiler                  | Medium-Large | New general-purpose feature in `lowerCallExpression`          |
| Ambient declaration generation for Context              | Small        | Remove hardcoded template, register in type system            |
| Fiber spawn changes (prepend ctx arg)                   | Small        | One change per spawn site                                     |
| Adjust numParams in onExecute/onPageEntered lowering    | Small        | ctx occupies local slot 0                                     |
| Test updates                                            | Medium       | All Phase 13 tests need adjusting; host function names change |

The struct method call support is the gating feature. Without it, `ctx.time` and
`ctx.dt` work (field reads via GetField), but `ctx.self.getVariable()` and
`ctx.engine.queryNearby()` have no compilation path.

## Phasing

**Phase A -- Struct method dispatch (compiler)**
Add general-purpose type-based method dispatch for struct types. When the compiler
sees `expr.method(args)` where `expr` has a struct type, it looks up
`"TypeName.methodName"` in the FunctionRegistry and emits HOST_CALL_ARGS with the
struct as the first argument.

**Phase B -- Context as native struct (core + compiler)**
Register Context/SelfContext/EngineContext struct types with fieldGetters. Update
fiber spawn sites to pass the Context struct. Remove all ctx special-casing from the
compiler. Update ambient declarations to generate from the registry. Update tests.

## Open Questions

1. **SelfContext and EngineContext fields**: At the core level, what fields (if any)
   should these have beyond methods? The sim app adds `position` to ActorRef. Should
   `self.position` be a core concept or app-specific?

2. **Method registration API**: Should struct methods be registered alongside the
   struct type (as part of StructTypeShape), or separately in the FunctionRegistry
   with a naming convention (`"TypeName.methodName"`)?

3. **Return type of struct methods in ambient declarations**: Currently the Context
   interface hardcodes method return types (`unknown`, `unknown[]`, `Promise<void>`).
   The method registration would need to carry return type information for ambient
   generation.
