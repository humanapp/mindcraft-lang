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
silent stack corruption. The TS reference VM and the C++ port are
both encouraged to ship one.

Shape: a single `inVm` boolean (or equivalent flag) on the VM, set
on entry to any of the four entry points named above and cleared
on exit. Re-entry while the flag is set is a fatal `VmReentry`
fault, not a recoverable `ScriptError` -- the whole point is that
the VM state is no longer consistent.

Illustrative C++ sketch (RAII):

```cpp
struct VmReentryGuard {
    Vm& vm;

    VmReentryGuard(Vm& vm) : vm(vm) {
        if (vm.inVm) {
            vm.fatal(Fault::VmReentry);
        }
        vm.inVm = true;
    }

    ~VmReentryGuard() {
        vm.inVm = false;
    }
};

void brainThink(uint32_t now, uint32_t dt) {
    VmReentryGuard guard(vm);
    scheduler.tick(now, dt);
    drainCompletions(); // or drain before tick, but still under
                        // host-loop ownership
}
```

The TS equivalent is a `try` / `finally` around each entry point
that toggles the same flag.

Notes:

- The guard wraps the host-loop entry, not individual host calls.
  A `HostSyncFn.exec` body runs _inside_ the guard's scope; if it
  invokes `brain.think()` (etc.), the nested guard observes
  `inVm == true` and faults.
- The fault is fatal because there is no safe recovery: the
  operand stack and any active `ReadonlyList<Value>` arg view are
  in an indeterminate state.
- The check is one branch on the dispatch entry path, not
  per-instruction. Cost is negligible on both targets.

A future relaxation (e.g. an actuator that synchronously evaluates
a brain page, or a bytecode-backed struct getter invoked from inside
a host function) must come as its own spec unit that revisits the
contract -- a narrowly-scoped re-entrant entry point distinct from
`brain.think()`, plus an explicit materialize/copy step for any
ephemeral views the host holds. Ad-hoc loopholes are not permitted.

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
no `Dict.get(name)` lookup for variable access -- name -> slot
resolution is the compiler's job, performed once at program build,
and re-bound to the host's value list at program load via
`Brain.installVariableTable`.

`STORE_VAR_SLOT` deep-copies struct values before writing
(consulting `ITypeRegistry`); primitive values are written by
reference. The slot list grows lazily on out-of-range writes from
host code -- the bytecode path bounds-checks first and faults --
but bytecode reads/writes always observe a slot already sized to
`Program.variableNames.size()`.

Name-keyed access remains available to host code via
`ExecutionContext.getVariable` / `setVariable` / `clearVariable`. A
host that writes through a name not present in `variableNames`
allocates a fresh slot at the end of the value list; that slot is
not addressable from bytecode (no `LOAD_VAR_SLOT` operand can
target it) and is dropped on the next `installVariableTable` (i.e.
hot-reload).

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

**Re-entry.** The TS VM is not single-entry by contract. The host
is responsible for the discipline around invoking VM operations
synchronously inside its own `exec`.

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

This invariant is regression-guarded by the
`VM -- operator monomorphization` test in
`packages/core/src/brain/runtime/vm.spec.ts`, which wraps
`ITypeRegistry` with an access counter and asserts a zero count after
running a number-heavy arithmetic loop.

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

Limit violations are signalled internally with the `OverflowError`
class, and operand-stack underflow with the parallel `UnderflowError`
class (both extend the platform `Error` and live in
`interfaces/vm.ts`). The VM dispatch loop detects each via
`isOverflowError(e)` / `isUnderflowError(e)` and constructs the
matching fault. Hosts that call `HandleTable.createPending` or
`FiberScheduler.spawn` directly will see `OverflowError` propagate as
a thrown value -- catch with `instanceof OverflowError` or
`isOverflowError(e)` if a graceful path is needed.

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
