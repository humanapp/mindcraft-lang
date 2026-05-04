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

## Opcodes

The full opcode reference -- numeric assignments, operand layout,
stack effects, fault conditions, and per-group prose -- lives in
[docs/specs/core/vm-contract.md](../../docs/specs/core/vm-contract.md)
under "Opcode reference". The TS expression of the same numeric
assignments is the `Op` enum in
`packages/core/src/runtime/bytecode.ts`. When changing an opcode in
either place, update both in the same unit.

### Frame and capture layout

`Frame` carries:

- `locals: List<Value>` -- indexed slots sized by `fn.numLocals ?? fn.numParams`. Args fill slots 0..numParams-1; rest are nil.
- `captures?: List<Value>` -- closure capture list set when entering a closure function via an indirect call.

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

`STRUCT_GET`/`STRUCT_SET` resolve field names through `StructTypeDef.fieldIndexByName` and then access `struct.v` (the indexed `List<Value>`).
`GET_FIELD`/`SET_FIELD` go through `fieldGetter`/`fieldSetter` hooks registered on the `StructTypeDef` when present, enabling native-backed struct types; otherwise they use `fieldIndexByName`.

## Fiber Lifecycle

`FiberState`: `RUNNABLE -> WAITING -> RUNNABLE`, `RUNNABLE -> DONE`, `RUNNABLE -> FAULT`, or `-> CANCELLED`

`VmRunResult`:
- `DONE` (with optional result)
- `YIELDED` (budget exhausted; scheduler re-enqueues)
- `WAITING` (suspended on a handle; resumed via `onHandleCompleted`)
- `FAULT` (with `ErrorValue`)

## Variable Access

Variable access is **slot-keyed at dispatch time**. The `LOAD_VAR_SLOT` and `STORE_VAR_SLOT` opcodes carry a `slotId: u16` operand which is a program-scoped index into `Program.variableNames`. The dispatch loop calls `ExecutionContext.getVariableBySlot(slotId)` / `setVariableBySlot(slotId, value)` -- it performs no `Dict.get(name)` lookup for variable access.

`Brain` owns the value list:

- `Brain.variables: List<Value | undefined>` -- one entry per slot. `undefined` means the slot has never been written; bytecode reads observe `NIL_VALUE`.
- `Brain.varSlotByName: Dict<string, number>` -- name -> slot map, rebuilt at program load from `Program.variableNames` via the private `installVariableTable(programVariableNames)` helper. Hot-reload copies values forward by name; variables present only in the previous program are dropped.

Name-keyed access remains available to host code via `ExecutionContext.getVariable` / `setVariable` / `clearVariable`. Writing through `setVariable(name, value)` for a name not present in `variableNames` lazy-extends the value list with a fresh slot; that slot is **not addressable from bytecode** and is dropped on the next `installVariableTable` call.

There is no built-in scope chain walk and no `resolveVariable` / `setResolvedVariable` hook. Application-level scope chaining must be implemented inside the host's name-keyed `getVariable` / `setVariable` closures on `ExecutionContext`.

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
