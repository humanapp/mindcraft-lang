# Global FunctionRegistry vs Per-Brain Execution

Created: 2026-04-03

## Problem Statement

The brain runtime uses a single global `FunctionRegistry` (via
`getBrainServices().functions`) for HOST_CALL dispatch across all VM
instances. Core tiles (sensors, actuators) work because their `HostFn`
implementations are stateless -- they operate purely through the
`ExecutionContext` argument. User-authored tiles compiled from TypeScript
break this model because `createUserTileExec` produces `HostAsyncFn`
closures that capture a specific `VM` and `Scheduler` instance to spawn
and run fibers containing user tile bytecode.

When multiple actors share a BrainDef (the normal case -- e.g. all
herbivores), each actor gets its own Brain/VM/Scheduler, but the global
FunctionRegistry has exactly one `.fn` slot per tile ID. Only the last
Brain to initialize would have a working exec function; all others
would invoke the wrong VM's fiber spawner.

This is not a peripheral issue. The global singleton pattern is woven
through the entire compile-time and runtime stack. A patch (per-brain
routing) is possible but would leave the underlying tension in place.

## Architecture Walkthrough

### Two function tables, one shared

The VM holds two separate function tables:

1. **`this.prog.functions: List<FunctionBytecode>`** -- bytecode
   functions compiled from brain rules. Each rule becomes a
   `FunctionBytecode` entry. Indexes are per-program. The VM uses CALL
   instructions to invoke these by function ID into this list.

2. **`this.fns: IFunctionRegistry`** -- host functions (sensors,
   actuators). Initialized as `getBrainServices().functions`, the global
   singleton. HOST_CALL instructions encode a numeric `fnId` that
   indexes into this list. The VM dispatches:
   ```
   this.fns.getAsyncById(fnId)!.fn.exec(ctx, args, hid)
   ```

Table 1 is per-Brain (each Brain compiles its own BrainProgram). Table
2 is global and shared by every VM instance in the process.

### Registration is append-only

`FunctionRegistry.register()` assigns `id = fnList.size()` (sequential
index) and throws on duplicate names. There is no `unregister()`,
`update()`, or `replace()` method. The only mutation path is direct
property assignment on the entry object: `entry.fn = newHostFn`, which
`registerUserTile()` uses for in-place hot-swap.

### Compile-time binding

The brain compiler resolves tile references to numeric function IDs at
compile time, not runtime. The chain is:

```
BrainTileSet (model)
  -> IBrainActionTileDef (tile definition, holds fnEntry)
    -> BrainFunctionEntry.id (assigned at registration time)
      -> emitter.hostCallAsync(fnEntry.id, argc, callSiteId)
        -> bytecode: HOST_CALL_ASYNC a=<fnId> b=<argc> c=<callSiteId>
```

The `fnEntry` is a reference to the same object stored in the
FunctionRegistry. The numeric ID is baked into bytecode at compile time
and resolved back to the entry at runtime via `fns.getAsyncById(fnId)`.

Since all VMs share the same FunctionRegistry, the same fnId resolves
to the same entry in every VM -- which is fine for stateless host
functions but breaks for closures that capture VM-specific state.

### Why core tiles work

Core sensor/actuator `HostFn` implementations are pure functions of
their arguments:

```typescript
// Stateless -- only reads ctx and args
function execBump(ctx: ExecutionContext, args: MapValue): Value {
  const self = getSelf(ctx);
  // ... reads self.bumpQueue, self.engine ...
  return result;
}
```

Some use `getCallSiteState(ctx)` / `setCallSiteState(ctx, state)` for
per-invocation persistence (e.g. Move's wander target), but this state
is stored in the `ExecutionContext.callSiteState` map, which is
per-Brain. No core tile captures external references in a closure.

### Why user tile exec functions break

`createUserTileExec` returns a closure that captures `vm` and
`scheduler`:

```typescript
export function createUserTileExec(
  linkedProgram: BrainProgram,
  linkInfo: UserTileLinkInfo,
  vm: runtime.VM,        // captured by closure
  scheduler: Scheduler    // captured by closure
): HostAsyncFn {
  // ...
  function runFiberInline(funcId, args, ctx, callsiteVars) {
    const fiber = vm.spawnFiber(...);  // uses captured vm
    return vm.runFiber(fiber, scheduler);  // uses captured scheduler
  }

  function execAsync(ctx, args, outerHandleId) {
    const fiber = vm.spawnFiber(...);  // uses captured vm
    scheduler.addFiber!(fiber);        // uses captured scheduler
  }

  return { exec: execIsAsync ? execAsync : execSync };
}
```

The returned `HostAsyncFn` must run fibers on the correct Brain's VM
because user tile bytecode is linked into that Brain's program (via
`linkUserPrograms`). Different Brains may have different linked programs
with different function/constant offsets. Running a fiber on the wrong
VM would execute wrong bytecode or crash on out-of-bounds function IDs.

### The multi-actor scenario

```
Engine has BrainDef "herbivore" shared by 20 actors
Each actor: brainDef.compile() -> new Brain -> brain.initialize()
  initialize():
    program = compileBrain(brainDef)
    linked = linkUserPrograms(program, userPrograms)  // merge user bytecode
    vm = new VM(linked.linkedProgram, handles)
    scheduler = new FiberScheduler(vm)
    execFn = createUserTileExec(linked, linkInfo, vm, scheduler)
    registerUserTile(linkInfo, execFn)  // overwrites global entry.fn

Only the 20th actor's execFn survives in the FunctionRegistry.
Actors 1-19 invoke actor 20's VM/Scheduler when running the user tile.
```

Result: user tile fibers reference bytecode functions at offsets that
exist in actor 20's linked program but may differ from the invoking
actor's linked program. If the linked program is structurally identical
across actors (same user tiles, same brain rules), the bytecode aligns
by coincidence, but the fibers still execute on the wrong VM with the
wrong handle table, wrong execution context plumbing, and wrong
scheduler. This will produce incorrect behavior or crashes.

## Scope of the coupling

The global `FunctionRegistry` is referenced from:

| Component | How it accesses functions |
|---|---|
| `VM` constructor | `this.fns = getBrainServices().functions` |
| Brain compiler (`compileBrain`) | `tileDef.fnEntry.id` baked into bytecode |
| `registerUserTile()` | `getBrainServices().functions.get(name)` |
| `TileSuggestions` (language service) | Reads tile defs which hold `fnEntry` |
| Brain editor UI | Reads tile defs from `TileCatalog` |
| `BytecodeVerifier` | Checks `HOST_CALL fnId < functions.size()` |

The `TileCatalog` (also global) stores `BrainTileSensorDef` /
`BrainTileActuatorDef` objects that hold a reference to
`BrainFunctionEntry`. The compiler reads this reference to emit
HOST_CALL instructions. The UI reads it for display. The verifier
reads it for bounds checking.

## What needs to change

The fundamental tension: HOST_CALL dispatch is global (one table for
all VMs), but user tile execution is per-Brain (each needs its own
VM/Scheduler context). A clean solution likely involves one or more of:

### Direction A: Per-VM host function table

Give each VM its own function table instead of sharing the global one.
The table could start as a snapshot of the global registry (for core
tiles) and be extended with per-Brain user tile entries.

Considerations:
- The brain compiler currently bakes `fnEntry.id` into bytecode. If
  per-VM tables have different layouts, IDs would diverge.
- Core tile IDs could remain stable (same prefix in every table).
  User tile IDs would be appended per-Brain.
- `linkUserPrograms` already remaps function IDs. It could also assign
  host function slots.
- The `BytecodeVerifier` would need the per-VM table size.
- `TileCatalog` and UI are read-only consumers and could continue
  using a global reference; only the runtime dispatch needs per-VM
  scoping.

### Direction B: Indirection layer in host function entries

Replace the `fn` field on `BrainFunctionEntry` with a dispatch
mechanism that can route to per-Brain implementations based on
`ExecutionContext`. The global table stays global, but each entry
becomes a dispatcher rather than a direct function.

Considerations:
- Adds per-HOST_CALL overhead (map lookup on `ctx.brain`).
- Core tiles could bypass the indirection (they're stateless).
- Keeps the existing compile-time ID assignment intact.
- Conceptually messy -- the "function" is now a routing table.

### Direction C: Separate host function namespaces

Split the registry into two regions: a static region for core tiles
(assigned at startup, never changes) and a dynamic region for
user-authored tiles (scoped per-Brain, assembled at Brain.initialize
time).

Considerations:
- HOST_CALL instructions would need to distinguish which region
  to look up (could use a flag bit in the fnId, or separate opcodes).
- `linkUserPrograms` already knows which functions are user-authored.
  It could assign IDs in the dynamic region.
- The brain compiler would need to emit different opcodes for core
  vs user tiles.

### Direction D: User tile bytecode as inlined functions

Instead of HOST_CALL, compile user tiles into the brain program as
regular bytecode functions (CALL instead of HOST_CALL). The linker
already merges user tile bytecode into the BrainProgram -- the missing
piece is having the brain compiler emit CALL instructions for user
tiles instead of HOST_CALL.

Considerations:
- Eliminates the host function dispatch entirely for user tiles.
- User tile parameters and return values would need to follow the
  bytecode calling convention instead of the HOST_CALL map-based
  convention.
- `createUserTileExec` handles callsite variables, init functions,
  and lifecycle hooks (onPageEntered). These would need equivalents
  in the bytecode calling convention.
- The brain compiler would need to know which tiles are
  user-authored at compile time to emit CALL vs HOST_CALL.

### Direction E: There may be other approaches

If your analysis produces other promising directions, do not discard them
simply because they weren't included here. We're looking for a clean
architecture that supports this feature in a robust way.

## Constraints

- `packages/core` targets both web (sim app) and Roblox
  (`tsconfig.rbx.json`). Roblox does not have user-authored tiles yet
  but the core API should not preclude it.
- `packages/core` must not depend on `packages/typescript` (the user
  tile compiler). Any integration must be through interfaces/callbacks.
- The `FunctionRegistry` is append-only with index-based IDs. Removal
  would break VM references to existing functions. Any solution must
  either preserve this property or migrate away from it.
- Core tiles are registered once at startup and never change. User
  tiles are registered dynamically and can be added/removed/updated at
  any time.
- The brain compiler, VM, FiberScheduler, and BytecodeVerifier are all
  in `packages/core/src/brain/runtime/`. Changes here affect all
  targets.

## Files involved

Core runtime:
- `packages/core/src/brain/runtime/vm.ts` -- VM, FiberScheduler
- `packages/core/src/brain/runtime/brain.ts` -- Brain.initialize
- `packages/core/src/brain/runtime/functions.ts` -- FunctionRegistry
- `packages/core/src/brain/services.ts` -- global singleton
- `packages/core/src/brain/interfaces/functions.ts` -- BrainFunctionEntry
- `packages/core/src/brain/interfaces/vm.ts` -- Program, HostAsyncFn, Scheduler
- `packages/core/src/brain/compiler/rule-compiler.ts` -- HOST_CALL emission
- `packages/core/src/brain/compiler/emitter.ts` -- hostCall/hostCallAsync
- `packages/core/src/brain/tiles/catalog.ts` -- TileCatalog
- `packages/core/src/brain/tiles/sensors.ts` -- BrainTileSensorDef
- `packages/core/src/brain/tiles/actuators.ts` -- BrainTileActuatorDef
- `packages/core/src/brain/model/tiledef.ts` -- BrainActionTileBase

User tile pipeline:
- `packages/typescript/src/linker/linker.ts` -- linkUserPrograms
- `packages/typescript/src/runtime/authored-function.ts` -- createUserTileExec
- `packages/typescript/src/runtime/registration-bridge.ts` -- registerUserTile
- `apps/sim/src/services/user-tile-registration.ts` -- registration + hot-swap
- `apps/sim/src/services/user-tile-compiler.ts` -- compilation provider
- `apps/sim/src/brain/actor.ts` -- Actor constructor, replaceBrain
- `apps/sim/src/brain/engine.ts` -- Engine.updateBrainDef

## Related specs

- `docs/specs/features/user-tile-compilation-pipeline.md` -- Phase 4
  (integration with brain execution) is blocked on this issue.
- `docs/specs/features/user-authored-sensors-actuators.md` -- compiler
  pipeline spec, defines createUserTileExec and linkUserPrograms.
