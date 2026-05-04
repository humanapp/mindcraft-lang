# TS VM Page Lifecycle Hooks Plan

Date: 2026-05-03
Status: Drafted; not yet started.

## Purpose

Action callsite storage in the TS VM is today
page-activation-scoped: a user-language
`let lastShotTime = 0;` declared in an action is re-zeroed on
every page re-entry, and host-side state (e.g. `MoveState`
cooldowns) is discarded the same way. That lifetime is wrong
by design -- module-scope `let` should mean "initialized
once, persists for the life of the brain," matching C
`static` locals or TS module-scope `let`.

This spec changes callsite storage to **brain-instance-scoped**
and adds the page lifecycle hook surface that lets user and
host code opt into reset when reset is the desired semantic.
It must land before the dense-state plan
([`ts-vm-dense-runtime-state-plan-2026-05-02.md`](./ts-vm-dense-runtime-state-plan-2026-05-02.md))
reaches D3, which would otherwise pin the wrong lifetime
into the new `PlatformServices` adapter contract.

## Scope

In scope (runtime + compiler + tests, shipped lock-step):

- Lifetime change: action state slots and host state cells
  become brain-instance-scoped. Allocation happens once per
  callsite per brain instance; reset is opt-in.
- New bytecode hooks on `BytecodeExecutableAction`:
  - `initializerFuncId` -- runs exactly once per callsite
    per brain instance, on first allocation. Backs
    user-language module-scope `let` / `const` initializers.
  - `deactivationFuncId` -- runs every time the action's
    page is deactivated. Backs the user-language
    `onPageExited` handler when language syntax exists.
  - `activationFuncId` -- existing field, **repurposed**:
    runs every page activation. No longer carries `let`
    initializer logic.
- New host-binding hook on `HostActionBinding`:
  - `onPageExited?: (ctx: ExecutionContext) => void`,
    symmetric to the existing `onPageEntered?`.
  - `onInitialized?: (ctx: ExecutionContext) => void`,
    symmetric to the bytecode `initializerFuncId`. Runs
    exactly once per `(brainInstance, callSiteId)`, on the
    first allocation of the action's callsite, before the
    first `onPageEntered`.
- New explicit reset primitives on the dense-state plan's
  service surface:
  - `services.action.resetCallsite(callSiteId)` --
    deallocates the slot list; next `ensureCallsite`
    re-allocates and re-runs `initializerFuncId`.
  - `services.callSite.clearHostState(callSiteId)` --
    clears the host cell.
- `Brain.activatePage` / `Brain.deactivateCurrentPage` /
  `Brain.shutdown`: lifetime contract update; new hook
  driver entries.
- Linker bounds checks and tree-shaker reachability for the
  two new func ids.
- ts-compiler change: emit module-scope `let` / `const`
  initializers into `initializerFuncId`, not
  `activationFuncId`.
- Documentation update to `docs/specs/core/vm-contract.md`.

Out of scope:

- The dense-state surface migration itself (D2 / D3 / D4 of
  the dense-state plan). This spec is its precondition.
- User-language syntax additions beyond what the action
  descriptor already parses. The descriptor recognizes
  `onPageEntered` today; L2 preserves its emission into
  `activationFuncId`, and L3 adds the symmetric
  `onPageExited` parse + emission into
  `deactivationFuncId`. Any further hook surface (e.g.
  tile-level `onPageExited` sensors, async-aware exit
  handlers) is a separate language-design question.
- The relationship to the existing `OnPageEntered` *sensor*
  ([`packages/core/src/runtime/sensors/on-page-entered.ts`](../../../packages/core/src/runtime/sensors/on-page-entered.ts)).
  The sensor uses `HostActionBinding.onPageEntered` to reset
  its `{ fired: boolean }` cell per activation; that hook
  still fires per activation, so the sensor's behavior is
  preserved. Whether to expose `onPageExited` or initializer
  as tile-level sensors is a separate language-design
  question.
- `requestPageRestart` semantics. The existing
  skip-deactivate / skip-activate optimization preserves all
  callsite state by construction; this spec preserves it.
  Hooks do not fire on a soft restart.
- Compiler-emitted async coordination of `onPageExited`
  (e.g. awaiting in-flight async actuators). Hooks fire
  synchronously during deactivation; "wait for in-flight
  work" semantics are a separate design.

## Prerequisite

Dense-state plan D0 and D1 are landed (per its Current
State). The `runtime/dense-shims.ts` adapter exists with
`services.action` (`ensureCallsite` / `getStateSlot` /
`setStateSlot`) and `services.callSite` (`getHostState` /
`setHostState`). This spec extends that surface; if D1
slips, this spec stops.

## Inherited Rules

This spec inherits the following from the dense-state plan
and treats them as binding without restating:

- **Workflow loop** (implement -> stop for review -> user
  declares unit complete -> post-mortem updates Current
  State + Phase Log + repo memory note). Phase Log entries
  are hard-capped at 15 lines (target 5-10).
- **No backward compatibility.** Lock-step ship across
  runtime, compiler, tests in one coherent change.
- **Multi-target core constraints.** New runtime storage
  uses `List<T>` / `Dict<K, V>` from
  `packages/core/src/platform`; no native `Array` / `Map`,
  no `Object.freeze`, no `globalThis`, no Luau reserved
  words.
- **No phase markers in shipped code.**

Re-read the dense-state plan's Workflow Convention before
writing any post-mortem entry under this spec.

**Novel rule:** L1 (runtime) and L2 (compiler) ship as
independent units. The runtime semantics must be reviewable
in isolation, with regression tests against synthetic
actions, before the compiler emits into the new func-id
slots.

## Lifetime Contract

The bytecode action surface gains a clean three-way
distinction:

| field                | when it runs                                                         | user-language counterpart                  |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------ |
| `initializerFuncId`  | exactly once per `(brainInstance, callSiteId)`, on first allocation  | module-scope `let` / `const` initializers  |
| `activationFuncId`   | every page activation                                                | future `onPageEntered` handler (no syntax) |
| `deactivationFuncId` | every page deactivation                                              | future `onPageExited` handler (no syntax)  |

The host action surface gains the symmetric pair:

| field            | when it runs                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `onInitialized`  | exactly once per `(brainInstance, callSiteId)`, on first allocation, before `onPageEntered`   |
| `onPageEntered`  | every page activation (existing; semantics unchanged)                                         |
| `onPageExited`   | every page deactivation                                                                       |

`Brain.activatePage` calls `services.action.ensureCallsite`
once per callsite. The op returns `boolean` (true if newly
allocated). On `true`, the runtime invokes
`initializerFuncId` (bytecode) before invoking
`activationFuncId` / `onPageEntered`. Subsequent activations
skip the initializer.

`Brain.deactivateCurrentPage` invokes
`deactivationFuncId` / `onPageExited` for every callsite
owned by the deactivating page **before** cancelling its
fibers. After hooks return, fibers are cancelled and the
page goes inactive. Callsite storage is not touched unless
a hook explicitly requested reset.

## Key Invariants

- Numeric `0` is a real `funcId`. All three func-id fields
  are `number | undefined`; `undefined` is the only "no
  hook" sentinel. (Inherits the rule-id sentinel discipline
  pinned in the dense-state plan's D1 phase log.)
- `initializerFuncId` runs at most once per allocation.
  `Brain.startup()` and explicit `resetCallsite` are the
  only re-allocation triggers.
- `onPageExited` / `deactivationFuncId` runs **before**
  fiber cancellation, in a fully-live execution context.
- Hooks are synchronous and fast. The runtime never awaits
  a hook; long-running work in a hook stalls the page
  transition.
- `requestPageRestart` does not invoke any hook and does
  not allocate or deallocate callsite storage.
- `Brain.shutdown()` is best-effort clean: deactivate the
  current page first (firing exit hooks), then tear down
  all callsite stores. After `shutdown()`, every prior
  `callSiteId` is invalid until the next `Brain.startup()`
  re-allocates.
- The existing `OnPageEntered` sensor's host hook continues
  to fire on every page activation; its per-activation
  `fired` reset semantic is preserved without modification.
- **Hook fault semantics.** All four hook drivers
  (`runBytecodeInitializerHook`, `runBytecodeActivationHook`,
  `runBytecodeDeactivationHook`, `runHostDeactivationHook`)
  follow today's `runBytecodeActivationHook` convention and
  **throw** on VM fault or host-thrown error. Initializer-
  fault rollback, partial-deactivation handling, and
  shutdown-fault handling are intentionally rough edges to
  revisit separately.

## Pinned Decisions

These are fixed by this spec. They are recorded here so L1
and L2 reference them directly rather than re-deciding.

1. **Initializer driver site.** Inside `Brain.activatePage`,
   after `services.action.ensureCallsite` returns
   `newlyAllocated = true`. Keeps the service surface free of
   bytecode-execution concerns.
2. **Deactivation hook ordering.** Hooks run **before**
   `cancelActiveFibers`, so they observe a live page.
3. **Host-state clear primitive.**
   `services.callSite.clearHostState(callSiteId)`. Explicit
   name; equivalent runtime cost to a `setHostState(...,
undefined)` call.
4. **`ensureCallsite` return type.** `boolean` (true if newly
   allocated).
5. **`initializerFuncId` re-run on `resetCallsite`.** Yes,
   via the deallocate-then-re-ensure path.
6. **Hook fault semantics.** Throw on fault (see invariants).
7. **`Brain.shutdown()` ordering.** Deactivate first, then
   tear down storage.
8. **Existing `OnPageEntered` sensor.** Unchanged.

---

## Current State

Completed: L1, L2, L3, L4
Next up: none -- spec is feature-complete; remaining bytecode/host
hook asymmetry is closed.

L1 risks (lazy callsite storage; VM no longer calls `ensureCallsite`;
`numStateSlots` is no longer read by runtime services) carried
through L2-L4 unchanged. After L4, the host action surface
exposes the same three lifecycle stages as the bytecode surface
(initialize once, activate per page entry, deactivate per page
exit). Pre-existing public-API gap: `mindcraft.ts` `SyncHostActionFn`
/ `AsyncHostActionFn` mirror `onPageEntered` only; neither
`onPageExited` (L3) nor `onInitialized` (L4) is forwarded through
the `createHostSensor` / `createHostActuator` adapter. Plumbing
that through is a separate follow-up outside this spec.

---

## Phase Log

### L1 -- Runtime Lifetime Flip + Hook Driver Entries

Lifecycle-hook runtime contract is live: callsite storage is
brain-instance-scoped and lazy-allocated; Brain drives
`initializerFuncId` (once per first allocation),
`deactivationFuncId` / `onPageExited` (before fiber cancel),
`activationFuncId` / `onPageEntered` (every activation), and
`shutdown()` deactivates-then-tears-down.

New surfaces: `BytecodeExecutableAction.initializerFuncId` /
`.deactivationFuncId`; `HostActionBinding.onPageExited`;
`IActionServices.ensureCallsite -> boolean` and `.resetCallsite`;
`ICallSiteServices.clearHostState`; `IDenseShims.reset()`;
`ProgramArtifact.initializerFuncId` / `.deactivationFuncId`.

Verification: full gate green (722/722 tests).

### L2 -- Compiler Emission Of Initializer Func Id + Doc Update

Compiler now emits user-language module-scope `let` / `const`
initializers into `initializerFuncId`; `activationFuncId` is
allocated only when the action descriptor declares
`onPageEntered`. `vm-contract.md` documents the bytecode + host
hook surface.

New surfaces: `ProgramLoweringResult.initializerFuncId` (and the
matching field on `UserAuthoredProgram`); `vm-contract.md` "Page
lifecycle hooks" section.

Risks: L2's review surfaced that the action descriptor parses
`onPageEntered` today but has no `onPageExited` counterpart, so
`deactivationFuncId` is permanently `undefined` until syntax is
added; this gap is now scheduled as L3 and the Out of Scope
bullet has been narrowed accordingly.

Verification: full gate green (ts-compiler 973/973, core 722/722,
sim typecheck/check/build).

### L3 -- Compiler Emission Of Deactivation Func Id (`onPageExited` Syntax)

Descriptor now parses `onPageExited` in both property-assignment
and method-shorthand branches; `lowering.ts` emits the body into
`deactivationFuncId` (allocated only when the descriptor declares
the handler, preserving func-id layout for programs that don't).
The lowered function carries `injectCtxTypeId: ContextTypeIds.Context`
so `Brain.runBytecodeHook` can spawn it directly with an empty
args list. Ambient `SensorConfig` / `ActuatorConfig` and the sim
`mindcraft.d.ts` shim gained the optional `onPageExited` member.

New surfaces: `ExtractedDescriptor.onPageExitedNode`;
`ProgramLoweringResult.deactivationFuncId` (forwarded onto
`UserAuthoredProgram`); `DescriptorDiagCode.OnPageExitedMustBeFunction`
(2051); `LoweringDiagCode.OnPageExitedHasNoBody` (3172).

Verification: full gate green (ts-compiler 981/981, core 722/722,
sim typecheck/check/build).

### L4 -- Host-Side `onInitialized` Hook

`HostActionBinding.onInitialized?` now mirrors the bytecode
`initializerFuncId`: `Brain.activatePage` calls
`callsiteStore.ensure` for a host callsite only when
`onInitialized` is set, dispatches the new `runHostInitializerHook`
helper on `newlyAllocated` before `runHostActivationHook`, and
leaves bytecode initializer dispatch independent. `vm-contract.md`'s
"Host hook fields" gained an `onInitialized` row and dropped the
"no separate initializer slot" claim. `HostSyncFn` / `HostAsyncFn`
mirror the field for symmetry with `onPageEntered`.

Audit found zero in-tree host bindings doing `onPageEntered`-guarded
one-shot setup; no migrations needed. Pre-existing gap recorded
in Current State: `mindcraft.ts` public adapter does not yet forward
`onPageExited` (L3) or `onInitialized` (L4) to `HostActionBinding`.

Verification: full gate green (core 750/750; sim typecheck/check/build).

---

## Phase L1 -- Runtime Lifetime Flip + Hook Driver Entries

**Purpose.** Land the runtime side: change callsite storage
lifetime to brain-instance-scoped, add the new hook driver
entries (`initializerFuncId`, `deactivationFuncId`,
`onPageExited`), add the explicit reset primitives, and
prove the new semantics with regression tests against
synthetic actions.

**Scope.** Runtime-only. Tests construct synthetic
`BytecodeExecutableAction` / `HostActionBinding` values;
the compiler is not yet emitting into the new slots.

### Source paths (the agent edits these)

- `packages/core/src/runtime/context.ts` -- add
  `initializerFuncId?: number` and
  `deactivationFuncId?: number` to
  `BytecodeExecutableAction`; add
  `onPageExited?: (ctx: ExecutionContext) => void` to
  `HostActionBinding`.
- `packages/core/src/runtime/vm-types.ts` -- mirror of the
  host binding shape; add `onPageExited` if present here.
- `packages/core/src/runtime/services.ts` -- change
  `services.action.ensureCallsite` return type to
  `boolean`. Add `services.action.resetCallsite(callSiteId)`
  and `services.callSite.clearHostState(callSiteId)`.
- `packages/core/src/runtime/dense-shims.ts` -- update
  `ensureCallsite` to allocate-on-first-call / no-op
  afterward / return `boolean`. Implement `resetCallsite`
  and `clearHostState`. Remove the legacy
  `denseShims.resetCallsite(callSiteId, numStateSlots)`
  method (its only caller in `Brain.activatePage` is being
  replaced). Add a teardown surface (`reset()` /
  `clearAll()`) that clears both action-slot and host-state
  storage.
- `packages/core/src/runtime/test-only-runtime-services-factory.ts`
  -- mirror the production adapter changes.
- `packages/core/src/brain/brain.ts`:
  - `activatePage`: replace the unconditional
    `denseShims.resetCallsite(...)` call with
    `services.action.ensureCallsite(callSiteId,
numStateSlots)`. If `newlyAllocated && action.binding ===
"bytecode" && action.initializerFuncId !== undefined`,
    dispatch via a new `runBytecodeInitializerHook`
    helper (parallel to `runBytecodeActivationHook`).
    Then dispatch `activationFuncId` / `onPageEntered` as
    today.
  - `deactivateCurrentPage`: before `cancelActiveFibers`,
    walk the deactivating page's callsites; dispatch
    `deactivationFuncId` (bytecode) / `onPageExited`
    (host) via new `runBytecodeDeactivationHook` /
    `runHostDeactivationHook` helpers.
  - `shutdown`: invoke `deactivateCurrentPage` if a page
    is active, then call the dense-shims teardown
    surface.
- `packages/core/src/runtime/linker.ts` -- bounds checks
  for `initializerFuncId` and `deactivationFuncId`
  alongside the existing `activationFuncId` check.
- `packages/core/src/runtime/tree-shaker.ts` -- enqueue
  the two new func ids in the reachability seed; remap
  them on the rebuilt action.
- `packages/core/src/runtime/vm.ts` -- the four
  `ensureCallsite` call sites (host `ACTION_CALL`, host
  `ACTION_CALL_ASYNC`, `enterBytecodeActionFrame`,
  `spawnBytecodeActionFiber`) keep the same shape; all
  ignore the new `boolean` return. Document the ignore
  with a one-line comment at one site.

L1 does not modify `apps/sim`. Sim is exercised only as
a downstream gate (acceptance #11).

### Audit step (do first)

Pin the inspection commit SHA in the L1 phase log. Walk
each source path above; if any has drifted (helper
renamed, function moved, field moved), record the actual
shape in the phase log before editing. Also walk
`packages/ts-compiler/src/compiler/` to identify the
file / function that today emits module-scope `let` /
`const` initializers into `activationFuncId`; record
that pin in the L1 phase log so L2 can start from it.
If drift invalidates a Pinned Decision, STOP and present
the conflict to the user.

### Procedure (the tree compiles after each step)

1. Add the three new interface fields. No semantic change
   yet.
2. Add `services.action.resetCallsite`,
   `services.callSite.clearHostState`, and the dense-shims
   teardown surface. No consumer yet.
3. Change `ensureCallsite` semantics: allocate-on-first-call,
   return `boolean`. Update vm.ts callers to ignore the
   return type.
4. Update `Brain.activatePage` to drive `initializerFuncId`
   based on `newlyAllocated`; add
   `runBytecodeInitializerHook`.
5. Extend `Brain.deactivateCurrentPage` to dispatch
   deactivation hooks; add
   `runBytecodeDeactivationHook` / `runHostDeactivationHook`.
6. Update `Brain.shutdown` to deactivate-then-teardown.
7. Update linker bounds checks and tree-shaker
   reachability + remap.
8. Add the regression tests below. They must all pass.
9. Run the full gate from `packages/core` and `apps/sim`
   (`typecheck && check && test && build`).

### Regression tests

Split between `packages/core/src/runtime/dense-shims.spec.ts`
and `packages/core/src/brain/brain.spec.ts`:

1. `ensureCallsite` returns `true` first call, `false`
   subsequent; second call does not zero the slot list.
2. `resetCallsite` deallocates; next `ensureCallsite`
   returns `true` again.
3. `clearHostState` clears the cell; subsequent
   `getHostState` returns `undefined`.
4. (brain) Action state slot survives a page round-trip
   when no `deactivationFuncId` is set.
5. (brain) Action state slot is reset when
   `deactivationFuncId` calls `resetCallsite`.
6. (brain) Synthetic `initializerFuncId` runs exactly once
   across N page round-trips (counter ends at 1).
7. (brain) Host state survives a page round-trip when no
   `onPageExited` is set.
8. (brain) Host state cleared when `onPageExited` calls
   `clearHostState`.
9. (brain) `Brain.shutdown()` then `startup()` re-runs
   `initializerFuncId` for every callsite (counter from
   #6 ends at 2 after shutdown + startup + one
   activation).
10. (brain) `requestPageRestart` invokes none of the new
    hooks and changes no callsite slot or host-state value.

### Risks

- **Host-state preservation surfacing latent bugs.**
  Existing host actuators (`move`, `eat`, `shoot`) were
  authored against today's per-action-instance carry-over
  (which matches the new semantics), so nothing should
  break. If a sim test does break, the actuator was
  relying on per-page-activation reset that was never
  documented. Mitigation: sim suite runs as part of
  acceptance #11.
- **Shutdown teardown completeness.** If `shutdown` misses
  any store, regression test #9 fails. The test is the
  gate.

### Acceptance

L1 ships only when every item passes:

1. Three new interface fields exist and are used.
2. `ensureCallsite` returns `boolean` and is
   allocate-on-first-call.
3. `resetCallsite` and `clearHostState` exist and work.
4. `Brain.activatePage` invokes `initializerFuncId`
   exactly once per `(brainInstance, callSiteId)`.
5. `Brain.deactivateCurrentPage` invokes deactivation
   hooks before `cancelActiveFibers`.
6. `Brain.shutdown()` deactivates first, then tears
   down all callsite stores; subsequent `startup()`
   re-runs every `initializerFuncId`.
7. Linker bounds checks cover the two new func ids.
8. Tree-shaker enqueues + remaps the two new func ids.
9. All ten regression tests pass.
10. `packages/core`: all four gates pass with the
    project's zero-noise standard.
11. `apps/sim`: all four gates pass.

---

## Phase L2 -- Compiler Emission Of Initializer Func Id + Doc Update

**Purpose.** Move user-language module-scope `let` /
`const` initializer emission out of `activationFuncId`
and into `initializerFuncId`. Document the lifetime
contract and hook surface in `vm-contract.md`.

**Scope.** ts-compiler + docs. The runtime contract is
already in place from L1.

User-defined `onPageEntered` / `onPageExited` handler body
emission is **out of scope**: the language has no in-action
handler syntax today. When that language-design change
lands, the runtime contract is already wired and an
emission patch is sufficient.

**Precondition.** L1 has shipped.

### Source paths

- `packages/ts-compiler/src/compiler/` -- the action
  lowering pipeline. The specific file / function is
  pinned in the L1 phase log's compiler-audit entry.
- `packages/ts-compiler/src/compiler/*.spec.ts` -- any
  fixture that asserts on `activationFuncId` content;
  these become assertions on `initializerFuncId`.
- `docs/specs/core/vm-contract.md` -- add a "Page
  lifecycle hooks" section.

### Procedure

1. From the file / function pinned in L1, add a new
   emission target for `initializerFuncId`. The compiler
   emits module-scope initializers into this function and
   sets `BytecodeExecutableAction.initializerFuncId` to
   its id. `activationFuncId` remains unset for user
   programs.
2. Update all compiler-output snapshots / fixtures.
3. Add an end-to-end test (compiler or brain integration
   suite) that compiles a user program containing
   `let x = 0;` at action module scope, runs the brain
   through several page round-trips, and asserts `x` is
   initialized once.
4. Add the "Page lifecycle hooks" section to
   `vm-contract.md` documenting: the three bytecode hook
   fields and their lifetimes, the two host hook fields,
   the brain-instance-scoped lifetime guarantee, the
   explicit reset primitives, and the
   `Brain.shutdown()` teardown contract.
5. Update the dense-state plan's cross-references if
   needed beyond the precondition note already dropped
   in by this spec's creation.
6. Run the full gate from `packages/ts-compiler`,
   `packages/core`, and `apps/sim`.

### Risks

- **Snapshot churn.** Compiler output snapshots change
  wherever a program has module-scope initializers. The
  diff is mechanical (function body moves between two
  func-id slots). Review carefully to confirm.
- **Lazy callsite storage (from L1).** `setStateSlot` and
  `setHostState` auto-allocate; `stateSlots` grows on
  demand. The compiler does not need to seed slots, and
  the runtime no longer pre-sizes from `numStateSlots`.
  If L2 introduces an emission path that depends on
  `ensureCallsite` having been called first, it will
  silently no-op for callsites whose action has no
  `initializerFuncId` (Brain only calls `ensureCallsite`
  when `initializerFuncId !== undefined`).
- **`numStateSlots` is no longer read by runtime services**
  (only by `linker.ts` for validation). If the compiler
  stops emitting it, drop the linker check in the same
  unit or it will reject all programs.

### Acceptance

1. Module-scope `let` / `const` initializers compile
   into `initializerFuncId`, not `activationFuncId`.
2. The "initializer runs once" end-to-end test passes.
3. `vm-contract.md` documents the new surface.
4. Dense-state plan cross-references are correct.
5. All four gates pass from `packages/ts-compiler`,
   `packages/core`, and `apps/sim`.

---

## Phase L3 -- Compiler Emission Of Deactivation Func Id (`onPageExited` Syntax)

**Purpose.** Close the lifecycle-hook parity gap between
bytecode and host actions by surfacing the
`onPageExited` handler in the action descriptor and
emitting its body into `deactivationFuncId`. After L3,
every bytecode hook field documented in the Lifetime
Contract has a user-language counterpart.

**Scope.** ts-compiler only. The runtime contract for
`deactivationFuncId` is already in place from L1, and
the `onPageEntered` parse + activation-func emission is
already in place from before L2. L3 adds the symmetric
parse + emission for `onPageExited`. No runtime, sim, or
docs change is required beyond a one-line note in
`vm-contract.md`'s "Page lifecycle hooks" section to
reflect that `deactivationFuncId` now has a user-syntax
counterpart.

**Precondition.** L2 has shipped. The descriptor
extractor and `lowering.ts`'s `lowerOnPageEnteredBody` /
`generateActivationFunction` pair are the patterns to
mirror.

### Source paths

- `packages/ts-compiler/src/compiler/descriptor.ts` --
  add `onPageExitedNode` parsing alongside the existing
  `onPageEnteredNode` parsing. Parses both the property-
  assignment form (`onPageExited: function(...) {...}` /
  `onPageExited: (ctx) => {...}`) and the method-shorthand
  form (`onPageExited(ctx) {...}`), with a matching
  `OnPageExitedMustBeFunction` diag for non-function
  initializers. Adds `onPageExitedNode` to the descriptor
  payload.
- `packages/ts-compiler/src/compiler/lowering.ts` --
  add a `lowerOnPageExitedBody` helper (parallel to
  `lowerOnPageEnteredBody`) and an emission path that
  sets `BytecodeExecutableAction.deactivationFuncId` to
  the lowered function's id when the descriptor has an
  `onPageExitedNode`. Diag code
  `OnPageExitedHasNoBody` mirrors the existing
  `OnPageEnteredHasNoBody`.
- `packages/ts-compiler/src/compiler/project.ts` --
  pass `deactivationFuncId` through from
  `ProgramLoweringResult` to `UserAuthoredProgram`,
  symmetric to L2's `initializerFuncId` pass-through.
- `packages/ts-compiler/src/compiler/control-flow.spec.ts`
  (or a new `lifecycle-hooks.spec.ts`) -- end-to-end
  tests covering the new emission path.
- `apps/sim/src/examples/mindcraft.d.ts` -- add the
  optional `onPageExited?(ctx: Context): void;` member
  to the action descriptor type so user examples can
  declare the handler.
- `docs/specs/core/vm-contract.md` -- update the "Page
  lifecycle hooks" section so `deactivationFuncId`'s row
  reads "in-action `onPageExited` handler" instead of
  "reserved for the symmetric in-action `onPageExited`
  handler."

### Procedure

1. Extend `descriptor.ts` to recognize `onPageExited` in
   both the property-assignment branch and the method-
   shorthand branch. Add `OnPageExitedMustBeFunction` to
   the `DescriptorDiagCode` enum. Capture the parsed node
   into `onPageExitedNode` on the descriptor payload.
2. Add a unit test for the descriptor extractor covering:
   missing handler (no diag, node `null`), method-shorthand
   form, arrow-function form, function-expression form,
   and the must-be-function diag for a non-function value.
3. Add `lowerOnPageExitedBody` to `lowering.ts` mirroring
   `lowerOnPageEnteredBody`. The lowered body opens a
   function scope named `${descriptor.name}.onPageExited`
   and emits a final `RET`. Add `OnPageExitedHasNoBody` to
   `LoweringDiagCode`.
4. In `lowerProgram` (the same site that allocates
   `userOnPageEnteredFuncId`), allocate a parallel
   `deactivationFuncId` from the func-id counter when
   `descriptor.onPageExitedNode` is set. Store it on the
   `ProgramLoweringResult`.
5. In `project.ts`, forward `deactivationFuncId` from
   `ProgramLoweringResult` onto `UserAuthoredProgram`
   alongside `initializerFuncId` and `activationFuncId`.
6. Add the `onPageExited?(ctx: Context): void;` member to
   the action-descriptor types in
   `apps/sim/src/examples/mindcraft.d.ts` so the example
   programs typecheck.
7. Add end-to-end tests:
   - `onPageExited` body is lowered and
     `deactivationFuncId` is set; `activationFuncId` and
     `initializerFuncId` are independent.
   - Compiling a program with both `onPageEntered` and
     `onPageExited` produces three distinct func ids
     (entry, activation, deactivation).
   - A round-trip integration test that compiles a program
     with `let count = 0;` plus an `onPageExited` handler
     that calls `setStateSlot` (or equivalent) to mutate
     `count`, drives the brain through one page exit, and
     asserts the deactivation handler's mutation is
     observed on the next activation (callsite storage is
     brain-instance-scoped, so the mutation persists).
8. Update the `vm-contract.md` "Page lifecycle hooks"
   section so the `deactivationFuncId` description matches
   `activationFuncId`'s phrasing now that user syntax
   exists for both.
9. Run the full gate from `packages/ts-compiler`,
   `packages/core`, and `apps/sim` (typecheck, check,
   test, build).

### Risks

- **Parser drift.** The two descriptor branches (property-
  assignment vs. method-shorthand) must both recognize
  `onPageExited` or programs using one form will silently
  fail to emit the hook. Mirror the existing
  `onPageEntered` switch arms exactly; a unit test covering
  both forms is the gate.
- **Func-id ordering.** L2 already relies on stable
  func-id assignment for `initializerFuncId` /
  `activationFuncId`; inserting a `deactivationFuncId`
  allocation must not perturb those ids in programs that
  do not declare `onPageExited`. The allocation is gated
  on `descriptor.onPageExitedNode` being non-null, so a
  program without the handler sees identical func-id
  layout to today.
- **Diag-code numeric stability.** Adding
  `OnPageExitedMustBeFunction` and
  `OnPageExitedHasNoBody` to the existing diag enums must
  append, not insert, to preserve the numeric values of
  existing codes.

### Acceptance

1. The action descriptor recognizes `onPageExited` in both
   property-assignment and method-shorthand forms; the
   must-be-function diag fires for non-function values.
2. `lowering.ts` emits the handler body into a dedicated
   function and sets `BytecodeExecutableAction.deactivationFuncId`
   to its id. Programs without the handler leave the field
   unset and have unchanged func-id layout.
3. The end-to-end "exit-handler mutation persists" test
   passes.
4. After L3, every row of the bytecode column in the
   Lifetime Contract table has a user-language counterpart
   (no more "future" / "no syntax" entries).
5. `vm-contract.md` no longer describes
   `deactivationFuncId` as "reserved."
6. All four gates pass from `packages/ts-compiler`,
   `packages/core`, and `apps/sim`.

---

## Phase L4 -- Host-Side `onInitialized` Hook

**Purpose.** Close the remaining hook-surface asymmetry
between bytecode and host actions by adding a host-side
one-shot initializer hook. After L4, both binding kinds
expose the same three lifecycle stages (initialize once,
activate per page entry, deactivate per page exit), so
host actuators that today key one-shot setup off
`onPageEntered` plus their own per-instance bookkeeping
can drop the bookkeeping and use the runtime's first-touch
gate directly.

**Scope.** Core runtime + docs only. No ts-compiler change
(user-authored tiles compile to bytecode and use
`initializerFuncId`; `onInitialized` is exclusively for
hand-coded host actions). No sim change beyond what gates
require; sim actuators may opt into the new hook in a
follow-up.

**Precondition.** L3 has shipped. The callsite store's
`ensure(callSiteId): boolean` first-touch detector is
already in place from L1 and is host-agnostic; L4 wires it
into the host activation path.

### Source paths (the agent edits these)

- `packages/core/src/runtime/context.ts` -- add
  `onInitialized?: (ctx: ExecutionContext) => void` to
  `HostActionBinding`. Update the JSDoc on
  `HostActionBinding` and on the field to match the
  bytecode `initializerFuncId` semantics (once per
  `(brainInstance, callSiteId)`; cleared by
  `services.callsite.reset` or `Brain.shutdown()`).
- `packages/core/src/runtime/vm-types.ts` -- mirror the
  field on the `HostSyncFn` / `HostAsyncFn` shapes if
  those mirror the binding (they currently mirror
  `onPageEntered`).
- `packages/core/src/brain/brain.ts`:
  - `activatePage`: in the host branch (today's
    `if (action.binding === "host") { ... continue; }`),
    when `action.onInitialized !== undefined`, call
    `this.callsiteStore.ensure(site.callSiteId)`. On
    `true`, dispatch via a new `runHostInitializerHook`
    helper (parallel to `runHostActivationHook`) BEFORE
    `runHostActivationHook` runs. The bytecode branch's
    existing `ensure` call must remain independent so
    that mixed pages keep correct semantics.
  - Add `runHostInitializerHook(callSiteId, onInitialized)`
    -- structurally identical to `runHostActivationHook`
    (same `currentCallSiteId` / `currentRuleFuncId`
    save-restore pattern; throws on host-thrown error per
    the existing hook fault convention).
- `docs/specs/core/vm-contract.md` -- update the "Host
  hook fields" section to add an `onInitialized` row and
  remove the existing sentence "Host hooks have no
  separate 'initializer' slot." Add a one-line invariant
  matching the bytecode initializer's lifetime guarantee.

L4 does not modify `apps/sim`. Sim is exercised only as a
downstream gate (acceptance #6).

### Audit step (do first)

Pin the inspection commit SHA in the L4 phase log. Walk
each source path above; if any has drifted (helper
renamed, field moved, hook driver consolidated), record
the actual shape in the phase log before editing. In
particular, confirm that `Brain.activatePage`'s host
branch still uses `if (action.binding === "host") { ...
continue; }` to short-circuit the bytecode path; if the
branching has been restructured, write the actual shape
into the phase log before proceeding. If drift
invalidates a Pinned Decision, STOP and present the
conflict to the user.

Also walk `packages/core/src/runtime/sensors/` and
`packages/core/src/runtime/actuators/` for any host
binding that today implements one-shot setup via a
guarded `onPageEntered`. Record the count and a brief
note in the L4 phase log; **do not migrate** any of them
in this phase. Migration is a follow-up.

### Procedure (the tree compiles after each step)

1. Add `HostActionBinding.onInitialized?` field. No
   semantic change yet (no callers).
2. Add `runHostInitializerHook` helper to `Brain`. No
   callers yet.
3. Wire `Brain.activatePage`'s host branch: gated `ensure`
   call + dispatch on `newlyAllocated`. Bytecode branch
   stays as-is.
4. Update `vm-contract.md`'s "Host hook fields" section.
5. Add the regression tests below. They must all pass.
6. Run the full gate from `packages/core` and `apps/sim`
   (`typecheck && check && test && build`).

### Regression tests

In `packages/core/src/brain/brain.spec.ts`, parallel to
the existing host `onPageEntered` / `onPageExited`
coverage:

1. Synthetic `HostActionBinding` with `onInitialized` set
   has its initializer fired exactly once across N page
   round-trips (counter ends at 1).
2. Host `onInitialized` fires before host `onPageEntered`
   on the activation that first allocates the callsite
   (assert call ordering via a shared log).
3. After `services.callsite.reset(callSiteId)` is invoked
   from inside `onPageExited`, the next page activation
   fires `onInitialized` again.
4. After `Brain.shutdown()` then `Brain.startup()`, the
   next page activation fires `onInitialized` again.
5. A host action with no `onInitialized` set never causes
   `callsiteStore.ensure` to be called for its callsite
   (verified by spying on the store or by asserting that a
   bytecode action sharing the same page is unaffected).
6. `requestPageRestart` does not fire `onInitialized`,
   does not call `ensure`, and does not perturb the
   already-allocated callsite record.
7. Mixed-binding page test: a page containing one host
   action with `onInitialized` and one bytecode action
   with `initializerFuncId` fires both initializers
   exactly once on first activation, in the order the
   call sites appear in `pageMetadata.actionCallSites`.

### Risks

- **Existing host-binding bookkeeping conflict.** Host
  actuators that today implement their own one-shot setup
  via a flag inside `onPageEntered` will keep working
  unchanged -- the new hook is opt-in. The audit step
  above records the population so future migration can be
  scoped, but L4 must not migrate them.
- **`ensure` allocation cost for host actions.** Calling
  `ensure` on a host callsite allocates an empty
  `CallsiteRecord` (slot list = `List.empty()`,
  `hostState = undefined`). The cost is a single map
  insert per `(brainInstance, callSiteId)` over the life
  of the brain; negligible. If a host action does not set
  `onInitialized`, `ensure` is NOT called -- so unchanged
  host actions pay zero cost.
- **Hook ordering.** `onInitialized` must run BEFORE
  `onPageEntered` on the first activation. Tests #2 and #7
  are the gate; reversed ordering is a regression.
- **Hook fault semantics.** `runHostInitializerHook`
  follows the existing host-hook convention (throw on
  host-thrown error). Initializer-fault rollback remains
  the same intentional rough edge as the bytecode side.

### Acceptance

L4 ships only when every item passes:

1. `HostActionBinding.onInitialized` field exists and is
   wired through `Brain.activatePage`.
2. `runHostInitializerHook` exists, mirrors
   `runHostActivationHook`'s save-restore pattern, and
   throws on host-thrown errors.
3. `Brain.activatePage` calls `callsiteStore.ensure` for
   host callsites only when `action.onInitialized !==
undefined`; on `newlyAllocated`, the initializer runs
   before `onPageEntered`.
4. All seven regression tests pass.
5. `vm-contract.md` documents the host `onInitialized`
   surface and no longer claims "Host hooks have no
   separate initializer slot."
6. All four gates pass from `packages/core`, plus the
   three-gate run from `apps/sim`
   (`typecheck && check && build`; sim has no `npm test`).

