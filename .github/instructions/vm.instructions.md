---
applyTo: "packages/core/src/brain/runtime/**"
---

<!-- Last reviewed: 2026-04-02 -->

# VM Runtime

The brain VM (`packages/core/src/brain/runtime/`) is a stack-based bytecode virtual machine with fiber-based concurrency. See also `brain.instructions.md` for the broader brain architecture (tiles, parser, compiler, value model).

## Execution Model

- **Stack-based** bytecode VM with **fibers** (lightweight coroutines)
- **Budget-limited** execution: each fiber has `instrBudget` decremented per instruction
- Single-threaded -- one fiber runs at a time

## Key Files

- `vm.ts` - VM class, FiberScheduler, BytecodeVerifier
- `brain.ts` - Brain class: page/rule orchestration, variable storage, think() loop
- `functions.ts` - FunctionRegistry for host functions
- `operators.ts` - OperatorTable, OperatorOverloads
- `conversions.ts` - Type conversion registry
- `type-system.ts` - TypeRegistry
- `context-types.ts` - Context, SelfContext, EngineContext struct type registration
- `page.ts` / `rule.ts` - Page and Rule runtime instances
- `sensors/` / `actuators/` - Core sensor and actuator implementations

## Opcodes (Op enum)

| Range   | Category   | Opcodes                                                                                              |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| 0-3     | Stack      | `PUSH_CONST`, `POP`, `DUP`, `SWAP`                                                                   |
| 10-11   | Variables  | `LOAD_VAR`, `STORE_VAR`                                                                              |
| 20-22   | Control    | `JMP`, `JMP_IF_FALSE`, `JMP_IF_TRUE`                                                                 |
| 30-31   | Calls      | `CALL`, `RET`                                                                                        |
| 40-43   | Host       | `HOST_CALL`, `HOST_CALL_ASYNC`, `HOST_CALL_ARGS`, `HOST_CALL_ARGS_ASYNC`                             |
| 50-51   | Async      | `AWAIT`, `YIELD`                                                                                     |
| 60-62   | Exceptions | `TRY`, `END_TRY`, `THROW`                                                                            |
| 70-73   | Boundaries | `WHEN_START`, `WHEN_END`, `DO_START`, `DO_END`                                                       |
| 90-99   | Lists      | `LIST_NEW`, `LIST_PUSH`, `LIST_GET`, `LIST_SET`, `LIST_LEN`, `LIST_POP`, `LIST_SHIFT`, `LIST_REMOVE`, `LIST_INSERT`, `LIST_SWAP` |
| 100-104 | Maps       | `MAP_NEW`, `MAP_SET`, `MAP_GET`, `MAP_HAS`, `MAP_DELETE`                                             |
| 110-113 | Structs    | `STRUCT_NEW`, `STRUCT_GET`, `STRUCT_SET`, `STRUCT_COPY_EXCEPT`                                       |
| 120-121 | Fields     | `GET_FIELD`, `SET_FIELD`                                                                             |
| 130-131 | Locals     | `LOAD_LOCAL`, `STORE_LOCAL`                                                                          |
| 140-141 | Callsite   | `LOAD_CALLSITE_VAR`, `STORE_CALLSITE_VAR`                                                            |
| 150     | Types      | `TYPE_CHECK`                                                                                         |
| 160-161 | Indirect   | `CALL_INDIRECT`, `CALL_INDIRECT_ARGS`                                                                |
| 170-171 | Closures   | `MAKE_CLOSURE`, `LOAD_CAPTURE`                                                                       |

### Host Call Variants

There are four host call opcodes. `HOST_CALL`/`HOST_CALL_ASYNC` expect the compiler to have pre-built a `MapValue` on the stack. `HOST_CALL_ARGS`/`HOST_CALL_ARGS_ASYNC` let the compiler push raw values; the VM wraps them into a `MapValue` with 0-indexed keys via `collectArgsToMap`.

| Opcode               | a      | b     | c           | Stack input       | Stack output | Sync? |
| -------------------- | ------ | ----- | ----------- | ----------------- | ------------ | ----- |
| `HOST_CALL`          | fnId   | -     | callSiteId  | MapValue on TOS   | result Value | sync  |
| `HOST_CALL_ASYNC`    | fnId   | -     | callSiteId  | MapValue on TOS   | handle Value | async |
| `HOST_CALL_ARGS`     | fnId   | argc  | callSiteId  | b raw values      | result Value | sync  |
| `HOST_CALL_ARGS_ASYNC` | fnId | argc  | callSiteId  | b raw values      | handle Value | async |

Async variants push a handle; the VM must then execute `AWAIT` to suspend the fiber and retrieve the result when the handle resolves.

Before every host call, the VM sets `fiber.executionContext.currentCallSiteId = callSiteId`.

### STRUCT_COPY_EXCEPT (113)

Pops `a` string keys as an exclusion set, pops source struct. Copies all fields from source except those in the exclusion set. `b` is the constant index for the new struct's typeId string.

### CALL_INDIRECT vs CALL_INDIRECT_ARGS

- `CALL_INDIRECT` (160): pops `a` args then a `FunctionValue`; requires exact `argc == fn.numParams`.
- `CALL_INDIRECT_ARGS` (161): same but pads or trims args to match `fn.numParams`.

### Frame Locals and Captures

`Frame` carries:
- `locals: List<Value>` -- indexed slots sized by `fn.numLocals ?? fn.numParams`. Args fill slots 0..numParams-1; rest are nil.
- `captures?: List<Value>` -- closure capture list set when entering a closure function.

`LOAD_LOCAL`/`STORE_LOCAL` index into `frame.locals`. `LOAD_CAPTURE` indexes into `frame.captures`.

### Callsite Variables

`LOAD_CALLSITE_VAR`/`STORE_CALLSITE_VAR` index into `fiber.callsiteVars`, a per-fiber list for persistent callsite state across ticks.

## Key Data Structures

### Program vs BrainProgram

`Program` (base, in `interfaces/vm.ts`): `{ version, functions, constants, variableNames, entryPoint? }`

`BrainProgram` (extended, in `interfaces/runtime.ts`): adds `ruleIndex: Dict<string, number>` and `pages: List<PageMetadata>`.

`PageMetadata`: `{ pageIndex, pageId, pageName, rootRuleFuncIds, hostCallSites, sensors, actuators }`

### FunctionBytecode

```typescript
interface FunctionBytecode {
  code: List<Instr>;
  numParams: number;
  numLocals?: number;   // total local slots; defaults to numParams
  name?: string;
  maxStackDepth?: number;
  injectCtxTypeId?: TypeId; // if set, VM wraps ExecutionContext as arg[0] native struct
}
```

### Fiber

```typescript
interface Fiber {
  id: number;
  state: FiberState;
  vstack: List<Value>;
  frames: List<Frame>;
  handlers: List<Handler>;
  await?: AwaitSite;
  lastError?: ErrorValue;
  pendingInjectedThrow?: boolean;
  instrBudget: number;
  createdAt: number;
  lastRunAt: number;
  executionContext: ExecutionContext;
  callsiteVars?: List<Value>;
}
```

### Value Types

Primitives: `Unknown`, `Void`, `Nil`, `Boolean`, `Number`, `String`, `Enum`
Collections: `List` (`{ t: NativeType.List; typeId; v: List<Value> }`), `Map`, `Struct`
Callable: `FunctionValue` (`{ t: NativeType.Function; funcId: number; captures?: List<Value> }`)
VM-internal (not user-visible): handle, err

Singletons: `UNKNOWN_VALUE`, `VOID_VALUE`, `NIL_VALUE`, `TRUE_VALUE`, `FALSE_VALUE`

### StructValue and Field Hooks

`STRUCT_GET`/`STRUCT_SET` access `struct.v` (the raw `Dict<string, Value>`) directly.
`GET_FIELD`/`SET_FIELD` go through `fieldGetter`/`fieldSetter` hooks registered on the `StructTypeDef`, enabling native-backed struct types.

## Fiber Lifecycle

`FiberState`: `RUNNABLE -> WAITING -> RUNNABLE`, `RUNNABLE -> DONE`, `RUNNABLE -> FAULT`, or `-> CANCELLED`

`VmRunResult`:
- `DONE` (with optional result)
- `YIELDED` (budget exhausted; scheduler re-enqueues)
- `WAITING` (suspended on a handle; resumed via `onHandleCompleted`)
- `FAULT` (with `ErrorValue`)

## Variable Resolution

`resolveVariable(fiber, name)` walks:
1. Optional custom `resolveVariable` hook on `ExecutionContext`
2. `ctx.getVariable(name)`
3. Returns `NIL_VALUE` if not found

There is no built-in scope chain walk -- scope chaining must be implemented by the application via `resolveVariable`/`setResolvedVariable` hooks on `ExecutionContext`.

## FiberScheduler

- `tick()` -- dequeues up to `maxFibersPerTick` RUNNABLE fibers, sets `instrBudget = defaultBudget`, calls `vm.runFiber`; re-enqueues on YIELDED
- `onHandleCompleted` -- resumes all waiting fibers for a handle via `vm.resumeFiberFromHandle`
- `gc()` -- removes DONE/FAULT/CANCELLED fibers
- Defaults: `maxFibersPerTick: 64`, `defaultBudget: 1000`, `autoGcHandles: true`

## Brain.think() Loop

1. Handle pending page restart (deactivate + re-activate same page).
2. Handle page change (deactivate current, activate new, emit events).
3. `thinkPage()`: update `executionContext.time/dt/currentTick`, respawn any completed/faulted/cancelled root-rule fibers, call `scheduler.tick()`, then `scheduler.gc()`.

Page activation calls `onPageEntered` for each `hostCallSites` entry and spawns one fiber per `rootRuleFuncIds`.

## OperatorOverloads

`OperatorOverloads.binary`/`unary` auto-register the `HostFn` in the `FunctionRegistry` under a generated name (`$$op_{op}_{types}_to_{resultType}`) and add the overload to the `OperatorTable`. Resolve with `OperatorOverloads.resolve(id, argTypes)`.

## TypeRegistry

Notable methods: `addEnumType` (auto-registers eq/neq), `addNullableType` (wraps base type as nullable), `getOrCreateUnionType` (normalizes, dedupes, sorts; 2-member unions with Nil become `NullableTypeDef`), `addStructMethods`, `removeUserTypes` (removes module-scoped user types with `::` in name), `isStructurallyCompatible`.
