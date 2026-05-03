# TS VM Dense Runtime State Plan

Date: 2026-05-02
Status: Phased implementation plan.

## Scope And Sibling Spec

This spec covers the work of replacing the object-shaped runtime state
of the TS VM with a compact ids/slots/side-tables model that TS,
WODAL, and the C++ CODAL port can mirror byte-for-byte semantically.

In scope:

- `Brain`, `BrainPage`, `BrainRule`, action-instance objects, and the
  rich `ExecutionContext` shape -- their runtime roles are replaced by
  ids, slot indices, and explicit runtime side tables / services.
- Host function signatures, where they currently dereference
  `ctx.brain` / `ctx.rule` / object-shaped actor or action handles.
- Rule resolution (spawn func id -> rule, frame -> current rule).
- Host-call context binding (`HOST_CALL`, `HOST_CALL_ASYNC` ->
  `currentCallSiteId` discipline).
- Action call state (action-instance state slots, current action
  identity, async action handle resolution).
- Scheduler vs page/rule orchestration boundary.

Out of scope (lives in
[ts-vm-module-decoupling-plan-2026-05-02.md](ts-vm-module-decoupling-plan-2026-05-02.md)):

- Module relocation of bytecode types into `runtime/`.
- The `PlatformServices` aggregate for registries
  (types/functions/conversions/operators/program verification).
- The `VMEvents` aggregate scaffold.
- The `vm.ts` import firewall.

Out of scope entirely:

- Bytecode instruction changes.
- A dense MCU binary writer.
- A WODAL or CODAL implementation.
- Any reduced MCU bytecode subset; the TS VM remains the full
  semantic reference.

## Prerequisite

Phases M0 through M5 of the module-decoupling spec must be complete
before any unit in this spec ships. The contract surface that this
spec builds on is pinned in
[`vm-contract.md#construction-and-services-boundary`](../core/vm-contract.md#construction-and-services-boundary).
The dense-state work assumes:

- The runtime `Program` exists at `packages/core/src/runtime/`.
- `PlatformServices` is the aggregate the VM accepts at
  construction.
- `VMEvents` is the passive-observer aggregate.
- The import firewall is in place and green.

If any prerequisite slips, this spec stops -- do not work around a
missing seam by reaching back into `brain/`.

## Goal

Replace the object-shaped runtime state surface with a portable shape:

```text
ExecutionContext (portable)
  - slot-keyed variable access
  - rule variable access by (rule id, slot)
  - callsite state by current callsite id
  - action state by (action id, callsite id)
  - currentCallSiteId, currentRuleId, currentActionId
  - time, dt, currentTick
  - RNG with deterministic TS/MCU semantics
  - platform entity / self access
  - data
```

```text
PlatformServices (extends module-decoupling spec's aggregate)
  + action resolution / activation
  + rule lookup (id -> rule descriptor)
  + callsite metadata access
  + RNG / time service if not owned by ExecutionContext
  + platform entity / self access service
```

The forcing function is the sim host functions, especially `see` and
`move`. Every context capability they require is a portability
requirement unless that host function is explicitly removed from the
MCU target. The plan optimizes TS toward the MCU-shaped API; it does
not design a reduced MCU substitute.

## Non-Goals

- No bytecode instruction changes.
- No dense MCU binary writer.
- No WODAL implementation.
- No CODAL implementation.
- No reshaping of the registry-shaped `PlatformServices` introduced by
  the module-decoupling spec.

## Desired End State

- `ExecutionContext` is one portable shape with no heap-object
  references to brain/page/rule/action objects. State is reached by
  ids, slots, and side tables.
- Host function signatures take only the portable
  `ExecutionContext` and -- where relevant -- explicit
  `PlatformServices` operations. Sim host functions including `see`
  and `move` are migrated.
- Rule resolution is a `Program`-table or `PlatformServices` lookup,
  not a walk of object hierarchy.
- `HOST_CALL` and `HOST_CALL_ASYNC` bind
  `ExecutionContext.currentCallSiteId` (and any other current-scope
  ids the host ABI requires) as documented VM behavior, not as an
  optional event.
- Action call state lives in compact side tables addressable by
  `(action id, callsite id)` or equivalent. The TS object
  `ActionInstance` is gone or reduced to a debug/editor convenience
  in non-runtime code.
- The scheduler is a runtime mechanism (fibers, queues, budgets,
  handles). Page/rule lifecycle (active page fibers, root rule
  respawn, page activation/deactivation, action callsite reset) is
  explicit runtime behavior, not hidden inside scheduler queue
  internals.
- All current runtime behavior tests pass through every unit. New
  tests cover the new state contract.

## Key Invariants

- Existing Mindcraft bytecode output remains semantically unchanged.
- Current runtime behavior tests remain green after every unit.
- Required bytecode semantics are not optional events. If TS and MCU
  must do the same thing for parity, it belongs in the VM contract,
  `Program`, `ExecutionContext`, or `PlatformServices`.
- Every capability used by shipped sim host functions is a
  portability requirement unless that host function is explicitly
  removed from the MCU target.
- Object-shaped runtime fallbacks must not survive past the unit
  that is supposed to retire them. No "object form for now, slot
  form later" parallel data paths.

## No Backward Compatibility

Same rules as the module-decoupling spec. No parallel old/new shapes,
no deprecation aliases, no dual-mode factories. Every call site is
updated in the unit that changes the shape.

## Multi-Target Core Constraints

Same constraints as the module-decoupling spec
(`.github/instructions/core.instructions.md`). Dense state is
particularly constraint-sensitive: id-keyed and slot-indexed storage
must use `List<T>` and `Dict<K, V>` from
`packages/core/src/platform`, never native `Array` / `Map`.

Additionally, **no circular import paths between modules unless
every import in the cycle is type-only** (`import type` /
`export type`). Roblox-ts emits Luau `require` calls for value
imports, and value-level cycles are not safe at module-init time on
Luau. Type-only cycles are erased at compile time and are allowed.
Dense-state work tends to introduce cross-references between context,
services, and program tables; check for value-level cycles whenever a
new runtime module is added or an existing one is split.

## Workflow Convention

Phases are numbered D0-D5. Units within a phase are numbered D<N>.<K>
when a phase is broken into units; otherwise the phase number alone
identifies the unit.

The implementation loop, post-mortem rules, and verification gate are
identical to the module-decoupling spec. Repo memory notes use the
prefix `vm-decouple-D<N>[.<K>].md` to distinguish from
`vm-decouple-M<N>.md` (module-decoupling) and the existing
`vm-embed-V*.md` notes.

D6, D7, D8 in the original combined plan corresponded to the
behavior-sensitive migrations; they map to D2, D3, D4 here. **Those
three phases must not be combined into a single unit.** Each ships
and is reviewed independently.

---

## Current State

Phase D0 not yet started. Prerequisite: module-decoupling spec
through M5. This section is populated by post-mortems as units
complete; do not amend during implementation.

---

## Phase D0 -- Decision Tables For The Dense State Shape

**Purpose.** Pin the data-shape decisions that the rest of this spec
depends on, before any code moves.

**Work.** Produce four tables. Each is appended to this plan under a
`## Phase D0 Decisions` section directly below `## Current State`.

1. **`ExecutionContext` field disposition.** For each field on today's
   `ExecutionContext`, one of:
   - `keep-portable` -- stays, semantics unchanged;
   - `replace-with-id` -- the current object reference is replaced by
     a stable id and a lookup operation;
   - `replace-with-slot` -- the current name-keyed access is replaced
     by a slot-indexed access;
   - `move-to-service` -- moves to a `PlatformServices` operation;
   - `delete` -- no portable equivalent and no host function depends
     on it.

2. **Sim host function context dependency table.** For each shipped
   sim host function (start with `see` and `move`; cover the full
   set), list the `ExecutionContext` fields and `PlatformServices`
   operations it requires. The union of these requirements is the
   minimum host context contract for MCU/WODAL parity.

3. **Object-model retirement table.** For each of `Brain`,
   `BrainPage`, `BrainRule`, `ActionInstance`, `RuleSet`, list:
   - which D-phase retires its runtime role;
   - what compact representation replaces it (id / slot / side
     table);
   - whether a non-runtime debug/editor variant survives, and where
     it lives.

4. **Rule and action id-space decisions.** Specifically:
   - id type (`number` vs branded `RuleId` / `ActionId`);
   - id allocation point (compiler vs linker vs runtime);
   - sentinel value for "no current rule" / "no current action";
   - slot-allocation rule for action state and rule variables.

Out of scope for D0:

- Implementing any of the new shape.
- Migrating any host function.

**Deliverable.**

- The four tables, appended as `## Phase D0 Decisions`.

**Acceptance.**

- D1-D5 can be implemented from the D0 tables without re-litigating
  the data shape.
- No code changes.

## Phase D1 -- Unify ExecutionContext Around The Portable Shape

**Purpose.** Make the host-call context portable without losing the
Mindcraft semantics that current sensors and actuators rely on.

**Work.**

- Replace today's `ExecutionContext` with the shape decided in D0.
  Includes:
  - name-keyed variable access for host compatibility (if D0 keeps
    it) and slot-keyed access for bytecode;
  - rule variable access by `(rule id, slot)`;
  - callsite state access by current callsite id;
  - action state access by `(action id, callsite id)`;
  - `currentCallSiteId`, `currentRuleId`, `currentActionId` (or D0's
    equivalent);
  - `time`, `dt`, `currentTick`;
  - RNG access with deterministic TS/MCU semantics;
  - platform entity / self access;
  - `data`.
- Retype host function signatures to accept the portable shape.
- Migrate every shipped sim host function to the new signature in
  the same unit -- per the No Backward Compatibility rule, do not
  leave a parallel object-shaped path.
- Object-model fields (`ctx.brain`, `ctx.rule`, etc.) are deleted
  from the runtime context in this phase. Object structures
  themselves may still exist on `Brain` -- they just are not
  reachable through `ctx`.

**Risks.**

- TypeScript variance around host function callbacks may force
  generics or explicit casts.
- Existing app host functions outside the sim may expect
  object-model fields from `ctx`. The D0 sim table covers the sim;
  this unit must extend the audit to every other shipped host
  function before retyping.
- Faults emitted from host functions may include object references
  in their payload today; those payloads need to switch to ids.

**Acceptance.**

- VM-facing and host-function APIs refer to the unified portable
  `ExecutionContext`.
- Every shipped host function is on the new signature.
- `currentCallSiteId` binding is treated as required VM behavior, not
  an optional extension point.
- The `see` sensor and `move` actuator context dependencies are
  satisfied by portable operations or `PlatformServices`.
- No runtime behavior changes.

## Phase D2 -- Rule Resolution As A Contracted Service

**Purpose.** Replace direct rule-object lookups in function call and
fiber spawn paths with table/service operations.

**Work.**

- Replace direct calls to rule-resolution helpers with `Program`
  tables or `PlatformServices` operations:
  - spawn func id -> rule id;
  - caller/callee func id -> effective rule id;
  - frame -> current rule id.
- `BrainRule` objects no longer flow through scheduler or VM dispatch
  paths.
- Rule variable access uses the slot/id model end-to-end on TS;
  there is no "until the data shape is optimized" fallback past D2.
- Runtime programs that do not use rule-sensitive bytecode or host
  functions do not require rule services.

**Risks.**

- Current rule context may subtly affect host functions and sensors;
  D0 table 2 must be complete and accurate before this phase ships.
- Nested function calls inside a rule must preserve today's rule
  identity through the new id-based path.

**Acceptance.**

- Rule-aware host functions observe the same rule scope and variables
  as before through ids and slots.
- TS exposes current rule identity through the same operational model
  the MCU port can mirror.
- Runtime programs do not need rule mapping unless they use
  rule-sensitive services.

## Phase D3 -- First-Class Host Call Context Binding

**Purpose.** Make host-call dispatch explicit and portable across TS,
WODAL, and MCU.

**Work.**

- Specify (in the VM contract) that `HOST_CALL` and `HOST_CALL_ASYNC`
  bind `ExecutionContext.currentCallSiteId` to the instruction
  `callSiteId` for the host-call execution window, and unbind on
  return.
- Move any remaining direct mutation of object-model fields out of VM
  dispatch and into `ExecutionContext` / service operations:
  - current action id binding;
  - current rule id binding;
  - rule/action variable scope entry/exit.
- Preserve positional arg ABI.
- Preserve sync view vs async snapshot semantics.
- Add tests for callsite id binding across sync and async host calls,
  including nested call/return restoration.

**Risks.**

- Host-call arg views are ephemeral. Event observers and services
  must not retain unsafe stack views.
- Rebinding must be restored correctly after nested calls and
  returns.

**Acceptance.**

- `HOST_CALL` and `HOST_CALL_ASYNC` behavior unchanged.
- Callsite binding is documented in the VM contract and implemented
  by the VM, not delegated to optional events.
- Service boundaries are explicit enough for WODAL/CODAL host-loop
  parity.

## Phase D4 -- Action Call State Behind A Service

**Purpose.** Replace object-heavy action-instance mechanics with a
compact runtime action-state model.

**Scope.** Define the portable runtime action model. Preserve
`ACTION_CALL` semantics, but replace TS object-shaped
`ActionInstance` machinery with compact program metadata,
execution-context state, and a service the MCU port can mirror.

**Work.**

- Move `getOrCreateActionInstance`, `resetActionInstance`, and action
  state-slot lookup behind a `PlatformServices` action adapter.
- Keep action opcodes semantically unchanged.
- The action service is responsible for:
  - action descriptor resolution;
  - host-bound vs bytecode-bound action dispatch;
  - activation behavior;
  - action state slot allocation;
  - current action id binding.
- Async bytecode actions spawn child fibers and resolve handles.
  D0 table 3 (object-model retirement) and table 4 (id-space
  decisions) must cover the async case before this phase ships --
  this is the highest-risk piece of D4.

**Risks.**

- Action calls combine dispatch, persistent state, current action
  identity, host-backed execution, bytecode-backed execution, child
  fibers, and async handle resolution. If D0 has not pinned these
  semantics, TS/WODAL/MCU behavior can diverge.

**Acceptance.**

- `vm.ts` does not import `getOrCreateActionInstance` or any
  object-shaped action helper.
- Action state slot opcodes still work in Mindcraft programs.
- Runtime programs can run without action metadata unless they
  execute action opcodes.

## Phase D5 -- Scheduler / Page Orchestration Boundary

**Purpose.** Ensure fiber scheduling remains a compact runtime
service, while page/rule orchestration is explicit runtime behavior
rather than hidden object-graph coupling.

**Work.**

- Audit scheduler and `Brain.think()` boundaries.
- Keep `FiberScheduler` focused on runtime mechanics: fibers,
  queues, budgets, handles. The scheduler interacts with the
  dense-state model through ids, not through `BrainRule` /
  `BrainPage` references.
- Keep page/rule lifecycle outside the scheduler queue
  implementation:
  - active page fibers;
  - root rule respawn;
  - page activation/deactivation;
  - action callsite reset.
- If passive scheduler events are needed, add them to the existing
  `VMEvents` aggregate from the module-decoupling spec. Do not
  create a parallel scheduler-events aggregate.

**Risks.**

- It is easy to hide page/rule orchestration inside scheduler
  mechanics while trying to simplify the code. The unit must
  explicitly call out where page/rule lifecycle lives after the
  change.

**Acceptance.**

- Scheduler can be used by any runtime host that supplies the
  required program/context/services and the dense-state ids.
- Rule respawn behavior remains unchanged.
- `Brain` (if it survives at all in runtime) is a thin orchestrator
  over ids and services, not a hierarchy the scheduler walks.

## Sequencing Constraints

Phases run in numeric order (D0 -> D5). The hard constraints:

- D0 must complete before D1.
- **D2, D3, D4 are the behavior-sensitive migrations and must not
  be combined into a single unit.** Each ships and is reviewed
  independently.
- D5 is last because it depends on D2 (rule ids) and D4 (action
  ids).

## Completion Criteria

This spec is complete when:

- `ExecutionContext` exposes only portable, id/slot-addressable
  state.
- Every shipped host function uses the portable signature.
- `Brain`, `BrainPage`, `BrainRule`, `ActionInstance` no longer
  appear in runtime dispatch paths. Any debug/editor variants are
  outside the runtime import graph.
- Rule resolution, host call binding, and action call state are
  contracted runtime behaviors, documented in the VM contract.
- The MCU binary encoder can consume the same semantic `Program`
  the TS VM runs.
- WODAL and CODAL can implement the same dense-state host
  boundary.
