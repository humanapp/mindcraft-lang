---
applyTo: 'packages/core/src/brain/runtime/**'
---
<!-- Last reviewed: 2026-02-22 -->

# VM Runtime

The brain VM (`packages/core/src/brain/runtime/`) is a stack-based bytecode virtual machine with fiber-based concurrency. See also `brain.instructions.md` for the broader brain architecture (tiles, parser, compiler, value model).

## Execution Model

- **Stack-based** bytecode VM with **fibers** (lightweight coroutines)
- **Budget-limited** execution: each fiber has `instrBudget` decremented per instruction
- Single-threaded -- one fiber runs at a time

## Opcodes (Op enum)

| Range | Category | Key Opcodes |
|-------|----------|-------------|
| 0-3 | Stack | `PUSH_CONST`, `POP`, `DUP`, `SWAP` |
| 10-11 | Variables | `LOAD_VAR`, `STORE_VAR` |
| 20-22 | Control | `JMP`, `JMP_IF_FALSE`, `JMP_IF_TRUE` |
| 30-31 | Calls | `CALL`, `RET` |
| 40-41 | Host | `HOST_CALL` (a=fnId, c=callSiteId), `HOST_CALL_ASYNC` |
| 50-51 | Async | `AWAIT`, `YIELD` |
| 60-62 | Exceptions | `TRY`, `END_TRY`, `THROW` |
| 70-73 | Boundaries | `WHEN_START`, `WHEN_END`, `DO_START`, `DO_END` |
| 90-94 | Lists | `LIST_NEW`, `LIST_PUSH`, `LIST_GET`, `LIST_SET`, `LIST_LEN` |
| 100-104 | Maps | `MAP_NEW`, `MAP_SET`, `MAP_GET`, `MAP_HAS`, `MAP_DELETE` |
| 110-112 | Structs | `STRUCT_NEW`, `STRUCT_GET`, `STRUCT_SET` |
| 120-121 | Fields | `GET_FIELD`, `SET_FIELD` |

## HOST_CALL Execution

1. Pop MapValue from stack (argument map)
2. Set `currentCallSiteId` on ExecutionContext
3. Look up sync function by `fnId` in function registry
4. Call `fn.exec(executionContext, argsMap)`
5. Push result onto stack

## Fiber Lifecycle

`FiberState`: `RUNNABLE -> WAITING -> RUNNABLE`, `RUNNABLE -> DONE`, `RUNNABLE -> FAULT`, or `-> CANCELLED`

**VmRunResult**: `DONE` (with result), `YIELDED` (budget exhausted), `WAITING` (on handle), `FAULT` (with error)

## FiberScheduler

- Manages fiber lifecycle, run queue, budget allocation
- `tick()` -- dequeues fibers, sets budget, calls `vm.runFiber`, re-enqueues if YIELDED
- `onHandleCompleted` -- resumes waiting fibers when handles complete
- Defaults: `maxFibersPerTick: 64`, `defaultBudget: 1000`
- `gc()` removes DONE/FAULT/CANCELLED fibers

## Variable Resolution

`resolveVariable(fiber, name)` walks: custom resolver -> local `getVariable` -> `sharedScope` -> `parentContext` chain -> NIL.
