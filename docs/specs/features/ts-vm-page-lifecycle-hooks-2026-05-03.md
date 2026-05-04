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
- User-language syntax for declaring `onPageEntered` /
  `onPageExited` handlers in actions. The language has no
  such syntax today, so the compiler-side work in this spec
  is limited to the initializer move. The runtime contract
  is wired and ready for emission whenever the syntax lands.
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

| field           | when it runs                                                  |
| --------------- | ------------------------------------------------------------- |
| `onPageEntered` | every page activation (existing; semantics unchanged)         |
| `onPageExited`  | every page deactivation (new)                                 |

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

Not started. Awaiting kickoff.

---

## Phase Log

(empty until L1 ships)

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

### Acceptance

1. Module-scope `let` / `const` initializers compile
   into `initializerFuncId`, not `activationFuncId`.
2. The "initializer runs once" end-to-end test passes.
3. `vm-contract.md` documents the new surface.
4. Dense-state plan cross-references are correct.
5. All four gates pass from `packages/ts-compiler`,
   `packages/core`, and `apps/sim`.
