# Brain Action Execution Architecture

Created: 2026-04-03
Status: Proposed

Related:
- [../../issues/global-function-registry-multi-brain.md](../../issues/global-function-registry-multi-brain.md)
- [user-authored-sensors-actuators.md](user-authored-sensors-actuators.md)
- [user-tile-compilation-pipeline.md](user-tile-compilation-pipeline.md)

---

## Table of Contents

- [A. Problem](#a-problem)
- [B. Design Goals](#b-design-goals)
- [C. Core Position](#c-core-position)
- [D. Architectural Model](#d-architectural-model)
- [E. Runtime Semantics](#e-runtime-semantics)
- [F. Compiler and Linker Model](#f-compiler-and-linker-model)
- [G. User-Authored Action Model](#g-user-authored-action-model)
- [H. Catalog and Editor Model](#h-catalog-and-editor-model)
- [I. Rejected Alternatives](#i-rejected-alternatives)
- [J. Migration Notes](#j-migration-notes)

---

## A. Problem

The current runtime conflates three different concepts:

1. **Tile metadata** -- what a sensor or actuator is, how it is rendered, and
   what arguments it accepts.
2. **Compile-time action binding** -- what a brain rule means when it references
   a tile.
3. **Runtime dispatch** -- what executable implementation runs when that rule
   executes.

Today, all three are represented by a single global `BrainFunctionEntry` living
in the global `FunctionRegistry`.

That model is adequate only when every action implementation is effectively a
process-global host intrinsic. It breaks as soon as an action implementation is
owned by a specific Brain/VM/Scheduler instance.

User-authored tiles expose the flaw because they are already compiled as regular
bytecode programs with linked function IDs, activation wrappers, and persistent
state slots. The only reason they currently execute through a host-function
wrapper is that the brain runtime has no first-class concept of an executable
action table.

The system is missing an abstraction layer.

---

## B. Design Goals

1. **Separate tile metadata from runtime dispatch.** Tile definitions should not
   own executable closures or registry entries.
2. **Separate host intrinsics from brain actions.** Operators, conversions,
   builtins, and struct methods are not the same thing as sensors and actuators.
3. **Compile, then link, then execute.** Brain compilation should produce a
   relocatable program. Runtime binding should happen in an explicit link step.
4. **Keep action execution Brain-local.** Any stateful executable action must be
   bound to the owning executable brain artifact, never to a process-global
   singleton slot.
5. **Preserve one VM model.** User-authored code must execute inside the same VM
   and scheduler model as the rest of the brain runtime.
6. **Make lifecycle first-class.** Page-entry behavior must be part of action
   execution semantics, not an afterthought hanging off host-function tables.
7. **Make persistent action state explicit.** Per-action persistent storage must
   be scoped to an action callsite in a Brain, not to a registry entry and not
   to the current fiber as a whole.

---

## C. Core Position

The clean architecture is:

- **Global host intrinsic registry** for stable VM intrinsics only.
- **Action descriptors** for tile metadata and compile-time references.
- **Executable brain programs** with a per-program executable action table.
- **Action-call instructions** in the VM for invoking sensors and actuators.

This is **not** a per-brain routing layer inside the current global
`FunctionRegistry`.

This is **not** a per-VM clone of the current host-function table.

This is also **not** a raw "just emit CALL for user tiles" design. A raw `CALL`
is missing action lifecycle, action-callsite binding, and action-persistent state
semantics. Those belong to a dedicated action execution path.

---

## D. Architectural Model

### 1. Host intrinsics vs brain actions

The runtime should expose two independent executable namespaces.

#### Host intrinsics

These are globally registered once at startup and are valid across all VMs:

- operators
- conversions
- string/math builtins
- struct methods
- native bridge helpers

They continue to use host-function IDs and host-call opcodes.

#### Brain actions

These are what sensor and actuator tiles compile against.

- Core tiles are host-backed actions.
- User-authored tiles are bytecode-backed actions.
- A brain program does not know or care which backing kind it gets at compile
  time. That is decided at link time.

### 2. Action descriptors

Tile definitions should carry `ActionDescriptor`, not `BrainFunctionEntry`.

```ts
type ActionKey = string;

interface ActionDescriptor {
  key: ActionKey;
  kind: "sensor" | "actuator";
  callDef: BrainActionCallDef;
  isAsync: boolean;
  outputType?: TypeId;
}
```

Properties of this model:

- `ActionDescriptor` is stable metadata.
- It is safe to store in `TileCatalog` and reference from UI, parser, typechecker,
  and compiler.
- It contains no VM instance, scheduler, host closure, or runtime slot index.

### 3. Unlinked brain program

The brain compiler should emit an **unlinked** program containing action slots.

```ts
interface ActionRef {
  slot: number;
  key: ActionKey;
}

interface ActionCallSiteEntry {
  actionSlot: number;
  callSiteId: number;
}

interface UnlinkedBrainProgram extends Program {
  ruleIndex: Dict<string, number>;
  pages: List<PageMetadata>;
  actionRefs: List<ActionRef>;
}

interface PageMetadata {
  pageIndex: number;
  pageId: string;
  pageName: string;
  rootRuleFuncIds: List<number>;
  actionCallSites: List<ActionCallSiteEntry>;
  sensors: UniqueSet<TileId>;
  actuators: UniqueSet<TileId>;
}
```

The compiler owns slot assignment exactly the way it owns constant-pool indexes.
The slot index is brain-program-local, not global.

### 4. Executable brain program

The linker resolves `actionRefs` into executable action bindings.

```ts
type ExecutableAction = HostExecutableAction | BytecodeExecutableAction;

interface HostExecutableAction {
  binding: "host";
  descriptor: ActionDescriptor;
  onPageEntered?: (ctx: ExecutionContext) => void;
  execSync?: (ctx: ExecutionContext, args: MapValue) => Value;
  execAsync?: (ctx: ExecutionContext, args: MapValue, handleId: HandleId) => void;
}

interface BytecodeExecutableAction {
  binding: "bytecode";
  descriptor: ActionDescriptor;
  entryFuncId: number;
  activationFuncId?: number;
  numStateSlots: number;
}

interface ExecutableBrainProgram extends Program {
  ruleIndex: Dict<string, number>;
  pages: List<PageMetadata>;
  actions: List<ExecutableAction>;
}
```

`ExecutableBrainProgram` is the artifact the runtime actually instantiates.

### 5. Execution environment

Core should define an interface for action resolution. The sim app provides the
implementation for user-authored actions.

```ts
interface BrainActionResolver {
  resolveAction(descriptor: ActionDescriptor): ExecutableAction | undefined;
}
```

Resolution sources:

- core runtime registration resolves built-in actions to host-backed bindings
- app-side compiled user action registry resolves user-authored tiles to
  bytecode-backed bindings

Core must not depend on `packages/typescript`; it only depends on the resolver
interface.

---

## E. Runtime Semantics

### 1. Action-call opcodes

Brain rule compilation should use dedicated action opcodes:

- `ACTION_CALL`
- `ACTION_CALL_ASYNC`

Host intrinsics keep their existing host-call opcodes:

- `HOST_CALL`
- `HOST_CALL_ASYNC`
- `HOST_CALL_ARGS`
- `HOST_CALL_ARGS_ASYNC`

This separation is deliberate:

- host-call opcodes are for VM intrinsics
- action-call opcodes are for sensor/actuator dispatch

#### `ACTION_CALL`

Fields:

- `a = actionSlot`
- `c = callSiteId`

Stack behavior:

- input: `MapValue` arguments on top of stack
- output: result `Value`

#### `ACTION_CALL_ASYNC`

Fields:

- `a = actionSlot`
- `c = callSiteId`

Stack behavior:

- input: `MapValue` arguments on top of stack
- output: handle value

### 2. Sync dispatch semantics

`ACTION_CALL(actionSlot, callSiteId)` executes as follows:

1. Pop the argument `MapValue`.
2. Set `ExecutionContext.currentCallSiteId = callSiteId`.
3. Resolve `ExecutionContext.rule` from the current rule frame.
4. Resolve or create the action-instance state for `(page activation,
   actionSlot, callSiteId)`.
5. Dispatch by binding kind.

If the action is host-backed:

- call `execSync(ctx, args)`
- push the returned value

If the action is bytecode-backed:

- invoke the target function inside the current VM
- inject `ctx` using the existing `injectCtxTypeId` mechanism
- pass the `MapValue` args as the explicit parameter when needed
- bind the action-instance state to the called frame chain
- push the returned value

### 3. Async dispatch semantics

`ACTION_CALL_ASYNC(actionSlot, callSiteId)` executes as follows:

1. Pop the argument `MapValue`.
2. Create a pending handle.
3. Push the handle value.
4. Set `currentCallSiteId` and `rule` on the execution context.
5. Resolve or create action-instance state.
6. Dispatch by binding kind.

If the action is host-backed:

- call `execAsync(ctx, args, handleId)`

If the action is bytecode-backed:

- spawn a child fiber in the same VM and scheduler
- initialize its first frame with the bytecode action entry function
- bind the same action-instance state to that fiber's action frame
- resolve, reject, or cancel the outer handle from child-fiber completion

The important property is that async bytecode actions run on the owning Brain's
VM and scheduler, not in an externally captured wrapper.

### 4. Action-instance state model

User-authored persistent state should be modeled as **action-instance state**,
not fiber-global state.

The current `LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR` concept is valid, but the
state must belong to the current action frame chain, not to `fiber.callsiteVars`
as a single mutable slot for the whole fiber.

Clean model:

- each action callsite has a state vector of `numStateSlots`
- state vector is created and owned by the Brain runtime
- the current action frame references that state vector
- helper calls inside the action inherit the same state vector
- sequential action calls in the same rule fiber do not overwrite each other's
  active state binding

This can be implemented either by:

- renaming the opcodes to `LOAD_ACTION_STATE` / `STORE_ACTION_STATE`, or
- keeping the current opcode names but redefining them to resolve against the
  current action frame instead of the fiber object

The architecture does not depend on the opcode names. It depends on the scope.

### 5. Page lifecycle

Page activation should operate on `actionCallSites`, not `hostCallSites`.

For each action callsite in the page:

1. Create or reset action-instance state.
2. Invoke the action's activation hook once for this page activation.

For host-backed actions, activation dispatches to `onPageEntered(ctx)`.

For bytecode-backed actions, activation dispatches to `activationFuncId` if one
exists.

This design makes lifecycle behavior uniform across host-backed and bytecode-backed
actions.

### 6. State lifetime

Action-instance state is page-activation-scoped.

- It persists across ticks and root-rule fiber respawns.
- It is destroyed or discarded when the page deactivates.
- It is recreated on the next activation.

This is cleaner than retaining hidden state in a long-lived Brain-wide map and
depending on each action to remember to reset itself.

---

## F. Compiler and Linker Model

### 1. Brain compiler

The brain compiler should stop reading `fnEntry.id` from sensor and actuator tile
defs. Instead it should:

1. read `ActionDescriptor.key`
2. intern that key into `actionRefs`
3. emit `ACTION_CALL` or `ACTION_CALL_ASYNC` using the local slot index

The compiler still builds `MapValue` action arguments exactly as it does today.
The argument calling convention does not need to change.

### 2. Bytecode verifier

Verifier responsibilities split cleanly:

- `ACTION_CALL` verifies `actionSlot < program.actions.size()`
- `HOST_CALL*` continues to verify against host intrinsic table size
- `CALL` continues to verify against `program.functions.size()`

### 3. Link step

The link step is responsible for two independent tasks:

1. resolve action descriptors into executable action bindings
2. merge linked bytecode artifacts into the final executable program where
   necessary

For user-authored actions, the current `linkUserPrograms()` logic is still the
right lower-level mechanism. What changes is where it sits in the architecture:

- it becomes part of the brain link step
- it no longer produces VM-capturing host wrappers

### 4. Brain instantiation lifecycle

The runtime lifecycle should be:

1. compile brain definition -> `UnlinkedBrainProgram`
2. link with `BrainActionResolver` -> `ExecutableBrainProgram`
3. instantiate VM and scheduler from the executable program
4. initialize page/action-instance lifecycle state

That explicit compile/link/instantiate split is the architectural correction.

---

## G. User-Authored Action Model

### 1. Bytecode action artifact

The TypeScript compiler should publish a user action artifact shaped for the new
runtime model.

```ts
interface UserActionArtifact extends Program {
  key: ActionKey;
  kind: "sensor" | "actuator";
  callDef: BrainActionCallDef;
  outputType?: TypeId;
  isAsync: boolean;
  numStateSlots: number;
  entryFuncId: number;
  activationFuncId?: number;
  revisionId: string;
}
```

This is a cleaner version of the current `UserAuthoredProgram` shape.

Notable simplifications:

- `numCallsiteVars` becomes `numStateSlots`
- `initFuncId` plus lifecycle wrapper collapses into `activationFuncId`
- no runtime wrapper object is part of the artifact

### 2. Entry function calling convention

User-authored action bytecode should keep its current logical entry convention:

- `ctx` injected as local slot 0 via `injectCtxTypeId`
- optional params map passed as the next argument

This means the TypeScript compiler does **not** need to change its expression or
statement lowering model to fit the new architecture.

### 3. Activation function

If a user action needs activation behavior, the compiler emits one activation
function that the runtime can invoke directly on page activation.

That activation function is responsible for:

- initializing action-instance state slots
- running user-authored `onPageEntered`, if present

The runtime does not need to know how those semantics are composed internally.

### 4. Async user actions

Async user actions are bytecode-backed actions whose entry function runs in a
child fiber and resolves a handle on completion. They are not host async functions.

---

## H. Catalog and Editor Model

The editor and tile catalog only need stable action metadata.

They do not need:

- host function IDs
- executable closures
- per-Brain runtime bindings
- mutable global function slots

This means `TileCatalog` remains the right place to store:

- tile IDs
- placement and visuals
- action descriptors
- call specs and output types

It is not the right place to store runtime dispatch bindings.

---

## I. Rejected Alternatives

### 1. Per-brain router inside the global registry

Why rejected:

- keeps the wrong abstraction intact
- adds per-dispatch routing overhead to hide a modeling error
- leaves tile compilation coupled to a global host-function namespace
- turns a function entry into a map of Brain -> implementation

This is a patch, not the right platform.

### 2. Per-VM host function tables

Why rejected:

- cleaner than routing, but still models tile actions as host registry layout
- still forces sensors/actuators into a host-function abstraction they do not fit
- still mixes host intrinsics with executable brain actions

This improves locality but not conceptual clarity.

### 3. Raw `CALL` for user tiles

Why rejected as the full solution:

- `CALL` has no action lifecycle semantics
- `CALL` has no action-callsite metadata
- `CALL` has no action-instance state binding model
- page activation would still need a parallel special case

`CALL` remains the correct opcode for helper functions, closures, methods, and
ordinary bytecode control flow. It is not the right top-level abstraction for
sensor/actuator invocation.

---

## J. Migration Notes

No backward compatibility is required.

The migration should therefore optimize for architectural cleanliness:

- existing serialized brain definitions may be discarded
- localStorage brain caches may be cleared or version-bumped
- obsolete docs and wrapper-oriented code paths may be deleted aggressively

This is an opportunity to remove the flawed model, not to preserve it behind
compatibility adapters.