# TS VM Page Lifecycle Hooks Plan

Date: 2026-05-03
Status: Drafted; not yet started.

## Purpose

Action callsite storage in the TS VM is currently
page-activation-scoped: every time a page is activated, the
runtime re-allocates the action-state-slot list and the
host-state cell for every callsite owned by the page. That
means a user-language `let lastShotTime = 0;` declared in an
action is re-zeroed every time the page is re-entered, and
host-side state (e.g. `MoveState.wanderTargetExpiresAt`) is
discarded the same way.

That lifetime is wrong by design. A user who writes
`let lastShotTime = 0;` expects "initialized once on first
use, persists for the life of the brain" -- the same
semantics as a `static` local in C, or a module-scope `let`
in TS. They do not expect the value to vanish every time the
page round-trips. Likewise, host actuators with cooldowns
should not lose their cooldown state on a page restart unless
they explicitly opt in.

This spec replaces page-activation-scoped callsite storage
with **brain-instance-scoped** callsite storage, and adds the
explicit page lifecycle hook surface that lets user code (and
host code) opt in to reset when reset is what they actually
want.

The forcing function is the dense-state plan
([`ts-vm-dense-runtime-state-plan-2026-05-02.md`](./ts-vm-dense-runtime-state-plan-2026-05-02.md)):
that plan's D3 and D4 phases relocate callsite storage off
the legacy `ActionInstance` graph and onto a new
`PlatformServices` adapter surface. Pinning the wrong
lifetime into that surface bakes the bug into the contract.
This spec lands the lifetime correction (and the hook
surface that makes it usable) **before** the dense-state
plan reaches D3.

## Scope

In scope:

- Lifetime change: action state slots and host state slots
  become brain-instance-scoped. Allocation happens once per
  callsite per brain instance; reset happens only when user
  or host code explicitly requests it, or when the brain is
  shut down.
- New bytecode hooks on `BytecodeExecutableAction`:
  - `initializerFuncId` -- runs exactly once per callsite
    per brain instance, on first allocation. Backs
    user-language module-scope `let` / `const`
    initializers.
  - `deactivationFuncId` -- runs every time the action's
    page is deactivated. Backs the user-language
    `onPageExited` handler.
  - `activationFuncId` -- existing field, **repurposed**:
    runs every time the action's page is activated. Backs
    the user-language `onPageEntered` handler. No longer
    carries `let` initializer logic.
- New host-binding hook on `HostActionBinding`:
  - `onPageExited?: (ctx: ExecutionContext) => void`,
    symmetric to the existing `onPageEntered?`.
- New explicit reset primitives (added to whichever
  service owns callsite storage after the dense-state
  plan -- adapter or context):
  - per-callsite action-state-slot reset
    (`services.action.resetCallsite(callSiteId)` against
    the dense-state plan's pinned surface);
  - per-callsite host-state clear
    (`services.callSite.clearHostState(callSiteId)`,
    equivalent to `setHostState(callSiteId, undefined)`).
- `Brain.activatePage`, `Brain.deactivateCurrentPage`,
  `Brain.shutdown`: lifetime contract update; new hook
  driver entries for `initializerFuncId`,
  `deactivationFuncId`, and `onPageExited`.
- ts-compiler change: emit user-language module-scope
  `let` / `const` initializers into `initializerFuncId`,
  not `activationFuncId`. Emit user-defined
  `onPageEntered` / `onPageExited` handlers into
  `activationFuncId` / `deactivationFuncId` respectively.
- Linker bounds checks for the two new func ids.
- Tree-shaker reachability + remap entries for the two new
  func ids.
- Regression tests proving:
  - action state slots survive a page round-trip when no
    reset hook is provided;
  - host state survives a page round-trip when no
    `onPageExited` reset is provided;
  - `let x = 0` initializer runs exactly once across many
    page round-trips;
  - explicit `resetCallsite` (or a `deactivationFuncId`
    that calls it) zeros the slot list as expected;
  - explicit `clearHostState` (or an `onPageExited` that
    calls it) clears the host cell as expected;
  - `Brain.shutdown()` followed by `startup()` re-runs
    `initializerFuncId` for every callsite.

Out of scope:

- The dense-state surface migration itself (D2 / D3 / D4
  of the dense-state plan). This spec is a precondition;
  it lands the lifetime correction and the hook surface,
  then the dense-state plan proceeds with the new
  semantics already in place.
- User-language syntax for declaring `onPageEntered` /
  `onPageExited` handlers. The compiler-side change in
  this spec is _emission_: given an
  `onPageEntered` / `onPageExited` declaration in the
  source, emit it into the right func id slot. The syntax
  for declaring those handlers is either already present
  in the language or is the subject of a separate
  language-design change; this spec does not invent it.
  If the language has no syntax for these handlers at
  the time this spec lands, the runtime hooks are
  reachable only via host-side `HostActionBinding`
  fields, and the compiler-side emission step is reduced
  to "leave `initializerFuncId` set to the current
  initializer-emission target and `deactivationFuncId`
  unused" -- the runtime contract still ships, ready for
  the language-side change to wire into.
- `requestPageRestart` semantics. The existing
  optimization in `Brain.requestPageRestart`
  (skip-deactivate / skip-activate) preserves all
  callsite state by construction; this spec preserves
  that optimization. Hooks do not fire on a soft
  restart.
- Compiler-emitted async coordination of `onPageExited`
  (e.g. awaiting an in-flight async actuator before the
  page is truly considered exited). The hook fires
  synchronously during `Brain.deactivateCurrentPage`
  before fibers are cancelled; any "wait for in-flight
  work" semantics are a separate design.

## Prerequisite

The runtime contract and the dense-state plan's D0 / D1
units are landed (Current State at this spec's start
matches "Completed: D0, D1; Next up: D2" of the
dense-state plan). The `runtime/dense-shims.ts` file
exists and implements the new `services.action` adapter
trio (`ensureCallsite` / `getStateSlot` /
`setStateSlot`) and the `services.callSite` host-state
adapter (`getHostState` / `setHostState`) as documented
in the dense-state plan.

If the dense-state plan has not reached the end of D1,
this spec stops -- the surface this spec adjusts the
semantics of does not yet exist.

## Desired End State

Callsite storage (action state slots and host state
cells) is allocated once per `(brainInstance, callSiteId)`
and survives until the brain is shut down. Reset is
opt-in via three mechanisms:

1. **Bytecode `deactivationFuncId`** -- runs every page
   deactivation. The compiler emits user-defined
   `onPageExited` bodies into this func; the body can
   call the dense-state plan's
   `services.action.resetCallsite(callSiteId)` to zero
   the slot list, or do nothing to preserve.
2. **Host `onPageExited`** -- the `HostActionBinding`
   counterpart, called by `Brain.deactivateCurrentPage`
   for every host-action callsite owned by the page.
   Host code calls
   `services.callSite.clearHostState(callSiteId)` (or
   `setHostState(callSiteId, undefined)`) to clear, or
   does nothing to preserve.
3. **`Brain.shutdown()`** -- tears down all callsite
   stores. A subsequent `startup()` starts fresh; the
   first `activatePage` for each page re-runs every
   action's `initializerFuncId`.

The bytecode action surface gains a clean three-way
distinction:

| field                 | when it runs                                                                          | user-language counterpart                       |
| --------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `initializerFuncId`   | exactly once per callsite per brain instance, on first allocation                     | module-scope `let` / `const` initializers       |
| `activationFuncId`    | every time the action's page is activated                                             | user-defined `onPageEntered` handler            |
| `deactivationFuncId`  | every time the action's page is deactivated                                           | user-defined `onPageExited` handler             |

The host action surface gains the symmetric pair:

| field                 | when it runs                                                                          |
| --------------------- | ------------------------------------------------------------------------------------- |
| `onPageEntered`       | every time the action's page is activated (existing; semantics unchanged)             |
| `onPageExited`        | every time the action's page is deactivated (new)                                     |

`Brain.activatePage` calls `services.action.ensureCallsite`
once per callsite. The op returns whether the slot list was
newly allocated. If newly allocated, the runtime invokes
`initializerFuncId` (bytecode) before invoking
`activationFuncId` / `onPageEntered`. Subsequent activations
of the same page skip the initializer and run only the
activation hook.

`Brain.deactivateCurrentPage` invokes
`deactivationFuncId` / `onPageExited` for every callsite
owned by the deactivating page, **before** cancelling its
fibers. After the hooks return, fibers are cancelled and
the page goes inactive. Callsite storage is not touched
unless a hook explicitly requested reset.

Acceptance, when this spec is complete:

- `let x = 0;` at action-module scope is observably
  initialized on first page activation only; subsequent
  page round-trips preserve any value the action wrote.
- A host actuator that writes
  `setHostState(callSiteId, { lastShotTime: ctx.time })`
  reads the same `lastShotTime` after a page round-trip
  unless the actuator's own `onPageExited` clears it.
- A bytecode action whose `deactivationFuncId` calls
  `services.action.resetCallsite(callSiteId)` observes
  the slot list reset on the next page activation
  (after `initializerFuncId` runs again, because reset
  is equivalent to "deallocate, will re-allocate on next
  ensure").
- `Brain.shutdown()` + `Brain.startup()` re-runs every
  callsite's `initializerFuncId` on the first
  activation of the corresponding page.
- The dense-state plan's `services.action.ensureCallsite`
  is allocate-on-first-call, no-op afterward.
- `services.action.resetCallsite(callSiteId)` exists and
  zeros the slot list (next `ensureCallsite` re-allocates
  and re-runs `initializerFuncId`). An equivalent
  primitive exists for host state.

## Key Invariants

- Numeric `0` is a real `funcId`. `initializerFuncId`,
  `activationFuncId`, and `deactivationFuncId` are all
  `number | undefined`; `undefined` is the only "no hook"
  sentinel. (Inherits the rule-id sentinel discipline pinned
  in the dense-state plan's D1 phase log.)
- `initializerFuncId` runs at most once per
  `(brainInstance, callSiteId)`. A callsite that was
  reset via `resetCallsite` and then re-allocated re-runs
  the initializer; the "exactly once per brain instance"
  guarantee is "exactly once per allocation" with
  `Brain.startup()` and explicit `resetCallsite` being
  the only re-allocation triggers.
- `onPageExited` / `deactivationFuncId` runs **before**
  fiber cancellation. The hook's body executes in a
  fully-live execution context with the page's fibers
  still in scope.
- `onPageExited` / `deactivationFuncId` is synchronous
  and fast. Long-running work in the hook stalls the
  page transition. (Mitigation guidance, not enforced;
  but the runtime never awaits a hook.)
- `requestPageRestart` (the soft-restart optimization)
  does not invoke any hook and does not allocate or
  deallocate any callsite storage.
- `Brain.shutdown()` tears down every callsite store
  owned by the brain. After `shutdown()`, every prior
  `callSiteId` is invalid until the next
  `Brain.startup()` re-allocates.
- Existing bytecode programs are semantically unchanged
  except for the lifetime change. A program that today
  observes "let initializer re-runs on every activation"
  was observing the bug; after this spec, it observes
  "let initializer runs once."

## No Backward Compatibility

This is a behavior change with no shipped customers. The
dense-state plan's "No Backward Compatibility" section
applies verbatim: the spec ships in lock-step across
runtime, compiler, and tests in one coherent change.
There is no compatibility flag, no opt-in shim, no
"legacy lifetime" mode.

## Multi-Target Core Constraints (Roblox-ts portability)

Same constraints as the dense-state plan. New runtime
storage uses `List<T>` and `Dict<K, V>` from
`packages/core/src/platform`. No native `Array` / `Map`,
no `Object.freeze`, no `globalThis`, no Luau reserved
words. The `installDenseShims` -> `services.action` /
`services.callSite` wiring established by the
dense-state plan's D1 already obeys these constraints;
this spec extends that surface, not the rules.

## Workflow Convention

Phases are numbered L0-L3. Each phase is a single unit
unless a phase number is qualified (e.g. L1.1, L1.2).

Each unit follows the dense-state plan's loop:

1. Agent implements the unit.
2. Agent stops and presents work for review.
3. The user reviews, requests changes or approves.
4. Only after the user declares the unit complete does the
   post-mortem happen.
5. Post-mortem updates Current State, Phase Log, propagates
   risks to future phases, and writes any useful repo
   memory note (`/memories/repo/vm-lifecycle-L<N>.md`).

Post-mortem content rules, Phase Log entry hard cap (15
lines, target 5-10), risks block content, repo memory note
content, and the no-phase-markers-in-shipped-code rule are
inherited verbatim from the dense-state plan's Workflow
Convention section. Re-read that section before writing
any post-mortem entry under this spec.

L1 (the runtime lifetime flip + new hook driver entries)
must not be combined with L2 (the compiler change). They
ship as independent units so the runtime semantics are
reviewable in isolation, with regression tests against
synthetic actions, before the compiler starts emitting
into the new func-id slots.

---

## Current State

Not started. Awaiting kickoff.

---

## Phase Log

(empty until L0 ships)

---

## Phase L0 -- Decision Pin And Source-Path Audit

**Purpose.** Pin the small number of design decisions this
spec leaves open, so L1 / L2 / L3 are pure execution
phases.

**Deliverable.** A short decisions table appended below
this section, plus the source-paths audit confirming
every file L1 / L2 / L3 will touch is what this spec
expects it to be at the inspection commit.

### Source paths (the agent inspects only these)

- `packages/core/src/runtime/context.ts` -- the
  `BytecodeExecutableAction` and `HostActionBinding`
  interfaces. L1 adds two fields to the bytecode binding
  and one field to the host binding.
- `packages/core/src/brain/brain.ts` -- `activatePage`
  (around line 523), `deactivateCurrentPage` (around
  line 599), `runHostActivationHook` (around line 659),
  `runBytecodeActivationHook` (around line 678),
  `shutdown` (search). L1 modifies the activation /
  deactivation drivers and the shutdown teardown.
- `packages/core/src/runtime/dense-shims.ts` -- the
  current implementation of `services.action.ensureCallsite`
  (today: delegates to
  `getOrCreateActionInstance` + `ActionInstance.stateSlots`).
  L1 changes the semantic to allocate-on-first-call,
  no-op afterward; L1 also adds
  `services.action.resetCallsite(callSiteId)` and
  `services.callSite.clearHostState(callSiteId)` (or
  pins `setHostState(callSiteId, undefined)` as the
  documented clear primitive).
- `packages/core/src/runtime/linker.ts` -- the bounds
  check for `activationFuncId` (around line 117). L1
  adds analogous bounds checks for `initializerFuncId`
  and `deactivationFuncId`.
- `packages/core/src/runtime/tree-shaker.ts` -- the
  reachability seed for `activationFuncId` (around line
  50) and the remap for the rebuilt action (around line
  582). L1 adds analogous handling for the two new func
  ids.
- `packages/core/src/runtime/vm.ts` -- the
  `ensureCallsite` call sites in
  `enterBytecodeActionFrame` (around line 1779) and
  `spawnBytecodeActionFiber` (around line 1809). L1
  may need to thread the "newly allocated" return
  through to the call site that decides whether to
  invoke `initializerFuncId`, depending on where the
  initializer driver lives (decided in L0).

L1 does not modify any code under `apps/sim`, and does
not rely on sim sources to verify the lifetime guarantee.
Reading sim files for orientation is fine; what L1 must
not do is treat sim as a test target or as the source of
truth for the new contract. The brain-instance-scoped
lifetime guarantee is exercised by L1's own ten
regression tests (see "New regression
tests" below) using synthetic actions registered inside
`packages/core/src/runtime/dense-shims.spec.ts` and
`packages/core/src/brain/brain.spec.ts`. The dense-state
plan's D3 phase adds a further three core-side synthetic
actuators that mirror the shapes of `move`'s cooldown,
`eat`'s consumption window, and `shoot`'s recharge to pin
the host-state surface end-to-end without depending on
sim. Sim remains a downstream consumer whose build is
exercised by L1 acceptance #11 (full gate from
`apps/sim`), but no sim source files are read or written
by L1.

### Decisions to pin in L0

1. **Initializer driver site.** Where does the runtime
   decide to invoke `initializerFuncId`? Two options:
   - (A) Inside `Brain.activatePage`, after
     `services.action.ensureCallsite` returns
     `newlyAllocated = true`.
   - (B) Inside `services.action.ensureCallsite` itself,
     via a callback registered at brain construction.
   Recommendation: (A). Keeps the service surface free of
   bytecode-execution concerns; the brain orchestrator
   already owns activation-hook dispatch.
2. **Deactivation hook ordering.** `onPageExited` /
   `deactivationFuncId` runs **before**
   `cancelActiveFibers`. Confirm; the alternative
   (cancel first, hooks observe a torn-down page) is
   strictly worse.
3. **Host-state clear primitive.** Two equivalent
   surfaces:
   - (A) `services.callSite.clearHostState(callSiteId)`.
   - (B) `services.callSite.setHostState(callSiteId,
undefined)`.
   Recommendation: (A). Explicit name documents the
   intent; equivalent runtime cost.
4. **`ensureCallsite` return type.** Today: `void`. New:
   `boolean` (true if newly allocated). Confirm; the
   alternative (a separate `wasNewlyAllocated` query op)
   is strictly more surface for no benefit.
5. **`initializerFuncId` re-run on `resetCallsite`.**
   `resetCallsite(callSiteId)` deallocates the slot
   list. Next `ensureCallsite` re-allocates and the
   initializer driver re-runs `initializerFuncId`.
   Confirm.

### Procedure (execute in order)

1. Pin the inspection commit. Record the SHA in the
   `## Phase L0 Decisions` header.
2. Walk the source paths; confirm each file matches the
   expected shape. If any file's shape has drifted
   (lines moved, helper renamed), record the actual
   shape in this section.
3. Resolve each of the five decisions above. Record the
   choice and a one-sentence justification under
   `## Phase L0 Decisions`.
4. Concretize L1 / L2 / L3 procedures: replace any
   "(per L0)" parenthetical in those phases with the
   chosen branch.

### Acceptance (validation checklist)

L0 ships only when:

1. The inspection commit SHA is recorded.
2. All five decisions are pinned with one-sentence
   justifications.
3. No L1 / L2 / L3 step contains an "(or per L0)"
   branch after concretization.
4. `## Phase L0 Decisions` exists below
   `## Phase Log` and the L0 Phase Log entry has
   landed (post-mortem rules apply).

---

## Phase L1 -- Runtime Lifetime Flip + Hook Driver Entries

**Purpose.** Land the runtime side of the spec: change
callsite storage lifetime to brain-instance-scoped, add
the new hook driver entries (`initializerFuncId`,
`deactivationFuncId`, `onPageExited`), add the explicit
reset primitives, and write the regression tests that
prove the new semantics.

**Scope.** Runtime-only. The compiler is not yet emitting
into `initializerFuncId` / `deactivationFuncId`; tests
construct synthetic `BytecodeExecutableAction` /
`HostActionBinding` values directly.

**Precondition.** L0 has shipped.

### Source paths (the agent edits these)

- `packages/core/src/runtime/context.ts` -- add
  `initializerFuncId?: number` and
  `deactivationFuncId?: number` to
  `BytecodeExecutableAction`; add
  `onPageExited?: (ctx: ExecutionContext) => void` to
  `HostActionBinding`.
- `packages/core/src/runtime/dense-shims.ts` (or its
  successor adapter, depending on dense-state plan
  state) -- change `services.action.ensureCallsite`
  semantics from "overwrite on every call" to
  "allocate-on-first-call, no-op afterward". Return
  `boolean` (true if newly allocated). Add
  `services.action.resetCallsite(callSiteId): void`.
  Add `services.callSite.clearHostState(callSiteId):
void` (per L0 decision 3).
- `packages/core/src/brain/brain.ts`:
  - `activatePage`: replace the unconditional
    `denseShims.resetCallsite(callSiteId, n)` call (line
    ~551 today) with `denseShims.ensureCallsite(callSiteId,
n)`. If the call returned `newlyAllocated = true` AND
    the action is bytecode-backed AND has
    `initializerFuncId`, dispatch `initializerFuncId`
    via a new `runBytecodeInitializerHook` helper
    (parallel structure to
    `runBytecodeActivationHook`). Then dispatch
    `activationFuncId` / `onPageEntered` as today.
  - `deactivateCurrentPage`: before
    `cancelActiveFibers`, walk the deactivating page's
    callsites; for each, dispatch
    `deactivationFuncId` (bytecode) /
    `onPageExited` (host) via new
    `runBytecodeDeactivationHook` /
    `runHostDeactivationHook` helpers.
  - `shutdown`: clear all `denseShims` stores so a
    subsequent `startup()` re-runs every
    `initializerFuncId` on the first activation. (The
    exact teardown call depends on the shim's existing
    teardown surface; if absent, add it.)
- `packages/core/src/runtime/linker.ts` -- add bounds
  checks for `initializerFuncId` and
  `deactivationFuncId` next to the existing check for
  `activationFuncId`.
- `packages/core/src/runtime/tree-shaker.ts` -- enqueue
  `initializerFuncId` and `deactivationFuncId`
  alongside `activationFuncId` (line ~50); remap them
  in the rebuilt action (line ~582).
- `packages/core/src/runtime/vm.ts` -- the
  `enterBytecodeActionFrame` and
  `spawnBytecodeActionFiber` `ensureCallsite` calls
  (lines ~1779, ~1809) keep the same shape; the return
  value is intentionally ignored at these sites. Only
  `Brain.activatePage` reads `newlyAllocated` to drive
  `initializerFuncId`. Document this in a one-line
  comment at one of the vm.ts sites.

### New regression tests

All in `packages/core/src/runtime/dense-shims.spec.ts`
and `packages/core/src/brain/brain.spec.ts`:

1. `ensureCallsite` returns `true` on first call,
   `false` on subsequent calls, and the slot list is
   not zeroed on the second call.
2. `resetCallsite` deallocates the slot list; the next
   `ensureCallsite` returns `true` again.
3. `clearHostState` clears the host cell; subsequent
   `getHostState` returns `undefined`.
4. (brain-level) Action state slot survives a
   page round-trip when no `deactivationFuncId` is
   set: write a value via `STORE_CALLSITE_VAR`,
   deactivate the page, re-activate the page, read the
   slot via `LOAD_CALLSITE_VAR`, assert the value is
   preserved.
5. (brain-level) Action state slot is reset when the
   action's `deactivationFuncId` calls
   `resetCallsite`: same setup as #4 but with a
   `deactivationFuncId` that resets; assert the slot
   reads NIL after re-activation.
6. (brain-level) Synthetic
   `BytecodeExecutableAction.initializerFuncId` runs
   exactly once across many page round-trips: set up a
   counter in a brain variable that the initializer
   bumps; round-trip the page N times; assert the
   counter ends at 1.
7. (brain-level) Host state survives a page
   round-trip when no `onPageExited` is set.
8. (brain-level) Host state cleared when
   `onPageExited` calls `clearHostState`.
9. (brain-level) `Brain.shutdown()` followed by
   `startup()` re-runs `initializerFuncId` for every
   callsite (the counter from #6 ends at 2 after
   shutdown + startup + one activation).
10. (brain-level) `requestPageRestart` does not
    invoke any of the new hooks and does not change
    any callsite slot or host-state value.

### Procedure (execute in order; the tree should compile after each step)

1. Add the three new interface fields to
   `context.ts`. No semantic change yet; existing
   producers don't set them. Compile / build / tests
   stay green.
2. Add `services.action.resetCallsite` and
   `services.callSite.clearHostState` to the dense-shims
   surface (or its adapter successor). Wire them through
   to the legacy storage exactly as
   `getStateSlot` / `setStateSlot` already are. No
   consumer yet. Compile stays green.
3. Change `services.action.ensureCallsite` semantics:
   on first call for a `callSiteId`, allocate the slot
   list and return `true`; on subsequent calls, no-op
   and return `false`. Update all internal callers in
   `brain.ts` and `vm.ts` to handle the new return
   type (most ignore it).
4. Update `Brain.activatePage` to drive
   `initializerFuncId` based on the
   `newlyAllocated` return. Add
   `runBytecodeInitializerHook` helper (parallel to
   `runBytecodeActivationHook`).
5. Extend `Brain.deactivateCurrentPage` to dispatch
   `deactivationFuncId` / `onPageExited` for every
   callsite owned by the deactivating page, before
   `cancelActiveFibers`. Add
   `runBytecodeDeactivationHook` /
   `runHostDeactivationHook` helpers.
6. Update `Brain.shutdown` to tear down all
   denseShims stores. If the shim does not yet have a
   teardown method, add one (`reset()` or
   `clearAll()`).
7. Update the linker bounds checks.
8. Update the tree-shaker reachability + remap.
9. Add the regression tests. They must all pass.
10. Run the full gate: from `packages/core`,
    `npm run typecheck && npm run check && npm test
&& npm run build`; from `apps/sim`, the same four
    gates. Both must pass.

### Risks

- **Hidden re-use of `activationFuncId` for
  initializer logic.** The compiler today (per the
  dense-state plan's D1 audit) emits no actions with
  `activationFuncId` set in shipped programs, but
  hand-written test fixtures may. Mitigation: step 9's
  regression tests construct synthetic actions with
  `initializerFuncId` set explicitly; the compiler
  change is L2's problem.
- **Host-state preservation surfacing latent bugs.**
  Existing host actuators (`move`, `eat`, `shoot`)
  were authored against today's "host state survives
  per-action-instance reset" carry-over -- which
  matches the new semantics. They should not surface
  any bug. If they do, it indicates the actuator was
  relying on per-page-activation reset, which was
  never a documented guarantee. Mitigation: run the
  sim test suite end-to-end as part of step 10; flag
  any cooldown-sensitive test that breaks.
- **`shutdown` teardown completeness.** If
  `shutdown` misses any callsite store, the next
  `startup()` will not re-run `initializerFuncId`
  for that callsite, and #9 of the regression tests
  will fail. Mitigation: the test is the gate.
- **Lifetime of host-state map across `shutdown` /
  `startup`.** The `services.callSite` host-state
  map must be cleared on `shutdown` for symmetry with
  action state slots. If the shim's clear surface
  only covers action slots, add a host-state clear
  too.
- **Soft-restart vs full-restart drift.**
  `requestPageRestart` is documented to skip
  deactivate / activate; #10 of the regression tests
  pins this. If a future agent "fixes" the soft
  restart to invoke hooks, #10 becomes the gate.

### Acceptance (validation checklist)

L1 ships only when every item passes:

1. The three new interface fields exist in
   `context.ts` and are used by the brain orchestrator.
2. `services.action.ensureCallsite` returns `boolean`
   and is allocate-on-first-call.
3. `services.action.resetCallsite(callSiteId)` and
   `services.callSite.clearHostState(callSiteId)`
   exist and work.
4. `Brain.activatePage` invokes
   `initializerFuncId` exactly once per
   `(brainInstance, callSiteId)`.
5. `Brain.deactivateCurrentPage` invokes
   `deactivationFuncId` / `onPageExited` for every
   callsite owned by the deactivating page, before
   `cancelActiveFibers`.
6. `Brain.shutdown()` tears down all callsite stores;
   a subsequent `startup()` re-runs every
   `initializerFuncId`.
7. The linker bounds checks cover the two new func
   ids.
8. The tree-shaker enqueues + remaps the two new
   func ids.
9. All ten regression tests pass.
10. From `packages/core`, all four gates
    (typecheck, check, test, build) pass with the
    project's zero-noise standard.
11. From `apps/sim`, all four gates pass.

---

## Phase L2 -- Compiler Emission Of Initializer / Deactivation Func Ids

**Purpose.** Move user-language module-scope `let` /
`const` initializer emission out of `activationFuncId`
and into the new `initializerFuncId` slot. Wire
user-defined `onPageEntered` / `onPageExited` handler
emission into `activationFuncId` /
`deactivationFuncId` respectively.

**Scope.** ts-compiler only. The runtime contract is
already in place from L1; this phase changes what
gets emitted into which func-id slot.

**Precondition.** L1 has shipped. Synthetic-action
regression tests demonstrate the runtime semantics
work.

### Source paths (the agent edits these)

- `packages/ts-compiler/src/compiler/` -- the action
  lowering pipeline. Specific files to be identified
  in L2 step 1; the lowering code that today emits
  module-scope `let` initializers into the action's
  activation function is the target. (The L0 audit
  may pin specific files in advance; if not, L2 step
  1 is the inspection step.)
- `packages/ts-compiler/src/compiler/*.spec.ts` --
  any compiler test fixture that asserts on
  `activationFuncId` content. Tests of "initializer
  ran on activation" are now tests of "initializer
  ran on first activation" via `initializerFuncId`.

### Procedure (execute in order)

1. Inspect the lowering code to identify exactly
   where module-scope `let` / `const` initializers
   are emitted today. Record the file / function /
   line in the L2 phase log.
2. Add a new emission target for
   `initializerFuncId`. The compiler emits
   module-scope initializers into this function and
   sets `BytecodeExecutableAction.initializerFuncId`
   to its id.
3. If the language already has syntax for
   `onPageEntered` handler bodies inside actions:
   route those into `activationFuncId`. If not, leave
   `activationFuncId` unset.
4. If the language already has syntax for
   `onPageExited` handler bodies inside actions:
   route those into `deactivationFuncId`. If not,
   leave `deactivationFuncId` unset.
5. Update all compiler-output snapshots / fixtures.
6. Add an end-to-end test (in
   `packages/ts-compiler/src/compiler/*.spec.ts` or
   the brain integration test suite) that compiles a
   user program containing `let x = 0;` at action
   module scope, runs the brain through several page
   round-trips, and asserts `x` is initialized once.
7. Run the full gate: `packages/ts-compiler` and
   `packages/core` both green.

### Risks

- **Language lacks `onPageEntered` / `onPageExited`
  syntax.** If the language has no syntax for these
  handlers, steps 3 and 4 are no-ops. The runtime
  contract (L1) still ships and is reachable via
  host-side `HostActionBinding` fields. The compiler
  side is reduced to the initializer change only.
- **Existing snapshot churn.** Compiler output
  snapshots will change wherever a program contains
  module-scope initializers. The diff is mechanical
  (initializers move from `activationFuncId`'s
  function body into `initializerFuncId`'s function
  body). Mitigation: review the diff carefully to
  confirm it is mechanical only.

### Acceptance (validation checklist)

L2 ships only when every item passes:

1. Module-scope `let` / `const` initializers compile
   into `initializerFuncId`, not `activationFuncId`.
2. (If language syntax exists)
   `onPageEntered` / `onPageExited` handler bodies
   compile into `activationFuncId` /
   `deactivationFuncId`.
3. The end-to-end "initializer runs once" test
   passes.
4. From `packages/ts-compiler`, all four gates pass.
5. From `packages/core`, all four gates pass.
6. From `apps/sim`, all four gates pass.

---

## Phase L3 -- Documentation And Contract Update

**Purpose.** Document the new lifetime contract and the
hook surface in `docs/specs/core/vm-contract.md`. Update
the dense-state plan to reference this spec as a
precondition.

**Scope.** Documentation only. No code changes.

**Precondition.** L1 and L2 have shipped.

### Procedure (execute in order)

1. Add a "Page lifecycle hooks" section to
   `docs/specs/core/vm-contract.md` documenting:
   - the three bytecode hook fields
     (`initializerFuncId`, `activationFuncId`,
     `deactivationFuncId`) and their lifetimes;
   - the two host hook fields (`onPageEntered`,
     `onPageExited`);
   - the lifetime guarantee: callsite storage is
     brain-instance-scoped;
   - the explicit reset primitives
     (`services.action.resetCallsite`,
     `services.callSite.clearHostState`);
   - the `Brain.shutdown()` teardown contract.
2. Update the dense-state plan
   ([`ts-vm-dense-runtime-state-plan-2026-05-02.md`](./ts-vm-dense-runtime-state-plan-2026-05-02.md))
   if any cross-reference to this spec needs adding
   beyond the precondition note dropped in by the
   creation of this spec.
3. Run `npm run check` from any package whose docs
   were touched (typically none if only
   `vm-contract.md` changed -- markdown is not
   linted).

### Acceptance (validation checklist)

L3 ships only when:

1. `vm-contract.md` documents the new surface.
2. The dense-state plan's cross-references are
   correct.
