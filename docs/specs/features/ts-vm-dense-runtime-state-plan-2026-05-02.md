# TS VM Dense Runtime State Plan

Date: 2026-05-02
Status: In progress.

## Purpose

Today's TS `ExecutionContext` exposes the runtime as a TS heap-object
graph (`ctx.brain`, `ctx.rule`, `ActionInstance` identity, the
brain/page/rule object hierarchy reachable through them). Any
implementation that lacks per-object allocation and GC-style identity
cannot host this shape -- the constraint is structural, not
engineering effort.

This spec replaces the object-graph surface with one expressible as
ids, slot indices, and side tables, so the runtime-state contract no
longer forecloses constrained-target implementations of the VM.

The forcing function is the kind of work shipped sim host functions
already do (sensor reads like `see`, actuators like `move`, and the
rest). Sim is not being ported to a constrained target. Sim host
functions are illustrative of the level of richness a host function
may need; the contract has to be wide enough to express that class of
operation, no narrower. If a sim host function reaches for an
object-graph affordance that the dense shape cannot express, either
the host function changes or the affordance becomes a contracted
service operation -- it does not survive as an object reference.

The checkable acceptance criterion is: walk the new `ExecutionContext`
and the dense-state additions to `PlatformServices` and ask of each
operation, "could a static-allocation, no-GC implementation provide
this?" If yes for every operation, the contract no longer forecloses
constrained targets.

## Scope

This spec covers the work of replacing the object-shaped runtime state
of the TS VM with a compact ids/slots/side-tables model that satisfies
the purpose above.

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

Out of scope:

- Bytecode instruction changes.
- The shape of `PlatformServices` for registries
  (types/functions/conversions/operators), the `VmEvents` aggregate,
  and the `runtime/` import firewall. These are existing contract
  surfaces documented in
  [`vm-contract.md#construction-and-services-boundary`](../core/vm-contract.md#construction-and-services-boundary);
  this spec adds dense-state members to `PlatformServices` but does
  not redefine the registry members or the events aggregate.
- Module relocation of bytecode types into `runtime/` (already done).
- A dense binary writer for any constrained target.
- Any constrained-target implementation of the VM. This spec defines
  a contract, not a port.
- Any reduced bytecode subset; the TS VM remains the full semantic
  reference.
- **Brain code split (BrainRuntime / BrainCompiler separation).**
  Module decoupling (M0-M5) moved the _type boundaries_ so
  `runtime/` no longer value-imports authoring types; the dense
  refactor (D0-D7) moves the _runtime-visible storage_ off the
  authoring object graph. Neither plan moves the _code_ -- the
  `Brain` class still physically holds compile-time concerns
  (authoring graph, compile/link/treeshake pipeline) alongside
  runtime concerns (variable storage, VM/scheduler ownership,
  page lifecycle FSM, activation-hook driver). After D2-D4 land,
  the runtime side of `Brain` has zero value-imports of
  `IBrainRule` / `ActionInstance`, which makes a physical split
  into a `runtime/brain-runtime.ts` file (runtime concerns) plus
  `brain/` (compile-time concerns) mechanical rather than
  design-laden. That split is the subject of a follow-on plan;
  this spec deliberately does not perform it because doing it
  before the dense contracts land would force the runtime side
  to import authoring types or carry shims.

## Prerequisite

The runtime contract this spec builds on is pinned in
[`vm-contract.md#construction-and-services-boundary`](../core/vm-contract.md#construction-and-services-boundary).
The dense-state work assumes:

- The runtime `Program` exists at `packages/core/src/runtime/`.
- `PlatformServices` is the aggregate the VM accepts at
  construction.
- `VmEvents` is the passive-observer aggregate.
- The import firewall is in place and green.

If any prerequisite slips, this spec stops -- do not work around a
missing seam by reaching back into `brain/`.

**Lifecycle-hooks precondition (added 2026-05-03; updated
2026-05-03).** All three phases of the page-lifecycle-hooks spec
([`ts-vm-page-lifecycle-hooks-2026-05-03.md`](./ts-vm-page-lifecycle-hooks-2026-05-03.md))
(L1 / L2 / L3) have landed. Under that spec, callsite storage
(action state slots and host state cells) is
**brain-instance-scoped**, not page-activation-scoped:
`services.action.ensureCallsite(callSiteId): boolean` allocates
on first call and is a no-op afterward (the slot list grows on
demand via `setStateSlot`; `numStateSlots` is no longer read by
runtime services), reset is opt-in via
`services.action.resetCallsite(callSiteId)` /
`services.callSite.clearHostState(callSiteId)` /
`Brain.shutdown()`, and `BytecodeExecutableAction` carries the
three-way `initializerFuncId` / `activationFuncId` /
`deactivationFuncId` hook surface (with `HostActionBinding`
adding the symmetric `onPageExited`). Brain owns the four hook
drivers (`runBytecodeInitializerHook`,
`runBytecodeActivationHook`, `runBytecodeDeactivationHook`,
`runHostDeactivationHook`) and the dense-shims teardown call
from `shutdown`. As a side effect, the legacy `ActionInstance`
helpers (`getActionInstance`, `getOrCreateActionInstance`,
`resetActionInstance`, `isActionInstance`) and the
`ExecutionContext.currentActionInstance` field are already
deleted, and `vm.ts` no longer calls `ensureCallsite` (Brain is
the sole caller). D3 / D4 below are scoped against this new
baseline -- see each phase's "Status update (2026-05-03)"
preamble for what remains.

## Desired End State

The runtime exposes one portable `ExecutionContext` shape and a
dense-state extension to `PlatformServices`:

```text
ExecutionContext (portable, core-only)
  - slot-keyed variable access
  - rule variable access by (rule id, slot)
  - callsite state by current callsite id
  - action state by (action id, callsite id)
  - currentCallSiteId, currentRuleId, currentActionId
  - time, dt, currentTick
```

```text
PlatformServices (extends the runtime aggregate documented in
`docs/specs/core/vm-contract.md#construction-and-services-boundary`)
  + action resolution / activation
  + rule lookup (id -> rule descriptor)
  + callsite metadata access
```

Note: `time`, `dt`, and `currentTick` are per-tick scalar anchors
on `ExecutionContext`, stamped by the host before each tick. Core
ships an `IRngServices` member on `PlatformServices` because the
core `random` sensor (`packages/core/src/runtime/sensors/random.ts`)
is a shipped host function and requires a brain-scoped random
stream. Core does not ship a sub-tick `now()` service or any other
time facility on `PlatformServices`; applications that need such
facilities layer them in at the application level (via their own
host functions and platform-side service objects).

Note: "platform entity / self access" (e.g. sim's actor handle,
target actor, world view) is **not** part of the core
`ExecutionContext` shape and **not** a core `PlatformServices`
member. Today this is supplied by sim's `ActorExecutionContext
extends ExecutionContext` (via the `data` field) plus
sim-side helpers (`getSelf`, `getActor`, `getTargetActor`)
defined in `apps/sim/src/brain/execution-context-types.ts`.
The dense plan preserves this extension model: apps subclass
`ExecutionContext` to add app-shaped fields (sim's `data`),
and host functions registered by the app see the extended
shape. Core's job is to keep its own surface id/slot-keyed and
free of authoring-graph references; what an app layers on top
is the app's contract, not core's. D0 table 1 is closed-set
over the _core_ `ExecutionContext` interface only (per the
D0 source-paths note that `ActorExecutionContext.data` is
not a table 1 row); D7's contract section documents the
core surface and names the extension seam in one sentence,
without enumerating any app's extension fields.

Acceptance, when this spec is complete:

- `ExecutionContext` is one portable shape with no heap-object
  references to brain/page/rule/action objects. State is reached by
  ids, slots, and side tables.
- Host function signatures take only the portable
  `ExecutionContext` and -- where relevant -- explicit
  `PlatformServices` operations. Every shipped TS host function
  (sim, bridge, vscode-extension) is on the new signature.
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
- Required bytecode semantics are not optional events. If a
  constrained-target implementation would need to do the same thing
  the TS VM does for the same program to behave the same way, the
  behavior belongs in the VM contract, `Program`, `ExecutionContext`,
  or `PlatformServices` -- not in TS-only code that is invisible to
  the contract.
- Every capability used by shipped sim host functions is expressible
  through the portable contract. Sim is the complexity probe; the
  contract has to be rich enough that a host function of sim's
  shape can be written against it.
- Object-shaped runtime fallbacks must not survive past the unit
  that is supposed to retire them. No "object form for now, slot
  form later" parallel data paths.

## No Backward Compatibility

Everything in this work is new code. There are **no external
customers**, **no shipped public API to preserve**, and **no
serialized artifacts in the wild** (no on-disk programs, no saved
fault objects, no DAP traces consumed by third parties). The TS VM,
the bytecode it consumes, the brain JSON it loads, the bridge
protocol, and every downstream consumer all live in this monorepo
and are updated in lock-step.

Implications for every unit in this plan:

- **Prefer clean replacements over compatibility bridges.** If a type
  changes shape, change every call site. Do not introduce parallel
  "old" and "new" forms, deprecation aliases, dual-mode factories,
  conversion shims, or "string-or-enum" unions. Delete the old form in
  the same unit that adds the new one.
- **No re-export aliases for renamed symbols.** Rename and update
  imports.
- **No legacy field tolerance in serialization.** Bump the version
  constant and require the new shape; do not accept both.
- **No stringly-typed escape hatches.** When the spec says
  `tag: ErrorCode`, the runtime must not also accept the old string
  literal "for now."
- **Tests assert the new shape directly.** Do not keep old-shape
  fixtures around as a "compatibility check."
- **No object-shaped runtime fallbacks.** This spec retires the
  brain/page/rule/action object graph from runtime dispatch paths;
  no "object form for now, slot form later" parallel data paths are
  permitted to outlive the unit that retires them.

Each unit lands as one coherent change. Whether the working tree is
committed between units is up to the user; this plan does not require
commits as a workflow step.

## Multi-Target Core Constraints (Roblox-ts portability)

`packages/core` is a multi-target package (Node TS, browser TS,
Roblox-ts/Luau). Every unit in this plan that touches shared core
code -- whether under `packages/core/src/brain/` or
`packages/core/src/runtime/` -- must obey
`.github/instructions/core.instructions.md`:

- **No native `Array` / `T[]` in shared core.** Use `List<T>` from
  `packages/core/src/platform`.
- **No native `Map` / `Set` in shared core.** Use `Dict` / set
  abstractions from `packages/core/src/platform`.
- **No `Object.freeze` / `Object.isFrozen` / `Object.assign` /
  `Object.keys` / etc. in shared core.** `Object` is JS-only.
- **No `Uint8Array` / `Uint32Array` / typed arrays in shared core.**
  Binary I/O lives behind `IWriteStream` / `IReadStream` in
  `packages/core/src/platform/stream-types.ts`, or in Node-only
  `.node.ts` files.
- **No `typeof x === "string"` / `instanceof Error`.** Use
  `TypeUtils.isString()` etc. from `platform/types.ts`. Throw and
  catch the platform `Error` from `platform/error.ts`, never the
  global `Error`.
- **No `globalThis` in shared core.** Allowed only in `.node.ts`
  files.
- **No Luau reserved words** as identifiers (`end`, `local`, `then`,
  `repeat`, `until`, etc.).
- **No circular import paths between modules unless every import in
  the cycle is type-only** (`import type` / `export type`). Roblox-ts
  emits Luau `require` calls for value imports, and value-level
  cycles are not safe at module-init time on Luau. Type-only cycles
  are erased at compile time and are allowed.

Dense state is particularly constraint-sensitive: id-keyed and
slot-indexed storage must use `List<T>` and `Dict<K, V>` from
`packages/core/src/platform`, never native `Array` / `Map`.
Dense-state work also tends to introduce cross-references between
context, services, and program tables; check for value-level cycles
whenever a new runtime module is added or an existing one is split.

## Workflow Convention

Phases are numbered D0-D5. Units within a phase are numbered D<N>.<K>
when a phase is broken into units; otherwise the phase number alone
identifies the unit (e.g. D3).

Each unit follows this loop:

1. Agent implements the unit.
2. Agent stops and presents work for review.
3. The user reviews, requests changes or approves.
4. Only after the user declares the unit complete does the post-mortem
   happen.
5. Post-mortem updates Current State, Phase Log, propagates new risks to
   future phases, and writes any useful repo memory notes
   (`/memories/repo/vm-dense-D<N>.md`).

Do NOT amend Current State, Phase Log, propagate risks, or create repo memory
notes during implementation.

D2, D3, and D4 are the behavior-sensitive migrations. **Those three
phases must not be combined into a single unit.** Each ships and is
reviewed independently.

### Post-mortem content rules

**STOP. If you are about to write a post-mortem entry, re-read this
section in full first. Do not work from memory of these rules; do not
reuse the framing of the implementation summary you just gave the
user. Those two artifacts have different audiences and different
length budgets.**

The post-mortem is a forward-looking artifact for future-phase
agents, not a changelog and not a recap of the work for the user.
The user already saw the work. The future agent has the unit's spec
section above the Phase Log entry and does not need it
restated. Be ruthlessly minimal.

**Why this rule keeps getting violated.** Agents finish
implementation, give the user a verbose "here's what I did" summary
for review, and then -- when the user approves -- copy that framing
into the post-mortem. The implementation summary is correctly
verbose (it is for review). The post-mortem is correctly terse (it
is for an agent who already has the spec). Conflating the two is
the single most common failure mode in this workflow. If your draft
post-mortem reads like a shorter version of the implementation
summary, you are doing it wrong; throw it away and start from the
checklist below.

**Mandatory pre-write checklist.** Before writing the Phase Log
entry, answer each of these out loud (in the chat, not in the doc):

1. What is the one-sentence summary?
2. Did any new spec section, contract surface, or public API land?
   List them, one line each, or write "none."
3. What is the verification line?
4. Is the draft within the 5-15 line target? Count lines.
5. Does the draft contain any item from the "Do NOT include" list?
   Read the list and check each one.

If you skip the checklist or answer in your head instead of in the
doc, you will violate the rules. This has happened in every prior
session where these rules were not enforced this way.

**Phase Log entry for the unit (HARD CAP: 15 lines, including
the heading and the verification line; target 5-10).** Include
ONLY:

- One-sentence summary of what shipped.
- Any new spec section / contract surface / public API added (one
  line each, or omit if none).
- "Verification: full gate green (N/N tests)." -- nothing more.

DO NOT include any of the following. Each item is a real failure
mode observed in prior post-mortems:

- File lists or paths to files added/modified.
- Import bookkeeping (which tsconfig got which exclude, which
  package got which devDependency, version pins).
- Test-construction details (constant names, fixture paths, what
  the self-test asserts, programmatic API used).
- Per-test enumeration or per-target build results.
- Before/after diffs, "previously X, now Y."
- Restatement of deliverables already in the unit's spec section
  above. The future agent reads the spec section first; the
  Phase Log entry is a delta on top.
- Justification of why the implementation looks the way it does.
- Cross-references to the implementation summary you gave the user.

If you are tempted to add one of these because "the future agent
might want to know," remember: the spec section above already says
what was supposed to ship; the risks block below already says what
could go wrong; git history says what files changed. The Current
State entry's only job is to mark the unit done and link risks to
it.

**Risks block.** Include a risk if it satisfies any of these:

1. It is a behavior change a future phase could trip over.
2. It is not already obvious from the unit's spec or the contract doc.
3. It implies a concrete future action (a test to add, an invariant to
   preserve, a follow-up unit).
4. It represents a gap between the spec and actual deliverable.
5. It uncovered a rough edge in an existing system that might need
   addressing.

The risks block is the most important part of the post-mortem. Err on
the side of inclusion rather than keeping quiet about something
producing a new code smell or other warning signal.

State each risk in 2-4 lines: what changed, what could go wrong, what
to do about it. No background, no justification of the original design.

**Repo memory note (`/memories/repo/vm-dense-D<N>.md`, target:
10-25 lines).** Write only if the unit established invariants or owed
work that a future agent must respect. Content categories:

- Invariants the runtime / compiler must preserve (one line each).
- Owed tests or follow-ups with no current enforcement.
- Non-obvious gotchas that would silently break a future phase.

The memory note is also subject to the "Do NOT include" list above.
It is not a place to dump implementation details that did not earn
their way into the Phase Log entry.

Each unit must:

- Compile, type-check, lint, build, and test green at HEAD.
  Run `npm run typecheck && npm run check && npm test && npm run build`
  from `packages/core` and any downstream package whose API surface
  changed (`apps/sim`, `apps/vscode-extension`, etc.).
  `npm run build` is mandatory -- it is the only step that runs
  `rbxtsc` and catches Luau-incompatible code.
- Have its own test additions. No "tests will follow."
- Update `docs/specs/core/vm-contract.md` as part of the same unit
  when the change is contract-shaping. **Exception:** D2 through
  D5 defer all `vm-contract.md` updates to D6, which writes the
  dense-state contract section in one piece with full D0-D5
  context in hand. D6 is the only unit that touches
  `vm-contract.md`.
- **No phase/unit markers in shipped code.** Do not embed strings
  like "Phase D0", "D1", "D4", or references to this spec
  file in source comments, test names, JSDoc, or config-file
  comments. Phase numbers and this spec are ephemeral planning
  artifacts; the code that ships under them must read as if it had
  always been there. State invariants and behavior in the present
  tense, with no reference to the unit that introduced them. This
  rule applies to every unit in this plan and is checked during
  review.

---

## Current State

Completed: D0, D1, D2, D3, D4, D5; lifecycle-hooks precondition L1 / L2 / L3
landed (see
[`ts-vm-page-lifecycle-hooks-2026-05-03.md`](./ts-vm-page-lifecycle-hooks-2026-05-03.md)).

Next up: D6

---

## Phase Log

### D5

**Status**

Deleted `funcIdToRule` field, its two `initialize()` assignments,
`collectFuncIdToRuleMapping`, and the now-unused `IBrainRule` import from
`brain/brain.ts`. Added field-level JSDoc on `activeRuleFiberIds` naming it
the canonical Brain<->scheduler interface and forbidding authoring-graph
references in its entries. G1-G5 greps all pass; zero `runtime/` edits.
Verification: full gate green (750/750 tests).

**Risks** (D5 -> D6)

- G1-G5 are currently only verified manually at D5 runtime. A future
  refactor inside `brain/` could silently re-introduce a value import of
  `IBrainRule` or add a `BrainRule`-typed field to `activeRuleFiberIds`.
  D6 or the follow-on Brain-runtime split should encode these greps as
  standing CI checks so the lock-in survives.

---

### D4

**Status**

Per-callsite storage extracted into a brain-owned `ICallsiteStore`;
`services.callSite` + `services.action` collapsed into a single
`services.callsite: ICallsiteServices` backed directly by the store.
`createRuntimeServices(brain, callsiteStore)` factory replaces the
dense-shims closure. `ActionInstance` and `ActionInstanceMap` are
retired from the public context.
Verification: full gate green (743/743 tests).

**Risks** (D4 -> D5/D6)

- `services.callsite` is now a single surface with seven methods
  (`ensure`, `reset`, `getSlot`, `setSlot`, `getHostState`,
  `setHostState`, `clearHostState`). `reset(callSiteId)` drops both
  the slot pad and the host-state cell in one operation;
  `clearHostState` drops only the host-state cell. D6 must document
  this in `vm-contract.md`. Future code that needs to drop slots
  while preserving host state has no API for that today; if such a
  use case appears, add a separate `clearSlots` rather than
  re-introducing the host/action split.
- `ICallsiteStore extends ICallsiteServices`, so the store is passed
  into `services.callsite` with no per-method wrapping. This makes
  the runtime path zero-overhead but means anyone subclassing or
  proxying `ICallsiteStore` becomes observable to the VM. If a
  future phase introduces a layer between Brain and the VM (e.g. a
  recording wrapper for replay), it must wrap the service surface,
  not the store.
- The brain's `callsiteStore` field is `private readonly` and
  initialized at field-declaration time, so it exists before
  `initialize()` runs. Any future code that reads
  `services.callsite` before `initialize()` (e.g. from a constructor
  hook) will see an empty but functional store rather than throw.
  D5/D6 should not rely on "no service before initialize" as a
  safety property.
- `__test__createPlatformServices` no longer has `callSite` or
  `action` overrides; it has a single optional `callsite`. No
  current consumers override either, but if D5 or downstream tests
  need to inject a fake, they must build an `ICallsiteServices`
  rather than splitting the surface back apart.

### D3

**Status**

Host-call callsite host-state migration shipped. All host functions
reach per-callsite host state through
`services.callSite.{getHostState,setHostState,clearHostState}`; the
legacy `ActionInstance.hostState` field is gone, and dense-shims
holds host state in its own `Dict<callSiteId, unknown>` independent
of the action-instance map. New helpers `getCallSiteState<T>(ctx)`,
`setCallSiteState(ctx, value)`, `clearCallSiteState(ctx)` exported
from `@mindcraft-lang/core/app` source `currentCallSiteId` from the
context.
Verification: full gate green (732/732 tests).

**Risks** (D3 -> D4/D5/D6)

- `ActionInstance` and `ActionInstanceMap` survive D3 with only
  `callSiteId` and `stateSlots`; the `hostState` field is gone.
  D4 retires both. Any new code that adds fields to
  `ActionInstance` between now and D4 will collide with the
  retirement; do not extend the interface.
- `test-only-runtime-services-factory.ts` keeps host state in the
  shared `__test__ActionState` record alongside `stateSlots`
  (the dense-shims split was intentionally not mirrored there
  since the factory has no production callers). If D4 collapses
  or rewrites that factory, port the host-state branch first or
  the test surface will diverge from the production contract.
- `getCallSiteState(ctx)` / `setCallSiteState(ctx, value)` /
  `clearCallSiteState(ctx)` use `ctx.currentCallSiteId!` and
  throw on `undefined`. They are only safe inside a host-call
  dispatch (`HOST_CALL` / `HOST_CALL_ASYNC` / `ACTION_CALL` /
  `ACTION_CALL_ASYNC` / `onPageEntered` / `onPageExited`). New
  hook surfaces added by future phases must bind
  `currentCallSiteId` before invoking host code, or these
  helpers will throw rather than no-op.
- Host-state and action-state-slot stores are now structurally
  separate maps with parallel lifetimes (allocate-on-write, clear
  on `Brain.shutdown` / `services.action.resetCallsite`). A
  future cleanup may unify them into a single per-callsite record;
  if so, the unification must preserve the independent reset
  semantics already exercised by
  `dense-shims.spec.ts` and
  `callsite-host-state-lifetime.spec.ts`.

### D2

**Status**

Rule identity flows through `Program.ruleFuncIds` and
`Program.ruleAncestors` (compiler-emitted, linker-passthrough,
tree-shaker-remapped). `services.program` and `services.ruleVars`
built directly via `runtime/rule-services.ts` against a
brain-instance side-table; the rule branch of `dense-shims.ts` is
gone. The shim's remaining surfaces (brainVars, brainPages, rng,
callSite, action) await D3/D4.
Verification: full gate green (725/725 tests).

**Risks** (D2 -> D3/D4/D5)

- `Program.ruleFuncIds` / `ruleAncestors` are optional on the
  `Program` interface so legacy test fixtures that build bare
  `Program` literals keep compiling. The dense rule-services
  factories treat `undefined` as empty. Future readers of these
  fields must do the same; assuming presence will silently mis-key
  rule traffic on test-only programs.
- `Brain.funcIdToRule` and `collectFuncIdToRuleMapping` are now
  unread by the runtime path but kept in place per spec (D5
  decides `Brain`'s fate). If a future phase removes them, audit
  any host-side consumers of `IBrainRule` first; nothing under
  `runtime/` should value-import `IBrainRule` outside what D3/D4
  retire from the shim.
- The new ancestor-walk semantics live in
  `createRuleVariableServices` and are pinned by
  `rule-services.spec.ts`. Any future change that splits per-rule
  variable storage (e.g. dense slot-array per rule) must preserve
  the chain: child store missing -> walk
  `Program.ruleAncestors` -> `NIL_VALUE` on root miss.

### D1

**Status**

`ExecutionContext` and `PlatformServices` reshaped to the dense
surface (D0 tables 1-6); new ops (`services.brainVars`,
`services.ruleVars`, `services.brainPages`, `services.callSite`,
`services.action`, `services.program`, `services.rng`) backed by
`runtime/dense-shims.ts` against the legacy `Brain` / `IBrainRule`
graph. `vm.ts` reads route through the new surface only. Lowering
audit (step 0): no ts-compiler edits required.
Verification: full gate green (711/711 tests).

**Risks** (D1 -> D2/D3/D4)

- **Numeric `0` is a real `RuleId`, not a no-rule sentinel.** The
  compiler assigns funcId `0` to the first rule of the first page,
  so `undefined` is the only no-rule marker. D1 hit a live
  regression where the shim short-circuited on `ruleFuncId === 0`
  and silently dropped rule-var traffic for single-page brains.
  D2 must keep `undefined` as the sole sentinel; new regression
  tests in `dense-shims.spec.ts` and `brain.spec.ts` (single-page
  WHEN/DO roundtrip, parent->child ancestor walk, page isolation,
  unset = NIL) inherit as the gate when the shim's rule-side
  branch is removed.
- **`runtime/dense-shims.ts` is the only post-D1 value-importer of
  `IBrain` / `IBrainRule` under `runtime/`.** D2/D3/D4 each retire
  one branch; the file deletes at end of D4. Any new value-import
  of those types from `runtime/` outside `dense-shims.ts` is a
  regression and must be bounced.
- **`services.callSite` host-state lifetime is
  brain-instance-scoped.** Per the page-lifecycle-hooks spec,
  the host-state map is allocated once per
  `(brainInstance, callSiteId)` and survives until
  `Brain.shutdown()` or an explicit `clearHostState`. D3 must
  add behavior tests for `move` cooldown and `eat`
  consumption window so the adapter's semantics do not
  drift from this contract.

---

### D0

**Status**

Decision tables 1-6 appended as `## Phase D0 Decisions`
(inspection commit `9edc6f1`). D2-D4 procedures concretized: variable
accessors use `services.{brainVars,ruleVars}.{getByName,setByName}`,
callsite host state uses `services.callSite.{getHostState,setHostState}`,
action state slots use `services.action.{ensureCallsite,getStateSlot,setStateSlot}`.
`dense-shims.ts` is deleted at end of D4. `Brain` row in Table 5 is
deferred to D5.
Verification: acceptance #11 grep returns only matches inside D0's own procedure docs.

**Risks** (D0 -> future phases)

- **D2 must verify `RuleId` sentinel `0` is unused by the compiler.**
  Table 6 picks `0` as the no-rule sentinel; if any compile path
  assigns funcId `0` to a rule, `services.program.getRuleFuncIdForFunc`
  cannot distinguish "no rule" from "rule 0." D2 step 2 adds the
  guard.
- **`services.callSite` host-state must not clear on action reset.**
  Per the page-lifecycle-hooks spec, the host-state map is
  brain-instance-scoped and survives page round-trips; clearing it
  is opt-in via `clearHostState` or `Brain.shutdown`. The D3
  adapter's map is keyed only by `callSiteId` and is independent
  of action-instance lifetime. D3's behavior tests for `move`
  cooldown and `eat` consumption window catch a regression.
- **`currentActionInstance` deletion gated on D3 grep cleanliness.**
  Table 1 dispositions `delete` the field as dead-after-D3. D3
  acceptance #1/#2 are the gate; if either grep is non-empty, D4
  cannot proceed to step 7 without reopening D3.
- **`Brain` row deferred to D5.** D2-D4 must not hardcode any
  particular `Brain` fate (thin id-only orchestrator vs split).
  Activation-hook signatures (D4 step 6) drop the `ActionInstance`
  parameter but stay inside `Brain`; D5 decides relocation.

---

## Phase D0 Decisions

Inspection commit: `9edc6f1207cd384768502fd0a422716799c2f9f8` (HEAD at
the start of D0 work; update on D0-merge if rebased).

### Table 1: `ExecutionContext` field disposition

| field                   | type                                   | disposition       | replacement                                                                                                                                                                                                                                                                                                                                                                                                                                              | phase   | justification                                                                                                                                        |
| ----------------------- | -------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brain`                 | `IBrain`                               | `move-to-service` | `services.brainVars` adapter for variables; `services.brainPages` adapter for page state and lifecycle (`getCurrentPageId`, `getPreviousPageId`, `requestPageChange`, `requestPageChangeByPageId`, `requestPageRestart`); `services.rng.next()` for the random stream.                                                                                                                                                                                   | D2      | tiebreaker 1: shipped host functions reach `ctx.brain.rng()`, `ctx.brain.getCurrentPageId()`, `ctx.brain.requestPageChange(...)`.                    |
| `getVariable`           | `<T>(varId: string) => T \| undefined` | `move-to-service` | `services.brainVars.getByName(name: string): Value`                                                                                                                                                                                                                                                                                                                                                                                                      | D2      | tiebreaker 1: object-graph reach into Brain variable storage; tiebreaker 3: read-only ABI.                                                           |
| `setVariable`           | `(varId: string, v: Value) => void`    | `move-to-service` | `services.brainVars.setByName(name: string, value: Value): void`                                                                                                                                                                                                                                                                                                                                                                                         | D2      | tiebreaker 1: object-graph reach into Brain variable storage.                                                                                        |
| `clearVariable`         | `(varId: string) => void`              | `move-to-service` | `services.brainVars.clearByName(name: string): void`                                                                                                                                                                                                                                                                                                                                                                                                     | D2      | tiebreaker 1: object-graph reach into Brain variable storage.                                                                                        |
| `getVariableBySlot`     | `(slotId: number) => Value`            | `keep-portable`   | unchanged; already slot-keyed indexer                                                                                                                                                                                                                                                                                                                                                                                                                    | n/a     | already dense (slot-indexed scalar accessor).                                                                                                        |
| `setVariableBySlot`     | `(slotId: number, v: Value) => void`   | `keep-portable`   | unchanged; already slot-keyed indexer                                                                                                                                                                                                                                                                                                                                                                                                                    | n/a     | already dense (slot-indexed scalar accessor).                                                                                                        |
| `data`                  | `unknown`                              | `keep-portable`   | unchanged; opaque host-injected payload                                                                                                                                                                                                                                                                                                                                                                                                                  | n/a     | scalar / opaque pointer; no base-shape reach-through (sim's `getSelf` etc. are extension-side helpers).                                              |
| `callSiteState`         | `CallSiteStateMap`                     | `move-to-service` | host-state branch: `services.callSite.getHostState(callSiteId: number): unknown` / `services.callSite.setHostState(callSiteId: number, state: unknown): void` (D3); action-state-slot branch: `services.action.ensureCallsite(callSiteId: number): boolean` / `services.action.getStateSlot(callSiteId: number, slotIdx: number): Value` / `services.action.setStateSlot(callSiteId: number, slotIdx: number, v: Value): void` (D4). Lifecycle-hooks L1 already moved the storage off `ExecutionContext`; the field declaration on `ExecutionContext` is gone. D3 / D4 retire the convenience helpers and any remaining `ActionInstance`-shaped fixtures.                                                                                                                                                | D3 / D4 | tiebreaker 1: name-keyed map of `ActionInstance` objects with object-graph reach (`hostState`, `stateSlots`).                                        |
| `currentActionInstance` | `ActionInstance \| undefined`          | `delete`          | n/a (already deleted by lifecycle-hooks L1; field, helper graph, and vm.ts writes all gone)                                                                                                                                                                                                                                                                                                                                                              | done    | `grep -nE 'currentActionInstance' packages/core/src` returns zero matches.                                                                            |
| `currentCallSiteId`     | `number \| undefined`                  | `keep-portable`   | unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                | n/a     | already dense (scalar number set by `bindExecutionContext`).                                                                                         |
| `rule`                  | `IBrainRule \| undefined`              | `replace-with-id` | `currentRuleFuncId: number \| undefined` (`RuleId`, table 6); sentinel `0` (no rule). Lookup of rule-scoped data goes through `services.ruleVars.getByName(ruleFuncId, name): Value` / `setByName(ruleFuncId, name, value): void`.                                                                                                                                                                                                                       | D2      | tiebreaker 1: shipped host functions reach `ctx.rule.getVariable(name)` / `ctx.rule.setVariable(name, v)`.                                           |
| `funcIdToRule`          | `Dict<number, IBrainRule>`             | `move-to-service` | `services.program.getRuleFuncIdForFunc(funcId: number): number \| undefined`                                                                                                                                                                                                                                                                                                                                                                             | D2      | tiebreaker 1: name-keyed object map; tiebreaker 3: VM-only read on host-call entry.                                                                  |
| `time`                  | `number`                               | `keep-portable`   | unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                | n/a     | scalar.                                                                                                                                              |
| `dt`                    | `number`                               | `keep-portable`   | unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                | n/a     | scalar.                                                                                                                                              |
| `currentTick`           | `number`                               | `keep-portable`   | unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                | n/a     | scalar.                                                                                                                                              |

### Table 2: App-shipped host function complexity-probe

| function                             | file                                 | ctx-fields-touched                                   | services-used                                                                      | gap            | resolution                                                                                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Vector2.add`                        | apps/sim/src/brain/type-system.ts    | (none)                                               | (none)                                                                             | `none`         |                                                                                                                                                                                                                                                                                   |
| `Vector2.sub`                        | apps/sim/src/brain/type-system.ts    | (none)                                               | (none)                                                                             | `none`         |                                                                                                                                                                                                                                                                                   |
| `Vector2.mul`                        | apps/sim/src/brain/type-system.ts    | (none)                                               | (none)                                                                             | `none`         |                                                                                                                                                                                                                                                                                   |
| `Vector2.div`                        | apps/sim/src/brain/type-system.ts    | (none)                                               | (none)                                                                             | `none`         |                                                                                                                                                                                                                                                                                   |
| `Vector2.dot`                        | apps/sim/src/brain/type-system.ts    | (none)                                               | (none)                                                                             | `none`         |                                                                                                                                                                                                                                                                                   |
| `Vector2.cross`                      | apps/sim/src/brain/type-system.ts    | (none)                                               | (none)                                                                             | `none`         |                                                                                                                                                                                                                                                                                   |
| `Vector2.magnitude`                  | apps/sim/src/brain/type-system.ts    | (none)                                               | (none)                                                                             | `none`         |                                                                                                                                                                                                                                                                                   |
| `Vector2.normalize`                  | apps/sim/src/brain/type-system.ts    | (none)                                               | (none)                                                                             | `none`         |                                                                                                                                                                                                                                                                                   |
| `Vector2.distance`                   | apps/sim/src/brain/type-system.ts    | (none)                                               | (none)                                                                             | `none`         |                                                                                                                                                                                                                                                                                   |
| `Vector2.lerp`                       | apps/sim/src/brain/type-system.ts    | (none)                                               | (none)                                                                             | `none`         |                                                                                                                                                                                                                                                                                   |
| `Vector2.angle`                      | apps/sim/src/brain/type-system.ts    | (none)                                               | (none)                                                                             | `none`         |                                                                                                                                                                                                                                                                                   |
| `Vector2.rotate`                     | apps/sim/src/brain/type-system.ts    | (none)                                               | (none)                                                                             | `none`         |                                                                                                                                                                                                                                                                                   |
| `BrainContext.getTargetActor`        | apps/sim/src/brain/brain-context.ts  | `rule`                                               | (none)                                                                             | `host-rewrite` | reads target-actor variable via `services.ruleVars.getByName(ctx.currentRuleFuncId, "targetActor")` after D2.                                                                                                                                                                     |
| `BrainContext.getTargetPosition`     | apps/sim/src/brain/brain-context.ts  | `rule`, `data`                                       | (none)                                                                             | `host-rewrite` | reads `targetPos` / `targetActor` via `services.ruleVars.getByName(ctx.currentRuleFuncId, ...)`; resolves actor through extension-side `getActor(ctx, ...)` over `data`.                                                                                                          |
| `EngineContext.getActorsByArchetype` | apps/sim/src/brain/engine-context.ts | `data`                                               | (none -- extension-side `getSelf(ctx)` over `data` reaches the host engine handle) | `none`         |                                                                                                                                                                                                                                                                                   |
| `EngineContext.getActorById`         | apps/sim/src/brain/engine-context.ts | `data`                                               | (none -- extension-side `getSelf(ctx)` over `data` reaches the host engine handle) | `none`         |                                                                                                                                                                                                                                                                                   |
| `bump` (sensor)                      | apps/sim/src/brain/actions/bump.ts   | `currentCallSiteId`, `callSiteState`, `rule`, `data` | (none)                                                                             | `host-rewrite` | replaces `getCallSiteState` / `setCallSiteState` with `services.callSite.getHostState(ctx.currentCallSiteId)` / `setHostState(...)` (D3); replaces `ctx.rule.setVariable("bumpedActor", ...)` with `services.ruleVars.setByName(ctx.currentRuleFuncId, "bumpedActor", ...)` (D2). |
| `see` (sensor)                       | apps/sim/src/brain/actions/see.ts    | `currentCallSiteId`, `callSiteState`, `rule`, `data` | (none)                                                                             | `host-rewrite` | same shape as `bump`: callsite host state via `services.callSite.*` (D3); rule-variable writes via `services.ruleVars.setByName(...)` (D2).                                                                                                                                       |
| `eat` (actuator)                     | apps/sim/src/brain/actions/eat.ts    | `currentCallSiteId`, `callSiteState`, `data`         | (none)                                                                             | `host-rewrite` | callsite host state via `services.callSite.*` (D3); `resolveTargetActor(ctx, args, slotId)` reads target-actor rule variable via `services.ruleVars.getByName(...)` (D2).                                                                                                         |
| `move` (actuator)                    | apps/sim/src/brain/actions/move.ts   | `currentCallSiteId`, `callSiteState`, `rule`, `data` | (none)                                                                             | `host-rewrite` | callsite host state via `services.callSite.*` (D3); `resolveTargetPosition` reads rule variables via `services.ruleVars.getByName(...)` (D2); `ctx.brain.rng()` becomes `services.rng.next()` (D2).                                                                               |
| `say` (actuator)                     | apps/sim/src/brain/actions/say.ts    | `data`                                               | (none)                                                                             | `none`         |                                                                                                                                                                                                                                                                                   |
| `shoot` (actuator)                   | apps/sim/src/brain/actions/shoot.ts  | `currentCallSiteId`, `callSiteState`, `data`         | (none)                                                                             | `host-rewrite` | callsite host state via `services.callSite.*` (D3); `resolveTargetActor` reads target-actor rule variable via `services.ruleVars.getByName(...)` (D2).                                                                                                                            |
| `turn` (actuator)                    | apps/sim/src/brain/actions/turn.ts   | `currentCallSiteId`, `callSiteState`, `rule`, `data` | (none)                                                                             | `host-rewrite` | same shape as `move`: callsite host state via `services.callSite.*` (D3); rule-variable reads via `services.ruleVars.getByName(...)` (D2); `ctx.brain.rng()` becomes `services.rng.next()` (D2).                                                                                  |

### Table 3: Core-shipped host function complexity-probe

| function                                         | file                                                 | ctx-fields-touched                   | services-used                                      | gap            | resolution                                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------- | ------------------------------------ | -------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `$$math_abs` ... `$$math_sqrt` (18 total)        | packages/core/src/runtime/math-builtins.ts           | (none)                               | (none)                                             | `none`         |                                                                                                                                                     |
| `$$str_length` ... `$$str_startsWith` (11 total) | packages/core/src/runtime/string-builtins.ts         | (none)                               | (none)                                             | `none`         |                                                                                                                                                     |
| `$$map_keys`                                     | packages/core/src/runtime/map-builtins.ts            | (none)                               | `services.types.instantiate`, `services.types.get` | `none`         |                                                                                                                                                     |
| `$$map_values`                                   | packages/core/src/runtime/map-builtins.ts            | (none)                               | `services.types.instantiate`                       | `none`         |                                                                                                                                                     |
| `$$map_get`                                      | packages/core/src/runtime/map-builtins.ts            | (none)                               | (none)                                             | `none`         |                                                                                                                                                     |
| `$$map_set`                                      | packages/core/src/runtime/map-builtins.ts            | (none)                               | (none)                                             | `none`         |                                                                                                                                                     |
| `$$get_element`                                  | packages/core/src/runtime/element-access-builtins.ts | (none)                               | (none)                                             | `none`         |                                                                                                                                                     |
| `$$set_element`                                  | packages/core/src/runtime/element-access-builtins.ts | (none)                               | (none)                                             | `none`         |                                                                                                                                                     |
| `BrainContext.getVariable`                       | packages/core/src/runtime/context-types.ts           | (delegates to `getVariable`)         | (none)                                             | `host-rewrite` | calls `services.brainVars.getByName(name): Value` per Table 1 disposition for `getVariable` (D2).                                                   |
| `BrainContext.setVariable`                       | packages/core/src/runtime/context-types.ts           | (delegates to `setVariable`)         | (none)                                             | `host-rewrite` | calls `services.brainVars.setByName(name, value): void` (D2).                                                                                       |
| `RuleContext.getVariable`                        | packages/core/src/runtime/context-types.ts           | `rule`                               | (none)                                             | `host-rewrite` | calls `services.ruleVars.getByName(ctx.currentRuleFuncId, name): Value` (D2); returns `NIL_VALUE` when `currentRuleFuncId` is the no-rule sentinel. |
| `RuleContext.setVariable`                        | packages/core/src/runtime/context-types.ts           | `rule`                               | (none)                                             | `host-rewrite` | calls `services.ruleVars.setByName(ctx.currentRuleFuncId, name, value): void` (D2); no-op when sentinel.                                            |
| `random` (CoreSensorId.Random)                   | packages/core/src/runtime/sensors/random.ts          | `brain`                              | (none)                                             | `host-rewrite` | calls `services.rng.next(): number` (D2).                                                                                                           |
| `onPageEntered` (CoreSensorId.OnPageEntered)     | packages/core/src/runtime/sensors/on-page-entered.ts | `currentCallSiteId`, `callSiteState` | (none)                                             | `host-rewrite` | callsite host state via `services.callSite.getHostState` / `setHostState` (D3).                                                                     |
| `timeout` (CoreSensorId.Timeout)                 | packages/core/src/runtime/sensors/timeout.ts         | `currentCallSiteId`, `callSiteState` | (none)                                             | `host-rewrite` | callsite host state via `services.callSite.getHostState` / `setHostState` (D3).                                                                     |
| `currentPage` (CoreSensorId.CurrentPage)         | packages/core/src/runtime/sensors/current-page.ts    | `brain`                              | (none)                                             | `host-rewrite` | calls `services.brainPages.getCurrentPageId(): number` (D2).                                                                                        |
| `previousPage` (CoreSensorId.PreviousPage)       | packages/core/src/runtime/sensors/previous-page.ts   | `brain`                              | (none)                                             | `host-rewrite` | calls `services.brainPages.getPreviousPageId(): number` (D2).                                                                                       |
| `switchPage` (CoreActuatorId.SwitchPage)         | packages/core/src/runtime/actuators/switch-page.ts   | `brain`                              | (none)                                             | `host-rewrite` | calls `services.brainPages.requestPageChange(name)` / `requestPageChangeByPageId(id)` / `requestPageRestart()` (D2).                                |
| `restartPage` (CoreActuatorId.RestartPage)       | packages/core/src/runtime/actuators/restart-page.ts  | `brain`                              | (none)                                             | `host-rewrite` | calls `services.brainPages.requestPageRestart(): void` (D2).                                                                                        |
| `yield` (CoreActuatorId.Yield)                   | packages/core/src/runtime/actuators/yield.ts         | (none)                               | (none)                                             | `none`         |                                                                                                                                                     |

### Table 4: Lowered-call surface

| source-expression                       | example-file                               | lowered-operation | ctx-fields-touched | services-used                                                     | gap                | resolution                                                                                                                                            |
| --------------------------------------- | ------------------------------------------ | ----------------- | ------------------ | ----------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ctx.engine.getActorsByArchetype(arch)` | apps/sim/src/examples/Detect/detect.ts     | `HOST_CALL`       | `data`             | (delegates to extension-side handle on `data`)                    | `none`             |                                                                                                                                                       |
| `ctx.self.id`                           | apps/sim/src/examples/Detect/detect.ts     | `HOST_CALL`       | `data`             | (extension-side struct accessor on `data`)                        | `none`             |                                                                                                                                                       |
| `ctx.self.position`                     | apps/sim/src/examples/Detect/detect.ts     | `HOST_CALL`       | `data`             | (extension-side struct accessor on `data`)                        | `none`             |                                                                                                                                                       |
| `ctx.rule.setVariable(name, value)`     | apps/sim/src/examples/Detect/detect.ts     | `HOST_CALL`       | `rule`             | `services.ruleVars.setByName(ctx.currentRuleFuncId, name, value)` | `lowering-rewrite` | `RuleContext.setVariable` host fn migrates per Table 3 row; lowering of `ctx.rule.setVariable` continues to emit a `HOST_CALL` to that registered fn. |
| `ctx.self.position = value`             | apps/sim/src/examples/Teleport/teleport.ts | `HOST_CALL`       | `data`             | (extension-side struct accessor on `data`)                        | `none`             |                                                                                                                                                       |
| `ctx.brain.getTargetPosition()`         | apps/sim/src/examples/Teleport/teleport.ts | `HOST_CALL`       | `rule`, `data`     | (delegates to `BrainContext.getTargetPosition`, see Table 2)      | `none`             |                                                                                                                                                       |

### Table 5: Object-model retirement

| type             | defining-file                        | retire-phase | replacement                                                                                                       | survives-outside-runtime | survival-location        |
| ---------------- | ------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------ |
| `Brain`          | packages/core/src/brain/brain.ts     | D5           | decided in D5 (thin id-only orchestrator or named replacement)                                                    | tbd                      | tbd                      |
| `BrainPage`      | packages/core/src/brain/page.ts      | D5           | `PageId` (table 6); page state side-table on the Brain orchestrator, accessed via `services.brainPages` adapter   | yes                      | packages/core/src/brain/ |
| `BrainRule`      | packages/core/src/brain/rule.ts      | D2           | `RuleId` (table 6); rule-variable storage in side-table keyed by ruleFuncId, accessed via `services.ruleVars`     | yes                      | packages/core/src/brain/ |
| `ActionInstance` | packages/core/src/runtime/context.ts | D4           | `CallSiteId` (table 6); state slots and host state in `services.action` / `services.callSite` adapter side-tables | no                       | n/a                      |
| `RuleSet`        | n/a                                  | n/a          | no longer present                                                                                                 | no                       | n/a                      |

### Table 6: Rule and action id-space

| id-space     | representation | allocation-site | sentinel | slot-space                                                                                                                                                                                                      | reload-stability        |
| ------------ | -------------- | --------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `RuleId`     | `number`       | compiler        | `0`      | rule variables, allocated by compiler from rule's local var declarations                                                                                                                                        | `regenerated-on-reload` |
| `ActionId`   | `number`       | compiler        | `0`      | n/a                                                                                                                                                                                                             | `regenerated-on-reload` |
| `CallSiteId` | `number`       | compiler        | `0`      | per-callsite host-state cell plus per-callsite action-state-slot list, allocated by compiler at action-call lowering (brain-instance-scoped lifetime per the page-lifecycle-hooks spec; `services.action.ensureCallsite` allocates on first call and is a no-op afterward; explicit reset via `services.action.resetCallsite` / `services.callSite.clearHostState` / `Brain.shutdown`) | `regenerated-on-reload` |
| `PageId`     | `number`       | compiler        | `0`      | n/a                                                                                                                                                                                                             | `regenerated-on-reload` |

---

## Phase D0 -- Decision Tables For The Dense State Shape

**Purpose.** Pin the data-shape decisions that the rest of this spec
depends on, before any code moves.

**Deliverable.** Four tables, appended to this plan under a single
new section `## Phase D0 Decisions` placed directly below
`## Phase Log`. The section header records the git commit hash
of the D0-merge commit; until D0 lands, use HEAD at the start of D0
work and update the hash at merge.

### Source paths (the agent inspects only these)

- **`ExecutionContext` and runtime action types:**
  `packages/core/src/runtime/context.ts`. The exported type
  `ExecutionContext` is the row source for table 1. The exported
  helpers `getActionInstance`, `getOrCreateActionInstance`,
  `resetActionInstance`, `getCallSiteState`, `setCallSiteState`
  in the same file are inputs to tables 3 and 4.
- **App-shipped host functions (table 2 row source):** every
  static host-function registration under `apps/sim/src/brain/`.
  At the inspection commit these come from three APIs:
  - `functions.register(...)` in `type-system.ts`,
    `brain-context.ts`, `engine-context.ts` (type-system
    methods, BrainContext / EngineContext accessors).
  - `api.registerHostActuator(createHostActuator(...))` in
    `apps/sim/src/brain/index.ts`, registering the actuator
    `exec*` callbacks defined under
    `apps/sim/src/brain/actions/` (move, eat, say, shoot, turn,
    teleport, ...).
  - `api.registerHostSensor(createHostSensor(...))` in
    `apps/sim/src/brain/index.ts`, registering the sensor
    `exec*` callbacks defined under
    `apps/sim/src/brain/actions/` (bump, see).

  All three channels produce shipped TS host functions whose
  `exec` callback closes over `ExecutionContext`. The actuator
  and sensor channels are notable because their `exec`
  callbacks consume `getCallSiteState<T>(ctx)` /
  `setCallSiteState(ctx, T)` from `runtime/context.ts` (they
  carry per-callsite host-side state across ticks), so their
  table 2 rows record `currentCallSiteId` and `callSiteState`
  in `ctx-fields-touched`.

  Bytecode action _opcodes_ (`ACTION_CALL_SYNC`,
  `ACTION_CALL_ASYNC`) are not registrations; they are emitted
  by lowering and dispatch through these registered host
  functions. The lowered-call surface is the next bullet.

- **Sim `ExecutionContext` extension:**
  `apps/sim/src/brain/execution-context-types.ts` defines
  `ActorExecutionContext` and the `getSelf` / `getActor` /
  `getTargetActor` helpers. Reads of these helpers from
  registered host functions are reach-through into `ctx.data`
  and are recorded in table 2's `ctx-fields-touched` column as
  `data`.
- **Lowered-call complexity probe (table 4 row source):** the
  shipped user-authored examples under `apps/sim/src/examples/`
  (e.g. `Detect/detect.ts`, `Teleport/teleport.ts`). These
  files compile to bytecode; their `onExecute` bodies are not
  TS host functions, but every `ctx.<x>` and `ctx.<x>.<y>`
  expression they contain becomes a contract operation
  produced by lowering. Each distinct reach-through pattern is
  a row in table 4.
- **Core-shipped host functions (table 3 row source):** every
  call to `functions.register(...)` under
  `packages/core/src/runtime/` whose `exec` callback closes over
  `ctx`. At the inspection commit this includes:
  - `runtime/context-types.ts`: `BrainContext.getVariable`,
    `BrainContext.setVariable`, `RuleContext.getVariable`,
    `RuleContext.setVariable` (all four reach through
    `ctx.getVariable` / `ctx.setVariable` /
    `ctx.rule?.getVariable` / `ctx.rule?.setVariable`);
  - `runtime/math-builtins.ts`, `runtime/map-builtins.ts`,
    `runtime/string-builtins.ts`, and any other `*-builtins.ts`
    that registers an `exec` reading or writing `ctx.*`.
    Builtins that touch only `args` (not `ctx`) get a single
    table 3 row each with `ctx-fields-touched = (none)` and
    `gap = none` -- their presence is recorded so the table is
    closed-set.
- **Other shipped TS host functions:** none at D0-merge. The only
  non-sim, non-core consumers of `ExecutionContext` in this repo
  are `packages/ts-compiler/src/compiler/*.spec.ts` (test
  fixtures, not shipped host functions). If grep
  `'export function exec.*ExecutionContext'` outside
  `apps/sim/` and `packages/core/src/runtime/` returns matches
  at D0-merge, treat each match as an additional row in table
  2 and update this section.
- **Legacy types (table 5 row source):** `Brain`
  (`packages/core/src/brain/brain.ts`), `BrainPage`
  (`packages/core/src/brain/page.ts`), `BrainRule`
  (`packages/core/src/brain/rule.ts`), `ActionInstance`
  (`packages/core/src/runtime/context.ts`), `RuleSet` (search
  the workspace; if absent at D0-merge, the row records "no
  longer present" and is dropped from later phases).
- **VM dispatch sites that will need to migrate (informational):**
  `packages/core/src/runtime/vm.ts`. The agent does not modify
  this file in D0; it is referenced only to confirm the
  reach-through patterns table 1 must catch.

### Procedure (execute in order)

1. Pin the inspection commit. Record the SHA in the
   `## Phase D0 Decisions` header.
2. Open `packages/core/src/runtime/context.ts`. Seed table 1 with
   one row per public field on `ExecutionContext` (instance
   fields, getters, and methods on the interface; see "Exported
   field" below). Leave `disposition`, `replacement`, `phase`,
   `justification` blank.
3. Walk every app-shipped host function listed under "Source
   paths". For each, fill one row in table 2: list the
   `ctx.*` fields it touches, the `PlatformServices` operations
   it invokes, and set `gap` initially to `none`.
4. Walk every core-shipped host function listed under "Source
   paths". For each, fill one row in table 3 with the same
   columns as table 2. Builtins that close over only `args` get
   a row with `ctx-fields-touched = (none)`,
   `services-used = (none)`, `gap = none`.
5. Walk the lowered-call probe files under
   `apps/sim/src/examples/`. For each distinct `ctx.<x>` /
   `ctx.<x>.<y>` reach-through pattern, fill one row in
   table 4 naming the example file, the source expression,
   and the contract operation lowering must emit. This
   enumerates the action-call surface the lowering process
   depends on at runtime.
6. For each row in tables 2, 3, and 4 whose
   `ctx-fields-touched` or `services-used` references something
   the dense shape cannot express (because table 1's chosen
   disposition would remove it), set `gap` to either
   `host-rewrite` (tables 2, 3), `lowering-rewrite` (table 4),
   or `contract-add` per the gap-classification below. For
   `contract-add` rows, append a new row to table 1 with
   `disposition = keep-portable` or the appropriate dense
   shape and `phase = D1`.
7. Audit other shipped TS host functions (none expected; see
   "Source paths"). For any found, ensure every `ctx.<field>`
   access maps to a table 1 row and append the function as a
   row in table 2.
8. Apply the table 1 tiebreakers (in order) to assign
   `disposition`, `replacement`, `phase`, and `justification` to
   every table 1 row. Any row whose disposition is still
   ambiguous after all tiebreakers gets `disposition = tbd` and
   a one-line note; resolve at D1 kickoff.
9. Fill table 5 (object-model retirement) per the row list and
   tiebreakers below.
10. Fill table 6 (id-space) per the row list and tiebreakers
    below. Cross-check: every `replace-with-id` row in table 1
    references an id-space that exists in table 6, and every
    id-space referenced by tables 1 or 5 has a row in table 6.
11. **Concretize downstream procedures.** D2, D3, D4, and D6
    procedures are written with parenthetical "or per D0"
    branches at every step where the dispositions decided in
    steps 8-10 select between alternative shapes (most
    notably, **PlatformServices adapter op trio** vs
    **ExecutionContext slot-indexer** for callsite host state
    and for action state slots; also: side-table location, who
    initializes the backing store, and child-fiber sharing
    semantics). With tables 1, 2, 3, 4, 5, 6 now filled, walk
    each downstream procedure and lock in the chosen branch:
    1. Open the D2 / D3 / D4 / D6 phase sections in this plan.
    2. For every step that contains a parenthetical of the
       form "(adapter form)" / "(indexer form)" / "(or per
       D0)" / "(if D0 chose ...)" / similar, edit the step
       to retain only the chosen branch and delete the
       alternative. The procedure must read as a flat
       sequence of concrete actions, not a switch over D0's
       output.
    3. For every "Source paths" entry that names alternative
       file locations contingent on D0 (e.g. "either
       `runtime/platform-services.ts` or
       `runtime/context.ts`"), pick the file the chosen
       disposition routes to and delete the other.
    4. For every "Verification gates" entry whose grep
       pattern is contingent on D0 (e.g. greps for
       `getCallSiteState` only make sense if the adapter
       form was chosen; an indexer form would grep for
       `ctx.callSiteState[...]` instead), rewrite the grep
       to match the chosen shape.
    5. After each downstream phase is concretized, re-read
       it end-to-end as if it were the only phase you were
       executing. If any step still reads as a choice
       rather than an instruction, the concretization is
       incomplete; revise.
    6. Record in D0's phase log (post-mortem) the list of
       downstream phase steps that were concretized and the
       branch chosen for each. This is the audit trail
       linking D0's table dispositions to the now-frozen
       D2-D6 procedures.
       The unit gate for D0 is that **no downstream procedure
       contains a D0-contingent branch after this step.** A
       procedure that still says "or per D0" has not been
       concretized; D0 has not shipped.
12. Run the validation checklist (Acceptance section). Every
    item must pass before D0 ships.

### Closure rules (apply to all four tables)

- The row set freezes when D0 ships, not when each table is first
  drafted. Step 4 explicitly extends table 1 from table 2's
  `contract-add` resolutions; that is part of D0, not a later
  amendment. Once D0 ships, adding a row is a contract change
  and reopens D0.
- "Today's `ExecutionContext`" means the exported type as it
  exists at the inspection commit pinned in step 1.
- "Exported field" means any member of the `ExecutionContext`
  interface that is reachable from a host function via `ctx.x`
  (instance fields, getters, methods). Inherited members are
  rows in their own right. Exclude private / underscore-prefixed
  members. Members defined only on extensions (e.g.
  `ActorExecutionContext.data`) are not table 1 rows; reach-through
  to them is recorded in table 2 as a read of the base field
  (here, `data`).
- A base field that exists at the inspection commit but is unused
  by any shipped host function is still a row; its disposition
  is typically `delete` with `phase = n/a` and
  `justification = "unused at D0-merge"`.

### Table 1: `ExecutionContext` field disposition

**Schema.** One row per "exported field" (above) on the
`ExecutionContext` interface in `packages/core/src/runtime/context.ts`
at the inspection commit. Columns, in order:

| col             | meaning                                                                                            |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `field`         | TypeScript field name                                                                              |
| `type`          | TypeScript type at the inspection commit                                                           |
| `disposition`   | one of `keep-portable`, `replace-with-id`, `replace-with-slot`, `move-to-service`, `delete`, `tbd` |
| `replacement`   | new surface (id type + lookup op, slot indexer, service method, or `n/a`)                          |
| `phase`         | D-phase that performs the migration: `D1`, `D2`, `D3`, `D4`, `D6`, or `n/a` (for `delete` rows)    |
| `justification` | one sentence, or `"see tiebreaker N"`                                                              |

Use GitHub-flavored Markdown table syntax with the columns in the
order shown.

**Disposition definitions.**

- `keep-portable` -- stays, semantics unchanged. Pure scalar /
  data field with no object-graph reach-through.
- `replace-with-id` -- current object reference becomes a stable
  id; a `PlatformServices` (or context) lookup op resolves the
  id when needed.
- `replace-with-slot` -- current name-keyed access becomes a
  slot-indexed access on a contracted slot space.
- `move-to-service` -- field disappears from `ExecutionContext`
  and becomes a `PlatformServices` operation.
- `delete` -- no portable equivalent and no shipped host
  function depends on it.
- `tbd` -- temporary marker for fields where all tiebreakers
  failed to disambiguate; resolved at D1 kickoff. Acceptance
  forbids any `tbd` rows in the shipped D0 tables.

**Tiebreakers (apply in order).**

1. If any shipped host function reads or writes the field via
   `ctx.<field>.<inner>` (object-graph reach-through), it is not
   `keep-portable`; pick `replace-with-id` or `move-to-service`.
2. If the field is a name-keyed map whose keys come from program
   metadata (variable names, slot names), it is `replace-with-slot`.
3. If the field is read by host functions but never mutated by
   the VM during a host call, prefer `move-to-service` over
   `keep-portable`.

**Cell prose style.**

- `replacement` cell names the id type, the sentinel, and the
  resolution op together in one cell separated by `;`. If the
  disposition is `replace-with-slot` instead, the cell names
  the indexer signature: `ctx.varSlot(slotIndex: number): Value`.
  If the disposition is `move-to-service`, the cell names the
  full method signature, e.g.
  `services.types.getStruct(typeId: number): StructDescriptor`.
- `justification` is one sentence ending with a period; it
  cites a tiebreaker by number when the disposition was forced
  by one (`tiebreaker N: ...`).
- A `delete` row puts `n/a` in `replacement` and the
  justification names the inspection-commit grep that
  confirmed zero shipped consumers.

### Table 2: App-shipped host function complexity-probe

**Schema.** One row per `functions.register(...)` call site
under `apps/sim/src/brain/`. Sim is the language-level
complexity probe -- the contract has to be wide enough that a
host function of sim's shape is expressible. Columns, in order:

| col                  | meaning                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `function`           | host function name (registration string)                                    |
| `file`               | source file path                                                            |
| `ctx-fields-touched` | `ExecutionContext` base fields read or written (table 1 names), or `(none)` |
| `services-used`      | `PlatformServices` ops invoked, or `(none)`                                 |
| `gap`                | `none`, `host-rewrite`, or `contract-add`                                   |
| `resolution`         | one sentence; only required when `gap != none`                              |

**Cell prose style.**

- `ctx-fields-touched` lists comma-separated table 1 field
  names exactly as they appear in table 1 column 1; never an
  inner property (`ctx.data.actorId` -> `data`).
- `services-used` is the full method signature when the gap
  resolution adds a new service op; for existing service ops,
  the bare method name (`services.types.getStruct`) is enough.
- `resolution` for `contract-add` ends by naming the
  corresponding table 1 row (which must exist).
- `resolution` for `host-rewrite` names the new function
  body in one phrase, e.g. "reads `actorId` from `data`,
  calls `services.platformEntity.getActorPosition(actorId)`."

### Table 3: Core-shipped host function complexity-probe

**Schema.** One row per `functions.register(...)` call site
under `packages/core/src/runtime/`. These are the runtime's own
built-in surface (math, string, map, context-type accessors).
They are part of the language ABI and must remain expressible
against the dense shape. Reach-throughs in table 3 drive the
same gap resolutions as table 2; the dispositions feed back into
table 1 identically. Columns are the same as table 2.

**Cell prose style.** Same as table 2. The `resolution`
column is empty when `gap = none`; do not write "n/a" or
"-".

### Table 4: Lowered-call surface

**Schema.** One row per distinct lowering reach-through observed
in the shipped examples under `apps/sim/src/examples/`. Action
calls (move, shoot, set-position, get-target-position, ...) are
not statically registered -- they are produced by the lowering
process at runtime. The example files are the canonical
enumeration of the surface lowering depends on. Columns, in
order:

| col                  | meaning                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `source-expression`  | exact `ctx.<x>` / `ctx.<x>.<y>` / `ctx.<x>.<y> = <z>` form in user code |
| `example-file`       | path under `apps/sim/src/examples/` where the pattern appears           |
| `lowered-operation`  | name of the contract op the lowering process must emit                  |
| `ctx-fields-touched` | `ExecutionContext` base fields the lowered op reads or writes           |
| `services-used`      | `PlatformServices` ops invoked by the lowered op, or `(none)`           |
| `gap`                | `none`, `lowering-rewrite`, or `contract-add`                           |
| `resolution`         | one sentence; only required when `gap != none`                          |

**Cell prose style.**

- `source-expression` is the verbatim TS as it appears in the
  example file, including spacing, with `<x>` placeholders
  only for argument positions: `actor.shoot(<target>)`.
- `lowered-operation` is the bytecode opcode mnemonic
  (`ACTION_CALL`, `ACTION_CALL_ASYNC`, `HOST_CALL`,
  `HOST_CALL_ASYNC`) -- not a service method name.
- `services-used` lists the service op the lowered opcode
  dispatches through, full signature for `contract-add`.

### Gap classification (tables 2, 3, 4)

`gap` values:

- `none` -- the function (or lowered op) is expressible against
  the dense shape with no change to either the function or the
  contract.
- `host-rewrite` (tables 2, 3) / `lowering-rewrite` (table 4) --
  the function or lowered op reaches for something the dense
  shape does not expose, but it can be rewritten to use a
  contracted operation. Resolution names the rewrite (which
  function or lowering rule, which new operation it calls).
- `contract-add` -- the need is legitimate and the contract is
  extended. Resolution names the new context field or service
  operation; that addition appears as a row in table 1 with
  `phase = D1`.

Acceptance forbids any unresolved gap in any of tables 2, 3,
or 4 (every row is `gap = none`, or a resolved `host-rewrite` /
`lowering-rewrite` / `contract-add`).

### Table 5: Object-model retirement

**Schema.** One row per legacy object type. Required rows:
`Brain`, `BrainPage`, `BrainRule`, `ActionInstance`, `RuleSet`.
If a required type is absent at the inspection commit, the row
records `retire-phase = n/a` and
`replacement = "no longer present"`. Columns, in order:

| col                        | meaning                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `type`                     | legacy class / interface name                                            |
| `defining-file`            | path under `packages/core/src/brain/` or `packages/core/src/runtime/`    |
| `retire-phase`             | D-phase that removes its runtime role (`D2`, `D4`, `D5`, `D6`, or `n/a`) |
| `replacement`              | id type, slot space, side table, or `"no runtime equivalent"`            |
| `survives-outside-runtime` | `yes` / `no`                                                             |
| `survival-location`        | module path (e.g. `core/src/brain/editor/`), or `n/a`                    |

**Tiebreakers.**

1. If the type is referenced by both a runtime and a non-runtime
   call site, the runtime reference must retire by `retire-phase`;
   `survives-outside-runtime = yes` covers the non-runtime use.
2. The `Brain` row is filled in two passes. D0 records:
   `retire-phase = D5`,
   `replacement = "decided in D5 (thin id-only orchestrator or named replacement)"`,
   `survives-outside-runtime = tbd`,
   `survival-location = tbd`. D5's post-mortem updates the row
   with the chosen fate.

**Cell prose style.**

- `replacement` names the id type with a parenthetical link to
  table 6 when the id-space is contracted, then describes
  storage location: `<id-type> (table 6); <storage description>`.
- `survival-location` is a directory path (trailing slash) when
  the type survives in any non-runtime location; `n/a` when
  `survives-outside-runtime = no`.

### Table 6: Rule and action id-space

**Schema.** One row per id-space. Required rows: `RuleId`,
`ActionId`, `CallSiteId`. Add a `PageId` row only if table 5's
`BrainPage` row has `survives-outside-runtime = yes` or its
runtime replacement keeps a per-page id; otherwise omit.
Columns, in order:

| col                | meaning                                                                                                                |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `id-space`         | name                                                                                                                   |
| `representation`   | `number` or branded type (`RuleId & { __brand }`)                                                                      |
| `allocation-site`  | compiler / linker / runtime                                                                                            |
| `sentinel`         | value meaning "none" (e.g. `0`, `-1`, `NO_RULE`)                                                                       |
| `slot-space`       | description of the per-id slot space (e.g. "rule variables, allocated by compiler from rule's local var declarations") |
| `reload-stability` | `stable-across-reload` or `regenerated-on-reload`                                                                      |

**Tiebreakers.**

1. Use `number` unless a single function signature in tables 1,
   2, 3, or 4 accepts more than one id space at the same
   parameter position; in that case, use a branded type for
   those id spaces.
2. Prefer compile-time allocation; runtime allocation is allowed
   only when the id space is open-ended at runtime (e.g.
   per-callsite action state keyed by `(actionId, callSiteId)`
   where `callSiteId` is bytecode-immediate).
3. The "none" sentinel must be representable in
   `replace-with-id` lookups; pick a value the lookup op rejects
   without requiring an extra branch.

**Cell prose style.**

- `representation` is `number` (when tiebreaker 1 picks the
  primitive form) or a branded type literal
  (`RuleId & { readonly __brand: "RuleId" }`) -- write the
  full brand declaration, not a shorthand.
- `allocation-site` is `compiler` / `linker` / `runtime`; if
  the id is split across stages (e.g. allocated by the
  compiler, finalized by the linker), use `compiler+linker`.
- `slot-space` is one short noun phrase ending in a comma,
  followed by the allocation source. If the id-space has no
  per-id slot space (e.g. `CallSiteId`), write `n/a`.
- `reload-stability` uses the literal strings
  `stable-across-reload` or `regenerated-on-reload`; do not
  paraphrase.

### Out of scope for D0

- Implementing any of the new shape.
- Migrating any host function.
- Editing `vm-contract.md` (deferred to D6).
- Editing `runtime/context.ts` or any sim host function (deferred
  to D1+).

### Acceptance (validation checklist)

D0 ships only when every item passes:

1. The inspection commit SHA is recorded in the
   `## Phase D0 Decisions` section header.
2. Every "exported field" on `ExecutionContext` at the
   inspection commit has exactly one row in table 1.
3. No table 1 row has `disposition = tbd`.
4. Every app-shipped host function listed under "Source paths"
   has exactly one row in table 2; every core-shipped host
   function under `packages/core/src/runtime/` has exactly one
   row in table 3; every distinct `ctx.<x>` reach-through in
   the example files under `apps/sim/src/examples/` has exactly
   one row in table 4.
5. No row in tables 2, 3, or 4 has an unresolved `gap` (every
   row is `none`, resolved `host-rewrite` /
   `lowering-rewrite`, or resolved `contract-add`).
6. Every `contract-add` row in tables 2, 3, or 4 corresponds to
   a row in table 1 with `phase = D1`.
7. Every non-sim, non-core shipped host function (per "Source
   paths" audit) accesses only base `ExecutionContext` fields
   that appear in table 1.
8. Table 5 has rows for `Brain`, `BrainPage`, `BrainRule`,
   `ActionInstance`, `RuleSet` (or `n/a` rows for any absent at
   the inspection commit).
9. Table 6 has rows for `RuleId`, `ActionId`, `CallSiteId`
   (and `PageId` if required by table 5).
10. Cross-reference: every `replace-with-id` row in table 1
    names an id-space that has a row in table 6; every id-space
    referenced by tables 1 or 5 has a row in table 6.
11. **Downstream procedures concretized.** D2, D3, D4, and D6
    phase sections in this plan contain zero remaining
    "(or per D0)" / "(adapter form)" / "(indexer form)" /
    similar D0-contingent branches. Greppable check: from the
    plan file, `grep -nE '\\(or per D0\\)|\\(adapter form\\)|\\(indexer form\\)|\\(if D0 chose'`
    returns only matches inside D0's own procedure (step 11
    of D0 itself, where the discipline is documented). Every
    procedure step in D2-D4 / D6 reads as a flat instruction.
12. The list of downstream procedure steps that step 11
    concretized, with the branch chosen for each, is recorded
    in D0's phase log entry (post-mortem artifact, not
    written by the implementation unit).
13. No code changes outside this plan file.

## Phase D1 -- Declare The Portable Shape (Type-First)

**Purpose.** Transform the existing `ExecutionContext` interface and
`PlatformServices` interface per D0 table 1 dispositions, with the
new surface backed by an internal shim against the legacy object
graph. This unit changes shape, not behavior; D2 / D3 / D4 / D6
each remove the shim for one subsystem.

This is mostly a deletion-and-redirection job, not greenfield. The
new fields are determined by D0 table 1; D1 implements the
transformation, wires the shim, and routes every reader through the
new surface.

### Source paths (the agent edits / inspects these)

- **Interface to transform:**
  `packages/core/src/runtime/context.ts` -- `ExecutionContext`
  declaration and the existing helpers
  (`getActionInstance`, `getOrCreateActionInstance`,
  `resetActionInstance`, `getCallSiteState`, `setCallSiteState`).
- **Services interface to extend:**
  `packages/core/src/runtime/services.ts` -- `PlatformServices`.
- **VM dispatch to redirect:**
  `packages/core/src/runtime/vm.ts` -- every
  `fiber.executionContext.<deleted-field>` access (currently 35+
  callsites for `brain` / `rule` / `funcIdToRule` / name-keyed
  variable methods / `currentActionInstance`).
- **Construction sites of `ExecutionContext`:**
  - `packages/core/src/brain/brain.ts` (the only production
    construction; currently sets `brain`, `rule?`,
    `funcIdToRule`, `time`, `dt`, `currentTick`, `data?`).
  - `packages/core/src/runtime/vm.ts` line ~1817 (child fiber
    spawn copies the parent context).
  - Test fixtures: every `vm-*.spec.ts` under
    `packages/core/src/runtime/` that builds
    `const ctx: ExecutionContext = { ... }`.
- **Shim file (created in this phase):**
  `packages/core/src/runtime/dense-shims.ts`. Holds the only
  surviving value-imports of `IBrain` / `IBrainRule` under
  `runtime/` after D1.
- **Public re-exports:**
  `packages/core/src/runtime/index.ts` -- the shim file is not
  re-exported.
- **App-shipped host functions to retype:** every
  `functions.register(...)` call site under `apps/sim/src/brain/`
  (at the inspection commit: `type-system.ts`,
  `brain-context.ts`, `engine-context.ts`). Cite D0 table 2
  for the full row list. Action calls produced by the lowering
  process at runtime are _not_ in this list -- they are emitted
  by `packages/ts-compiler` lowering rules into contracted
  opcodes (`ACTION_CALL` / `ACTION_CALL_ASYNC`) whose runtime
  interpretation D1 changes via the vm.ts redirect (step 4).
  Whether the lowering rules themselves need source-level edits
  is determined by step 0 below.
- **Core-shipped host functions to retype:** every
  `functions.register(...)` call under
  `packages/core/src/runtime/` whose `exec` callback closes
  over `ctx`. Cite D0 table 3 for the full row list. Most
  builtins (math, string, map) only touch `args` and the
  retype is mechanical; the four context-types reach-throughs
  (`BrainContext.getVariable`, `BrainContext.setVariable`,
  `RuleContext.getVariable`, `RuleContext.setVariable`) are
  reshaped per their D0 table 3 resolutions.
- **Sim `ExecutionContext` extension:**
  `apps/sim/src/brain/execution-context-types.ts` --
  `ActorExecutionContext extends ExecutionContext` and the
  `getSelf` / `getActor` / `getTargetActor` helpers continue to
  read `ctx.data`; no semantic change.
- **Test fixtures to retype:**
  `packages/ts-compiler/src/compiler/arg-spec.spec.ts` and
  `array.spec.ts` (the `mkCtx()` helpers building
  `Partial<ExecutionContext>`).

### Procedure (execute in order; the tree should compile after each step)

0. **Audit `packages/ts-compiler` lowering rules against D0
   table 4.** For every row in table 4, confirm the
   `lowered-operation` cell names a contracted opcode
   (`ACTION_CALL`, `ACTION_CALL_ASYNC`, `HOST_CALL`,
   `HOST_CALL_ASYNC`). If every row passes, the lowering side
   needs no source edits in D1 -- the contracted opcodes are
   already id-keyed in the bytecode, and D1's vm.ts redirect
   (step 4) is the only thing that changes how the runtime
   interprets them. Record "lowering: no edits required" in
   the phase log and proceed to step 1. If any row's
   `lowered-operation` is something else (a non-contracted
   opcode, or a custom emit pattern), **stop and escalate per
   the Workflow Convention** -- those patterns belong in a
   dedicated ts-compiler unit ahead of D2, not wedged into D1.
   D1 does not perform compiler changes.
1. **Add new fields and dense-state ops as additions only.** In
   `runtime/context.ts`, add every D0 table 1 row whose
   disposition is `replace-with-id`, `replace-with-slot`, or
   `keep-portable` (and is not already present) to
   `ExecutionContext`. In `runtime/services.ts`, add every D0
   table 1 row whose disposition is `move-to-service` to
   `PlatformServices`. Do not delete anything yet; the legacy
   fields and the new fields coexist for steps 2-7.
2. **Create the shim file** (`runtime/dense-shims.ts`). It
   exports a function (e.g. `installDenseShims(ctx, brain)`)
   that, given a partially-constructed `ExecutionContext` and
   the legacy `Brain`, populates the new surface so each new op
   delegates to the legacy object graph:
   - rule-side: variable slot read goes through the existing
     variable store; rule-id-to-rule lookup walks
     `funcIdToRule` (D2 retires this branch).
   - action-side: action-id resolution calls
     `getOrCreateActionInstance` and reads
     `ActionInstance.stateSlots` (D4 retires this branch).
   - host-state-side: per-callsite host-state get/set
     reads/writes `ActionInstance.hostState` via
     `getOrCreateActionInstance` (D3 retires this branch).
     The shim is the only place under `runtime/` allowed to
     value-import `IBrain` / `IBrainRule` after D1 ships.
3. **Wire the shim at the construction site.** In
   `packages/core/src/brain/brain.ts` (the
   `activationContext` construction), call
   `installDenseShims(ctx, this)` after building the legacy
   fields. Same in `vm.ts`'s child-fiber spawn path: the cloned
   context already carries the shim because it copies all
   fields, but verify the new ops continue to resolve through
   the parent's shim.
4. **Redirect `vm.ts` reads.** Replace every
   `fiber.executionContext.<deleted-field>` access in `vm.ts`
   with a call to the new `ExecutionContext` op or
   `services.<denseOp>(...ids)`. `vm.ts` does not import the
   shim file directly; it only sees the new surface. After this
   step, `vm.ts` contains no reference to `ctx.brain`,
   `ctx.rule`, `ctx.funcIdToRule`, or name-keyed variable
   methods.
5. **Retype every shipped TS host function** per D0 tables 2
   and 3 resolutions. The retype is signature-mechanical: each
   row's D0 resolution names exactly the change. For
   `gap = none` rows the signature change updates the parameter
   type (the body is unchanged); for `host-rewrite` rows the
   body shrinks an object-graph dereference
   (`ctx.brain.actor.position`) into an id-keyed service call
   (`services.platformEntity.getActorPosition(actorId)`) per
   the row's resolution; for `contract-add` rows the new
   operation already exists from step 1. **No host function
   gains or loses functionality; behavior is unchanged.** The
   four reach-through rows in table 3 for
   `runtime/context-types.ts` are reshaped here. If a retype
   reveals a needed semantic change (a service op the row's
   resolution did not anticipate, a return-shape mismatch, a
   missing parameter), **stop and escalate** -- D0 missed a
   gap; do not silently widen the new surface.
6. **Retype `ActorExecutionContext`** (sim) and the `mkCtx()`
   test fixtures (ts-compiler) so their construction matches
   the new `ExecutionContext` shape. The sim helpers
   (`hasActorData`, `getSelf`, `getActor`, `getTargetActor`)
   continue to read `ctx.data`; no semantic change.
7. **Delete the legacy fields and methods** from
   `ExecutionContext` per D0 table 1's `delete` and
   `move-to-service` rows: `brain`, `rule`, `funcIdToRule`,
   `getVariable`, `setVariable`, `clearVariable`, and
   `currentActionInstance` (replaced by `currentActionId` plus a
   shim-backed lookup; the persistent state is still reachable
   via the new surface, so host actions observe identical
   per-callsite state). After this step, the only file under
   `runtime/` with a value-import of `IBrain` / `IBrainRule` is
   `dense-shims.ts`.
8. **Confirm the import firewall.** `runtime/index.ts` does not
   re-export any symbol from `dense-shims.ts`. The shim is
   construction-site-only.

### Risks

- TypeScript variance around host-function callbacks may force
  generics or explicit casts when the `HostActionBinding`
  callback signatures change.
- The shim layer can become a parallel data path if it is
  allowed to accept calls from new code paths. Mitigation: the
  shim file is not re-exported; the only allowed import sites
  are listed in step 3.
- D0 tables 2, 3, and 4 must already have resolved every fault
  payload that today carries object references (those rows ship
  as `host-rewrite` / `lowering-rewrite` or `contract-add`). If
  a fault payload row was missed in D0, escalate per the
  Workflow Convention and reopen D0; do not silently widen the
  new surface.

### Acceptance (validation checklist)

D1 ships only when every item passes:

1. Every D0 table 1 row's disposition is implemented in
   `runtime/context.ts` (and `runtime/services.ts` for
   `move-to-service` rows): added, retained, or deleted as the
   row prescribes. Verified by walking the row list.
2. Every D0 table 2, 3, and 4 row's gap resolution is
   applied: for `host-rewrite` rows the function calls the
   named contracted operation; for `contract-add` rows the
   new operation exists and is called; for `lowering-rewrite`
   rows the resolution is recorded as out-of-scope for D1
   (the audit at step 0 escalated, or the row's
   `lowered-operation` is already a contracted opcode and the
   resolution is the runtime-side change in vm.ts step 4).
   Every shipped example under `apps/sim/src/examples/` still
   compiles and lowers without diagnostics.
3. `grep -nE 'ctx\.(brain|rule|funcIdToRule)\b' packages/core/src/runtime/`
   returns matches **only** in `dense-shims.ts`.
4. `grep -rnE 'ctx\.(brain|rule|funcIdToRule)\b' apps/sim/src/`
   returns no matches.
5. `grep -nE '\.(getVariable|setVariable|clearVariable)\b' packages/core/src/runtime/`
   returns matches only in `dense-shims.ts` (where the shim
   may delegate to the legacy variable store).
6. `runtime/index.ts` does not re-export any symbol declared in
   `dense-shims.ts`.
7. The shim file is the only file under `packages/core/src/runtime/`
   with a value-import (not type-import) of `IBrain` or
   `IBrainRule`.
8. From `packages/core`, `apps/sim`, and `packages/ts-compiler`
   in turn, all four of
   `npm run typecheck && npm run check && npm test && npm run build`
   pass with the project's zero-noise standard.
9. No behavior changes: existing test suites pass without
   modification beyond the type-fixture updates in step 6.

## Phase D2 -- Rule Subsystem Migration

**Purpose.** Remove the rule-resolution shim landed in D1; rule
identity flows through ids and a contracted lookup end-to-end.

**Precondition.** D0 tables 2 and 3 have resolved every host
function's rule-context use, including the core-shipped
variable-accessor host functions in
`runtime/context-types.ts` (`BrainContext.getVariable`,
`BrainContext.setVariable`, `RuleContext.getVariable`,
`RuleContext.setVariable`). If any row's `gap` is unresolved,
escalate per the Workflow Convention and reopen D0; do not
silently widen the new surface.

### Source paths (the agent edits / inspects these)

- **VM resolvers to remove or redirect:**
  `packages/core/src/runtime/vm.ts`. The three private methods
  `resolveDirectRuleFuncId` (~line 1665), `resolveFrameRuleFuncId`
  (~line 1672), `resolveCalleeRuleFuncId` (~line 1682), and their
  call sites at lines 327, 788, 843, 1693, 1787-1801, and 1820-1825
  (child-fiber spawn).
- **Frame field (informational; survives D2):**
  `packages/core/src/runtime/vm-types.ts` -- `Frame.ruleFuncId` at
  line 212. Stays as an id; its writer changes from
  `ctx.funcIdToRule?.get(...)` to the new contracted lookup.
- **Core-shipped variable-accessor host functions:**
  `packages/core/src/runtime/context-types.ts` registers
  `BrainContext.getVariable`, `BrainContext.setVariable`,
  `RuleContext.getVariable`, `RuleContext.setVariable`. The two
  `RuleContext.*` functions reach through `ctx.rule?.getVariable`
  / `ctx.rule?.setVariable` and must move to a contracted
  operation per D0 table 1's disposition for those rows.
- **Shim file:** `packages/core/src/runtime/dense-shims.ts`. The
  rule-side of the shim (the implementation that backed the new
  lookup with `funcIdToRule` / `IBrainRule` walks) is deleted in
  this phase.
- **Interface declaration (informational):**
  `packages/core/src/runtime/host-bindings.ts` declares
  `IBrainRule`. The declaration stays; after D2 the only
  `import type` of it under `runtime/` is in this file.
- **Mapping construction (informational; not edited in D2):**
  `packages/core/src/brain/brain.ts` -- `funcIdToRule` field
  (line 187), `collectFuncIdToRuleMapping` (line 734). These
  may continue to exist for non-runtime consumers; the
  _runtime_ simply stops reading them after D2.
  `Brain`'s overall fate is decided in D5.
- **Compiler-side allocation (informational):**
  `packages/core/src/brain/compiler/brain-compiler.ts` --
  `assignFuncIdToRule` (line 243). Per D0 table 6, rule ids are
  compile-time-allocated; the compiler is the source of truth
  for the new lookup.
- **Test fixtures to update:**
  `packages/core/src/runtime/vm.spec.ts` (line 1577 populates
  `funcIdToRule`), `packages/core/src/runtime/tree-shaker.spec.ts`,
  and any other `*.spec.ts` under `packages/core/src/runtime/`
  that constructs `funcIdToRule`.

### Lookup site (pin one)

Per D0 table 6 (rule ids are compile-time-allocated), the
rule-resolution lookup is a `Program` table populated by the
compiler, exposed on `PlatformServices` per D0 table 1's
`move-to-service` disposition for `funcIdToRule`. The agent reads
the exact field name from D0; for review purposes, treat it as
`services.program.getRuleFuncIdForFunc(funcId): number | undefined`.

### Procedure (execute in order; the tree should compile after each step)

1. **Add the new lookup** on `Program` and the
   `PlatformServices` accessor per D0. Name and signature come
   from D0; do not invent.
2. **Compiler populates the new lookup.** In
   `brain-compiler.ts`, the existing `assignFuncIdToRule` walk
   already produces every (`funcId`, `ruleFuncId`) pair; emit
   the same data into the new `Program` field. The legacy
   `funcIdToRule` builder in `Brain.collectFuncIdToRuleMapping`
   stays untouched for now.
3. **Redirect the three vm.ts resolvers.** Replace each
   resolver body (`ctx.funcIdToRule?.has(funcId)`,
   `ctx.funcIdToRule?.get(...)`) with the new lookup. The
   resolvers themselves (`resolveDirectRuleFuncId`,
   `resolveFrameRuleFuncId`, `resolveCalleeRuleFuncId`) can
   remain as private helpers in `vm.ts` or be deleted in favor
   of inline calls; the agent picks the option that does not
   churn unrelated code. Either way, `Frame.ruleFuncId`
   continues to be written from the new lookup.
4. **Delete the rule-side shim** in `dense-shims.ts` -- the
   implementation that satisfied the new lookup by walking
   `funcIdToRule`. The shim file may still hold action-side
   and callsite-side shims for D3 / D4 to remove.
5. **Update test fixtures.** Any `*.spec.ts` under
   `packages/core/src/runtime/` that populates `funcIdToRule`
   on a constructed `ExecutionContext` switches to populating
   the new `Program`-table lookup on the test-local services
   instance instead.
6. **Migrate the core variable-accessor host functions.** In
   `runtime/context-types.ts`, replace the
   `BrainContext.getVariable` / `setVariable` implementations
   with calls to `services.brainVars.getByName(name): Value` /
   `services.brainVars.setByName(name, value): void`, and
   replace `RuleContext.getVariable` / `setVariable` with
   calls to
   `services.ruleVars.getByName(ctx.currentRuleFuncId, name): Value`
   / `services.ruleVars.setByName(ctx.currentRuleFuncId, name, value): void`.
   `RuleContext.getVariable` returns `NIL_VALUE` when
   `currentRuleFuncId` is the no-rule sentinel (`0`);
   `RuleContext.setVariable` is a no-op in that case.
7. **Confirm shim removal.** No file under
   `packages/core/src/runtime/` other than `host-bindings.ts`
   value- or type-imports `IBrainRule` from anywhere except
   the local declaration. Cross-check that the child-fiber
   spawn at vm.ts:1820-1825 no longer assigns `childContext.rule`
   (that field is gone after D1; this is a defense-in-depth
   check).

### Notes (not work items)

- After D2, runtime programs that do not use rule-sensitive
  bytecode or host functions do not require the rule
  lookup -- the `Program` field stays empty and the services
  accessor returns `undefined`. This is a consequence of the
  migration, not a deliverable.
- `Brain.collectFuncIdToRuleMapping` and the legacy
  `funcIdToRule` field are not removed in D2. Whether they
  survive at all is a D5 / `Brain`-fate question.

### Risks

- Nested function calls inside a rule must preserve today's
  rule identity through the new id-based path. Test coverage
  for nested-call rule scope must pass without modification
  beyond fixture updates (step 5).
- The variable-accessor host functions (step 6) are part of
  the language ABI -- a wrong rewrite changes observable
  behavior of compiled `brainVariable.value` accesses.
  Mitigation: D0 disposition for those rows is the source of
  truth; if D0 was ambiguous, escalate.

### Acceptance (validation checklist)

D2 ships only when every item passes:

1. `grep -nE '\bIBrainRule\b' packages/core/src/runtime/`
   returns matches only in `host-bindings.ts` (the
   declaration), and only as `import type` outside that file
   (no value-imports anywhere under `runtime/`).
2. `grep -n 'funcIdToRule' packages/core/src/runtime/`
   returns no matches.
3. `grep -nE 'ctx\.rule\b' packages/core/src/runtime/`
   returns no matches.
4. The new `Program` rule-resolution field exists, is
   populated by the compiler, and is consumed via the
   `PlatformServices` accessor wherever vm.ts previously
   read `ctx.funcIdToRule`.
5. `Frame.ruleFuncId` is still written for every frame that
   today carries a `ruleFuncId`; the writer reads the new
   lookup.
6. `RuleContext.getVariable` and `RuleContext.setVariable` in
   `runtime/context-types.ts` no longer reference `ctx.rule`;
   their new implementations match D0 table 1's disposition.
7. No changes outside the source-paths list above (modulo test
   fixtures called out in step 5 of the procedure).
8. From `packages/core`, all four of
   `npm run typecheck && npm run check && npm test && npm run build`
   pass with the project's zero-noise standard.
9. No behavior changes: rule-aware behavior tests (nested
   calls, child-fiber spawn from inside a rule, sensor /
   actuator rule-scope reads) pass without modification
   beyond the fixture-builder updates in step 5.

## Phase D3 -- Host-Call Callsite-State Migration

**Status update (2026-05-03).** Lifecycle-hooks L1 incidentally
completed the structural half of D3: the `services.callSite`
adapter is the real production owner of host-state storage
(brain-instance-scoped, keyed by `callSiteId`), the legacy
`ActionInstance` helper trio is gone, and
`getCallSiteState<T>(ctx)` / `setCallSiteState(ctx, T)` are now
thin convenience wrappers over `ctx.services.callSite.getHostState`
/ `setHostState` -- they no longer reach for an
`ActionInstance` graph. What's left for D3 is the *consistency*
half: migrate the sim host functions (`bump`, `see`, `move`,
`shoot`, `eat`, `turn`) and the core sensors
(`onPageEntered`, `timeout`) from the convenience helpers to
direct `services.callSite.{get,set}HostState` calls; then delete
the helpers and their re-exports. The procedure below is
annotated with what L1 already did. The lifetime-flip
regression tests live in lifecycle-hooks L1; D3's behavioral
regression tests (synthetic cooldown / consumption / recharge
actuators in `packages/core/src/brain/brain.spec.ts`) remain
the gate for the surface's end-to-end behavior.

**Purpose.** Replace the legacy `callSiteState: Dict<callSiteId,
ActionInstance>` reach-through used by host functions for
per-callsite persistent state (e.g. cooldown timers in
`apps/sim/src/brain/actions/move.ts`) with a contracted dense
per-callsite host-state surface. Removes the D1 shim's
host-state branch and decouples host-side persistent state
from the `ActionInstance` object.

**Scope.** Per-callsite _host_ state for **every** host-bound
call path -- the value read/written by
`getCallSiteState<T>(ctx)` / `setCallSiteState(ctx, T)`.
Three call paths reach this surface today and all three
migrate in D3:

- `HOST_CALL` / `HOST_CALL_ASYNC` -- pure host functions
  (sensors registered via `registerHostSensor`, e.g.
  `bump`, `see`). The legacy helper's fallback branch
  (`getActionInstance(ctx, currentCallSiteId)` inside
  `getCallSiteState`) exists for this path because no
  enclosing action frame populates `currentActionInstance`.
- `ACTION_CALL` host branch -- host-backed actuators
  (registered via `registerHostActuator`, e.g. `move`,
  `shoot`, `eat`). The legacy `getOrCreateActionInstance(ctx,
callSiteId, 0)` calls at `vm.ts:999` and `vm.ts:1055`
  pre-populate `currentActionInstance` for this path so the
  helper's fast path hits.
- `ACTION_CALL_ASYNC` host branch -- async host-backed
  actuators. Same shape as the sync host-action path.

The per-callsite _VM_ state slots
(`ActionInstance.stateSlots` consumed by action bytecode
opcodes) and the action dispatch machinery itself
(`getOrCreateActionInstance`, `resetActionInstance`,
current-action-id binding) are D4's scope and stay shimmed
through D3.

The scalar `ExecutionContext.currentCallSiteId` and the binding
mechanism (`bindExecutionContext` /
`syncExecutionContextFromTopFrame` in `vm.ts`) are _not_
migrated; both are already dense (a `number` and a frame
walk). D3 leaves them untouched and only changes what the host
function reads through them.

**Precondition.** D0 table 2 has resolved every actuator /
sensor host function row that touches `currentCallSiteId` or
`callSiteState`, with each row's `gap` set to `host-rewrite`
(routes through the new contract op) or `contract-add` (new
`PlatformServices` op). If any such row is unresolved or
absent, escalate per the Workflow Convention and reopen D0.

### Source paths (the agent edits / inspects these)

- **Public helpers to retire:**
  `packages/core/src/runtime/context.ts` --
  `getCallSiteState<T>(ctx)` (~line 284) and
  `setCallSiteState(ctx, T)` (~line 295). Their re-exports in
  `packages/core/src/app/index.ts` (line 92) are also retired
  or redirected per D0 table 1's disposition for those
  helpers.
- **Field to retire (legacy storage):**
  `ExecutionContext.callSiteState` at
  `runtime/context.ts:131` and the `CallSiteStateMap` /
  `ActionInstanceMap` aliases (lines 33-44). The field stays
  through D3 because D4's action path still reads it through
  `getActionInstance` / `getOrCreateActionInstance`; D3 only
  removes the _host-state_ branch of its content.
- **Host-state branch in legacy storage:**
  `runtime/context.ts:195-249` (`getActionInstance`,
  `getOrCreateActionInstance`, `resetActionInstance`). The
  `hostState` field of `ActionInstance` is the host-state
  branch; D3 stops writing it and stops reading it. D4 retires
  the rest.
- **Field to retire (legacy current binding):**
  `ExecutionContext.currentActionInstance` at
  `runtime/context.ts:138` -- but only the host-state read
  path through it (`getCallSiteState` reads
  `currentActionInstance.hostState`). The field itself stays
  for D4.
- **Actuator / sensor host functions to migrate (table 2
  row source):** every file under
  `apps/sim/src/brain/actions/` that exports an `exec*`
  callback registered via `createHostActuator` /
  `createHostSensor` and reads `getCallSiteState<T>(ctx)` /
  writes `setCallSiteState(ctx, ...)`. At the inspection
  commit:
  - `actions/move.ts:182, 188` (`MoveState` cooldown);
  - `actions/shoot.ts:63, 66` (`ShootState`);
  - `actions/eat.ts:49, 54` (`EatState`);
  - `actions/see.ts:66, 73, 96, 115, 200` (`SeeState`).
    Cite the table 2 rows for the exact migration shape per
    function.
- **Shim file:** `packages/core/src/runtime/dense-shims.ts`.
  The host-state branch of the shim (the implementation that
  satisfied the new per-callsite host-state lookup by reading
  `ActionInstance.hostState`) is deleted in this phase. The
  action-state-slot branch survives until D4.
- **VM dispatch (informational; not edited in D3):**
  `runtime/vm.ts` -- `bindExecutionContext` (line 1700) and
  `syncExecutionContextFromTopFrame` (line 1706). These
  continue to write `currentCallSiteId` exactly as before; D3
  does not change the binder. The five call sites (vm.ts:905,
  946, 1000, 1056, 1084) and the child-fiber spawn at
  vm.ts:1820-1825 are all unchanged.
- **Tests to update:**
  `packages/core/src/runtime/sensors/sensors.spec.ts:66, 236`
  (build `mkCtx({ currentCallSiteId, callSiteState: ... })`),
  and `packages/core/src/runtime/vm.spec.ts:1214` (asserts
  `ctx.currentCallSiteId`). D3 introduces no sim-side test
  changes; cooldown / consumption-window / recharge behavior
  is exercised by the synthetic actuators added under
  `packages/core/src/brain/brain.spec.ts` (see "New
  regression tests" below). Sim is exercised only via the
  full-gate acceptance line.

### New surface

Per D0 table 1's disposition for `callSiteState` (host-state
branch), the contract for per-callsite host state is a
`PlatformServices` adapter pair:

- `services.callSite.getHostState(callSiteId: number): unknown`,
- `services.callSite.setHostState(callSiteId: number, state: unknown): void`.

The backing store is brain-instance-scoped per the
page-lifecycle-hooks spec and is owned by the adapter
implementation, not the context. The new surface does not
expose `ActionInstance` to host code.

### Procedure (execute in order; the tree should compile after each step)

1. **Add the new surface as additions only.** Per D0, add the
   service op or context slot indexer. The legacy
   `callSiteState` field, `ActionInstance.hostState` branch,
   and `getCallSiteState` / `setCallSiteState` helpers all
   stay in place during steps 2-5.
2. **Wire the dense-shims host-state branch.** In
   `dense-shims.ts`, the new surface delegates to the legacy
   storage: a get reads `actionInstance.hostState`; a set
   creates an `ActionInstance` via `getOrCreateActionInstance`
   if needed and assigns its `hostState`. This is identical to
   what `getCallSiteState` / `setCallSiteState` do today, just
   funneled through the new op.
3. **Migrate every actuator / sensor host function** (one row
   per function in D0 table 2). Each call site replaces
   `getCallSiteState<T>(ctx)` with the new get op and
   `setCallSiteState(ctx, state)` with the new set op,
   reading `ctx.currentCallSiteId` to identify the callsite.
   The behavior is unchanged because the shim still routes
   through `ActionInstance.hostState`.
4. **Stop using `hostState` from the host side.** With every
   callsite migrated, no shipped host function reads or writes
   `ActionInstance.hostState`. Verify by grep
   (`grep -nE 'hostState|getCallSiteState|setCallSiteState'`
   under `apps/sim/` and `packages/core/src/runtime/` --
   matches only in the legacy implementation files at this
   point).
5. **Delete the legacy host-state surface.** Remove
   `getCallSiteState` and `setCallSiteState` from
   `runtime/context.ts` and the re-exports in
   `app/index.ts`. Remove the `hostState` field from
   `ActionInstance` (and any `existingHostState` carry-over
   in `resetActionInstance`).
6. **Delete the host-state branch of the shim.** In
   `dense-shims.ts`, remove the get/set delegation that read
   from / wrote to `ActionInstance.hostState`. The new
   surface's implementation lives in the `services.callSite`
   adapter module under `runtime/`. The shim file may still
   hold the rule-side branch (already gone in D2) and the
   action-side branch (still present until D4).
7. **Update test fixtures.** `sensors.spec.ts:66, 236` and
   `vm.spec.ts:1214` switch from constructing
   `callSiteState: new Dict<number, unknown>()` to
   constructing a test-local `services.callSite` adapter that
   holds host state for the asserted call sites. The
   `currentCallSiteId` assignment is unchanged. The new
   regression tests below exercise cooldown-style behavior
   end-to-end through the new surface; no sim-side test
   sweeps are required.

### Notes (not work items)

- `ExecutionContext.currentCallSiteId` is unchanged. It is
  already a scalar `number`; nothing about D3 alters how it is
  bound or restored.
- The action `stateSlots` half of `ActionInstance` (used by
  `LOAD_ACTION_VAR` / `STORE_ACTION_VAR` opcodes) is
  untouched. D4 owns it.
- After D3, the only consumer of `ActionInstance.hostState`
  was the deleted helper pair, so removing the field cannot
  affect bytecode behavior.

### New regression tests

Lifetime-flip behavior is covered by the page-lifecycle-hooks
spec's L1 phase (`/memories/repo/vm-lifecycle-L1.md` once L1
ships, plus the L1 "New regression tests" list inside that
spec). The tests below are D3-specific: they pin the
`services.callSite` adapter's wiring and the carry-over of
cooldown semantics across page round-trips through synthetic
host actuators that mirror the shapes of `move`, `eat`, and
`shoot` without depending on sim.

All new D3 tests live under `packages/core/src/runtime/` and
`packages/core/src/brain/`:

1. **`services.callSite.getHostState` / `setHostState` round-trip
   (unit).** File:
   `packages/core/src/runtime/dense-shims.spec.ts`. Construct
   the dense-shims adapter, call `setHostState(7, { foo: 1
})`, assert `getHostState(7)` returns the same object
   reference. Call `getHostState(8)` returns `undefined`.
2. **Distinct `callSiteId`s do not alias (unit).** Same file.
   Set host state on callsite 7 and 8 independently; assert
   each `getHostState` returns the correct payload.
3. **`services.callSite` host-state survives a page round-trip
   (brain-level).** File:
   `packages/core/src/brain/brain.spec.ts`. Build a brain with
   one host actuator that, on first `exec`, writes
   `setHostState(ctx.currentCallSiteId, { tick: ctx.time })`
   and on every subsequent `exec` reads that value back. Tick
   the brain, capture the written tick, switch pages and back,
   tick again, assert the actuator observes the originally
   written tick. Inverts under the lifetime-flip assumption:
   no `onPageExited` clearing means the host cell carries.
4. **Child-fiber sees parent's host-state map (brain-level).**
   Same file. Build a brain with an async host actuator that
   spawns a child fiber via `HOST_CALL_ASYNC`; both parent and
   child write to and read from the same
   `currentCallSiteId`'s host state. Assert the child reads
   what the parent wrote and vice versa within the same tick.
   This pins the "adapter map is shared across the cloned
   `ExecutionContext`" guarantee called out in the Risks
   block.
5. **Synthetic cooldown actuator survives page round-trip
   (brain-level).** File:
   `packages/core/src/brain/brain.spec.ts`. Register a
   synthetic host actuator whose `exec` reads
   `getHostState(ctx.currentCallSiteId)` as
   `{ readyAt: number } | undefined`, refuses to act when
   `ctx.time < state.readyAt`, and on success writes
   `setHostState(ctx.currentCallSiteId, { readyAt: ctx.time +
COOLDOWN })`. This shape mirrors `move`'s cooldown
   without depending on sim. Drive the brain so the actuator
   fires and sets `readyAt`; switch pages and back; tick
   again at a `time` value still inside the cooldown window;
   assert the actuator declines to act (proving the
   host-state `readyAt` carried across the round-trip).
6. **Synthetic consumption-window actuator survives page
   round-trip (brain-level).** Same file. Register a
   synthetic actuator whose host state is
   `{ remainingUses: number }` initialized on first exec to
   3 and decremented each subsequent exec; the actuator
   refuses to act when `remainingUses === 0`. Mirrors
   `eat`'s consumption window. Tick to consume two uses,
   round-trip the page, tick again, assert
   `remainingUses === 0` after one more exec (proving the
   counter carried).
7. **Synthetic recharge actuator survives page round-trip
   (brain-level).** Same file. Register a synthetic
   actuator whose host state is
   `{ chargeLevel: number; lastFireTime: number }` and that
   recharges based on `ctx.time - state.lastFireTime`.
   Mirrors `shoot`'s recharge. Fire once, round-trip the
   page advancing `ctx.time` by less than the full recharge
   interval, fire again, assert `chargeLevel` reflects the
   round-trip elapsed time (proving both `lastFireTime` and
   `chargeLevel` carried).

Tests #5, #6, #7 may be combined into a single
`callsite-host-state-lifetime.spec.ts` under
`packages/core/src/brain/` if it reads more cleanly as a
single fixture sweep over the three synthetic shapes; the
spec requires the assertions to exist, not the file layout.
Keeping these tests in core (rather than sim) means the
lifetime contract is exercised by the layer that owns it
and does not require sim to be in a working state for the
dense-state plan to ship.

### Risks

- **Mid-flight type leak.** Between steps 3 and 5 the new
  surface and the old helpers coexist. If any host function
  is missed in step 3, it continues to read the legacy
  storage, the shim keeps it working, and the leak is
  invisible until step 4's grep. Mitigation: step 4 is a
  hard gate, not a smoke check; the grep must return zero
  matches in `apps/` before step 5.
- **Host-state lifetime is brain-instance-scoped.** Per the
  page-lifecycle-hooks spec, the `services.callSite` host-state
  map is allocated once per `(brainInstance, callSiteId)` and
  survives until `Brain.shutdown()` or an explicit
  `clearHostState(callSiteId)`. This is broader than today's
  `resetActionInstance` carry-over (which preserved
  `existingHostState` only across slot resets within a single
  page activation): host state now also survives full page
  round-trips. Cooldown-sensitive behavior tests for
  `move`, `eat`, and `shoot` exercise this guarantee.
- **Child-fiber visibility.** The child fiber spawned at
  `vm.ts:1820-1825` inherits the parent's
  `currentCallSiteId` and `currentActionInstance`. Because
  the new host-state storage lives in the
  `services.callSite` adapter (brain-instance-scoped, not
  per-fiber), child fibers transparently see the same map as
  the parent.

### Acceptance (validation checklist)

D3 ships only when every item passes:

1. `grep -nE '\\b(getCallSiteState|setCallSiteState)\\b'`
   over the workspace returns no matches in `apps/`,
   `packages/core/src/runtime/`, or `packages/core/src/app/`
   (the helpers and their re-exports are gone).
2. `grep -nE '\\bhostState\\b' packages/core/src/runtime/`
   returns no matches.
3. `grep -nE 'callSiteState' packages/core/src/runtime/`
   returns matches only in the action-side legacy code path
   that D4 will retire (i.e. inside `getActionInstance` /
   `getOrCreateActionInstance` / `resetActionInstance` if
   still present, and any internal map). The host-state
   branch is gone.
4. The new per-callsite host-state surface
   (`services.callSite.getHostState` / `setHostState`) exists,
   is wired to a real backing store, and is consumed by every
   shipped actuator / sensor host function listed in D0
   table 2.
5. `runtime/vm.ts` is unchanged in this phase
   (`git diff packages/core/src/runtime/vm.ts` empty for D3).
6. The dense-shims.ts host-state branch is gone; the file
   still contains the action-state-slot branch (D4 removes
   that).
7. From `packages/core`, all four of
   `npm run typecheck && npm run check && npm test && npm run build`
   pass with the project's zero-noise standard.
8. From `apps/sim`, `npm run typecheck && npm run check &&
npm test && npm run build` pass.
9. No behavior changes: the synthetic cooldown / consumption /
   recharge actuators added under "New regression tests"
   exercise the host-state surface end-to-end and pass without
   modification beyond the surface rename in step 7's fixture
   sweep. Any test that constructs `currentCallSiteId` plus
   per-callsite state still exercises the same logical
   scenarios.

## Phase D4 -- Action State Slots Migration

**Status update (2026-05-03; revised).** Lifecycle-hooks L1
incidentally completed most of D4's *contract-surface* work: the
`services.action` adapter trio
(`ensureCallsite(callSiteId): boolean` -- no `numStateSlots`
parameter, slot list grows on demand via `setStateSlot`;
`getStateSlot`; `setStateSlot`) is the production owner of the
contract; `services.action.resetCallsite` and the dense-shims
`reset()` teardown exist; `Brain.activatePage` calls
`ensureCallsite` and drives `initializerFuncId` from the
`boolean` return; the `getOrCreateActionInstance` /
`resetActionInstance` / `isActionInstance` legacy helpers are
deleted; `vm.ts` no longer imports or calls those helpers and no
longer calls `ensureCallsite` (Brain is the sole caller); the
`ExecutionContext.currentActionInstance` field is deleted along
with all writers; activation-hook signatures already drop the
`ActionInstance` parameter.

What L1 did NOT do, and what D4 must finish: the storage itself
is still hidden inside a closure in `runtime/dense-shims.ts`, a
file whose name implies "temporary bridge" and whose factory
function owns brain-instance-scoped state. That is the same
shape (services adapter doubling as state owner) the dense plan
exists to dissolve at the contract surface; tolerating it on the
implementation side recreates the original sin in miniature and
breaks the symmetry established by D2 (rule storage owned at
rule-instance scope) and D3 (host-state delegation already
removed from the legacy graph). It also leaves D5 (Brain
runtime/compile split) with a closure to re-plumb instead of a
field to move.

D4 finishes the migration by relocating storage to its proper
home (a dedicated `runtime/callsite-store.ts` module that Brain
holds), reducing the renamed services factory to a stateless
projection, retiring the now-internal `ActionInstance` record
type from the public `runtime/context.ts` surface, and adding
the D4-specific regression tests for vm-level dispatch wiring.

**Purpose.** Replace the `ActionInstance` object graph backing
bytecode action state slots with a contracted dense per-callsite
state-slot surface, relocate the storage to a dedicated
brain-instance-scoped owner (`runtime/callsite-store.ts`), and
reduce the `PlatformServices` action / callSite adapters to
pure projections.

**Scope.** All `ACTION_CALL` and `ACTION_CALL_ASYNC` state-slot
machinery -- both sync and async -- and the page-activation reset
that initializes those slots. The async path's _fiber and handle
wiring_ (child fiber spawn, handle creation, scheduler entry) is
D6's scope and is untouched here. The state-slot allocation /
lookup is identical sync vs async, so splitting it across phases
would leave a stub call site that helps no one.

The scalar `ExecutionContext.currentCallSiteId` and the binder
(`bindExecutionContext` / `syncExecutionContextFromTopFrame`) are
unchanged: D4 removes only the _action-instance_ arm of those
helpers (per Finding 3 below, that arm writes a field nobody
reads after D3).

**Precondition.** D0 has resolved every action-side row with a
pinned `gap`:

- table 1 row for `ExecutionContext.currentActionInstance`
  (expected: retired -- dead state after D3);
- table 1 row for `ExecutionContext.callSiteState` (expected:
  retired now that D3 removed the host-state branch and D4
  removes the action-state branch);
- table 5 row for `ActionInstance` (expected: retired in favor
  of a dense state-slot store);
- table 6 row for the new per-callsite state-slot surface
  (expected: `services.action` adapter trio, with
  brain-instance-scoped lifetime per the page-lifecycle-hooks
  spec; `ensureCallsite` is allocate-on-first-call, no-op
  afterward; explicit reset via
  `services.action.resetCallsite`).

If any row is unresolved, escalate per the Workflow Convention
and reopen D0.

### Source paths (the agent edits / inspects these)

- **Action-instance object graph to retire:**
  `packages/core/src/runtime/context.ts` --
  - `ActionInstance` interface (~line 36);
  - `ActionInstanceMap` and `CallSiteStateMap` type aliases
    (~lines 41-44);
  - `isActionInstance` predicate (~line 184);
  - `getActionInstance` (~line 193),
    `getOrCreateActionInstance` (~line 213),
    `resetActionInstance` (~line 235);
  - `ExecutionContext.callSiteState` field (~line 131) -- the
    legacy backing storage;
  - `ExecutionContext.currentActionInstance` field (~line 138)
    -- dead after D3 (no reader; see Finding 3 in the D4
    review).
    All of these are deleted by the end of D4.
- **VM dispatch to update:** `packages/core/src/runtime/vm.ts`.
  - Value-import of `getOrCreateActionInstance` at line 12 --
    deleted.
  - `execActionCall` (~line 978): host branch
    `getOrCreateActionInstance(..., 0)` at line 999 -- deleted
    outright (host actions need no per-callsite state slots);
    bytecode branch routes through
    `enterBytecodeActionFrame`.
  - `execActionCallAsync` (~line 1022): host branch
    `getOrCreateActionInstance(..., 0)` at line 1055 --
    deleted; bytecode branch routes through
    `spawnBytecodeActionFiber`.
  - `bindExecutionContext` (~line 1700) and
    `syncExecutionContextFromTopFrame` (~line 1706):
    `currentActionInstance` writes (lines 1702, 1710, 1717)
    deleted; `currentCallSiteId` and `rule` writes unchanged.
  - `getCurrentActionInstance` (~line 1731) and
    `getCurrentActionStateSlots` (~line 1735): the latter
    becomes the only consumer, and resolves the state-slot
    list through the new surface keyed by the current frame's
    `actionBinding.callSiteId` (the frame walk in
    `getCurrentActionBinding` at line 1721 stays -- it
    identifies the _callsite_, not the instance).
  - `enterBytecodeActionFrame` (~line 1768):
    `getOrCreateActionInstance(..., action.numStateSlots)` at
    line 1786 replaced with the new surface's "ensure
    callsite has N state slots" op; the
    `frame.actionBinding.actionInstance` field is deleted (the
    binding only needs `callSiteId`, `actionKey`, `isAsync`).
    Line 1793 (`currentActionInstance` write) deleted.
  - `spawnBytecodeActionFiber` (~line 1812): same shape -- the
    `getOrCreateActionInstance` call at line 1819 replaced
    with the ensure-slots op against the child context;
    line 1824 (`currentActionInstance` write) deleted.
  - `Frame.actionBinding.actionInstance` (declared in
    `runtime/vm-types.ts` -- agent confirms field name on read)
    is removed; producers updated to omit it.
- **Page-activation orchestrator to update:**
  `packages/core/src/brain/brain.ts`.
  - Value-import of `resetActionInstance` (search for the
    import line) -- deleted.
  - `Brain.activatePage` (~line 517 onward, `resetActionInstance`
    call at line 536): each iteration replaces
    `resetActionInstance(ctx, callSiteId, numStateSlots)` with
    the new surface's "reset (or initialize) callsite to N
    state slots" op. The returned `actionInstance` parameter
    threaded into `runHostActivationHook` /
    `runBytecodeActivationHook` is removed -- those hooks
    consume `callSiteId` only (agent verifies on read; if a
    hook genuinely needs slot access it goes through the new
    surface, not an `ActionInstance` reference).
  - `currentActionInstance` clears at the end of `activatePage`
    (~line 554) and inside `deactivateCurrentPage` (~line 596)
    are deleted alongside the field.
- **Activation-hook signatures:**
  `runHostActivationHook` and `runBytecodeActivationHook`
  inside `brain/brain.ts` (search by name). Their signatures
  drop the `ActionInstance` parameter; bodies that read
  `actionInstance.stateSlots` route through the new surface.
- **Shim file:** `packages/core/src/runtime/dense-shims.ts`.
  The action-state-slot branch is the only branch left after
  D3 (D2 removed the rule branch). With D4, the implementation
  of the new state-slot surface stops delegating to
  `getOrCreateActionInstance` + `ActionInstance.stateSlots`
  and binds to whatever real backing D0 table 6 pinned. The
  shim file is deleted entirely if its real owner is the
  context (the indexer's storage is initialized in
  `Brain.activationContext` directly); if the owner is a
  `PlatformServices` adapter, the shim file is replaced by a
  real adapter module under `runtime/`.
- **Tests to update:**
  - `packages/core/src/runtime/vm.spec.ts` -- searches for
    `currentActionInstance`, `ActionInstance`,
    `getOrCreateActionInstance`, and any fixture that
    constructs `callSiteState`. Each updates to construct the
    new surface's backing.
  - `packages/core/src/runtime/sensors/sensors.spec.ts` -- D3
    already migrated `callSiteState` consumers; this phase
    drops `ActionInstance` construction sites if any remain.
  - D4 introduces no sim-side test changes. Existing sim
    tests that happened to grep-match `currentActionInstance`
    or `ActionInstance` (if any -- expected: zero, since
    those are core-internal types) are inspected by the
    grep gate in acceptance #1-#3 against `packages/core`,
    not by a sweep into `apps/sim`.

### New surface

Per D0 table 6 (and table 1's disposition for `callSiteState`),
the contract for per-callsite bytecode action state slots is a
`PlatformServices` adapter trio:

- `services.action.ensureCallsite(callSiteId: number): boolean`,
- `services.action.getStateSlot(callSiteId: number, slotIdx: number): Value`,
- `services.action.setStateSlot(callSiteId: number, slotIdx: number, v: Value): void`.

The surface:

- does not expose `ActionInstance`;
- `ensureCallsite` is brain-instance-scoped per the
  page-lifecycle-hooks spec: it allocates the slot list on
  first call for a `callSiteId` and is a no-op on
  subsequent calls. Returns `boolean` (`true` if newly
  allocated, `false` otherwise) so the brain orchestrator
  can drive `initializerFuncId`. (Already shipped by L1; the
  slot list is allocated empty and grows on demand via
  `setStateSlot`; `numStateSlots` from `BytecodeExecutableAction`
  is no longer read by the runtime services);
- explicit reset is via
  `services.action.resetCallsite(callSiteId)` (already
  shipped by L1): deallocates the slot list; the next
  `ensureCallsite` returns `true` and Brain's initializer
  driver re-runs `initializerFuncId`.

Per Finding 3 of the D4 review, the host-action callsite's
"current action instance" binding is dead. There is no
host-action half of this surface -- host actions read no
per-callsite state-slot store and do not call `ensure`.

Per Finding 10 of the D4 review, activation-hook dispatch
(`runHostActivationHook` / `runBytecodeActivationHook`)
stays in the Brain orchestrator. D4 only removes the
`ActionInstance` parameter from their signatures; D5 may
relocate them as part of pinning Brain's fate.

### Procedure (execute in order; the tree should compile after each step)

1. **Add the contract surface.** Per D0 table 6, the
   `services.action` adapter trio
   (`ensureCallsite(callSiteId): boolean` / `getStateSlot` /
   `setStateSlot`) plus `resetCallsite` and the
   `services.callSite` host-state pair are the dense
   contract. *(Already shipped by lifecycle-hooks L1.)*
2. **(legacy delegation step from the original D1-D4
   trajectory).** *(Already shipped by lifecycle-hooks L1;
   no legacy `ActionInstance` graph remains to delegate
   to.)*
3. **Migrate vm.ts state-slot reads/writes.**
   `getCurrentActionStateSlots` resolves the slot list
   through the contract surface keyed by the current
   frame's `actionBinding.callSiteId`; the legacy
   `fiber.callsiteVars` fallback for non-action frames is
   unchanged. *(Already shipped by lifecycle-hooks L1.)*
4. **Migrate vm.ts ensure-slots calls.** All legacy
   `getOrCreateActionInstance(...)` call sites in vm.ts
   are removed; `frame.actionBinding.actionInstance` is
   gone. *(Already shipped by lifecycle-hooks L1; vm.ts
   no longer calls `ensureCallsite` -- Brain is the sole
   caller.)*
5. **Migrate vm.ts host-action call sites.** The legacy
   `getOrCreateActionInstance(ctx, callSiteId, 0)` calls
   for the host `ACTION_CALL` / `ACTION_CALL_ASYNC`
   branches are gone; per-callsite host state for those
   branches flows through the D3 surface keyed by
   `ctx.currentCallSiteId`. *(Already shipped by
   lifecycle-hooks L1.)*
6. **Brain drives lifecycle.** `Brain.activatePage` calls
   `services.action.ensureCallsite(callSiteId)` per
   callsite and dispatches `initializerFuncId` when the
   call returns `true`; `runHostActivationHook` /
   `runBytecodeActivationHook` take `callSiteId` only.
   *(Already shipped by lifecycle-hooks L1.)*
7. **Retire `currentActionInstance`.** The field
   declaration on `ExecutionContext` and every writer in
   vm.ts and brain.ts are deleted. *(Already shipped by
   lifecycle-hooks L1.)*
8. **Extract the storage owner.** Create
   `packages/core/src/runtime/callsite-store.ts` exporting
   `ICallSiteStore` (interface) and `createCallSiteStore()`
   (factory). The store owns the `Dict<callSiteId,
ActionInstance>` plus the slot-pad helper currently
   declared inside `dense-shims.ts`. Move the
   `ActionInstance` record type inline into
   `callsite-store.ts` (it stops being a public
   `runtime/context.ts` symbol). The store's surface is:
   `ensureCallsite(callSiteId): boolean`,
   `resetCallsite(callSiteId): void`,
   `getStateSlot(callSiteId, slotIdx): Value`,
   `setStateSlot(callSiteId, slotIdx, v): void`,
   `getHostState(callSiteId): unknown`,
   `setHostState(callSiteId, v: unknown): void`,
   `clearHostState(callSiteId): void`,
   `clearAll(): void`. The store is purely a storage
   primitive -- no knowledge of `Brain`, no knowledge of
   `PlatformServices`.
9. **Brain owns the store.** Add a
   `callSiteStore: ICallSiteStore` field on `Brain`,
   constructed in the constructor alongside
   `brainVarStore`. Replace the current
   `denseShims.reset()` call in `Brain.shutdown` with
   `this.callSiteStore.clearAll()`. Brain's `shutdown`
   teardown sequence is now: `deactivateCurrentPage()`
   (fires exit hooks), then `callSiteStore.clearAll()`.
10. **Rename and reduce the services factory.** Rename
    `runtime/dense-shims.ts` -> `runtime/runtime-services.ts`,
    `createDenseShims` -> `createRuntimeServices`,
    `IDenseShims` -> `IRuntimeServices`. Drop the
    `IRuntimeServices.reset()` method (teardown is on
    `ICallSiteStore`, not on the services aggregate). The
    factory's signature becomes
    `createRuntimeServices(brain: IBrain, ruleLookup:
RuleByFuncIdLookup, callSiteStore: ICallSiteStore):
IRuntimeServices`. Inside the factory, every
    `services.action.*` and `services.callSite.*` method is
    a one-line forwarder to the corresponding
    `callSiteStore` method. The factory declares no
    `Dict` / `List` / mutable state of its own.
11. **Sweep tests.** Update `dense-shims.spec.ts` ->
    `runtime-services.spec.ts`; tests that previously
    constructed via `createDenseShims(stubBrain, ruleLookup)`
    now construct via `createRuntimeServices(stubBrain,
ruleLookup, createCallSiteStore())`. Add
    `callsite-store.spec.ts` covering the storage
    primitive in isolation (allocate/get/set/reset/
    clear-host-state/clear-all). Update any other fixture
    that still constructs `callSiteState`-shaped records.
    D4 introduces no sim-side test changes.

### Notes (not work items)

- `currentCallSiteId` is unchanged. The frame walk in
  `getCurrentActionBinding` is unchanged. The only thing
  retired from the binder is the dead `currentActionInstance`
  arm.
- `fiber.callsiteVars` (the fallback inside
  `getCurrentActionStateSlots`) is the rule-frame variable
  store, not action state. It is unrelated to D4 and is
  unchanged.
- D6 picks up the async-fiber wiring (child fiber spawn,
  handle creation, scheduler entry) without touching the
  state-slot surface this phase pins.

### New regression tests

Lifetime-flip behavior (state slot survives page round-trip;
`initializerFuncId` runs once; `resetCallsite` zeros the slot
list; `Brain.shutdown` re-runs initializer) is covered by the
page-lifecycle-hooks spec's L1 phase. The tests below are
D4-specific: they pin the `services.action` adapter's surface
shape and the dispatch wiring through `LOAD_CALLSITE_VAR` /
`STORE_CALLSITE_VAR`.

1. **`services.action.ensureCallsite` first-touch
   detection (unit).** File:
   `packages/core/src/runtime/runtime-services.spec.ts` (the
   adapter-module successor of `dense-shims.spec.ts` after
   step 10). Call `ensureCallsite(5)` once and assert it
   returns `true`; call it again and assert it returns
   `false`. The slot list is allocated empty -- per the L1
   contract, slots grow on demand via `setStateSlot`, so
   `getStateSlot(5, 0)` returns NIL on a freshly-ensured
   callsite without having written any slot.
2. **`services.action.setStateSlot` / `getStateSlot`
   round-trip (unit).** Same file. Set slot 1 to a `Value`,
   read it back, assert equality. Set slot 2 to a different
   value; assert slot 1 is unchanged.
3. **Distinct `callSiteId`s do not alias (unit).** Same
   file. `ensureCallsite(5)` and `ensureCallsite(6)`; write
   distinct values into slot 0 of each; assert each returns
   the correct value.
4. **Frame-walk dispatch: `LOAD_CALLSITE_VAR` /
   `STORE_CALLSITE_VAR` route through the new surface
   (vm-level).** File: `packages/core/src/runtime/vm.spec.ts`.
   Construct a `BytecodeExecutableAction` with
   `numStateSlots = 2`; emit a function that does
   `STORE_CALLSITE_VAR 0, <value>` then
   `LOAD_CALLSITE_VAR 0`; assert the loaded value equals
   what was stored, and assert the value is observable via
   `services.action.getStateSlot(callSiteId, 0)` from
   outside the VM.
5. **Child-fiber sees parent's slot store (vm-level).** Same
   file. Spawn a bytecode child via
   `spawnBytecodeActionFiber`; have parent write slot 0,
   child read slot 0; assert the child reads what the
   parent wrote. Pins the "adapter map is shared across the
   cloned `ExecutionContext`" guarantee called out in the
   Risks block.
6. **`Frame.actionBinding.actionInstance` deletion does not
   break frame-walk dispatch (vm-level).** Same file. After
   step 4 deletes the field, run a bytecode action that
   does `LOAD_CALLSITE_VAR` from a deeply-nested frame;
   assert `getCurrentActionStateSlots` resolves to the
   correct callsite via `getCurrentActionBinding`'s
   `callSiteId`.

### Risks

- **Lifetime semantics are brain-instance-scoped, not
  page-activation-scoped.** Per the page-lifecycle-hooks
  spec, `services.action.ensureCallsite` allocates the slot
  list on first call for a `callSiteId` and is a no-op on
  subsequent calls; the slot list survives page round-trips
  until `services.action.resetCallsite` or `Brain.shutdown`.
  Any D4 code path that assumed per-page-activation reset
  is wrong; the regression tests in the lifecycle-hooks
  spec's L1 are the gate.
- **Child-fiber visibility.** `spawnBytecodeActionFiber`
  shallow-clones the parent's `ExecutionContext`. The
  `services.action` adapter's slot store is owned by the
  adapter (one map keyed by `callSiteId`,
  brain-instance-scoped), not the context, so child fibers
  and parents see the same store.
- **Activation-hook parameter churn.** Removing
  `ActionInstance` from `runHostActivationHook` /
  `runBytecodeActivationHook` is a signature change inside
  `Brain`. Any code outside Brain that calls these
  (unlikely; they are private) must update. Mitigation:
  step 6's grep before deletion.
- **`Frame.actionBinding.actionInstance` field
  consumers.** The frame-walk helper
  `getCurrentActionInstance` is the only reader; verify by
  grep. Mitigation: step 4's deletion is paired with a grep
  check.

### Acceptance (validation checklist)

D4 ships only when every item passes:

1. `grep -nE '\\bActionInstance\\b' packages/core/src/runtime/`
   returns no value-import matches anywhere; type-only
   matches allowed only inside the deleted-legacy block (i.e.
   ideally zero matches).
2. `grep -nE '\\b(getActionInstance|getOrCreateActionInstance|resetActionInstance)\\b'`
   over the workspace returns zero matches outside test
   archives or generated docs.
3. `grep -nE '\\bcurrentActionInstance\\b' packages/core/src/`
   returns zero matches.
4. `grep -nE '\\bcallSiteState\\b' packages/core/src/`
   returns zero matches (D3 retired host-state consumers; D4
   retires the field itself).
5. `grep -n 'getOrCreateActionInstance' packages/core/src/runtime/vm.ts`
   returns zero matches; the value-import at line 12 is gone.
6. The new per-callsite state-slot surface
   (`services.action.ensureCallsite` / `getStateSlot` /
   `setStateSlot` per D0 table 6) is wired to a real backing
   store, exercised by `LOAD_CALLSITE_VAR` /
   `STORE_CALLSITE_VAR` and by `Brain.activatePage`.
7. The `runtime/dense-shims.ts` file has been renamed to
   `runtime/runtime-services.ts`. After D4, no production
   module exports a symbol named `createDenseShims` /
   `IDenseShims`; `grep -nE 'dense-shim|DenseShims'
packages/core/src/` returns zero matches. The renamed
   factory declares no `Dict` / `List` / mutable state of
   its own; every method body is a one-line forwarder.
   `runtime/callsite-store.ts` is the sole owner of the
   `actionInstances` storage, and `Brain` holds a
   `callSiteStore: ICallSiteStore` field whose `clearAll()`
   is invoked from `Brain.shutdown`.
8. From `packages/core`, all four of
   `npm run typecheck && npm run check && npm test && npm run build`
   pass with the project's zero-noise standard.
9. From `apps/sim`, all four gates pass.
10. No behavior changes vs the post-lifecycle-hooks-spec
    baseline: bytecode action programs (any sim example
    using `for ... in` loops over actuators with state,
    plus the existing
    `apps/sim/src/examples/Detect/detect.ts` and
    `apps/sim/src/examples/Teleport/teleport.ts` probes)
    produce identical output traces before and after D4.
    Action state slots survive page round-trips per the
    lifecycle-hooks spec; D4 introduces no new lifetime
    behavior beyond what L1 already pinned.

## Phase D5 -- Lock In The Brain<->Scheduler Surface; Cleanup Tail

**Purpose.** D5 is a **lock-in / cleanup phase**, not a migration.
After D2-D4 land, `runtime/FiberScheduler` already holds only
ids, `runtime/vm.ts` no longer reads from any retired
authoring-shape field, and `Brain`'s activation-hook helpers
have already shed the `previousRule` / `previousActionInstance`
save-restore pairs and the `rule: undefined` /
`actionBinding.actionInstance` literal fields. D5 verifies those
properties hold, sweeps the residual dead Brain-side state that
D2's runtime-side retirement orphaned, and pins
`activeRuleFiberIds` as the canonical Brain<->scheduler
interface so a future code-split (Brain-runtime / Brain-compiler)
can lift the runtime concerns out mechanically.

**Reality vs. original D5 plan.** When this phase was first
drafted, D5's "cleanup tail" enumerated five items it expected
to find on the Brain side. As of D5's start, four of those have
already been done as fall-out from D2 / D3 / D4:

- `runHostActivationHook` already saves and restores only
  `currentCallSiteId` + `currentRuleFuncId`; there is no
  `previousRule` / `previousActionInstance` pair to delete and
  no `actionInstance` parameter on the helper.
- `runBytecodeActivationHook` (via the shared `runBytecodeHook`
  helper) already builds its hook context with only
  `currentCallSiteId` + `currentRuleFuncId: undefined` and its
  `actionBinding` literal with only
  `{ actionKey, callSiteId, isAsync: false }`. There is no
  `rule: undefined` field and no `actionInstance` field to
  delete.
- `getCallSiteState` / `setCallSiteState` are not "stale dead
  imports inside `brain/`": they survived D3 as the contracted
  host-state public API exported from `runtime/context.ts` and
  are used (correctly) by tests in `brain/brain.spec.ts`. They
  are not D5 sweep targets.
- `getOrCreateActionInstance` / `resetActionInstance` /
  `currentActionInstance` were retired entirely from the tree
  by D4; no surviving import exists anywhere under `brain/`.

The one residual item is `Brain.funcIdToRule` + its
`collectFuncIdToRuleMapping` helper. The D2 retirement of
`ctx.rule` and `services.ruleVars`'s ancestor walk removed every
consumer of `funcIdToRule`, but the Brain-side builder still
runs in `initialize()` and still pulls in `IBrainRule` as a
type-only import to type the dictionary. D5 deletes both.

**Scope.** Brain-side deletion of `funcIdToRule` and
`collectFuncIdToRuleMapping`; addition of field-level JSDoc to
`Brain.activeRuleFiberIds` pinning it as the canonical
Brain<->scheduler interface; verification greps that freeze
the runtime side's id-only properties. No structural code move
(the BrainRuntime / BrainCompiler split is the subject of a
follow-on plan; see Out of Scope at the top of this spec). No
edits to `runtime/`.

**Brain-fate disposition.** D0 table 5's `Brain` row must record
**survives as a thin id-only orchestrator** (not "retires"). The
disposition is justified by the eight Brain concerns audit:

1. authoring graph holder (`brainDef`, `pages`),
2. compile/link/treeshake pipeline (`initialize()`),
3. variable storage owner (`variables`, `varSlotByName`,
   `getVariable*` / `setVariable*` / `installVariableTable` /
   `clearVariables`),
4. VM + `FiberScheduler` ownership,
5. `ExecutionContext` construction (the recipe handed to the
   runtime),
6. page lifecycle FSM (`think`, `activatePage`,
   `deactivateCurrentPage`, `cancelActiveFibers`, `thinkPage`,
   `requestPageChange*`, `requestPageRestart`, `startup`,
   `shutdown`, `activeRuleFiberIds`),
7. activation-hook driver (`runHostActivationHook`,
   `runBytecodeActivationHook`),
8. page lookup tables (`pageIdToIndex`, `pageNameToIndex`).

Concerns 6 and 7 have no second owner anywhere in the system.
"Retire" Brain would require inventing a "page-activation
service" whole-cloth, which is a behavior-shape change disguised
as a phase. Concerns 1, 2, 3, 4, 5, 8 are either compile-time or
own-the-runtime-structures responsibilities that have no other
home either. The "survives" disposition is the only credible
option.

If D0 table 5's `Brain` row is set to "retires" instead, escalate
per the Workflow Convention -- the dense plan is not the right
vehicle for that change.

**Precondition.** D2 / D3 / D4 ship and pass their acceptance.
The greps in **G1** and **G2** below pass at D5's start. D0
table 5's `Brain` row reads "survives as id-only orchestrator."

### Source paths (the agent edits / inspects these)

- **Pinned scheduler surface (informational; not edited):**
  `packages/core/src/runtime/vm.ts` --
  - `FiberScheduler` class declaration (`export class
FiberScheduler implements IFiberScheduler`) and its method
    surface (`spawn(funcId, args, executionContext)`,
    `addFiber(fiber)`, `removeFiber(fiberId)`,
    `getFiber(fiberId)`, `enqueueRunnable(fiberId)`,
    `cancel(fiberId)`, `tick()`, `gc()`, `getStats()`,
    `onHandleCompleted(handleId)`).
  - `SchedulerConfig` interface and `DEFAULT_SCHEDULER_CONFIG`
    constant. D5 does not modify any of this; the gates below
    pin the surface.
- **`IFiberScheduler` interface (informational; not edited):**
  `packages/core/src/runtime/vm-types.ts` -- the
  `IFiberScheduler extends Scheduler` declaration.
- **Brain<->scheduler interface (pinned this phase):**
  `packages/core/src/brain/brain.ts` --
  - `activeRuleFiberIds: List<{ funcId: number; fiberId:
number | undefined }>` field. **The** Brain<->scheduler
    interface object; D5 adds field-level JSDoc.
  - `this.scheduler.spawn(...)` call sites (in `activatePage`
    and in `thinkPage`), `this.scheduler.cancel(entry.fiberId)`
    in `cancelActiveFibers`, `this.scheduler.tick()` and
    `this.scheduler.gc()` in `thinkPage`,
    `this.scheduler.getFiber(fiberId)` in
    `shouldRespawnFiber`. All six sites pass funcIds /
    fiberIds / `List.empty()` args / `this.executionContext`
    only; G3 re-asserts via grep.
- **Dead Brain fragments to delete (cleanup tail from D2):**
  `packages/core/src/brain/brain.ts` --
  - The `funcIdToRule: Dict<number, IBrainRule>` field
    declaration.
  - The two assignment statements in `initialize()` that
    allocate the dict and populate it via
    `collectFuncIdToRuleMapping`.
  - The `collectFuncIdToRuleMapping` private method.
  - The `IBrainRule` type-only import on the file's import
    block (becomes unused once the field and helper delete).

### Verification gates (these are the work, not side checks)

D5's mechanical work is one small dead-code deletion plus one
JSDoc addition. The gates frame the verification:

- **G1 -- Scheduler is id-only.** Read the `FiberScheduler`
  class declaration in `packages/core/src/runtime/vm.ts` end
  to end. Every method parameter, field type, and call into
  `this.vm.*` is one of: a `funcId: number`, a
  `fiberId: number`, a `HandleId`, a `Fiber` runtime struct,
  a `List<Value>`, or `ExecutionContext`. No
  `IBrainRule` / `IBrainPage` / `BrainPage` / `BrainRule` /
  `ActionInstance` reference appears.
- **G2 -- Runtime is id-only at the boundary.**
  `grep -rnE '\\b(IBrainRule|IBrainPage|BrainPage|BrainRule|ActionInstance)\\b' packages/core/src/runtime/`
  returns matches only inside `host-bindings.ts` (the
  declarations of `IBrainPage` and `IBrainRule` themselves,
  retained as authoring-shape interfaces under `runtime/` for
  the import firewall). No other file under `runtime/` may
  match. **`IBrain` is permitted everywhere under `runtime/`:**
  it is the contracted brain surface that `runtime-services.ts`
  consumes, and its members are id-keyed (variable names,
  page indices, page-id strings, `rng()` -- no object
  references).
- **G3 -- Brain<->scheduler interface is fiber-id-keyed.**
  `grep -nE 'this\\.scheduler\\.' packages/core/src/brain/brain.ts`
  returns matches whose only arguments are funcIds, fiberIds,
  `List.empty()` args, and `this.executionContext`. No match
  passes a `BrainPage`, `BrainRule`, `IBrainRule`, or
  `ActionInstance` reference.
- **G4 -- `activeRuleFiberIds` is the canonical interface
  object.** Its declaration on Brain has the type
  `List<{ funcId: number; fiberId: number | undefined }>`
  unchanged from inspection. Field-level JSDoc (added this
  phase) names it as the Brain<->scheduler interface and
  forbids embedding object-graph references.
- **G5 -- Cleanup tail is gone.**
  `grep -nE '\\b(funcIdToRule|collectFuncIdToRuleMapping)\\b' packages/core/src/`
  returns zero matches.

### Procedure (execute in order; the tree compiles after each step)

1. **Run G1 / G2 / G3.** All must pass. If any fails, stop --
   a precondition is violated; escalate to D2 / D3 / D4
   post-mortem.
2. **Delete `funcIdToRule` cleanup tail.**
   - Remove the field declaration on `Brain`.
   - Remove the two assignment statements in `initialize()`
     that allocate the dict and populate it via
     `collectFuncIdToRuleMapping`.
   - Remove the `collectFuncIdToRuleMapping` private method.
   - Remove the `IBrainRule` type-only import if it has no
     remaining uses in the file (rerun the file's TypeScript
     check; the unused-import rule will catch it).
   - Re-run G5 and confirm zero matches.
3. **Pin `activeRuleFiberIds` JSDoc.** Add field-level JSDoc
   stating: this list is the canonical Brain<->scheduler
   interface object; entries hold `funcId` (program-resolved)
   and `fiberId` (scheduler-issued); any future change must
   keep both fields scalar (no `BrainPage` / `BrainRule` /
   `ActionInstance` references). Re-run G4.
4. **Standard verification.** From `packages/core`, run
   `npm run typecheck && npm run check && npm test && npm run build`.
   From `apps/sim`, the same four. All must pass with the
   project's zero-noise standard.

### Notes (not work items)

- **Scheduler is not migrated.** D5 does not edit
  `FiberScheduler`. The "scheduler is id-only" property is
  inherited from inspection-commit reality; D5 verifies and
  pins it via G1 / G3 / G4.
- **`IBrain` survives in `runtime/`.** `runtime-services.ts`
  consumes `IBrain` (declared in `runtime/host-bindings.ts`)
  as the contracted brain surface; its members take strings
  and indices, never authoring objects. This is the post-D2
  contract shape and is intentional.
- **`IBrainPage` / `IBrainRule` declarations stay in
  `runtime/host-bindings.ts`.** The runtime no longer
  consumes them, but they remain colocated with `IBrain` to
  preserve the import-firewall topology. G2 explicitly
  permits matches inside `host-bindings.ts`.
- **Brain still mixes compile-time and runtime concerns.**
  After D5, Brain holds all eight concerns listed in the
  Brain-fate disposition above. The physical split into
  `BrainRuntime` (concerns 3, 4, 5, 6, 7, 8) and
  `BrainCompiler` (concerns 1, 2) is a follow-on plan (see
  Out of Scope at the top of this spec). D5 makes that split
  mechanical by ensuring the Brain-side surface that the
  future `BrainRuntime` will own is already free of
  authoring-graph value imports.
- **No new VmEvents added.** If a future phase needs a
  passive scheduler event, the dense plan's general policy
  holds: add it to the existing `VmEvents` aggregate; do not
  create a parallel scheduler-events aggregate. D5 introduces
  no such events.

### Risks

- **Hidden authoring-graph re-coupling on Brain.** A future
  refactor inside `brain/` could re-add a value import of
  `IBrainRule` to the activation-hook helpers (e.g. by
  threading `rule` back through for "convenience"). G5
  catches this only if re-run; a follow-up for D7 is to record
  the G1-G5 greps as standing repository checks (CI or
  pre-commit) so the lock-in survives.
- **Phantom-fix temptation.** Because D5 is small and
  mechanical, an agent may be tempted to "improve" the
  scheduler API or refactor the activation hooks while here.
  Reject. D5's job is lock-in, not improvement. Any
  structural change belongs in the follow-on Brain-runtime
  split plan.

### Acceptance (validation checklist)

D5 ships only when every item passes:

1. G1 passes (FiberScheduler class declaration is id-only end
   to end).
2. G2 passes (`packages/core/src/runtime/` matches confined
   to `host-bindings.ts` declarations).
3. G3 passes (every `this.scheduler.*` call site in
   `brain/brain.ts` carries only funcIds, fiberIds, args,
   and the execution context).
4. G4 passes (`activeRuleFiberIds` declaration unchanged;
   field-level JSDoc names it the Brain<->scheduler
   interface).
5. G5 passes (zero `funcIdToRule` /
   `collectFuncIdToRuleMapping` matches anywhere under
   `packages/core/src/`).
6. From `packages/core`, all four standard gates pass with
   zero noise.
7. From `apps/sim`, all four standard gates pass.
8. `git diff packages/core/src/runtime/` for D5 shows zero
   changes (D5 does not edit the runtime).

## Phase D6 -- Async Action Fiber/Handle Wiring

**Purpose.** D6 is a **lock-in phase** for the async action
path, parallel in shape to D5. After D2 / D3 / D4 land, the
async wiring under `execActionCallAsync` /
`spawnBytecodeActionFiber` is already id-keyed end to end:

- the host branch of `execActionCallAsync` calls
  `bindExecutionContext(fiber, frame, callSiteId)` (3-arg) and
  no longer touches `getOrCreateActionInstance` or any
  authoring object;
- `spawnBytecodeActionFiber` builds its child context from
  `parentFiber.executionContext`, sets only
  `currentCallSiteId` + `currentRuleFuncId` on it, sets
  `childFrame.ruleFuncId` (consumed by
  `resolveFrameRuleFuncId`), and writes
  `childFrame.actionBinding = { actionKey, callSiteId,
isAsync: true }`. There is no `currentActionInstance` write,
  no `funcIdToRule` lookup, no `actionInstance` field on the
  binding;
- `resolveAsyncActionHandle` / `rejectAsyncActionHandle` /
  `cancelAsyncActionHandle` already touch only
  `fiber.asyncResultHandleId` and the handle table;
- `FiberScheduler.onHandleCompleted` already takes a
  `HandleId` only, and the
  `vm.handles.events.on("completed", ...)` subscription
  already carries no richer payload.

**Reality vs. original D6 plan.** The original D6 plan
expected a "cleanup tail of dead D2/D4 writes" inside
`execActionCallAsync` and `spawnBytecodeActionFiber` -- five
specific deletions in the bytecode child-fiber spawn and two
in the host branch. **All seven were already swept as part of
D2 / D3 / D4's mechanical sweeps.** D6 therefore has no dead
writes to delete; it inherits a clean call site.

What survives for D6 to do is:

- pin field-level JSDoc on `Fiber.asyncResultHandleId` naming
  the resolve / reject / cancel contract;
- pin member-level JSDoc on the `Scheduler` interface naming
  each member's id-only contract;
- close the **pre-existing** async-result handle leak in the
  host branch of `execActionCallAsync`: the bytecode branch
  wraps `scheduler.addFiber(childFiber)` in
  `try { ... } catch { this.handles.delete(hid); throw error; }`,
  but the host branch creates the handle before invoking
  `action.execAsync(...)` and does not roll the handle back if
  `execAsync` throws synchronously. D6 adds the symmetric
  guard.

**Scope.** Pin two JSDoc blocks (`Fiber.asyncResultHandleId`
and the `Scheduler` interface members). Close the host-branch
async-handle-leak gap in `execActionCallAsync`. Verify the
async wiring is id-keyed end to end. No other behavior change.

**Precondition.** D5 ships and passes its acceptance.
`runtime/` has no value-imports of authoring types. The greps
in **G2** and **G4** below pass at D6's start.

### Source paths (the agent edits / inspects these)

- `packages/core/src/runtime/vm.ts`:
  - `execActionCallAsync` -- both branches.
    - Host branch: D6 adds a `try / catch` around
      `action.execAsync(...)` that calls
      `this.handles.delete(hid)` and rethrows. The bind
      reduction (no fourth `actionInstance` arg) is already
      done; the call already uses 3-arg
      `bindExecutionContext(fiber, frame, callSiteId)`.
    - Bytecode branch: read-only. The existing
      `try { scheduler.addFiber(childFiber); } catch { ... }`
      is the model the host branch's new guard mirrors.
  - `spawnBytecodeActionFiber` -- read-only. The body
    contains only id-keyed writes (`currentCallSiteId`,
    `currentRuleFuncId`, `ruleFuncId`, and the
    no-`actionInstance` `actionBinding` literal). G4 verifies.
  - `resolveAsyncActionHandle` / `rejectAsyncActionHandle` /
    `cancelAsyncActionHandle` -- read-only. G2 verifies they
    touch only `fiber.asyncResultHandleId` and the handle
    table.
  - `FiberScheduler.constructor` handle subscription
    (`this.vm.handles.events.on("completed", (handleId) =>
this.onHandleCompleted(handleId))`) -- read-only. G3
    verifies the callback parameter is `HandleId`.
  - `FiberScheduler.onHandleCompleted` -- read-only. G3
    verifies it takes `HandleId` and looks up fibers by id.
- `packages/core/src/runtime/vm-types.ts`:
  - `Fiber.asyncResultHandleId?: HandleId` -- D6 adds field-
    level JSDoc naming the async-result-handle anchor and
    the resolve / reject / cancel contract that clears it.
  - `Scheduler` interface (the four-member `Scheduler`
    declaration: `onHandleCompleted`, `enqueueRunnable`,
    `getFiber`, `addFiber?`) -- D6 adds member-level JSDoc
    naming each member's id-only contract. `addFiber` takes
    a `Fiber` runtime struct (the contracted runtime entity,
    not an authoring object) -- the JSDoc states this
    explicitly. No signature change.

### Verification gates (these are the work, not side checks)

- **G1 -- Async wiring is id-only end-to-end.** Read
  `execActionCallAsync` end to end. Every value passed into
  `this.handles.*`, `this.push(fiber, ...)`,
  `scheduler.addFiber(...)`, `this.bindExecutionContext(...)`
  is one of: a `HandleId`, a `Fiber` runtime struct, a
  `List<Value>` of args, a `callSiteId: number`, or
  `fiber.executionContext`. No `ActionInstance`, no
  `BrainRule`, no `BrainPage`, no `IBrainRule`, no authoring
  reference.
- **G2 -- Async handle lifecycle is id-only.**
  `grep -nE 'resolveAsyncActionHandle|rejectAsyncActionHandle|cancelAsyncActionHandle' packages/core/src/runtime/vm.ts`
  -- every match takes only `fiber: Fiber` plus (for
  resolve) `result: Value` or (for reject) `err: ErrorValue`.
  Read all three helpers; their bodies touch only
  `fiber.asyncResultHandleId` and `this.handles.*`.
- **G3 -- Handle events keyed by `HandleId` only.** Read the
  `vm.handles.events.on("completed", ...)` subscription in
  `FiberScheduler` constructor and the
  `FiberScheduler.onHandleCompleted` declaration; the callback
  parameter is `HandleId` and the body looks up fibers by id.
- **G4 -- Cleanup tail is gone.**
  `grep -nE '\\b(currentActionInstance|getOrCreateActionInstance|resetActionInstance)\\b' packages/core/src/runtime/`
  returns zero matches. `actionInstance` (as a literal field
  name) returns zero matches inside `execActionCallAsync` or
  `spawnBytecodeActionFiber`.
- **G5 -- `bindExecutionContext` arity matches the post-D4
  surface.** `grep -nE 'bindExecutionContext\\(' packages/core/src/runtime/vm.ts`
  -- every call site has the 3-arg signature
  `(fiber, frame, callSiteId)`.
- **G6 -- Host async-action handle is rolled back on
  synchronous `execAsync` throw.** Read
  `execActionCallAsync` host branch: the call to
  `action.execAsync(...)` is wrapped in a `try { ... } catch
{ this.handles.delete(hid); throw error; }` symmetric to
  the bytecode branch's `scheduler.addFiber` guard. A new
  test in `vm.spec.ts` (or the existing async-action spec
  file) registers a host async action whose `execAsync`
  throws synchronously, calls it via `ACTION_CALL_ASYNC`, and
  asserts that the handle table size returns to its
  pre-call value.

### Procedure (execute in order; tree compiles after each step)

1. **Run G2 / G3 / G4 / G5.** All must pass. If any fails,
   the precondition was wrong; escalate to D2 / D3 / D4 / D5
   post-mortem.
2. **Pin `Fiber.asyncResultHandleId` JSDoc.** Add field-level
   JSDoc in `vm-types.ts`: this field holds the `HandleId` of
   the pending async-action result handle for a child fiber
   spawned by `ACTION_CALL_ASYNC`; set on spawn, cleared by
   `resolveAsyncActionHandle` / `rejectAsyncActionHandle` /
   `cancelAsyncActionHandle`; never holds an authoring-object
   reference.
3. **Pin `Scheduler` interface member JSDoc.** Add member-level
   JSDoc in `vm-types.ts` for each member of the `Scheduler`
   interface: `onHandleCompleted(handleId: HandleId)`,
   `enqueueRunnable(fiberId: number)`,
   `getFiber(fiberId: number)`, and the optional
   `addFiber(fiber: Fiber)` (note: takes a `Fiber` runtime
   struct, not an authoring object). No signature change.
4. **Close the host async-handle-leak gap.** In the host
   branch of `execActionCallAsync`, wrap the
   `action.execAsync(fiber.executionContext, args, hid)` call
   in `try { ... } catch (error) { this.handles.delete(hid);
throw error; }`. Add a unit test under
   `packages/core/src/runtime/` (or extend the existing
   async-action spec) that registers a host async action whose
   `execAsync` throws synchronously, invokes it via
   `ACTION_CALL_ASYNC`, and asserts the handle table size
   returns to its pre-call value.
5. **Run G1 by reading `execActionCallAsync` end to end.**
   Trace every value passed to `this.handles.*`,
   `this.push(fiber, ...)`, `scheduler.addFiber(...)`,
   `this.bindExecutionContext(...)`. Each must be an id, a
   `HandleId`, a `Fiber` struct, a `List<Value>`, or a
   `callSiteId`.
6. **Re-run G6** (the new test from step 4 plus the existing
   async-action regression suite).
7. **Standard verification.** From `packages/core`, run
   `npm run typecheck && npm run check && npm test && npm run build`.
   From `apps/sim`, the same four. All pass with the project's
   zero-noise standard.

### Notes (not work items)

- **No new VmEvents added.** Async-action lifecycle events
  (resolve / reject / cancel / cancellation-on-fault) flow
  through the existing `HandleTable.events.completed` channel
  the `FiberScheduler` already subscribes to. If a richer
  passive observer is needed for diagnostics, the dense plan's
  general policy holds (extend `VmEvents`, do not create a
  parallel scheduler-events aggregate). D6 introduces no new
  events.
- **`Scheduler.addFiber` takes a `Fiber` struct.** This is
  not a violation of the id-only invariant because `Fiber` is
  a runtime entity owned by the VM (declared in
  `vm-types.ts`); it is not an authoring object. The
  Brain<->scheduler boundary pinned in D5 (G3) carries
  funcIds and fiberIds across the **interface**; the VM
  internally constructs a `Fiber` struct and hands it to the
  scheduler for storage.
- **Internal child-fiber id space.** `nextInternalFiberId =
-1` issues negative ids for child fibers spawned by
  `ACTION_CALL_ASYNC`. D6 does not change this; D0 table 6
  records it. If a future phase consolidates fiber id
  allocation under the scheduler, that work is scoped
  separately.
- **`childFrame.ruleFuncId` is live, not dead.** The
  original D6 plan flagged this for possible deletion if no
  consumer remained. `resolveFrameRuleFuncId` consumes it; it
  stays.

### Risks

- **Phantom-fix temptation.** D6 is mechanical; an agent may
  be tempted to "improve" the handle table API or the
  scheduler interface while here. Reject. D6's job is lock-in
  plus the host-branch leak fix. Any structural change
  belongs in a follow-on plan.
- **Async-result handle leak surface area.** The host-branch
  fix in step 4 closes the synchronous-throw case. If
  `execAsync` returns a never-resolving promise (which the
  contract permits as long as it eventually completes) and
  the action provider later loses the handle, the handle
  remains pending forever and gets GC'd by
  `HandleTable.gc()` only if it has no waiters. This is
  pre-existing behavior; D6 does not add a watchdog. A
  follow-up risk for D7's contract docs is to state the host
  contract: `execAsync` must eventually resolve, reject, or
  cancel the handle.

### Acceptance (validation checklist)

D6 ships only when every item passes:

1. G1 passes (every value crossing into scheduler / handles
   in `execActionCallAsync` is an id, a `HandleId`, a `Fiber`
   struct, a `List<Value>`, or a `callSiteId`).
2. G2 passes (resolve / reject / cancel async handle helpers
   are id-keyed).
3. G3 passes (`vm.handles.events.completed` callback param
   and `FiberScheduler.onHandleCompleted` parameter are
   `HandleId`).
4. G4 passes (zero `currentActionInstance` /
   `getOrCreateActionInstance` / `resetActionInstance`
   matches under `runtime/`; zero `actionInstance` literal-
   field matches inside `execActionCallAsync` or
   `spawnBytecodeActionFiber`).
5. G5 passes (every `bindExecutionContext(` call site is
   3-arg).
6. G6 passes (host async-action handle is rolled back on
   synchronous `execAsync` throw, verified by a new unit
   test).
7. JSDoc pinned on `Fiber.asyncResultHandleId` and on every
   member of the `Scheduler` interface.
8. From `packages/core`, all four standard gates pass with
   zero noise.
9. From `apps/sim`, all four standard gates pass.
10. Async action behavior is unchanged: existing tests that
    exercise async action resolve / reject / cancel /
    cancellation-on-parent-fault continue to pass without
    modification.

## Phase D7 -- Document The Dense-State Contract

**Purpose.** Promote the dense-state surface (the
`ExecutionContext` shape, the dense additions to
`PlatformServices`, the callsite-id binding contract, the action
state-slot model, the id-spaces, and the Brain-fate disposition
pinned in D5) from a phased-implementation plan into the durable
contract document. This plan becomes historical once D7 ships;
`docs/specs/core/vm-contract.md` becomes the only durable record
of the D0-D6 decisions a downstream spec or a constrained-target
implementer needs to consult.

**Scope.** A single new section added to `vm-contract.md`,
positioned and sized as specified below. No code changes. No
changes to other documents in the repository (downstream specs
are updated as part of their own units, not this one).

**Anti-bloat rule.** Target <=120 lines for the new section.
Do **not** copy D0 decision tables into the contract; reference
them in prose ("the rule id-space pinned in D0 table 6") and link
to this plan by relative path. The contract states **what the
boundary is**, not **how D0-D6 derived it**. If the section grows
past 150 lines on first draft, the agent stops, reviews each
paragraph for whether it documents a contract or a derivation,
and deletes derivations.

**Authoring rule.** D2 through D6 deferred all `vm-contract.md`
updates here so this phase writes the new section once with full
D0-D6 context in hand. Do not split the work back into the
earlier phases.

**Precondition.** D6 ships and passes its acceptance. The
following greps return zero matches across `packages/core/src/`:

- `\\b(IBrain|IBrainRule|IBrainPage|BrainPage|BrainRule|ActionInstance)\\b`
  outside of `packages/core/src/brain/`.
- `\\b(currentActionInstance|funcIdToRule|getOrCreateActionInstance|resetActionInstance|getCallSiteState|setCallSiteState)\\b`
  inside `packages/core/src/runtime/`.

If either grep returns matches, D7 stops -- a precondition is
violated, escalate to D2-D6 post-mortem.

### Source paths (the agent edits / inspects these)

- **The single edited file:** `docs/specs/core/vm-contract.md`.
  - The new section inserts immediately after the existing
    `## Construction and services boundary` section
    (line ~135), before `## Opcode completeness`
    (line ~238).
  - The existing `### Out of scope for this boundary`
    subsection (line ~221) currently says runtime state
    shape is "addressed by ts-vm-dense-runtime-state-plan-2026-05-02.md,
    which builds on this boundary." D7 updates this paragraph
    to point readers at the new dense-state section as the
    durable answer rather than at the (now-historical) plan.
- **Inspection-only references** (the contract section
  describes these surfaces but does not edit them):
  - `packages/core/src/runtime/context.ts` --
    `ExecutionContext` field declarations as they exist
    post-D6.
  - `packages/core/src/runtime/platform-services.ts` (or the
    file the firewall identifies as the
    `PlatformServices` aggregate) -- the dense additions D2,
    D3, D4 land in their respective phases.
  - `packages/core/src/runtime/vm-types.ts` --
    `Scheduler` interface, `Fiber.asyncResultHandleId`
    (pinned by D6).
  - `packages/core/src/runtime/vm.ts` -- callsite-id binding
    discipline in `execHostCall*` and `execActionCall*`
    (the contract states the discipline; the agent reads
    these to verify the prose matches reality).
  - `packages/core/src/brain/brain.ts` -- Brain's surviving
    runtime surface (concerns 3-8 from D5's eight-concern
    audit), referenced only to support the Brain-fate
    one-liner in the new section.

### Section content (what the new section must contain)

The new section is titled `## Dense-state runtime surface` and
must cover the following sub-sections in this order. Each
sub-section is one or two short paragraphs (typically 5-15
lines); the whole section stays within the <=120-line target.

1. **`ExecutionContext` shape.** The portable runtime context
   struct: per-rule variable arrays addressed by `(ruleId,
slot)`, callsite host state addressed by `callSiteId`,
   action state slots addressed by `(callSiteId, slotIndex)`,
   the current-id fields (`currentCallSiteId`, current rule
   id, current fiber id), and the per-tick scalar anchors
   (`time`, `dt`, `currentTick`). State the closure
   property: every field is either a scalar id, a slot
   index, a primitive, or a side-table reference -- no
   field holds an authoring-graph object. Name the
   extension seam in one sentence: applications subclass
   `ExecutionContext` to add app-shaped fields (sim's
   `ActorExecutionContext.data` is the canonical example);
   what an app layers on top is the app's contract, not
   core's.
2. **Dense additions to `PlatformServices`.** Enumerate the
   members the dense plan added (rule lookup, action
   resolution / activation, callsite-state side table,
   action state-slot side table). For each, state the
   id-keyed signature shape in one line. State the closure
   property: every dense member operates on ids and
   primitives only. Note that core ships an `IRngServices`
   member on `PlatformServices` to back the core `random`
   sensor's brain-scoped random stream, but does not ship
   time, clock, or platform-entity / world-access services;
   applications layer those in at the application level via
   their own host functions and platform-side service
   objects if needed.
3. **`HOST_CALL` / `HOST_CALL_ASYNC` callsite-id binding
   contract.** State the discipline pinned in D3:
   `currentCallSiteId` is bound on entry to a host call,
   restored on return, and saved/restored across nested
   host calls. State the host function signature contract:
   host functions read and write callsite host state through
   the contracted `PlatformServices` op, never through
   pointer dereference of a `Brain` / `BrainRule` /
   `ActionInstance` reference.
4. **Action call state model.** State the discipline pinned
   in D4 + D6:
   - sync `ACTION_CALL` and async `ACTION_CALL_ASYNC` both
     route per-callsite action state through the
     state-slots side table keyed by `(callSiteId,
slotIndex)`;
   - state slots reset on page activation;
   - `ACTION_CALL_ASYNC` allocates a `HandleId` from the VM
     handle table, spawns a child fiber (bytecode branch)
     or invokes `execAsync(ctx, args, hid)` (host branch),
     and resolves the handle through the
     `HandleTable.events.completed` channel that the
     `FiberScheduler` subscribes to.
5. **Id-spaces.** Reference D0 table 6 in prose (do not
   copy). State the durable facts: rule ids and action ids
   are program-resolved (stable across reload of the same
   compiled `Program`); fiber ids are scheduler-issued and
   not stable across reload; `nextInternalFiberId` (negative
   ids for child fibers spawned by `ACTION_CALL_ASYNC`) is
   an internal allocation detail noted but not contracted
   for downstream consumption; handle ids are issued by the
   VM `HandleTable`.
6. **Brain-fate one-liner.** State the disposition pinned by
   D5: Brain survives as a thin id-only orchestrator owning
   variable storage, VM and scheduler ownership,
   ExecutionContext construction, page lifecycle FSM,
   activation-hook driver, and page lookup tables (concerns
   3-8 from D5's eight-concern audit). Brain's
   runtime-facing surface is id-only; no method on Brain
   accepts or returns an `IBrainRule` / `IBrainPage` /
   `ActionInstance` reference. The physical split into
   `BrainRuntime` (runtime concerns) and `Brain` /
   `BrainCompiler` (authoring + compile concerns) is the
   subject of a follow-on plan
   (`ts-brain-runtime-split-plan-2026-05-03.md`); this
   contract section pins the surface, not the file layout.
7. **Out-of-scope statement.** Registry-shaped
   `PlatformServices` members (`functions`, `types`,
   conversions, operators) and the `VmEvents` aggregate are
   covered by the existing `## Construction and services
boundary` section. The dense additions enumerated in
   sub-section 2 extend that aggregate; they do not redefine
   the registry surface.
8. **Maintenance rule.** Any subsequent spec that adds or
   removes a dense `PlatformServices` member, changes the
   `ExecutionContext` field set, changes the callsite-id
   binding discipline, changes the action state-slot
   keying, or changes the Brain runtime-facing surface
   **must update this section in lock-step** with the code
   change, in the same unit. Mirror the wording of the
   existing maintenance rule on the construction-and-
   services-boundary section.

### Verification gates (these are the work, not side checks)

D7 has no greppable code gates. Its gates are read-tests on the
new section:

- **G1 -- Dense-state walk.** A reader who has not opened any
  D0 table can read the new section and answer, for every
  named operation: "could a static-allocation, no-GC,
  no-closures implementation provide this?" If any operation
  cannot be answered yes from the section alone, the section
  is incomplete; revise before shipping.
- **G2 -- No tables, no derivations.** Search the new
  section for: a Markdown table (`|` characters in
  table-row position), the words "decided," "rationale,"
  "alternative," "we considered," "instead of" (when used
  as design comparison). Each match is a justification
  smell; rewrite as a contract statement ("the
  callsite-state side table is keyed by `callSiteId`")
  or delete.
- **G3 -- No copy of D0 tables.** The section does not
  reproduce D0 table 1 (`ExecutionContext` field
  disposition), table 5 (object-model retirement), or
  table 6 (id-space). It refers to them by name and links
  to this plan.
- **G4 -- <=120 lines.** `awk 'NR>=START && NR<=END' vm-contract.md
| wc -l` for the new section returns <=120 (preferred:
  <=100). If between 120 and 150, the agent reviews each
  paragraph for derivation content and deletes; if still
  exceeds 150, escalate.
- **G5 -- Forward references resolve.** Every
  parenthetical "(D0 table N)" / "(per D5)" / "(per D6)"
  / "(see ts-brain-runtime-split-plan-2026-05-03.md)"
  resolves to a real artifact at the named location.

### Procedure (execute in order)

1. **Run the precondition greps.** If either returns
   matches, stop and escalate.
2. **Re-read the existing `## Construction and services
boundary` section** end-to-end. The new section must
   match its tone, length per sub-section, and discipline
   (contract statements, not derivations).
3. **Draft the new section** following the eight
   sub-sections enumerated under "Section content."
   Insert immediately after `## Construction and services
boundary` and before `## Opcode completeness`.
4. **Update the existing `### Out of scope for this
boundary` paragraph** (line ~221) to point at the new
   dense-state section as the durable answer for runtime
   state shape, instead of pointing at this plan as a
   forward reference.
5. **Run G2, G3, G5** as read-passes. Fix matches /
   resolve broken references.
6. **Run G4.** If >120 lines, delete derivation content
   first. If still >120 after the derivation sweep, the
   sub-section breakdown is wrong; the agent reviews
   whether two sub-sections collapse, or whether one
   sub-section is documenting more than the contract
   needs.
7. **Run G1** as a fresh-eyes read. The agent (or a
   reviewer) walks every named operation in the section
   and asks the static-allocation / no-GC question; any
   "I cannot tell from the section alone" is a defect.
8. **Standard verification.** From the repo root, run a
   markdown-link-check pass on `vm-contract.md` if one
   exists in the repo's quality gates; otherwise verify
   manually that every link in the new section resolves.
   D7 introduces no code, so the per-package
   `npm run typecheck && npm run check && npm test &&
npm run build` gates are not required by D7's content
   change. They are still run if any incidental code
   touch happens (e.g. fixing a stale path comment
   discovered during the read-passes), and must pass with
   zero noise.

### Notes (not work items)

- **D7 is documentation-only.** The agent does not modify
  code, even to "tighten" something noticed during the
  read-passes of `runtime/vm.ts` or `brain/brain.ts`.
  Tightening belongs in a follow-on unit (the Brain split
  plan, or a new bug fix) so the doc commit stays a
  pure contract update.
- **Downstream specs update themselves.** If a downstream
  spec (e.g. the Brain split plan, a future MCU port plan)
  references "the rule id-space" or "the callsite-state
  side table," it links to the new dense-state section as
  the source of truth. D7 does not pre-emptively edit
  those downstream specs; they update in their own units.
- **This plan becomes historical.** Once D7 ships, the
  durable answer to "what is the dense-state runtime
  surface?" is `vm-contract.md`'s new section. This
  plan's narrative (D0-D6) is preserved for archeology
  but is not consulted by future agents.

### Risks

- **Section bloat.** The single biggest risk is that the
  agent treats the section as a place to capture every
  D0-D6 decision in detail. The anti-bloat rule, the
  <=120-line target, and G2 / G3 are the guards. If the
  agent finds itself wanting to write a paragraph
  starting with "we considered" or "rather than," the
  paragraph belongs in this plan's history, not the
  contract.
- **Duplication of `## Construction and services
boundary`.** The dense `PlatformServices` members
  enumerated in sub-section 2 must not re-state the
  registry-shaped members (`functions`, `types`)
  documented in the existing section. Cross-link instead.
- **Stale Brain-fate wording.** If a future plan
  retires Brain after all (against D5's pinned
  disposition), the maintenance rule requires updating
  the new section's Brain-fate one-liner in the same
  unit. D7 records this responsibility explicitly so it
  is not forgotten.

### Acceptance (validation checklist)

D7 ships only when every item passes:

1. The new `## Dense-state runtime surface` section exists
   in `docs/specs/core/vm-contract.md`, positioned between
   `## Construction and services boundary` and
   `## Opcode completeness`.
2. The section has all eight sub-sections enumerated under
   "Section content," in order.
3. G1 passes (a reader can perform the dense-state walk
   from the section alone).
4. G2 passes (no tables, no derivation phrasings).
5. G3 passes (no copies of D0 tables).
6. G4 passes (<=120 lines).
7. G5 passes (every cross-reference resolves).
8. The existing `### Out of scope for this boundary`
   paragraph is updated to point at the new section as
   the durable answer for runtime state shape.
9. No code changes shipped under D7 unless an incidental
   touch was required; if any, the per-package gates
   pass with zero noise.
10. This plan's "Phase Log" is updated by the
    post-mortem unit (not D7 itself) to reflect that the
    plan is historical and the durable contract lives in
    `vm-contract.md`.

## Sequencing Constraints

The phase DAG:

```text
D0 -> D1 -> D2 -> D3 -> D4 -> D5 -> D6 -> D7
```

Hard constraints:

- D0 must complete before D1.
- D1 must complete before D2, D3, D4 (each removes a shim D1
  introduces).
- **D2, D3, D4 are the behavior-sensitive migrations and
  must not be combined into a single unit.** Each ships
  and is reviewed independently.
- D2 < D3: D3's callsite binding writes to fields that D2's
  rule-id flow already populates.
- D3 < D4: D4's action call uses callsite-id from D3.
- D4 < D5: D5 verifies the Brain-side cleanup tail D2/D3/D4
  leave behind and pins the Brain<->scheduler surface as
  id-only.
- D5 < D6: D6 sweeps the async-path cleanup tail and pins
  the async wiring; D5's Brain<->scheduler surface lock-in
  is the precondition for trusting the scheduler is
  id-only.
- D6 < D7: D7 documents the result of D0-D6 in the durable
  contract.

## Completion Criteria

This spec is complete when:

- `ExecutionContext` exposes only portable, id/slot-addressable
  state.
- Every shipped TS host function uses the portable signature.
- `Brain`, `BrainPage`, `BrainRule`, `ActionInstance` no longer
  appear in runtime dispatch paths. Any debug/editor variants are
  outside the runtime import graph.
- `Brain`'s runtime fate is pinned (per D5) as "survives as a
  thin id-only orchestrator," with the eight-concern audit
  recorded in D5 and the physical split deferred to
  `ts-brain-runtime-split-plan-2026-05-03.md`.
- The async-action child-fiber and handle wiring is id-keyed
  end-to-end, with no surviving dead D2/D4 writes (per D6).
- Rule resolution, host-call binding, action call state, and
  id-spaces are contracted runtime behaviors, documented in
  `vm-contract.md`'s dense-state section (per D7).
- Walking the new `ExecutionContext` and the dense-state additions
  to `PlatformServices` shows every operation is expressible by a
  static-allocation, no-GC implementation.
