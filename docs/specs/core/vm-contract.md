# VM Contract

The implementation contract shared between the TypeScript reference VM
(`packages/core/src/brain/runtime/vm.ts`) and the eventual C++ MCU
port. Covers opcode set, operand semantics, value model, calling
convention, error model, feature flags, and resource limits. Does
_not_ cover wire format; the MCU binary layout is described in the
[Binary format appendix](#binary-format-appendix) at the end of this
document.

When this spec and the code disagree, the spec is wrong; fix it in
the same change.

## Trust model

The VM trusts the bytecode it receives. There is no static
verification layer; the compiler is the sole guarantor of validity.
Malformed bytecode -- out-of-bounds operands, unknown opcodes, jump
targets past end-of-function, mismatched call arities, etc. --
surfaces as a `ScriptError` fault on the offending fiber. No
platform-level throw escapes `runFiber`.

## Single-entry guarantee

The VM is **single-entry**. Only the mindcraft host loop may call
`brain.think()`, `scheduler.tick()`, `runFiber()`, or
resolve / reject async handles. These entry points are mutually
exclusive in time -- one is active at a time, on one thread of
execution, with no nesting.

The design rule that produces this property:

```
ISR / event source / CODAL / browser callback  ->  enqueue only
mindcraft host loop                             ->  drain, resolve,
                                                    schedule, execute
```

Anything outside the host loop -- a microbit fiber, a CODAL ISR, a
DOM event handler, a `setTimeout` callback, an MQTT message
listener -- only ever **enqueues** work onto a host-owned queue
(typically a handle-completion queue or a deferred-event queue).
The host loop is the sole consumer of those queues and the sole
caller of the VM entry points listed above. This rule applies
identically on Node, browser, and the C++ MCU port -- the names of
the outer event sources differ, the rule does not.

The "enqueue only" constraint is transitive. Any callback the host
fans out to from inside a host call -- e.g. CODAL `MessageBus::send`
delivering to immediate listeners synchronously, an `EventEmitter`
firing handlers inline, a Promise `.then` resolved while a host
function is executing -- is also forbidden from re-entering the VM.
Such callbacks are allowed to run inline because they themselves
only enqueue: the work they post is observed by the host loop on
its next drain, after `runFiber()` returns. The VM is not
re-entered. The single-entry guarantee survives intact even though
the call graph fans out arbitrarily, because the only edges that
return _into_ the VM are the four entry points, and only the host
loop ever takes those edges.

A `HostSyncFn.exec` or `HostAsyncFn.exec` body MUST NOT invoke any
of these entry points, directly or transitively. The operand stack,
fiber state, scheduler queue, and any host-call argument view
(`ReadonlyList<Value>`) are owned by the active
dispatcher and are valid only for the synchronous duration of the
host call. Re-entry corrupts all of these without diagnostic.

This is a contract, not a runtime check. It is enforced by code
review at the small set of host-function registration sites in
`packages/core/src/brain/runtime/*` and at the public seam in
`packages/core/src/mindcraft.ts`. User TS code never registers host
functions and is not subject to this rule.

### Optional re-entry guard

Implementations MAY install a cheap dispatcher-level re-entry guard
to surface contract violations as a deterministic fault rather than
silent stack corruption. The recommended shape is a single `inVm`
boolean (or equivalent flag) on the VM, set on entry to any of the
four entry points named above and cleared on exit; re-entry while the
flag is set raises a fatal `VmReentry` fault (not a recoverable
`ScriptError`, because the operand stack and any active argument view
are in an indeterminate state). The check is one branch on the
dispatch entry path, not per-instruction.

## Construction and services boundary

This section pins the VM's external surface: the constructor, the
service aggregate it consumes, the passive event aggregate it emits
through, and the import firewall that holds them in place.

### Construction signature

The VM is constructed as
`new VM(program: Program, services: PlatformServices, options?: VmOptions)`.
`options.events?: VmEvents` is the passive observer slot; omitting
`options` (or omitting `options.events`) must yield identical
program execution and identical host-visible side effects. The
remaining `VmOptions` fields (`handles?`, plus `Partial<VmConfig>`
overrides) tune resource shapes and do not change the boundary.

### `PlatformServices` responsibilities

`PlatformServices` is the single aggregate the VM accepts at
construction. Its members are:

- `functions: IFunctionRegistry` -- resolved by `HOST_CALL` and
  `HOST_CALL_ASYNC` dispatch to obtain the host function record
  for a given function id.
- `types: ITypeRegistry` -- consulted by VM value copying and
  struct field access paths to look up type definitions, native
  snapshot functions, and field getters/setters.

Scope rule (binding on every future addition): `PlatformServices`
covers only runtime registries (function and type lookup tables)
plus the runtime state members enumerated in the
[Runtime state surface](#runtime-state-surface) section. The VM
does **not** receive a program verifier; the reference VM trusts its
in-process compiler, and verification is reserved for ports that
accept bytecode from an untrusted source.

### `VmEvents` permissions and prohibitions

`VmEvents` is the optional passive observer aggregate. Its methods
are:

- `onFiberFault?(payload: FiberFaultEvent)` -- a fiber faulted;
  payload is `{ fiberId, err }`.
- `onFiberDone?(payload: FiberDoneEvent)` -- a fiber completed
  normally; payload is `{ fiberId, retv }`.
- `onFiberCancelled?(payload: FiberCancelledEvent)` -- a fiber was
  cancelled; payload is `{ fiberId }`.
- `onFiberWaiting?(payload: FiberWaitingEvent)` -- a fiber
  transitioned to waiting on a handle; payload is
  `{ fiberId, handleId }`.

**Passivity property.** An event observer is *passive* iff:

1. `vm.ts` never reads from `events` to make a control-flow
   decision (no branches, no return values consumed).
2. Final `Program` state and any host-visible side effects are
   identical for any two executions of the same program that
   differ only in their `VmEvents` argument (including
   `undefined`).

**Event-payload content rule.** Each event payload contains only
values already locally available at the emit site. Nothing is
computed, looked up, or allocated solely to satisfy an event.
Payloads carry only ids and primitive values that are expressible
through the runtime state surface. Payloads do **not** carry
references to authoring-graph objects.

Both rules bind every future event method added to `VmEvents` by
any downstream spec.

### Import-firewall rule

The runtime is a closed module: its source files may value-depend
only on other runtime files and on the platform-abstraction layer
(no upward imports into the brain, compiler, or app layers). The TS
reference enforces this through a build-time import allow-list and a
test-suite gate; ports are expected to maintain the same closure by
whatever mechanism their build system provides.

### Out of scope for this boundary

This section does not cover runtime state shape or host ABI
portability. Runtime state shape is documented in the
[Runtime state surface](#runtime-state-surface) section
below, which builds on this boundary.

### Maintenance rule

Any subsequent spec that modifies the VM constructor signature,
adds or removes a `PlatformServices` field, adds or removes a
`VmEvents` method, or changes the firewall rule **must update this
section in lock-step** with the code change. Per the workflow
convention, update `docs/specs/core/vm-contract.md` as part of the
same unit when the change is contract-shaping.

## Runtime state surface

`ExecutionContext` and the `PlatformServices` runtime state members form
the portable runtime boundary. Every operation here is expressible by a
static-allocation, no-GC implementation.

### `ExecutionContext` shape

`ExecutionContext` carries:

- `services: PlatformServices` -- the runtime service aggregate below.
- `getVariableBySlot(slotId)` / `setVariableBySlot(slotId, value)` --
  slot-indexed brain-global access; back `LOAD_VAR_SLOT` / `STORE_VAR_SLOT`.
- `currentCallSiteId?: number` -- bound before every host call and lifecycle
  hook dispatch; `undefined` outside those boundaries.
- `currentRuleFuncId?: number` -- `undefined` means no active rule; `0` is
  a valid rule id.
- `time`, `dt`, `currentTick` -- per-tick scalars stamped before each
  `think()` call.
- `data?: unknown` -- opaque per-tick application payload. The
  reference VM exposes this as a TS field; ports may render it as a
  `void*` user-data slot, a generic parameter, or another idiomatic
  pass-through. The contract is only that an opaque slot exists.

Every field is a scalar id, a primitive, a slot accessor, or a service
reference. No field holds an authoring-graph object, and there is no
`currentFiberId`; fiber identity is scheduler-internal.

### `PlatformServices` runtime state members

These id-keyed members extend `PlatformServices`
(in addition to `functions` and `types` from
[Construction and services boundary](#construction-and-services-boundary)):

- `program` -- `getRuleFuncIdForFunc(funcId)`: owning rule id or `undefined`.
- `brainVars` -- `getByName` / `setByName` / `clearByName`: brain-global vars.
- `ruleVars` -- same three, keyed by `(ruleFuncId, name)`. `undefined`
  ruleFuncId: reads return `NIL_VALUE`, writes are no-ops; store walks
  `Program.ruleAncestors` for inherited values.
- `brainPages` -- `getCurrentPageId()`, `getPreviousPageId()`,
  `requestPageChange(pageIndex)`, `requestPageChangeByPageId(pageId)`,
  `requestPageRestart()`.
- `rng` -- `next(): number` in `[0, 1)`, brain-scoped random stream.
- `callsite` -- `ensure(id)`, `reset(id)`, `getSlot(id, slotIdx)`,
  `setSlot(id, slotIdx, value)`, `getHostState(id)`, `setHostState(id,
  value)`, `clearHostState(id)`.

Every member operates on ids, names, and primitives. Time, clock,
and platform-entity services are not `PlatformServices` members.
Action resolution is not a member; the VM resolves actions from
`Program` directly.

### Callsite-id binding discipline

Before dispatching `HOST_CALL`, `HOST_CALL_ASYNC`, `ACTION_CALL` (host
branch), `ACTION_CALL_ASYNC` (host branch), or any lifecycle hook
(`onInitialized` / `onPageEntered` / `onPageExited`), the VM binds
`currentCallSiteId` and `currentRuleFuncId` on `ExecutionContext`. Host
functions reach per-callsite host state through
`services.callsite.{getHostState, setHostState, clearHostState}`, keyed by
`ctx.currentCallSiteId`; accessing host state when `currentCallSiteId` is
`undefined` is an error. Host functions never dereference an
authoring-graph object.

### Action call state model

`ACTION_CALL` and `ACTION_CALL_ASYNC` both route per-callsite state-slot
traffic through `services.callsite.{getSlot, setSlot}` keyed by
`(callSiteId, slotIdx)`, backing `LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR`.
`services.callsite.reset(callSiteId)` drops both slots and host state
together; `clearHostState(callSiteId)` drops only the host-owned cell.

`ACTION_CALL_ASYNC` allocates a `HandleId`, then either spawns a child
fiber (bytecode) or calls `execAsync(ctx, args, handleId)` (host). Both
paths resolve through `handles.events.on("completed", ...)`. **Host
obligation:** every `execAsync` call must eventually resolve, reject, or
cancel the `HandleId`. A synchronous throw is rolled back (the host branch
frees the handle in a `try/catch`); a silent drop leaves it pending until
`HandleTable.gc()` reclaims it.

### Id-spaces

Rule ids and action ids are compiler-assigned and stable for the lifetime
of a compiled `Program`. `0` is a valid `RuleId`; `undefined` is the only
"no rule" sentinel. Fiber ids are scheduler-internal; the contract does
not specify their allocation scheme. `HandleId`s come from the
`HandleTable`.

### Orchestrator opacity

The runtime orchestrator that owns the VM, scheduler, brain-instance
variable storage, and page-lifecycle state exposes an id-only public
surface. No orchestrator method accepts or returns an authoring-graph
reference, and the active-fiber set the scheduler exchanges with the
orchestrator carries fiber ids only.

### Out of scope for this section

`functions`, `types`, and `VmEvents` are covered by
[Construction and services boundary](#construction-and-services-boundary).
The runtime state members above extend that aggregate without redefining the
registry surface. Conversions and operators belong to the type and
function registries, not to separate `PlatformServices` members.

### Maintenance rule

Any subsequent spec that adds or removes a `PlatformServices` runtime
state member, changes the `ExecutionContext` field set or its exported helpers,
changes the callsite-id or rule-id binding discipline, changes the action
state-slot keying, changes the `HandleId` host-obligation contract, or
changes Brain's runtime-facing surface **must update this section in
lock-step** with the code change, in the same unit.

## Opcode completeness

Every conforming VM implementation -- the TypeScript reference VM
and any port (notably the C++ MCU port) -- implements every opcode
listed in this spec. Subsetting is not permitted.

The compiler is **target-unaware**: it emits the same bytecode
regardless of the eventual host. It does not consult a target
descriptor, does not gate opcode emission on host capability, and
does not lower a single source construct into different opcodes for
different targets. A compile-time `CompileTarget` descriptor would
create pressure for per-target lowering branches and, because no
configuration runs the TS VM in a mode that faithfully mimics a
different port, divergence on fault shape and check timing would be
invisible.

Not all opcodes are reachable from all host configurations, but
every conforming VM must be able to execute any of them:

- **Async opcodes** are emitted only when a host function or action
  declares `isAsync: true`. A host that registers no async
  functions will never receive bytecode that uses them, but must
  still implement them.
- **`try` / `throw` / `yield` opcodes** are part of the opcode set
  and must be implemented by every conforming VM.

---

## Opcode reference

One row per opcode: mnemonic, numeric code, operand widths, stack
effect, side effects, fault conditions.

> **Status:** the tables below are an in-progress reference covering
> the opcodes whose semantics the contract has had reason to pin
> precisely (stack manipulation, variable access, struct field
> access, host calls, action calls). The canonical numeric assignment
> for the full opcode set is the `Op` enum in
> `packages/core/src/runtime/bytecode.ts`; a port consumes that as
> the source of truth until each remaining opcode family is promoted
> into a table here.

### Stack manipulation

| Mnemonic        | Numeric | Operands       | Stack effect    | Faults                                                                       |
| --------------- | ------- | -------------- | --------------- | ---------------------------------------------------------------------------- |
| `STACK_SET_REL` | 6       | `d: u16` (`a`) | `[value] -> []` | `ScriptError` if `d` exceeds the post-pop top index (out-of-bounds write).   |

`STACK_SET_REL` pops one value off the operand stack, then writes
it to `vstack[top - d]` where `top` is the index of the topmost
element after the pop. `d = 0` writes the popped value to the new
topmost slot (a meaningful instruction under the top-element
convention -- not a no-op). Used to populate fixed-width arg
buffers at call sites; see [Calling convention](#calling-convention).

### Variable access

| Mnemonic         | Numeric | Operands            | Stack effect    | Faults                                                     |
| ---------------- | ------- | ------------------- | --------------- | ---------------------------------------------------------- |
| `LOAD_VAR_SLOT`  | 10      | `slotId: u16` (`a`) | `[] -> [value]` | `ScriptError` if `slotId >= program.variableNames.size()`. |
| `STORE_VAR_SLOT` | 11      | `slotId: u16` (`a`) | `[value] -> []` | `ScriptError` if `slotId >= program.variableNames.size()`. |

Variable access is slot-keyed at dispatch time. `slotId` is a
program-scoped index into `Program.variableNames`; the runtime hosts
a parallel value list of the same length. The dispatch loop performs
no name lookup for variable access -- name -> slot resolution is the
compiler's job, performed once at program build, and re-bound to the
host's value list at program load via the orchestrator's
variable-table install step.

`STORE_VAR_SLOT` deep-copies struct values before writing
(consulting `ITypeRegistry`); primitive values are written by
reference. The slot list grows lazily on out-of-range writes from
host code -- the bytecode path bounds-checks first and faults --
but bytecode reads/writes always observe a slot already sized to
`Program.variableNames.size()`.

Name-keyed access remains available to host code via
`services.brainVars.{getByName, setByName, clearByName}`. A host that
writes through a name not present in `variableNames` allocates a
fresh slot at the end of the value list; that slot is not addressable
from bytecode (no `LOAD_VAR_SLOT` operand can target it) and is
dropped on the next variable-table install (i.e. hot-reload).

### Struct field access

| Mnemonic           | Numeric | Operands              | Stack effect              | Faults                                      |
| ------------------ | ------- | --------------------- | ------------------------- | ------------------------------------------- |
| `STRUCT_GET_FIELD` | 114     | `fieldIndex: u16` (`a`) | `[struct] -> [value]`     | `ScriptError` if the source is not struct.  |
| `STRUCT_SET_FIELD` | 115     | `fieldIndex: u16` (`a`) | `[struct, value] -> [struct]` | `ScriptError` if the source is not struct. |
| `GET_FIELD`        | 120     | none                  | `[source, fieldName] -> [value]` | `ScriptError` if `fieldName` is not string. |
| `SET_FIELD`        | 121     | none                  | `[source, fieldName, value] -> [source]` | `ScriptError` if `fieldName` is not string or the source rejects the write. |

Closed structs store field values in `StructValue.v: List<Value>`,
indexed by `StructFieldDef.fieldIndex`. Compilers emit
`STRUCT_GET_FIELD` / `STRUCT_SET_FIELD` when type information proves
the source is a closed struct. Missing list entries read as `nil`.

Native-backed and open structs use the name-keyed `GET_FIELD` /
`SET_FIELD` family. For native-backed structs, the VM delegates to
the registered `fieldGetter` / `fieldSetter` hooks. Name-keyed access
to a closed struct is still defined by looking up the field name in
`StructTypeDef.fieldIndexByName` and then indexing `StructValue.v`; this is
for dynamic field-name paths and compatibility within the opcode set,
not the preferred static lowering.

---

## Value model

### Struct field indices

Every registered `StructTypeDef` exposes its fields as a
`List<StructFieldDef>` in which `fields.get(i).fieldIndex === i` for
every `i` in `[0, fields.size())`. The invariant holds for all three
registration paths (`addStructType`, `finalizeStructType` on a
reserved type, and `addStructFields` extending an existing type), and
field iteration order matches `fieldIndex` order.

`fieldIndex` is the field's stable, zero-based id within its struct
type. `STRUCT_GET_FIELD <idx>` / `STRUCT_SET_FIELD <idx>` take a
`fieldIndex` directly as their operand. Consumers that need a stable
per-field id should use `fieldIndex` rather than the field's name
string.

### Constant pool layout

Programs carry an aggregate `constantPools: ConstantPools` whose three
parallel sub-pools each have an independent index space:

- `constantPools.numbers: List<number>` -- raw `number` values pushed by
  `PUSH_CONST_NUM` and wrapped into `NumberValue` at runtime.
- `constantPools.strings: List<string>` -- raw `string` values pushed by
  `PUSH_CONST_STR`. Also used directly (without wrapping) as the
  typeId payload for `INSTANCE_OF.a`, `LIST_NEW.b`, `MAP_NEW.b`,
  `STRUCT_NEW.b`, and `STRUCT_COPY_EXCEPT.b`.
- `constantPools.values: List<Value>` -- residual pool for tagged values
  that do not fit the typed pools (e.g. `BoolValue`, `NilValue`,
  `FunctionValue`, `StructValue`). Pushed by `PUSH_CONST_VAL`.

Pool indices are independent: a `PUSH_CONST_NUM 3` and a
`PUSH_CONST_STR 3` reference unrelated entries. The linker and
tree-shaker remap each pool independently; cross-pool offsets are
carried as a `ConstantOffsets` aggregate.

---

## Calling convention

### Host-call layout

Host functions registered through `IFunctionRegistry` are invoked
via the opcode pair:

| Mnemonic          | Numeric | Operands                                            | Stack effect                                            |
| ----------------- | ------- | --------------------------------------------------- | ------------------------------------------------------- |
| `HOST_CALL`       | 40      | `fnId: u16` (`a`), `argc: u16` (`b`), `csId` (`c`)  | `[arg0, ..., arg(argc-1)] -> [result]`                  |
| `HOST_CALL_ASYNC` | 41      | `fnId: u16` (`a`), `argc: u16` (`b`), `csId` (`c`)  | `[arg0, ..., arg(argc-1)] -> [handle]`                  |

Operands:

- `fnId` is the function id assigned at registration time by
  `IFunctionRegistry`.
- `argc` is the **arg buffer width**. The dispatcher trusts `argc`
  to be the width on the operand stack;
  `argc == fnEntry.callDef.argSlots.size()` is true by construction
  for compiler-emitted call sites. Carried as an operand to avoid the
  registry indirection on the hot dispatch path.
- `csId` is the unique call-site id used by the host to key
  per-call-site state (e.g. timer carry, accumulator state).

Before invoking the host, the dispatcher sets
`fiber.executionContext.currentCallSiteId = csId`.

**Arg buffer.** The compiler reserves `argc` operand-stack slots
immediately preceding the call by emitting `argc` `PUSH_CONST_VAL`
of `NIL_VALUE` followed, for each user-supplied slot, by a
`STACK_SET_REL d` that overwrites the right filler. Slot ids are
indices into `callDef.argSlots`. The host reads slot `i` as
`args.get(i)`. Unsupplied slots are observed as `NIL_VALUE`; check
via `isNilValue(args.get(i))`. There is no `args.has(i)` distinct
from this -- "missing" and "explicitly nil" are not separable in
this ABI.

**Emit-side `d` formula.** Let `N = argc`. After pushing the `N`
NIL fillers the stack top is at the position of the last filler.
For target slot `s` in `0..N-1`, after pushing the user expression
the new top sits one slot above the buffer; after the implicit pop
in `STACK_SET_REL`, the new top is at the position of the last
filler. The d that addresses slot `s` from that new top is:

```
d = (N - 1) - s
```

Slot `0` therefore emits `STACK_SET_REL N-1` (deepest fill); slot
`N-1` emits `STACK_SET_REL 0` (overwrites the topmost filler with
the popped expression -- not a no-op under the top-element
convention). The compiler emits the same
`lower expr; STACK_SET_REL d` pair for every supplied slot
regardless of order; the formula is independent of emission order.

**Sync vs async.** Sync and async hosts share the slot layout but
have different lifetime contracts:

- `HostSyncFn.exec(ctx, args: ReadonlyList<Value>): Value` --
  `args` is a `Sublist` view over the operand stack. The wrapper is
  ephemeral; the sync host must read what it needs into locals and
  return. Individual `Value` heap objects retrieved through
  `args.get(i)` are always safe to retain.
- `HostAsyncFn.exec(ctx, args: ReadonlyList<Value>, handleId)` --
  `args` is an owned snapshot allocated by the dispatcher (a fresh
  `List<Value>`). The async host may close over the wrapper and
  individual values across the async boundary, then resolve or
  reject the handle whenever the work completes.

The dispatcher pops the buffer (or, for async, copies it then
pops) before the host call returns, so the buffer is no longer
visible to the host's continuation.

**Re-entry.** A host `exec` body must not invoke any of the four VM
entry points listed in [Single-entry guarantee](#single-entry-guarantee).
Within the synchronous duration of an `exec` call the host may read
its `args` view and the rest of `ctx`, but must not call back into
`brain.think()`, `scheduler.tick()`, `runFiber()`, or async-handle
resolution. See that section for the full transitive rule.

Action calls (`ACTION_CALL` / `ACTION_CALL_ASYNC`) use the same
positional buffer shape as host calls. The compiler pushes one
`NIL_VALUE` filler per declared action slot, lowers each supplied
argument expression, and stores it into the slot with
`STACK_SET_REL argc-1-slotId`. Operand `a` is the action slot,
operand `b` is `argc`, and operand `c` is the call-site id.

Host-bound sync actions receive a transient
`ReadonlyList<Value>` stack view and host-bound async actions receive
an owned snapshot, matching the host function lifetime contract
above. Bytecode actions do not receive an args map or list object:
their frame locals are laid out as `ctx` (when injected), then one
local per action slot. `args.<name>` in user-authored action code
lowers directly to that slot local. Reading the whole `args` object
is unsupported.

Sparse, optional, conditional, and repeated slots are represented by
`NIL_VALUE` when absent. There is no per-call presence map, so user
code that needs an omitted value to behave like a default must express
that fallback explicitly, for example with `??`.

### Operator monomorphization

Arithmetic on primitive `NumberValue` (and other primitive) operands
is monomorphic on the dispatch hot path. Operator overload resolution
happens at compile time: the compiler resolves each operator use to a
concrete `BrainFunctionEntry` and emits `HOST_CALL <fnId>` over the
prescribed NIL+STACK_SET_REL arg-buffer pattern (above). The runtime's
dispatch loop never consults `IOperatorTable`, `IOperatorOverloads`,
or `ITypeRegistry` to dispatch a primitive arithmetic instruction.
The dispatch loop only consults `ITypeRegistry` for struct-shaped
opcodes (e.g. `GET_FIELD`, `SET_FIELD`, `STORE_VAR_SLOT` when
deep-copying a struct value).

---

## Page lifecycle hooks

Every `BytecodeExecutableAction` declares up to three optional
hook function ids that the brain runtime dispatches at well-defined
points in a page's life. Every host-bound action declares up to two
optional host hook callbacks that the brain runtime dispatches at
the same points. These hooks own all per-callsite state setup,
re-setup on respawn, and teardown.

### Bytecode hook fields

`BytecodeExecutableAction` carries:

- `initializerFuncId?: number` -- runs at most once per
  `(brainInstance, callSiteId)` pair, the first time that callsite
  is activated. The compiler emits module-scope `let` / `const`
  initializers (and equivalent static-field initializers) into this
  function. After the first run, the callsite's storage is
  considered initialized and the function is not invoked again for
  the same brain instance, even across page exits and re-entries,
  until the brain itself is shut down.
- `activationFuncId?: number` -- runs every time the page
  containing this callsite becomes active. The compiler reserves
  this slot for an in-action `onPageEntered` handler; without that
  source-level construct, user programs leave it unset.
- `deactivationFuncId?: number` -- runs every time the page
  containing this callsite becomes inactive. The compiler reserves
  this slot for an in-action `onPageExited` handler; without that
  source-level construct, user programs leave it unset.

### Host hook fields

Host-bound actions carry:

- `onInitialized?: (...) => void` -- runs at most once per
  `(brainInstance, callSiteId)` pair, on the first activation
  that allocates the call site, before `onPageEntered` fires
  for the same activation. Symmetric to the bytecode
  `initializerFuncId`. Cleared by
  `services.callsite.reset(callSiteId)` (re-runs on the next
  activation) and by the orchestrator's brain shutdown (re-runs on
  the next brain startup). Soft `requestPageRestart` does not
  re-fire this hook.
- `onPageEntered?: (...) => void` -- runs every time the page
  containing this callsite becomes active.
- `onPageExited?: (...) => void` -- runs every time the page
  containing this callsite becomes inactive.

When `onInitialized` is set, the brain runtime calls
`services.callsite.ensure(callSiteId)` for the host callsite to
detect first-touch; when it is unset, no callsite record is
allocated for the host action and no first-touch dispatch
occurs.

### Brain-instance-scoped lifetime

All callsite storage -- bytecode state slots and host state -- is
scoped to a single brain instance. The runtime contract is:

- Storage is allocated **lazily** on first write
  (`services.callsite.setSlot`, `services.callsite.setHostState`) or
  on the first `services.callsite.ensure(callSiteId)` call for
  actions that declare an `initializerFuncId`.
- `services.callsite.ensure(callSiteId)` returns `true` on the first
  call for a callsite (newly allocated) and `false` thereafter. The
  brain runtime uses this result to dispatch `initializerFuncId`
  exactly once per allocation.
- Storage **persists** across page exits and re-entries within the
  same brain instance. Returning to a page does not reset its
  callsite state.

### Explicit reset primitives

The runtime exposes two primitives for callers (host code and the
brain runtime itself) to discard callsite state explicitly:

- `services.callsite.reset(callSiteId)` -- deallocates the bytecode
  state slot block and the host-side cell for the callsite together.
  The next `services.callsite.ensure` for the same id returns `true`
  and the next page activation re-runs the `initializerFuncId` for
  that callsite.
- `services.callsite.clearHostState(callSiteId)` -- clears the
  host-side state cell for the callsite without affecting bytecode
  state slots.

These primitives are the only sanctioned way to force a re-init
short of tearing down the whole brain.

### Brain shutdown teardown contract

The orchestrator's brain-shutdown operation is the brain-wide
teardown counterpart to allocation. It is required to release every
callsite's storage so that a subsequent brain startup on the same
instance behaves identically to a fresh brain: every
`initializerFuncId` runs again on first activation, and every host
hook re-binds against freshly allocated host state. Implementations
must not leak callsite state across a shutdown / startup boundary.

---

## Feature flags

None, by design. See [Opcode completeness](#opcode-completeness)
for the architectural commitment (every conforming VM implements
every opcode; the compiler is target-unaware).

Runtime feature flags (`fibers`, `structuredExceptions`,
`asyncHandles`) and a compile-time `CompileTarget` capability
descriptor were considered and rejected. Capability differences
between hosts are surfaced through host registration (async
functions / actions) and language-tile gating in the compiler,
not through VM-level flags or compiler-level target awareness.

Two invariants follow from this:

- **Adding an opcode to this spec obligates every conforming VM to implement it.**
  There is no per-host capability gate. Host constraints belong in
  the decision to add an opcode, not in the VM or compiler.
- **Runtime flags do not help C++ ports.**
  A C++ MCU port makes
  capability decisions at build time via `#ifdef` / build
  constants, not by reading a runtime flag. A TS-side runtime
  flag would impose per-opcode dispatch overhead in the TS VM
  with no corresponding mechanism on the C++ side.

Per-deployment caps for memory-constrained hosts are documented
under [Limits](#limits).

---

## Error model

Every fault produced by the VM carries an `ErrorCode` tag:

```ts
type ErrorValue = {
  code: ErrorCode; // numeric, wire-stable
  // implementations may include additional diagnostic fields
};
```

Only `code` is contractual.

`code` is a numeric `ErrorCode`. Values are explicit and never reordered:

| Code             | Numeric | Raised when                                                                                                                                                                                             |
| ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Timeout`        | 1       | Reserved; not yet emitted by the runtime.                                                                                                                                                               |
| `Cancelled`      | 2       | A handle is cancelled, or `cancelFiber` is invoked on a runnable/waiting fiber.                                                                                                                         |
| `HostError`      | 3       | An async handle rejects without an explicit error, or the host async path fails.                                                                                                                        |
| `ScriptError`    | 4       | Bytecode-level fault: missing frame, PC out of bounds, unknown opcode, dispatch-time exception, `THROW` of a non-error value.                                                                           |
| `StackOverflow`  | 5       | A configured capacity cap is exceeded: operand stack (`maxStackSize`), frame depth (`maxFrameDepth`), handler stack (`maxHandlers`), pending handles (`maxHandles`), or scheduler fibers (`maxFibers`). |
| `StackUnderflow` | 6       | An opcode handler attempts to `pop` or `peek` from an empty operand stack. Indicates malformed bytecode (the compiler should never emit such a sequence).                                               |

The runtime never compares against the string label. Render the label at
the diagnostics boundary via `errorCodeName(code)` (returns `"ScriptError"`,
`"HostError"`, etc.).

### Host fault callback

`Scheduler.onFiberFault?: (fiberId: number, error: ErrorValue) => void`
is invoked exactly once per faulting fiber, after the fiber transitions
to `FAULT` and any associated async-action handle is rejected.

---

## Limits

The runtime exposes five capacity caps. Crossing any of them surfaces
as an `ErrorCode.StackOverflow` fault on the offending fiber (the host
fault callback receives a normal `ErrorValue`; the runtime never throws
out of `runFiber`). Three are per-fiber (`VmConfig`); two are global
(host-owned).

| Cap             | Owner                  | Default             | Triggered when                                                                                                                                       |
| --------------- | ---------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxStackSize`  | `VmConfig` (per fiber) | 4096                | The operand stack would grow past this many values.                                                                                                  |
| `maxFrameDepth` | `VmConfig` (per fiber) | 256                 | A `CALL` / `CALL_INDIRECT` / `CALL_INDIRECT_ARGS` / `ACTION_CALL` would push a frame past this depth.                                                |
| `maxHandlers`   | `VmConfig` (per fiber) | 64                  | A `TRY` would install a handler past this depth on the handler stack.                                                                                |
| `maxHandles`    | `HandleTable` ctor arg | 100000 (production) | `HandleTable.createPending()` is invoked when the table already holds this many entries.                                                             |
| `maxFibers`     | `SchedulerConfig`      | 10000               | `FiberScheduler.addFiber()` (and therefore `spawn()` and async-action fiber creation) is invoked when the scheduler already tracks this many fibers. |

Both kinds of violation surface to the offending fiber as
`ErrorCode.StackOverflow` (or `ErrorCode.StackUnderflow` for operand
underflow). Hosts that drive `HandleTable.createPending` or
`FiberScheduler.spawn` directly may see the limit violation propagate
as a thrown value out of those calls; the wire-level fault code is
still `StackOverflow`.

`maxFibers` lives on `SchedulerConfig` because the scheduler -- not the
VM -- owns the fiber pool.

Operand widths and other numeric ranges (slot ids, function ids,
constant indices) are bounded by the binary format and are documented
in the [Binary format appendix](#binary-format-appendix).

### Recommended caps for memory-constrained hosts

The default caps in the table above are sized for a desktop host
running the simulator and authoring tools. An embed host targeting
a memory-constrained deployment (microcontroller, sandboxed plugin,
WASM module with a small heap) is expected to lower most of them.
This subsection describes the _shape_ of that choice. Concrete
numbers belong to the host's build configuration, not this spec.

On the TypeScript reference VM every cap is a **fault gate**: the
backing storage (operand stack, frame stack, handler stack, handle
table, fiber list) is a lazy `List` / `Dict` that grows as values
are pushed. Lowering a cap on the TS VM trades fault threshold for
fault threshold; it does not save heap. A fixed-array port (notably
the C++ MCU port) is expected to use the same cap as a build-time
sizing input, in which case lowering the cap _does_ shrink the
binary's resident memory footprint.

Per cap, an embed host should weigh:

- **`maxStackSize`** -- bounds the operand stack of a single fiber.
  Weigh: deepest expression nesting in user code (each arithmetic
  intermediate consumes one slot) and the widest action call (each
  argument is pushed before `ACTION_CALL`). Per-slot cost on a
  fixed-array port is one `Value` (tagged union). Overflow raises
  `ErrorCode.StackOverflow`. Fault gate on the TS VM; sizing input
  on a fixed-array port.
- **`maxFrameDepth`** -- bounds the call-frame stack of a single
  fiber. Weigh: deepest call chain (recursion, mutual recursion,
  action-call chains via `ACTION_CALL`). Per-frame cost on a
  fixed-array port is one frame record (program counter, frame
  pointer, function id, locals slice header). Overflow raises
  `ErrorCode.StackOverflow`. Fault gate on the TS VM; sizing
  input on a fixed-array port.
- **`maxHandlers`** -- bounds the handler stack of a single fiber
  (one entry per active `TRY`). Weigh: deepest dynamic nesting of
  `TRY` blocks. Per-entry cost on a fixed-array port is one
  handler record (catch program counter, frame depth snapshot,
  handler stack snapshot). Overflow raises `ErrorCode.StackOverflow`.
  Fault gate on the TS VM; sizing input on a fixed-array port.
- **`maxHandles`** -- bounds the global `HandleTable`. Weigh:
  expected count of in-flight async actions across all fibers.
  Each handle is one entry until it resolves and is collected.
  Pure fault gate on the TS VM (the `Dict` is lazy; lowering the
  cap saves zero bytes). On a fixed-array port that pre-allocates
  the handle slab, the cap also sizes the slab. Overflow raises
  `ErrorCode.StackOverflow` from `HandleTable.createPending`.
  Set to `0` to forbid async actions entirely; the host then must
  also refuse to register any async functions.
- **`maxFibers`** -- bounds the global fiber pool owned by the
  scheduler. Weigh: expected count of concurrent fibers (one root
  fiber per brain, plus one per active `spawn` and per active
  async-action call). Per-fiber cost on a fixed-array port is one
  fiber record plus that fiber's pre-allocated stacks (sized by
  `maxStackSize` / `maxFrameDepth` / `maxHandlers` above).
  Overflow raises `ErrorCode.StackOverflow` from
  `FiberScheduler.addFiber`. Fault gate on the TS VM; sizing
  input on a fixed-array port.

Treat the per-cap costs above as ordering, not absolutes; measured
byte costs for a specific MCU build vary by platform and compiler
settings.

---

## Binary format (appendix)

MCU-targeting binary layout produced by the offline transform.
The TS VM does not consume this format.
