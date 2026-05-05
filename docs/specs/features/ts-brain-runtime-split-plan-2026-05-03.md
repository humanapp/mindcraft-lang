# TS Brain Runtime Split Plan

Date: 2026-05-03
Status: Authored. Implementation not begun.

## Scope And Sibling Specs

This spec covers the **physical code split** of `packages/core/src/brain/brain.ts`
into two responsibilities housed in two locations:

- **`packages/core/src/runtime/brain-runtime.ts` (new).** Owns the runtime
  concerns currently mixed into `Brain`: variable storage, VM and scheduler
  ownership, `ExecutionContext` construction, page lifecycle FSM (`think`,
  `activatePage`, `deactivateCurrentPage`, etc.), activation / deactivation
  hook drivers, and page lookup tables consumed at runtime.
- **`packages/core/src/brain/` (existing, narrowed).** Owns the edit / compile
  concerns: authoring graph (`IBrainDef`, `BrainPage`, `BrainRule`), the
  compile / link / treeshake pipeline (`compileBrain`, `linkBrainProgram`,
  `treeshakeProgram`), and a thin `Brain` facade that constructs a
  `BrainRuntime` from a definition and delegates the runtime surface.

The end state is that a constrained-target port (Roblox-ts, future MCU C++
port, etc.) can compile against `packages/core/src/runtime/` only and
instantiate a `BrainRuntime` directly from a pre-compiled `Program` blob plus
a `PlatformServices` aggregate, without touching the authoring side of
`brain/`.

The complementary work that **enables** this split is:

- [ts-vm-module-decoupling-plan-2026-05-02.md](../../.archived/ts-vm-module-decoupling-plan-2026-05-02.md):
  moved the type boundaries so `runtime/` does not value-import authoring
  types and installed the dependency-cruiser firewall as a hard test gate
  (`packages/core/src/runtime/__firewall__.spec.ts`). After M5, the firewall
  passes vacuously because nothing under `runtime/` referenced `brain/`
  values; this spec lifts code across the boundary so the firewall is
  doing meaningful work.
- [ts-vm-dense-runtime-state-plan-2026-05-02.md](../../.archived/ts-vm-dense-runtime-state-plan-2026-05-02.md):
  moved runtime-visible storage (variable reach-through, callsite host
  state, action state slots) off the authoring object graph and behind
  contracted dense surfaces. After D5, the runtime side of `Brain` has
  zero value-imports of `IBrainRule` / `ActionInstance`, which is the
  precondition that lets `BrainRuntime` exist as a self-contained file
  under `runtime/` without shims.

This spec depends on both being complete through their final lock-in
units.

## Goal

```text
                 edit / compile time                  |             runtime
                                                      |
IBrainDef + BrainServices                             |
        |                                             |
        v                                             |
brain/Brain.initialize(contextData)                   |
  - compileBrain(brainDef, ...)                       |    runtime/BrainRuntime
  - linkBrainProgram(...)                             |        ^
  - treeshakeProgram(...)                             |        |
  - new BrainRuntime(program,                         |        |
                     pageMetadata,                    |        |
                     platformServices,                |        |
                     contextData)                     |        |
        |                                             |        |
        +---------------------------------------------+--------+
                                                      |
                                                      |   constrained-target port:
                                                      |   loads pre-compiled
                                                      |   Program blob and
                                                      |   constructs
                                                      |   BrainRuntime
                                                      |   directly, never
                                                      |   touching brain/
```

The primary seam this spec enforces is **edit / compile vs runtime**,
expressed as a physical file boundary. The dependency invariant
("nothing under `packages/core/src/runtime/` value-imports from
`packages/core/src/brain/`") is already enforced by the firewall;
this spec lifts the *code* across that boundary so the invariant is
non-vacuous.

## Non-Goals

- No bytecode instruction changes.
- No `ExecutionContext` shape changes (the dense plan owns that).
- No new `PlatformServices` members (the dense plan owns that).
- No host function signature changes.
- No constrained-target port itself; this spec **enables** a port,
  it does not **perform** one.
- No deletion of the `Brain` facade. Subclasses in this repo
  (`ManagedMindcraftBrain` in `packages/core/src/mindcraft.ts`)
  override `initialize` / `startup` / `shutdown`; preserving the
  facade as a class is required.
- No relocation of `BrainPage` / `BrainRule` out of `brain/`. They
  remain authoring-side objects. Their runtime counterparts are the
  per-page metadata and per-rule funcId lookups already produced by
  the compile / link pipeline.
- No removal of `IBrain` from `runtime/host-bindings.ts`.
  `IBrain` already lives under `runtime/` (used by
  `runtime-services.ts` to bind dense-state adapters to the brain
  instance) and stays where it is. This spec adds a narrower
  `IBrainRuntime` interface in the same file and reshapes `IBrain`
  as `IBrain extends IBrainRuntime`. `IBrainRuntime` declares the
  runtime surface (everything except `initialize` and
  `getCompiledProgram`); `IBrain` adds those two facade-only
  methods. The shape of `IBrain` is unchanged for existing
  consumers.

## Prerequisite

The work this spec builds on is:

- The runtime contract pinned in
  [`vm-contract.md#construction-and-services-boundary`](../core/vm-contract.md#construction-and-services-boundary).
- The module-decoupling plan (M0-M5) shipped: `runtime/` has no
  value-imports of authoring types; the firewall test
  (`packages/core/src/runtime/__firewall__.spec.ts`) is green at
  `BASELINE_VIOLATIONS = 0`.
- The dense-runtime-state plan (D0-D7) shipped: every reach-through
  `Brain` owned for the runtime is now a contracted op on
  `ExecutionContext` or `PlatformServices`; the lifecycle-hooks
  precondition (L1 / L2 / L3) is in place and `Brain` owns the six
  hook drivers (`runHostInitializerHook`, `runHostActivationHook`,
  `runHostDeactivationHook`, `runBytecodeInitializerHook`,
  `runBytecodeActivationHook`, `runBytecodeDeactivationHook`, plus
  the `runBytecodeHook` helper) and the dense-shims teardown call
  from `shutdown`.

If any prerequisite slips, this spec stops -- do not work around a
missing seam by reaching back into `brain/` from `BrainRuntime`.

## Brain Concerns Audit (input to phase decomposition)

`packages/core/src/brain/brain.ts` at the inspection commit holds
eight distinct concerns. The split assigns each to one side:

| #  | Concern                                | Goes to    | Source-line anchors (brain.ts at inspection commit) |
| -- | -------------------------------------- | ---------- | --------------------------------------------------- |
| 1  | Authoring graph holder                 | `brain/`   | `pages: List<BrainPage>` (60); ctor `new BrainPage(this, pageDef)` (155-158) |
| 2  | Compile / link / treeshake pipeline    | `brain/`   | `initialize()` (170-247): `compileBrain`, `linkBrainProgram`, `treeshakeProgram`, `installVariableTable`, `assignFuncIds`, `createRuntimeServices`, `new VM`, `new FiberScheduler`, page lookup-table build, `executionContext` construction |
| 3  | Variable storage owner                 | `runtime/` | `variables` (66), `varSlotByName` (75); `getVariable` (282), `setVariable` (300), `clearVariable` (315), `clearVariables` (327), `getVariableBySlot` (337), `setVariableBySlot` (348), `installVariableTable` (361) |
| 4  | VM + scheduler ownership               | `runtime/` | `vm: VM` (105), `scheduler: FiberScheduler` (110), `callsiteStore` (123), `ruleVariableStores` (131), `activeRuleFiberIds` (138), `nextInlineFiberId` (140) |
| 5  | `ExecutionContext` construction        | `runtime/` | `executionContext` (118); construction inside `initialize()` (236-247) including the brain-closing `getVariableBySlot` / `setVariableBySlot` arrows |
| 6  | Page lifecycle FSM                     | `runtime/` | state: `enabled` (52), `interrupted` (53), `currentPageIndex` (54), `desiredPageIndex` (55), `previousPageIndex` (56), `restartPageRequested` (57), `lastThinkTime` (58); methods: `setEnabled` (393), `isEnabled` (397), `interrupt` (401), `clearInterrupt` (405), `isInterrupted` (409), `requestPageChange` (413), `requestPageRestart` (444), `getCurrentPageId` (449), `getPreviousPageId` (455), `startup` (462), `shutdown` (475), `think` (494), `activatePage` (529), `cancelActiveFibers` (610), `deactivateCurrentPage` (623), `runDeactivationHooksForCurrentPage` (645), `thinkPage` (677), `shouldRespawnFiber` (700), `isValidPageIndex` (804) |
| 7  | Activation / deactivation hook drivers | `runtime/` | `runHostActivationHook` (713), `runHostInitializerHook` (731), `runBytecodeInitializerHook` (749), `runBytecodeActivationHook` (753), `runBytecodeDeactivationHook` (757), `runHostDeactivationHook` (761), `runBytecodeHook` (779) |
| 8  | Page lookup tables                     | `runtime/` | `pageIdToIndex` (143), `pageNameToIndex` (146), `requestPageChangeByPageId` (425), `requestPageChangeByName` (435); construction inside `initialize()` (227-235) |

Concerns 3, 4, 5, 6, 7, 8 (six of eight) move to
`runtime/brain-runtime.ts`. Concerns 1 and 2 stay in `brain/`.
`Brain.rng()` does not exist; RNG is host-registered as part of
`AppServices` and reaches the VM via `services.app.rng`.
`PlatformServices` is a nested struct with four tiers
`{ runtime, shared, app, brain }` (see
`packages/core/src/runtime/services.ts`).

**Line-number citations.** All line numbers in this spec (in the
table above and in every phase's Source paths) are pinned at the
inspection commit recorded in B0. Subsequent phases re-anchor at
kickoff: the agent re-locates each cited symbol in the current
`brain.ts` before editing. Stale line numbers are expected once
B2 starts moving code; treat them as orientation, not as
addresses.

## Desired End State

- `packages/core/src/runtime/brain-runtime.ts` exists. It is the
  runtime entry point for compiled Mindcraft programs. Its
  constructor takes:
  - `program: Program`,
  - `pageMetadata: List<PageMetadata>`,
  - `hostServices: Omit<PlatformServices, "brain">` -- the three
    host- and module-supplied tiers (`runtime`, `shared`, `app`),
  - `contextData: unknown` (defaults to `undefined`),
  - `previousVariables?: VariableSnapshot` (defaults to
    `undefined`).

  Variable-name -> slot binding is read from `program.variableNames`
  inside the constructor, not passed as a separate argument.
  `VariableSnapshot` is `{ values: List<Value | undefined>;
  slotsByName: Dict<string, number> }` exported from
  `runtime/brain-runtime.ts`. When `previousVariables` is
  supplied, `installVariableTable` carries each variable forward
  by name (the existing semantics). Constrained-target ports
  that load a fresh `Program` and never hot-reload pass
  `undefined`; the authoring-side facade passes a snapshot of
  the previous runtime's variables on every re-init.

  `hostServices` is the brain-runtime view of `PlatformServices`
  with the brain-instance tier omitted: it carries `runtime`
  (`RuntimeLangServices` -- `types`, `functions`, `operatorTable`,
  `actions`), `shared` (`SharedLangServices` -- `conversions`),
  and `app` (`AppServices` -- `rng`; future host-scoped services
  like network / wallClock / logger land here). The runtime
  constructor builds the brain-instance tier (`program`,
  `brainVars`, `ruleVars`, `pages`, `callsite`) internally and
  composes it with `hostServices` into the full nested
  `PlatformServices` consumed by `VM`.

  `contextData` is a runtime concern. The constructor stores
  it as `this.executionContext.data` (the `data` field of the
  `ExecutionContext` literal built inside the constructor);
  host functions read it via `ctx.data` per the existing
  `IBrain.initialize` JSDoc. No new `getContextData()` accessor
  is added to `IBrainRuntime`; the `executionContext.data`
  channel is the contract.
- `BrainRuntime` exposes the runtime surface previously on `Brain`:
  `events()`, `think(currentTime)`, `startup()`, `shutdown()`,
  `requestPageChange(pageIndex)`,
  `requestPageChangeByPageId(pageId)`,
  `requestPageChangeByName(name)`, `requestPageRestart()`,
  `getCurrentPageId()`, `getPreviousPageId()`, `setEnabled` /
  `isEnabled` / `interrupt` / `clearInterrupt` / `isInterrupted`,
  `getProgram()`, `getPages()`, plus the variable-name- and
  slot-keyed accessors (`getVariable`, `setVariable`,
  `clearVariable`, `clearVariables`, `getVariableBySlot`,
  `setVariableBySlot`).

  `rng()` is **not** on the runtime surface. RNG reaches the VM
  via `services.app.rng` (an `IRngServices` instance the host
  registers once at app startup as part of `AppServices`).
  Host functions that need randomness call
  `ctx.services.app.rng.next()`.
- `packages/core/src/brain/brain.ts` becomes a thin facade:
  - Holds `brainDef`, `services: BrainServices`, `linkEnvironment`,
    `pages: List<BrainPage>`, `compiledProgram`, and (after
    `initialize`) a `runtime: BrainRuntime`.
  - `initialize(contextData)` runs `compileBrain` ->
    `linkBrainProgram` -> `treeshakeProgram`, calls
    `assignFuncIds` on every `BrainPage`, builds the
    `PlatformServices` aggregate, constructs the `BrainRuntime`,
    and subscribes to its `page_activated` / `page_deactivated`
    events to fan them out to `BrainPage.activate()` /
    `BrainPage.deactivate()`. Every other `IBrain` method delegates
    to `this.runtime`.
  - `getCompiledProgram()` returns the unlinked compiler output
    held on the facade.
- The firewall stays green (`BASELINE_VIOLATIONS = 0`). After this
  split, that property is non-vacuous because
  `runtime/brain-runtime.ts` is a real, executing module.
- A constrained-target port can:
  - skip `brain/` entirely,
  - link `runtime/` only,
  - load a pre-compiled `Program` blob (produced off-target by the
    TS toolchain),
  - construct a `BrainRuntime` directly,
  - call `think(currentTime)` in a tick loop.
- A self-test in `packages/core/src/runtime/brain-runtime.spec.ts`
  demonstrates the constrained-target path: it constructs a
  `BrainRuntime` from a pre-built `Program` and a
  `PlatformServices` (built via the runtime-only test factory at
  `packages/core/src/runtime/test-only-runtime-services-factory.ts`)
  with no import path through `brain/`.

## Key Invariants

- Every existing brain behavior test (`brain.spec.ts`,
  `callsite-host-state-lifetime.spec.ts`, all `vm-*.spec.ts`,
  `mindcraft-environment.spec.ts`, `apps/sim/**/*.spec.ts`) passes
  after every phase with the same observable behavior. The split is
  structural, not behavioral.
- `Brain` remains a class implementing `IBrain` and remains
  subclassable. `ManagedMindcraftBrain` in
  `packages/core/src/mindcraft.ts` continues to override
  `initialize`, `startup`, `shutdown` with `super.initialize(...)`
  / `super.shutdown()` / `super.startup()` calls that work
  identically.
- The `BrainRuntime` constructor is the single runtime entry point.
  No `BrainRuntime.initialize()` method exists; the runtime is
  fully ready to `startup()` immediately after construction.
- `BrainRuntime` value-imports nothing from `packages/core/src/brain/`.
  The firewall test enforces this; B7 includes a self-test for
  the firewall that asserts a synthetic violation is detected.
- `BrainPage.activate()` / `BrainPage.deactivate()` are called
  exactly once per page activation / deactivation, in the same
  order they are today. The bridge from `BrainRuntime` to
  `BrainPage` runs through the existing `BrainEvents` channel
  (`page_activated`, `page_deactivated`) with no new public
  surface.
- No object-shaped reach-through from runtime to authoring
  survives. `BrainRuntime` does not hold `BrainPage` references;
  it holds only the `pageMetadata: List<PageMetadata>` produced by
  the linker.
- **Hot-reload is preserved.** `Brain.initialize()` may be called
  more than once on the same `Brain` instance (the existing
  `ManagedMindcraftBrain.rebuild()` path; an upcoming
  hot-reload feature relies on this). Across a re-init, every
  variable whose name exists in both the old and the new
  `program.variableNames` keeps its value; variables only in the
  old program are dropped; variables new to the new program start
  unwritten. This matches today's `Brain.installVariableTable`
  carry-forward semantics. The split MUST preserve this; phases
  that touch variable storage (B2) or the runtime construction
  flow (B3, B5) MUST pipe the carry-forward through. No phase may
  introduce a mechanism that makes hot-reload harder to implement.

  Note on `clearVariables()`: a slot that was explicitly
  cleared and a slot that was never written are
  indistinguishable (both read as the unwritten sentinel).
  After re-init they remain indistinguishable; callers
  must not depend on the difference between "cleared"
  and "unwritten" surviving a rebuild.

## No Backward Compatibility (within the repo)

- No deprecation aliases for `Brain` -> `BrainRuntime`. The
  `Brain` facade preserves the `IBrain` surface; tests and
  consumers continue to import `Brain` from
  `packages/core/src/brain`.
- No re-export of `BrainRuntime` from `brain/`. The new class is
  reachable only via `runtime/` exports
  (`packages/core/src/runtime/index.ts`).
- No parallel "old path / new path" runtime state. Each concern
  lives in exactly one place after its phase ships.
- No phase / unit markers in shipped code. Do not embed strings
  like "Phase B3", "B4", or references to this spec file in
  source comments, test names, JSDoc, or config-file comments.

## Multi-Target Core Constraints (Roblox-ts portability)

All constraints in `.github/instructions/core.instructions.md` apply
to every phase in this plan.

`BrainRuntime` is particularly sensitive to the value-cycle
constraint: it consumes `Program`, `PageMetadata`, `PlatformServices`
from `runtime/` and is itself in `runtime/`. Re-exports through
`runtime/index.ts` must not introduce a cycle with
`runtime-services.ts` (which imports `IBrain` from
`host-bindings.ts`). Any new value import added under `runtime/`
during this spec must be checked against the existing
`runtime/index.ts` graph before merging.

The unit gate for any phase that touches `packages/core/src/` is
the full chain from `packages/core`:

```
npm run typecheck && npm run check && npm test && npm run build
```

`npm run build` is mandatory -- it is the only step that runs
`rbxtsc` and catches Luau-incompatible code.

## Workflow Convention

Phases ship one at a time and are numbered B0-B8. Each phase
follows this loop:

1. Agent implements the phase.
2. Agent stops and presents work for review.
3. The user reviews, requests changes or approves.
4. Only after the user declares the unit complete does the post-mortem
   happen.
5. Post-mortem updates Current State, Phase Log, propagates new risks to
   future phases, and writes any useful repo memory notes
   (`/memories/repo/brain-runtime-split-<phase>.md`, where `<phase>`
   is the phase identifier such as `A0`, `B0`, ..., `B8`).

Do NOT amend Current State, Phase Log, propagate risks, or create repo memory notes during implementation.

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

**Repo memory note (`/memories/repo/brain-runtime-split-<phase>.md`,
target: 10-25 lines).** Write only if the unit established invariants or owed
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

Completed: A0, B0, B1, B2, B3, B4, B5, B6
Next up: B7

---

## Phase Log

### A0 -- AppServices tier and `Brain.rng()` removal

Split `PlatformServices` into a nested struct `{ runtime, shared, app, brain }`
backed by new `RuntimeLangServices`, `SharedLangServices`, `EditLangServices`,
`AppServices`, and `BrainInstanceServices` interfaces; deleted `Brain.rng()` /
`IBrain.rng()` and routed RNG through `services.app.rng` registered at
`MindcraftEnvironment` construction. `BrainServices` reshaped to
`{ runtime, edit, shared, app }`; standalone `functions` / `types` removed.

New contract surface: `AppServices`, `RuntimeLangServices`,
`SharedLangServices`, `EditLangServices`, `BrainInstanceServices`,
nested `PlatformServices`, `MindcraftEnvironment.appServices`,
optional `rng` parameter on `createMindcraftEnvironment`.

Verification: full gate green (752/752 core, 981/981 ts-compiler).

### B0

Completed (no post-mortem notes written as user's request).

### B1 -- `BrainRuntime` skeleton

Landed an empty `IBrainRuntime` interface and a method-less `BrainRuntime` class
implementing it, with the pinned 5-parameter constructor (`program`,
`pageMetadata`, `hostServices`, `contextData`, `previousVariables`). `IBrain`
now extends `IBrainRuntime`; its own body is unchanged.

New contract surface: `IBrainRuntime`, `BrainRuntime`, `VariableSnapshot`.

Verification: full gate green (752/752 core).

#### Risks

- Biome's `noEmptyInterface` auto-fix rewrote `interface IBrainRuntime {}`
  to `type IBrainRuntime = {}`. `IBrain extends IBrainRuntime` still
  type-checks against an object-type alias, but B2 must convert it back to
  `interface IBrainRuntime { ... }` in the same diff that adds the first
  member; otherwise the three-step coordinated-edit dance (add to
  `IBrainRuntime`, remove from `IBrain`'s body, implement on
  `BrainRuntime`) does not have an interface to grow.
- The firewall invariant on `IBrainRuntime` is vacuous until B2 adds the
  first method. Reviewers of B2 should re-check the firewall report
  explicitly rather than relying on a green pass that proves nothing.

### B2 -- Move Variable Storage

Variable storage moved from `Brain` to `BrainRuntime`; `Brain` delegates the
six public variable methods; hot-reload carry-forward threads through
`snapshotVariables()` and the `previousVariables` constructor parameter.

New contract surface: `IBrainRuntime` gains the four name-keyed variable
accessor signatures; `BrainRuntime.snapshotVariables()`.

Verification: full gate green (752/752 tests).

#### Risks

- B1 stored `previousVariables` as `protected readonly` on `BrainRuntime`.
  B2 changed it to a plain constructor parameter consumed in-place by
  `installVariableTable` and not stored. B3 and later must not assume
  `this.previousVariables` exists on the runtime instance.
- `BrainRuntime.snapshotVariables()` returns live references (no copy).
  Callers must consume the snapshot before any write to the old runtime's
  variable storage -- in practice it is only called immediately before
  dropping the old runtime, so this is not a hazard today, but B3 must
  not introduce a path where the snapshot is held across a write.

### B3 -- Move VM/scheduler/context and wire BrainRuntime into initialize()

VM, scheduler, executionContext, callsiteStore, ruleVariableStores,
activeRuleFiberIds, and nextInlineFiberId moved from Brain to BrainRuntime.
Brain.initialize() rewritten to assemble PlatformServices locally and pass
it to new BrainRuntime(...). BrainRuntime gains events() (backed by its own
emitter_) so Brain.initialize() can subscribe the page-bridge callbacks;
the emitter is transitional and becomes authoritative in B5.

New transitional surface on BrainRuntime (removed in B5): _vm(),
_scheduler(), _executionContext(), _callsiteStore(), _ruleVariableStores(),
_getActiveRuleFiberIds(), _setActiveRuleFiberIds(), _consumeNextInlineFiberId().

Verification: full gate green (752/752 tests).

#### Risks

- BrainRuntime.events() exists but nothing emits to it until B5. Brain still
  owns emitter_ and fires page_activated / page_deactivated from activatePage /
  deactivateCurrentPage. The page-bridge subscription in initialize() is wired
  but silently inert. B5 must move the emit sites to BrainRuntime and delete
  Brain.emitter_ in the same diff or page callbacks will double-fire or drop.
- Transitional accessors use plain-method syntax (_vm(), _scheduler(), etc.)
  rather than get/set because rbxtsc forbids getters/setters on classes.
  B4 and B5 must respect this constraint when adding any new transitional
  surface on BrainRuntime.
- BrainRuntime constructor accepts full PlatformServices (not
  Omit<PlatformServices, "brain">). The spec's Desired End State says the
  final ctor takes hostServices: Omit<PlatformServices, "brain"> and builds
  the brain tier internally. That narrowing is deferred to B5 when the
  brain tier construction moves into BrainRuntime. Until then, Brain passes
  the fully assembled PlatformServices and BrainRuntime trusts it.

### B4 -- Move Activation / Deactivation Hook Drivers

The seven hook driver methods moved from `Brain` to `BrainRuntime`;
`Brain.activatePage` and `Brain.runDeactivationHooksForCurrentPage` now
delegate via `this.runtime.<method>(...)`. `BytecodeExecutableAction`,
`ExecutionContext`, and `VmStatus` imports removed from `brain.ts`.

New transitional surface on `BrainRuntime` (public until B5 demotes to private):
`runHostActivationHook`, `runHostInitializerHook`, `runBytecodeInitializerHook`,
`runBytecodeActivationHook`, `runBytecodeDeactivationHook`,
`runHostDeactivationHook`, `runBytecodeHook`. Each carries `@deprecated`.

Verification: full gate green (752/752 tests).

#### Risks

- The seven hook drivers are `public` on `BrainRuntime`. B5 must demote all
  seven (including `runBytecodeHook`) to `private` in the same diff that moves
  the FSM in. Leaving any one public after B5 is a surface leak.
- The spec's B4 procedure step said to tag the methods with
  `@deprecated transitional; becomes private in B5` -- that text contains phase
  markers forbidden by the global rule. The resolved form is plain `@deprecated transitional`
  with no phase text. B5 should follow the same pattern for any temporary surface
  it adds.

### B5 -- Move Page Lifecycle FSM and Page Lookup Tables

Page lifecycle FSM (concern 6) and page lookup tables (concern 8) moved from
`Brain` to `BrainRuntime`. All 9 transitional getters removed. All 7 hook
drivers demoted to `private`. `BrainRuntime` constructor narrowed to
`hostServices: Omit<PlatformServices, "brain">`; it now builds the brain tier
internally. `createRuntimeServices` parameter narrowed from `IBrain` to
`IBrainRuntime`. `Brain` is now a thin facade with no private methods except
`getLinkEnvironment`.

New contract surface: `IBrainRuntime` gains `events`, `startup`, `shutdown`,
`think`, `setEnabled`, `isEnabled`, `interrupt`, `clearInterrupt`,
`isInterrupted`, `requestPageChange`, `requestPageChangeByPageId`,
`requestPageChangeByName`, `requestPageRestart`, `getCurrentPageId`,
`getPreviousPageId`, `getVariableBySlot`. `IBrain` own body narrowed to
`initialize` and `getCompiledProgram`.

Verification: full gate green (752/752 tests).

#### Risks

- Table 1 spec'd `getVariableBySlot` as facade-delete (rule 4 -- VM dispatch
  internal). During review it was restored to `IBrainRuntime` and `Brain` to
  preserve test coverage of slot-layer vs. name-layer storage agreement.
  `setVariableBySlot` remains internal (slot writes are unsafe to expose).
  B6 and later must keep `getVariableBySlot` on `IBrainRuntime`; removing it
  re-opens the coverage gap.

### B6 -- Reduce `Brain` To A Facade

Subscription handles for the page-lifecycle event bridge (registered in
`initialize()`) are now stored in a `unsubs: List<() => void>` field
and torn down unconditionally in `shutdown()`. The facade field set and
delegation pattern are otherwise unchanged from B5.

Verification: full gate green (752/752 tests).

#### Risks

- `Brain.initialize()` pushes new subscriptions each call without first
  clearing the list. If called twice without an intervening `shutdown()`,
  the list grows with stale entries that reference a dropped emitter (GC-safe,
  no double-fire). `ManagedMindcraftBrain` guards against this by always
  calling `super.shutdown()` before `super.initialize()`. B7 and B8 do not
  touch `Brain`; any future caller that skips `shutdown()` before re-init
  will accumulate dead closures.
- The spec's import audit listed `Value` as an import to remove from `brain.ts`.
  The import is required for the `getVariable<T extends Value>` and
  `setVariable(varId: string, value: Value)` method signatures; it was retained.
  No behavioral gap; no follow-up action needed.

---

## Phase B0 Decisions

Inspection commit: `dca5e9bf8d72b2b2002df593ea8a2269e901bede`.

External-reader survey covers: `packages/core/src/`, `packages/ts-compiler/src/`,
`packages/ui/src/`, `apps/sim/src/`, `apps/vscode-extension/src/`,
`apps/lbb/src/`, `packages/bridge-app/src/`, `packages/bridge-client/src/`,
`packages/service-api/src/`. Field/private-method readers that resolve to
non-`Brain` symbols (e.g. `IBrainDef.pages()`, `services.brain.pages`,
`actor.brainDef`, JSON `brain.pages`) are not counted.

Facade delegates for `move-to-runtime` rows preserve the existing `Brain`
method signature exactly (the facade's method body becomes
`return this.runtime.<method>(...)` or the void equivalent); the `notes`
cell records the wrapper signature only when it differs from the original
member shape.

### Table 1 -- Per-member dispositions

| field-or-method | kind | external-readers | disposition | target-class | phase | notes |
| --------------- | ---- | ---------------- | ----------- | ------------ | ----- | ----- |
| `brainDef` | field | none (`grep -n 'brain\.brainDef' packages apps`: no `Brain`-instance hits; matches resolve to `BrainActor.brainDef`) | keep-on-facade | Brain (facade) | - | rule 1 -- authoring graph holder; consumed by `getLinkEnvironment` and the ctor `BrainPage` build |
| `services` | field | none (private) | keep-on-facade | Brain (facade) | - | rule 1 -- supplies the three host-tier sub-aggregates passed to the runtime ctor and `getLinkEnvironment` |
| `linkEnvironment` | field | none (private; mutated by `ManagedMindcraftBrain.refreshLinkEnvironment`) | keep-on-facade | Brain (facade) | - | rule 2 -- compile-side input; re-init reads it via `getLinkEnvironment` |
| `pages` | field | none (`brain\.pages` matches resolve to `IBrainDef.pages()`, `services.brain.pages`, JSON `brain.pages`; no `Brain.pages` reader) | keep-on-facade | Brain (facade) | - | rule 1 -- authoring runtime page list; B5 facade event subscriber reads `this.pages.get(pageIndex)` to invoke `BrainPage.activate()`/`deactivate()` |
| `emitter_` | field | none | move-to-runtime | BrainRuntime | B5 | rule 3 -- emit sites are `activatePage`/`deactivateCurrentPage`, both move in B5; facade-delete (rule 4) |
| `enabled` | field | none | move-to-runtime | BrainRuntime | B5 | rule 3 -- read by `think`, written by `setEnabled`; facade-delete (rule 4) |
| `interrupted` | field | none | move-to-runtime | BrainRuntime | B5 | rule 3; facade-delete (rule 4) |
| `currentPageIndex` | field | none | move-to-runtime | BrainRuntime | B5 | rule 3 -- FSM state; facade-delete (rule 4) |
| `desiredPageIndex` | field | none | move-to-runtime | BrainRuntime | B5 | rule 3; facade-delete (rule 4) |
| `previousPageIndex` | field | none | move-to-runtime | BrainRuntime | B5 | rule 3; facade-delete (rule 4) |
| `restartPageRequested` | field | none | move-to-runtime | BrainRuntime | B5 | rule 3; facade-delete (rule 4) |
| `lastThinkTime` | field | none | move-to-runtime | BrainRuntime | B5 | rule 3; facade-delete (rule 4) |
| `variables` | field | none | move-to-runtime | BrainRuntime | B2 | rule 3 -- VM dispatch reads via `getVariableBySlot`; facade-delete (rule 4) |
| `varSlotByName` | field | none | move-to-runtime | BrainRuntime | B2 | rule 3; facade-delete (rule 4) |
| `compiledProgram` | field | none (only via `getCompiledProgram`) | keep-on-facade | Brain (facade) | - | rule 2 -- compile output; backs `getCompiledProgram` |
| `program` | field | none (only via `getProgram`) | move-to-runtime | BrainRuntime | B3 | rule 3 -- VM input; ctor parameter on runtime; facade does not store it (B6 acceptance 11 in B5 spec) |
| `ruleIndex` | field | none | move-to-runtime | BrainRuntime | B3 | rule 3 -- consumed by `BrainPage.assignFuncIds` during init; field itself is local on facade after B3 |
| `pageMetadata` | field | none (only via `getPages`) | move-to-runtime | BrainRuntime | B3 | rule 3 -- ctor parameter on runtime; facade does not store it |
| `vm` | field | none | move-to-runtime | BrainRuntime | B3 | rule 3; facade-delete (rule 4) |
| `scheduler` | field | none | move-to-runtime | BrainRuntime | B3 | rule 3; facade-delete (rule 4) |
| `executionContext` | field | none | move-to-runtime | BrainRuntime | B3 | rule 3; facade-delete (rule 4) |
| `callsiteStore` | field | none | move-to-runtime | BrainRuntime | B3 | rule 3 -- backs `services.brain.callsite`; facade-delete (rule 4) |
| `ruleVariableStores` | field | none | move-to-runtime | BrainRuntime | B3 | rule 3 -- backs `services.brain.ruleVars`; facade-delete (rule 4) |
| `activeRuleFiberIds` | field | none | move-to-runtime | BrainRuntime | B3 | rule 3 -- scheduler bookkeeping; facade-delete (rule 4) |
| `nextInlineFiberId` | field | none | move-to-runtime | BrainRuntime | B3 | rule 3 -- hook fiber id counter; facade-delete (rule 4) |
| `pageIdToIndex` | field | none | move-to-runtime | BrainRuntime | B5 | rule 3 -- O(1) lookup; built in runtime ctor; facade-delete (rule 4) |
| `pageNameToIndex` | field | none | move-to-runtime | BrainRuntime | B5 | rule 3; facade-delete (rule 4) |
| `constructor` | method | call sites: `BrainDef.compile()` (`braindef.ts:192`), `ManagedMindcraftBrain` ctor chain (`mindcraft.ts`) | keep-on-facade | Brain (facade) | - | rule 1 -- builds `BrainPage` instances from `IBrainDef.pages()`; signature unchanged |
| `events()` | method | `apps/sim/src/brain/actor.ts:168,169,186,189,190,424` | move-to-runtime | BrainRuntime | B5 | rule 3 -- per B0 bridge rule 2, facade returns `this.runtime.events()` directly; wrapper signature `events(): EventEmitterConsumer<BrainEvents>` |
| `initialize` | method | `mindcraft.ts` (`super.initialize` in `ManagedMindcraftBrain`), `brain.spec.ts`, `mindcraft-environment.spec.ts` | keep-on-facade | Brain (facade) | - | rule 2 -- compile/link/treeshake pipeline plus `new BrainRuntime(...)` plus event-bridge subscribe |
| `isInitialized()` | method | `mindcraft.ts:1043,1069,1082,1104` (subclass `this.isInitialized()`) | keep-on-facade | Brain (facade) | - | rule 2 -- after B6 reads `this.runtime !== undefined`; signature unchanged |
| `getProgram()` | method | `brain.spec.ts`, `mindcraft-environment.spec.ts:344`, `mindcraft.ts:1152` (`this.getProgram()` in subclass) | move-to-runtime | BrainRuntime | B3 | rule 5 -- runtime is source of truth; facade delegate `getProgram(): Program \| undefined` returns `this.runtime?.getProgram()` |
| `getCompiledProgram()` | method | `brain.spec.ts` test fixtures | keep-on-facade | Brain (facade) | - | rule 2 -- backed by facade-resident `compiledProgram` |
| `getPages()` | method | `apps/sim/src/brain/actor.ts:195`, `brain.spec.ts:716,741,781,832,833` | move-to-runtime | BrainRuntime | B3 | rule 5 -- runtime owns `pageMetadata`; facade delegate `getPages(): List<PageMetadata>` returns `this.runtime?.getPages() ?? List.empty()` |
| `getVariable<T>(varId)` | method | `packages/ts-compiler/src/compiler/struct.spec.ts:659,917`, `packages/core/src/brain/brain.spec.ts` (many), `packages/core/src/brain/callsite-host-state-lifetime.spec.ts`, `mindcraft-environment.spec.ts:342,343` | move-to-runtime | BrainRuntime | B2 | rule 3 -- variable storage owner; facade delegate `getVariable<T extends Value>(varId: string): T \| undefined` |
| `setVariable(varId, value)` | method | `packages/ts-compiler/src/compiler/struct.spec.ts:705`, `packages/ts-compiler/src/compiler/compile.spec.ts:53`, `mindcraft-environment.spec.ts:341` | move-to-runtime | BrainRuntime | B2 | rule 3; facade delegate `setVariable(varId: string, value: Value): void` |
| `clearVariable(varId)` | method | none | move-to-runtime | BrainRuntime | B2 | rule 3 -- on `IBrain` so facade delegate required despite zero external readers; signature `clearVariable(varId: string): void` |
| `clearVariables()` | method | none (called only by `Brain.shutdown`) | move-to-runtime | BrainRuntime | B2 | rule 3; on `IBrain` so facade delegate required; signature `clearVariables(): void` |
| `getVariableBySlot(slotId)` | method | none external (called by VM via `ExecutionContext` arrow) | move-to-runtime | BrainRuntime | B2 | rule 3 -- VM dispatch hot path; not on `IBrain`, but `executionContext` arrow moves with it; facade-delete (rule 4) |
| `setVariableBySlot(slotId, value)` | method | none external | move-to-runtime | BrainRuntime | B2 | rule 3 -- VM dispatch hot path; facade-delete (rule 4) |
| `installVariableTable(programVariableNames)` | method | none (private; called only by `Brain.initialize`) | move-to-runtime | BrainRuntime | B2 | rule 6 -- caller after B2 is the `BrainRuntime` ctor (carry-forward from `previousVariables` snapshot per Hot-reload invariant); facade-delete (rule 4) |
| `setEnabled(enabled)` | method | none | move-to-runtime | BrainRuntime | B5 | rule 3 -- gates `think`; on `IBrain` so facade delegate required; signature `setEnabled(enabled: boolean): void` |
| `isEnabled()` | method | none | move-to-runtime | BrainRuntime | B5 | rule 3; facade delegate `isEnabled(): boolean` |
| `interrupt()` | method | none | move-to-runtime | BrainRuntime | B5 | rule 3; facade delegate `interrupt(): void` |
| `clearInterrupt()` | method | none | move-to-runtime | BrainRuntime | B5 | rule 3; facade delegate `clearInterrupt(): void` |
| `isInterrupted()` | method | none | move-to-runtime | BrainRuntime | B5 | rule 3; facade delegate `isInterrupted(): boolean` |
| `requestPageChange(pageIndex)` | method | `brain.spec.ts` (many), `mindcraft-environment.spec.ts:335`, `callsite-host-state-lifetime.spec.ts` | move-to-runtime | BrainRuntime | B5 | rule 3; facade delegate `requestPageChange(pageIndex: number): void` |
| `requestPageChangeByPageId(pageId)` | method | `brain.spec.ts:597` | move-to-runtime | BrainRuntime | B5 | rule 3; facade delegate `requestPageChangeByPageId(pageId: string): void` |
| `requestPageChangeByName(name)` | method | none external (called from `requestPageChangeByPageId` fallback) | move-to-runtime | BrainRuntime | B5 | rule 3; on `IBrain` so facade delegate required; signature `requestPageChangeByName(name: string): void` |
| `requestPageRestart()` | method | `brain.spec.ts:905,1008,1293`, `runtime/actuators/restart-page.ts` (via `services.brain.pages`) | move-to-runtime | BrainRuntime | B5 | rule 3; facade delegate `requestPageRestart(): void` |
| `getCurrentPageId()` | method | `mindcraft-environment.spec.ts:338,339`, `runtime/sensors/current-page.ts` (via `services.brain.pages`) | move-to-runtime | BrainRuntime | B5 | rule 3; facade delegate `getCurrentPageId(): string` |
| `getPreviousPageId()` | method | none external on `Brain`; `runtime/sensors/previous-page.ts` reads via `services.brain.pages` | move-to-runtime | BrainRuntime | B5 | rule 3; on `IBrain` so facade delegate required; signature `getPreviousPageId(): string` |
| `startup()` | method | `apps/sim/src/brain/actor.ts:170,191`, `brain.spec.ts` (many), `mindcraft-environment.spec.ts:332,333`, `mindcraft.ts` (`super.startup`) | move-to-runtime | BrainRuntime | B5 | rule 3; facade delegate `startup(): void` short-circuits when `runtime` is undefined per B6 step 6 |
| `shutdown()` | method | `brain.spec.ts:1229`, `mindcraft.ts` (`super.shutdown`) | move-to-runtime | BrainRuntime | B5 | rule 3; facade delegate `shutdown(): void` calls `this.runtime?.shutdown()` and tears down event subscriptions |
| `think(currentTime)` | method | `apps/sim/src/brain/actor.ts:250`, `brain.spec.ts` (many), `callsite-host-state-lifetime.spec.ts` (many), `mindcraft-environment.spec.ts:336` | move-to-runtime | BrainRuntime | B5 | rule 3; facade delegate `think(currentTime: number): void` |
| `activatePage(pageIndex)` | method | none (private) | move-to-runtime | BrainRuntime | B5 | rule 3 -- FSM helper; facade-delete (rule 4); B5 step 4 replaces inline `page.activate()` with `emitter_.emit("page_activated", ...)` |
| `cancelActiveFibers()` | method | none (private) | move-to-runtime | BrainRuntime | B5 | rule 3 -- scheduler helper; facade-delete (rule 4) |
| `deactivateCurrentPage()` | method | none (private) | move-to-runtime | BrainRuntime | B5 | rule 3; facade-delete (rule 4); B5 step 4 replaces inline `page.deactivate()` with emit |
| `runDeactivationHooksForCurrentPage()` | method | none (private) | move-to-runtime | BrainRuntime | B5 | rule 3 -- composes hook drivers; facade-delete (rule 4) |
| `thinkPage(currentTime, dt)` | method | none (private) | move-to-runtime | BrainRuntime | B5 | rule 3 -- scheduler tick; facade-delete (rule 4) |
| `shouldRespawnFiber(fiberId)` | method | none (private) | move-to-runtime | BrainRuntime | B5 | rule 3; facade-delete (rule 4) |
| `runHostActivationHook(callSiteId, onPageEntered)` | method | none (private) | move-to-runtime | BrainRuntime | B4 | rule 3 -- activation hook driver; facade-delete (rule 4); public on runtime during B4-B5 transition then private (per B4 step 1, B5 step 9) |
| `runHostInitializerHook(callSiteId, onInitialized)` | method | none (private) | move-to-runtime | BrainRuntime | B4 | rule 3; same transitional visibility; facade-delete (rule 4) |
| `runBytecodeInitializerHook(action, callSiteId)` | method | none (private) | move-to-runtime | BrainRuntime | B4 | rule 3; facade-delete (rule 4) |
| `runBytecodeActivationHook(action, callSiteId)` | method | none (private) | move-to-runtime | BrainRuntime | B4 | rule 3; facade-delete (rule 4) |
| `runBytecodeDeactivationHook(action, callSiteId)` | method | none (private) | move-to-runtime | BrainRuntime | B4 | rule 3; facade-delete (rule 4) |
| `runHostDeactivationHook(callSiteId, onPageExited)` | method | none (private) | move-to-runtime | BrainRuntime | B4 | rule 3; facade-delete (rule 4) |
| `runBytecodeHook(action, callSiteId, funcId, label)` | method | none (private) | move-to-runtime | BrainRuntime | B4 | rule 3 -- shared hook fiber executor; throws on `VmStatus.FAULT`/non-`DONE`; facade-delete (rule 4) |
| `isValidPageIndex(pageIndex)` | method | none (private) | move-to-runtime | BrainRuntime | B5 | rule 3 -- guards FSM transitions; facade-delete (rule 4) |
| `getLinkEnvironment()` | method | none (private; called from `Brain.initialize`) | keep-on-facade | Brain (facade) | - | rule 2 -- builds `BrainLinkEnvironment` from `services.edit.tiles` and `services.runtime.actions`; consumed only by the compile pipeline |

---

## Phase B0 -- Decision Tables

**Purpose.** Pin the per-member disposition decisions that B1-B8
cannot proceed without, before any code moves.

**Deliverable.** One table (table 1, schema below) appended to
this plan under a single new section `## Phase B0 Decisions`
placed directly below `## Phase Log`. The section header records
the git commit hash of the inspection commit; until B0 lands,
use HEAD at the start of B0 work and update the hash at merge.

B0 is the **only** phase that mutates the spec body. Subsequent
phases append to the Phase Log only; they do not add `## Phase B<N> Decisions`
sections.

The constructor signature (B0 originally produced this as table 2)
and the page-lifecycle event bridge (B0 originally produced this
as table 3) are pre-decided in this spec body under "Desired End
State" and "Bridge rules for the page-lifecycle event channel"
respectively. B0 does not re-derive them.

### Source paths (the agent inspects only these)

- **Authoring/runtime mixed source:**
  `packages/core/src/brain/brain.ts` -- the `Brain` class. Every
  field and every method is a row in table 1.
- **Public runtime interface:**
  `packages/core/src/runtime/host-bindings.ts` -- `IBrain`
  (lines 137-167), `IBrainPage` (169-171), `BrainEvents` (131),
  `PageMetadata` (107), `LinkedBrainProgram` (82),
  `BrainLinkEnvironment` (101).
- **Runtime services adapter (informational; not edited in B0):**
  `packages/core/src/runtime/runtime-services.ts` -- consumes
  `IBrain` (line 28) to back the dense-state adapters. After the
  split it must accept whatever the new `BrainRuntime` class
  satisfies; B0 pins which interface that is.
- **Compile-side construction:**
  `packages/core/src/brain/model/braindef.ts` --
  `BrainDef.compile()` (line 192) returns
  `new Brain(this, this.services_)`.
- **Subclass that constrains the facade shape:**
  `packages/core/src/mindcraft.ts` --
  `ManagedMindcraftBrain extends Brain` (~line 975) overrides
  `initialize`, `startup`, `shutdown`. The override pattern
  (`super.initialize(...)` / `super.shutdown()` /
  `super.startup()` with `this.started` bookkeeping in between)
  is load-bearing and must survive the split.
- **`BrainPage` activate-deactivate API (informational):**
  `packages/core/src/brain/page.ts` --
  `BrainPage.activate()` (~line 50),
  `BrainPage.deactivate()` (~line 60),
  `BrainPage.assignFuncIds()` (~line 75). These are
  authoring-side calls that today fire from
  `Brain.activatePage` / `Brain.deactivateCurrentPage`. B0
  pins the bridge mechanism by which the post-split
  `BrainRuntime` (which cannot import `BrainPage`) triggers
  them.
- **External call sites:** every `new Brain(` and every
  `brain.<method>` invocation under `packages/core/src/`,
  `apps/sim/src/`, `apps/vscode-extension/src/`,
  `apps/lbb/src/`, `packages/bridge-app/src/`,
  `packages/bridge-client/src/`, `packages/service-api/src/`.
  These are inputs to table 1's "facade-method-survives"
  disposition.

### Procedure (execute in order)

1. Pin the inspection commit. Record the SHA in the
   `## Phase B0 Decisions` header.
2. Read `brain.ts` end-to-end. Seed table 1 with one row per
   field and one row per method. Leave `disposition`,
   `target-class`, `phase`, and `notes` blank.
3. For each row, apply the disposition rules below to fill
   `disposition`. Then fill `target-class` (`BrainRuntime`,
   `Brain` (facade), or `(deleted)`), `phase` (the B-phase
   that performs the move), and a one-clause `notes` cell.
4. Walk all external call sites enumerated under "Source
   paths". For each method on `Brain` that table 1 marked
   `target-class = BrainRuntime`, confirm that the facade
   still exposes a delegating method of the same name and
   signature (so call sites do not change). The default
   for any item with external readers is
   `move-to-runtime` plus a mandatory facade delegate;
   `facade-delete` is reserved for items that satisfy
   rule 4 (zero external readers), and applying it to an
   item with external readers is a B0 acceptance failure.
5. Run the validation checklist (Acceptance section). Every
   item must pass before B0 ships.

### Disposition rules for table 1 (apply in order)

1. If the field / method participates in the authoring graph
   (uses `BrainPage`, `BrainRule`, `IBrainDef`,
   `BrainServices` (the edit-time aggregate with fields
   `{ runtime, edit, shared, app }`), `BrainLinkEnvironment`,
   `compileBrain`), it is `keep-on-facade`. Goes to `Brain`
   (facade).
2. If the field / method participates in compile / link /
   treeshake (`compiledProgram`, `getCompiledProgram`,
   `installVariableTable` callers on the compile side,
   `getLinkEnvironment`), it is `keep-on-facade`.
3. If the field / method is touched by VM dispatch, the
   scheduler tick loop, or a host function during a tick
   (variable storage, callsiteStore, ruleVariableStores,
   activeRuleFiberIds, vm, scheduler, executionContext, the
   page lifecycle FSM state, the activation / deactivation
   hook drivers, page lookup tables), it is
   `move-to-runtime`. Goes to `BrainRuntime`. The facade
   gets a delegating method of the same name and signature.
4. If the field / method has zero external readers and is
   only read by code in the move set (rule 3), it is
   `move-to-runtime` with no facade delegate
   (`facade-delete`). The agent records the grep that
   proved zero external readers in the `notes` cell.
5. If the field / method has external readers but
   participates in both runtime and edit-side concerns (e.g.
   `getProgram()` is called by the runtime for VM
   construction *and* by external diagnostics), it is
   `move-to-runtime` and the facade exposes a delegating
   wrapper. The runtime is the source of truth; the facade
   reads from it.
6. If the field / method is `_`-prefixed or `private` and
   used only inside `brain.ts`, the disposition is
   determined by which class in the post-split layout calls
   it; the row's `notes` cell names the caller.

### Constructor signature (pre-decided)

The `BrainRuntime` constructor signature is pinned by "Desired
End State" above:

- `program: Program` (linked, treeshaken)
- `pageMetadata: List<PageMetadata>`
- `hostServices: Omit<PlatformServices, "brain">` -- the three
  non-`brain` tiers of the nested `PlatformServices` (`runtime`,
  `shared`, `app`). The runtime builds the `brain` tier
  internally.
- `contextData: unknown` (defaults to `undefined`)
- `previousVariables?: VariableSnapshot` (defaults to `undefined`)

Variable-name -> slot binding is read from `program.variableNames`
inside the constructor. The constructor accepts no authoring
type (`IBrainDef`, `BrainPage`, `BrainRule`, `IBrainPageDef`,
`IBrainRuleDef`, `BrainServices`, `BrainLinkEnvironment`); the
firewall enforces this for value imports and the spec pins it
for types as well. No optional `linkEnvironment` parameter --
linking happens on the facade side before the runtime is
constructed. The constructor does not accept a full
`PlatformServices`: the runtime builds the
`BrainInstanceServices` half (`program`, `brainVars`,
`ruleVars`, `pages`, `callsite`) internally and composes
it with `hostServices` into the nested `PlatformServices`
consumed by `VM`. No callbacks for `page.activate()` /
`page.deactivate()`; those run via the `BrainEvents` channel
per the bridge rules below.

### Bridge rules for the page-lifecycle event channel (pre-decided)

The page-lifecycle event bridge solves: `BrainRuntime`
decides a page activation / deactivation occurred and must
trigger the authoring-side `BrainPage.activate()` /
`BrainPage.deactivate()` calls that today live inline in
`Brain.activatePage` / `Brain.deactivateCurrentPage` --
without `BrainRuntime` importing `BrainPage`.

1. The bridge uses the existing `BrainEvents` channel
   (`page_activated`, `page_deactivated`). No new public
   surface.
2. `BrainRuntime` owns the `EventEmitter<BrainEvents>` and
   exposes it via `events(): EventEmitterConsumer<BrainEvents>`.
   The facade returns the runtime's emitter consumer
   directly from `Brain.events()` (no re-emit, no
   double-subscribe).
3. The facade subscribes to `page_activated` and
   `page_deactivated` inside `Brain.initialize()`, after
   constructing the `BrainRuntime`. The subscriber callbacks
   invoke `BrainPage.activate()` / `BrainPage.deactivate()`
   on `this.pages.get(pageIndex)`.
4. Subscription order matters: the runtime emits the event
   *after* its own state transition (fibers spawned for
   activate; fibers cancelled and hooks run for deactivate).
   The facade's subscriber runs `BrainPage.activate()` /
   `deactivate()` synchronously inside the emit. External
   listeners registered through `events()` see the event
   *after* the facade's subscriber runs. This ordering is
   preserved by registering the facade's subscriber first
   (inside `Brain.initialize()`, before any external
   listener can attach to the freshly constructed runtime).
5. Subscriptions are torn down on re-initialization. Today
   `Brain` has no `dispose`; `ManagedMindcraftBrain.dispose()`
   exists. The bridge subscriptions live for the lifetime of
   the `BrainRuntime` instance; if `Brain.initialize()` is
   called again (re-initialization, as in
   `ManagedMindcraftBrain.rebuild()`), the old `BrainRuntime`
   is replaced and its emitter goes out of scope along with
   the subscriptions.

### Table 1 schema

| field-or-method | kind | external-readers | disposition | target-class | phase | notes |
| --------------- | ---- | ---------------- | ----------- | ------------ | ----- | ----- |

- `kind` -- `field` or `method`.
- `external-readers` -- comma-separated file paths, or
  `"none"` for items only used inside `brain.ts`.
- `disposition` -- `keep-on-facade`, `move-to-runtime`,
  `facade-delete` (item disappears entirely; allowed only
  if rule 4 applies).
- `target-class` -- `Brain (facade)`, `BrainRuntime`, or
  `(deleted)`.
- `phase` -- `B2`, `B3`, `B4`, `B5`, or `B6` (the phase
  that moves the item).
- `notes` -- one short clause; cite the disposition rule
  that forced the choice when ambiguous.

### Acceptance (validation checklist)

B0 ships only when every item passes:

1. Table 1 covers every public, protected, and private
   member of `Brain` at the inspection commit. No row is
   missing; no row's disposition is blank.
2. Every `target-class = BrainRuntime` row that has external
   readers also has a `Brain (facade)` delegating wrapper
   accounted for. The agent records the planned wrapper
   signature in the `notes` cell.
3. No code changes. The deliverable is table 1; nothing
   else is touched.

---

## Phase B1 -- Create `BrainRuntime` Skeleton

**Purpose.** Land the new file with the pre-decided constructor
signature and the `IBrainRuntime` interface that declares the
runtime surface. No callers yet. The tree compiles; the firewall
stays green at zero.

**Precondition.** B0 shipped. Table 1 exists under
`## Phase B0 Decisions`. The agent has read it end-to-end and
reviewed the pre-decided constructor signature and bridge rules
in the B0 spec section.

### Source paths (the agent edits / inspects these)

- **New file:** `packages/core/src/runtime/brain-runtime.ts`.
- **Runtime barrel:** `packages/core/src/runtime/index.ts`.
  Add an `export * from "./brain-runtime";` line in
  alphabetical order with the existing exports.
- **Runtime interface:**
  `packages/core/src/runtime/host-bindings.ts`. This spec adds
  `IBrainRuntime` declaring everything currently on `IBrain`
  *except* `initialize` and `getCompiledProgram` (the two
  facade-only members), and reshapes `IBrain` as
  `IBrain extends IBrainRuntime` adding those two. The shape
  of `IBrain` is unchanged from any existing consumer's
  perspective.

  **Invariant:** `IBrainRuntime` must never gain a method that
  cannot be satisfied without a value-import from `brain/`.
  `BrainRuntime implements IBrainRuntime` plus the firewall
  test enforce this mechanically: an addition that requires
  `brain/` either fails to compile (no implementation on the
  runtime class) or trips the firewall (forbidden import).
- **Firewall test (informational):**
  `packages/core/src/runtime/__firewall__.spec.ts`. The new
  file must not introduce any forbidden import; the firewall
  stays at `BASELINE_VIOLATIONS = 0`.

### Procedure (execute in order; the tree compiles after each step)

1. **Add an empty `IBrainRuntime` interface** in
   `runtime/host-bindings.ts`:
   `export interface IBrainRuntime {}`. Reshape `IBrain`
   as `IBrain extends IBrainRuntime`, keeping every
   current member on `IBrain`'s own body. The export list
   of `host-bindings.ts` gains `IBrainRuntime`. No call
   site changes; `IBrain` is structurally identical.

   **Migration model.** `IBrainRuntime` grows
   incrementally. Each subsequent phase (B2 - B5) that
   moves a member of the runtime surface from `Brain` to
   `BrainRuntime` performs three coordinated edits in the
   same diff:
   1. add the member's signature to `IBrainRuntime`,
   2. remove the same signature from `IBrain`'s own body
      (it remains on `IBrain` via inheritance), and
   3. implement the member on `BrainRuntime`.

   This avoids stubs entirely: every method on
   `BrainRuntime` is real the moment it lands, and the
   firewall plus `BrainRuntime implements IBrainRuntime`
   together still enforce the no-`brain/`-value-import
   invariant on each addition.
2. **Create `runtime/brain-runtime.ts`.** Add
   `export class BrainRuntime implements IBrainRuntime { ... }`.
   The constructor matches the pre-decided signature in
   the B0 spec section and stores the four parameters as
   private readonly fields. With `IBrainRuntime` empty,
   the class body has no methods. The constructor body is
   minimal: assign the parameters; no further work
   (variable storage, services, VM, scheduler,
   `executionContext`) lands until B2 - B3 add it in
   place.
3. **Re-export from the runtime barrel.** Add
   `export * from "./brain-runtime";` to
   `packages/core/src/runtime/index.ts`.
4. **Run the full gate** from `packages/core`:
   `npm run typecheck && npm run check && npm test && npm run build`.
   The firewall test must report zero violations. The new
   file must not appear in the firewall's allow-list
   overrides.

### Acceptance (validation checklist)

1. `packages/core/src/runtime/brain-runtime.ts` exists with
   the class `BrainRuntime` and the pre-decided constructor
   signature. The class body has no methods.
2. `IBrainRuntime` is declared in
   `runtime/host-bindings.ts` as an empty interface, and
   `IBrain extends IBrainRuntime`. Every member that
   `IBrain` declared at the inspection commit still
   appears on `IBrain`'s own body.
3. The runtime barrel exports `BrainRuntime` and
   `IBrainRuntime`.
4. `grep -nE 'from "[^"]*brain[^/"]*"' packages/core/src/runtime/brain-runtime.ts`
   returns nothing -- the new file does not import from
   `brain/`.
5. `grep -nE 'not implemented|throw new Error' packages/core/src/runtime/brain-runtime.ts`
   returns nothing -- no stubs.
6. The full gate (typecheck, check, test, build) passes
   from `packages/core` with zero noise per the zero-noise
   policy.
7. `__firewall__.spec.ts` reports
   `BASELINE_VIOLATIONS = 0` and the self-test still
   detects the synthetic violation.

### Risks

- Adding `IBrainRuntime` and reshaping `IBrain` to extend
  it must not break any existing consumer of `IBrain`.
  Mitigation: `IBrain` continues to expose every method
  it does today; the shape is unchanged.
- Phases B2 - B5 must each remember to perform all three
  coordinated edits (add to `IBrainRuntime`, remove from
  `IBrain`'s own body, implement on `BrainRuntime`). The
  procedure section of each subsequent phase calls this
  out explicitly in step 1.

---

## Phase B2 -- Move Variable Storage

**Purpose.** Move concern 3 (variable storage owner) from
`Brain` to `BrainRuntime`. After this phase, `BrainRuntime`
holds the `variables` slot list and the `varSlotByName` map;
`Brain` delegates every variable accessor to the runtime.

**Precondition.** B0 and B1 shipped. The `BrainRuntime`
class exists with the pinned constructor signature and an
empty body. `IBrainRuntime` is empty; `IBrain extends
IBrainRuntime`.

### Source paths (the agent edits / inspects these)

- **Source of truth (today):**
  `packages/core/src/brain/brain.ts`. Fields: `variables`
  (66), `varSlotByName` (75). Methods: `getVariable` (282),
  `setVariable` (300), `clearVariable` (315),
  `clearVariables` (327), `getVariableBySlot` (337),
  `setVariableBySlot` (348), `installVariableTable` (361).
  Re-anchor line numbers at the start of B2.
- **Destination:**
  `packages/core/src/runtime/brain-runtime.ts`.
- **Runtime services adapter:**
  `packages/core/src/runtime/runtime-services.ts` --
  `createRuntimeServices(brain: IBrain, ...)` (line 28).
  Today the adapter binds to the `Brain` instance through
  the `IBrain` interface. After B2, the adapter still binds
  to `IBrain`; B2 moves the implementation, not the binding
  shape. (B5 narrows the parameter to `IBrainRuntime`,
  once the FSM accessors have moved. RNG is not on
  `IBrain`; host functions read it via
  `ctx.services.app.rng`.)
- **`ExecutionContext` construction (informational):**
  `Brain.initialize()` lines 236-247. The
  `getVariableBySlot` / `setVariableBySlot` arrows close
  over `Brain` today. B2 does not touch this; B3 closes
  them over `BrainRuntime` when the `executionContext`
  field moves.
- **Tests:** `packages/core/src/brain/brain.spec.ts` and
  `packages/core/src/runtime/vm-variable-slots.spec.ts`.
  Both exercise the variable surface end-to-end through
  `Brain`. No fixture changes expected; the surface is
  preserved.

### Procedure (execute in order; the tree compiles after each step)

1. **Grow `IBrainRuntime` and add the storage to
   `BrainRuntime`.** In `runtime/host-bindings.ts`, add
   the four name-keyed variable accessor signatures
   (`getVariable`, `setVariable`, `clearVariable`,
   `clearVariables`) to `IBrainRuntime`, and remove the
   same four signatures from `IBrain`'s own body (they
   remain on `IBrain` via inheritance). In
   `runtime/brain-runtime.ts`, move the `variables` and
   `varSlotByName` fields verbatim from `Brain`, export
   the type alias
   `VariableSnapshot = { values: List<Value | undefined>;
   slotsByName: Dict<string, number> }`, and implement:
   - the four interface methods,
   - the slot-keyed accessors `getVariableBySlot` /
     `setVariableBySlot` (used by `executionContext` in
     B3),
   - the private `installVariableTable(programVariableNames,
     previousVariables?)`, which is now a pure function
     of its arguments (no read of `this.variables`),
   - the public `snapshotVariables(): VariableSnapshot`
     returning `{ values: this.variables, slotsByName:
     this.varSlotByName }`.

   Add `previousVariables?: VariableSnapshot` as the
   fifth constructor parameter (defaults to `undefined`).
   Call `this.installVariableTable(program.variableNames,
   previousVariables)` at the end of the constructor.
   JSDoc on every moved member is preserved verbatim.
2. **Replace `Brain`'s implementations with delegations.**
   Each of the six public methods on `Brain` becomes a
   one-liner that forwards to
   `this.runtime.<method>(...)`. The fields `variables`
   and `varSlotByName` are deleted from `Brain`. The
   private `installVariableTable` is deleted from `Brain`.
3. **Wire `Brain.initialize()` to construct the runtime
   skeleton with carry-forward.** B2 does not yet
   construct the full runtime (VM/scheduler/executionContext
   are still on `Brain`); but the `BrainRuntime` instance
   must exist for the variable delegations to land.
   Inside `initialize()`, immediately after the
   `program`/`pageMetadata` are computed:
   1. `const previousVariables = this.runtime?.snapshotVariables();`
      (captures the snapshot if and only if a prior
      `initialize()` call left a runtime in place;
      `undefined` on first init).
   2. `this.runtime = new BrainRuntime(program,
      pageMetadata, services, contextData,
      previousVariables);`. The non-variable parameters
      (`pageMetadata`, `services`, `contextData`) are
      stored without further use until B3 wires them.

   **Constraint:** the `BrainRuntime` constructor must not
   throw or partially initialize. Variable storage is
   fully live the moment `new BrainRuntime(...)` returns,
   with carry-forward applied if `previousVariables` was
   passed.
4. **Confirm `runtime-services.ts` still works.** The
   `createRuntimeServices(brain, callsiteStore)` call
   inside `Brain.initialize()` continues to pass `this`
   (the `Brain` facade). The adapter's `getByName` /
   `setByName` / `clearByName` callbacks call
   `brain.getVariable(...)` etc., which now delegate into
   the runtime. Behavior is unchanged.
5. **Run the full gate.**

### Acceptance (validation checklist)

1. `grep -nE 'private (variables|varSlotByName)' packages/core/src/brain/brain.ts`
   returns nothing.
2. `grep -nE 'private installVariableTable' packages/core/src/brain/brain.ts`
   returns nothing.
3. The six variable-accessor methods on `Brain` have
   one-liner bodies that forward to
   `this.runtime.<method>(...)`.
4. `BrainRuntime` carries the `variables` and
   `varSlotByName` fields with their JSDoc preserved
   verbatim.
5. The full gate passes from `packages/core` with zero
   noise.
6. `brain.spec.ts` and `vm-variable-slots.spec.ts` pass
   without modification (no fixture changes).
7. The hot-reload carry-forward test in
   `mindcraft-environment.spec.ts` (variable-name
   survives rebuild) passes without modification. If it
   fails, the snapshot wiring in step 1 / step 3 is
   wrong; do not weaken the test.
8. `BrainRuntime.snapshotVariables()` exists and returns
   the live `variables` / `varSlotByName` references
   (no copy). The `VariableSnapshot` type alias is
   exported from `runtime/brain-runtime.ts`.

### Risks

- **Hot-reload carry-forward.** Today,
  `Brain.installVariableTable` reads `this.variables` /
  `this.varSlotByName` in-place to carry variable values
  forward across a re-init. After B2 those fields live on
  the previous `BrainRuntime` instance, which is dropped
  before the new one is constructed. B2 preserves the
  carry-forward via the `previousVariables` constructor
  parameter (see Desired End State). Mechanism:
  1. `BrainRuntime` exports a public method
     `snapshotVariables(): VariableSnapshot` that returns
     `{ values: this.variables, slotsByName: this.varSlotByName }`
     (no copy; the snapshot is consumed by the next
     constructor and the old runtime is dropped).
  2. `Brain.initialize()` reads
     `const prev = this.runtime?.snapshotVariables();`
     before constructing the new runtime, then passes
     `prev` as the fifth constructor argument.
  3. `BrainRuntime`'s constructor passes `previousVariables`
     into `installVariableTable`, whose body becomes a
     pure function of `programVariableNames` and the
     optional snapshot (no `this.variables` read).

  This is non-negotiable: the upcoming hot-reload feature
  depends on it, and the Key Invariants section forbids
  weakening it. The agent does not get to abandon
  carry-forward.
- B2 introduces the **first** `Brain -> BrainRuntime`
  field reference (`this.runtime`). Until B6, the `Brain`
  class holds both the runtime *and* the residual
  VM/scheduler/page-lifecycle state. The agent must not
  accidentally read `this.runtime`'s state from a
  `Brain`-method that has not yet been moved; the
  delegation is one-way (Brain -> Runtime), never the
  reverse.

---

## Phase B3 -- Move VM, Scheduler, And `ExecutionContext`

**Purpose.** Move concerns 4 and 5 from `Brain` to
`BrainRuntime`. After this phase, `BrainRuntime` owns the
`VM`, the `FiberScheduler`, the `executionContext`, the
`callsiteStore`, the `ruleVariableStores`, the
`activeRuleFiberIds` registry, the `nextInlineFiberId`
counter, and the `PlatformServices` construction logic.
`Brain.initialize()` becomes a compile / link / treeshake
pipeline that ends with
`new BrainRuntime(program, pageMetadata, platformServices, contextData)`.

**Precondition.** B2 shipped. `Brain` constructs the
`BrainRuntime` from inside `initialize()`; variable storage
lives on the runtime.

### Source paths (the agent edits / inspects these)

- **Source of truth (today):**
  `packages/core/src/brain/brain.ts`. Fields: `vm` (105),
  `scheduler` (110), `executionContext` (118),
  `callsiteStore` (123), `ruleVariableStores` (131),
  `activeRuleFiberIds` (138), `nextInlineFiberId` (140).
  The `PlatformServices` construction block lives inside
  `initialize()` at lines 200-224
  (`createRuntimeServices`, `createProgramServices`,
  `createRuleVariableServices`, the `platformServices`
  literal, `new VM`, `new FiberScheduler`).
- **Destination:**
  `packages/core/src/runtime/brain-runtime.ts`.
- **Compile pipeline (stays on facade):**
  `Brain.initialize()` lines 173-198 (`compileBrain`,
  `linkBrainProgram`, `treeshakeProgram`, `assignFuncIds`).
- **Imports to relocate:**
  - From `brain.ts`: `createCallsiteStore`,
    `ICallsiteStore`, `createProgramServices`,
    `createRuleVariableServices`, `RuleVariableStores`,
    `createRuntimeServices`, `PlatformServices`, `VM`,
    `FiberScheduler`, `ExecutionContext`. These move with
    their consuming code into `brain-runtime.ts`.
  - From `brain.ts` (stay): `compileBrain`,
    `linkBrainProgram`, `treeshakeProgram`,
    `BrainLinkEnvironment`, `BrainServices`, `IBrainDef`,
    `IBrainPageDef`.
- **Runtime services adapter:**
  `packages/core/src/runtime/runtime-services.ts` --
  `createRuntimeServices(brain: IBrain, ...)` (line 28).
  The function reads variable accessors (added to
  `IBrainRuntime` in B2) plus FSM page accessors (added
  in B5). The parameter therefore cannot
  narrow to `IBrainRuntime` until B5; in B3 + B4 it
  remains typed as `IBrain` and the **facade** is the
  caller (passing `this`, the `Brain` instance). The
  runtime constructor receives the assembled
  `IRuntimeServices` aggregate as part of its inputs in
  B3 (see procedure step 3 below) -- it does not call
  `createRuntimeServices` itself in B3. B5 moves the
  call inside the runtime constructor and narrows the
  parameter to `IBrainRuntime` in the same diff.
### `PlatformServices` assembly: B3 vs B5

`createRuntimeServices` reads variable accessors (on
`IBrainRuntime` after B2) **and** FSM accessors (on
`IBrain` only, until B5 moves them onto `IBrainRuntime`).
The runtime cannot be the `brain` argument to
`createRuntimeServices` until B5; until then, the facade
is the only valid argument. This drives a two-stage
assembly:

- **B3 -- facade builds `PlatformServices`.** The facade
  creates the `ICallsiteStore`, calls
  `createRuntimeServices(this, callsiteStore)` (where
  `this` is the `Brain` facade, still holding the FSM),
  assembles the nested four-tier `PlatformServices`
  literal (`{ runtime, shared, app, brain }`; the three
  host-tier fields are read directly off
  `this.services` (`BrainServices`), and the `brain` tier
  is built from `runtimeServices.brainVars` / `.callsite`
  / `runtimeServices.brainPages` (rebound to `pages`),
  `createProgramServices(...)`, and
  `createRuleVariableServices(...)`), and passes the full
  literal into `new BrainRuntime(program, pageMetadata,
  services, contextData)`. The runtime constructor stores
  the literal in `this.services` and reads
  `this.callsiteStore = services.brain.callsite as ICallsiteStore`
  (the store is the callsite-services impl with no
  wrapping). The `callsiteStore` field on `BrainRuntime`
  loses its `= createCallsiteStore()` initializer.
- **B5 -- runtime owns assembly.** Once the FSM moves
  to `BrainRuntime`, `createRuntimeServices` can take
  `IBrainRuntime` and the facade can stop building
  the `brain` tier. B5 moves the
  `createCallsiteStore()` call, the
  `createRuntimeServices(this, this.callsiteStore)`
  call, and the `brain`-tier construction into the
  `BrainRuntime` constructor. The constructor parameter
  narrows from full `PlatformServices` to
  `Omit<PlatformServices, "brain">` (the three
  host-supplied tiers); the parameter is renamed to
  `hostServices` to match. The runtime fills the `brain`
  tier internally and assembles the nested
  `PlatformServices` literal as `{ ...hostServices, brain: {...} }`.
  `createRuntimeServices`'s `brain` parameter narrows
  from `IBrain` to `IBrainRuntime` in the same diff.

The B3 shape is intentionally less elegant than B5's; it
exists only because the FSM has not yet moved.

### Procedure (execute in order; the tree compiles after each step)

1. **Grow `IBrainRuntime`.** In
   `runtime/host-bindings.ts`, add `getProgram()` and
   `getPages()` to `IBrainRuntime`, and remove the same
   two signatures from `IBrain`'s own body.
   Implementations land on `BrainRuntime` as part of
   step 2 below: `getProgram()` returns `this.program`,
   `getPages()` returns `this.pageMetadata`. The
   facade's `getProgram()` / `getPages()` become
   one-liner delegations (`return this.runtime.<member>()`).

   `events()` is **not** moved in B3. Today's emit sites
   (`emitter_.emit("page_activated", ...)` and
   `emitter_.emit("page_deactivated", ...)`) live
   inside `Brain.activatePage` /
   `deactivateCurrentPage` -- both still on `Brain`
   until B5. Moving the emitter to `BrainRuntime` in
   B3 would force those emit sites to write through a
   public helper on the runtime, which adds a
   transitional surface only to delete it in B5. B5
   moves the emitter and the FSM together (B5 step
   6); `Brain.events()` keeps returning the facade's
   own emitter consumer through B4.
2. **Move the seven fields** verbatim, with JSDoc
   preserved, from `Brain` to `BrainRuntime`. The
   `callsiteStore` field keeps its `readonly`-with-initializer
   form (`= createCallsiteStore()`); the
   `nextInlineFiberId` keeps its initializer
   (`= -1000000`). `vm`, `scheduler`, `executionContext`
   lose their `| undefined` union: the new constructor
   populates them before returning, so their declared
   types are non-nullable.

   **Invariant:** `Brain.runtime` is assigned exactly once
   per `initialize()` call, as the very last statement of
   the body, after the event-bridge subscription is in
   place. This is the precondition that lets the facade's
   `isInitialized()` collapse to `this.runtime !== undefined`.
3. **Populate the runtime constructor (B3 shape).** The
   `BrainRuntime` constructor receives the full
   `PlatformServices` from the facade. Order inside the
   constructor:
   1. Store `this.program = program`,
      `this.pageMetadata = pageMetadata`,
      `this.services = services`.
   2. Read `this.callsiteStore = services.brain.callsite as ICallsiteStore`.
   3. Read `program.variableNames` and call
      `this.installVariableTable(program.variableNames,
      previousVariables)` (already moved in B2; the
      `previousVariables` parameter flows from the
      constructor argument).
   4. Allocate `this.ruleVariableStores = new Dict()`.
      (Also exposed via the facade-built
      `services.brain.ruleVars`; the runtime field exists
      because B5 will build the services in-place and
      needs the underlying store.)
   5. `this.vm = new VM(this.program, this.services)`.
   6. `this.scheduler = new FiberScheduler(this.vm, { maxFibersPerTick: 64, defaultBudget: 1000, autoGcHandles: true });`.
   7. Build `this.executionContext`: the same literal as
      today, with `getVariableBySlot` /
      `setVariableBySlot` arrows now closing over
      `BrainRuntime` (no `const brain = this`
      indirection needed; `this` is the runtime). The
      literal's `data` field is set to the
      `contextData` constructor parameter, preserving
      today's `ctx.data` channel for host functions.
4. **Rewrite `Brain.initialize()`.** Every value the
   facade does not own long-term is a local. The only
   field this step writes on the facade (besides
   `this.runtime`) is `this.compiledProgram`, which
   `getCompiledProgram()` returns. `program`,
   `pageMetadata`, and `ruleIndex` are not stored on
   the facade -- they flow through locals into the
   runtime constructor, and `Brain.getProgram()` /
   `Brain.getPages()` delegate to `this.runtime` from
   B3 onward. Body:
   1. `const previousVariables = this.runtime?.snapshotVariables();`
      (carry-forward capture from B2; preserved here).
   2. Resolve `linkEnvironment` via the existing
      `getLinkEnvironment` call.
   3. `compileBrain(...)`, `linkBrainProgram(...)`,
      `treeshakeProgram(...)` -- unchanged. Bind the
      results to locals (`compiled`, `linked`, with
      `linked.program`, `linked.pages`,
      `linked.ruleIndex`).
   4. `this.compiledProgram = compiled;`.
   5. Call `assignFuncIds(linked.ruleIndex, ...)` on
      every `BrainPage` (unchanged shape; pass the
      local `ruleIndex` rather than reading
      `this.ruleIndex`).
   6. Allocate locals `callsiteStore =
      createCallsiteStore()` and `ruleVariableStores =
      new Dict<...>()`.
   7. Build `runtimeServices = createRuntimeServices(this, callsiteStore)`
      (`this` is the facade, which still holds the FSM
      until B5; RNG reaches the VM via
      `this.services.app.rng`).
   8. Assemble the nested four-tier `PlatformServices`
      literal as a local `platformServices`. The three
      host-supplied tiers (`runtime`, `shared`, `app`)
      are taken directly from `this.services`
      (`BrainServices` carries identical sub-aggregates).
      The `brain` tier is constructed inline:
      `program: createProgramServices(linked.program)`;
      `brainVars: runtimeServices.brainVars`;
      `pages: runtimeServices.brainPages` (the
      `IRuntimeServices` aggregate kept the legacy field
      name `brainPages`; rebound to `pages` per the
      `IBrainPageServices` contract);
      `callsite: runtimeServices.callsite`;
      `ruleVars: createRuleVariableServices(linked.program, ruleVariableStores)`.
   9. `this.runtime = new BrainRuntime(linked.program, linked.pages, platformServices, contextData, previousVariables);`.
   10. Subscribe to `this.runtime.events()` for
       `page_activated` / `page_deactivated` per the
       bridge rules above (this is a no-op until B5
       emits the events, but the subscription is in
       place).
5. **Remove the seven moved fields from `Brain`.** Replace
   `this.vm` / `this.scheduler` / `this.executionContext`
   / `this.callsiteStore` / `this.ruleVariableStores` /
   `this.activeRuleFiberIds` / `this.nextInlineFiberId`
   reads inside `Brain` (the page-lifecycle FSM still
   here until B5) with `this.runtime.<field>`. Since
   these fields are private on the runtime, expose them
   as **transitional internal getters** on `BrainRuntime`
   for the duration of the migration (the page-lifecycle
   FSM in `Brain` reads them through the getters). **B5
   deletes these getters when the FSM moves; they exist
   only between B3 and B5.** Mark each getter with a
   JSDoc tag `@deprecated transitional; removed in B5`.
6. **Leave `runtime-services.ts` unchanged.** The
   parameter stays typed as `IBrain`. B5 narrows it to
   `IBrainRuntime` once the FSM has moved.
7. **`Brain.isInitialized()`** becomes
   `this.runtime !== undefined`. Today it reads three
   fields (`vm`, `scheduler`, `program`); after B3 those
   three are guaranteed populated together if `runtime`
   exists.
8. **Run the full gate.**

### Acceptance (validation checklist)

1. `grep -nE 'private (vm|scheduler|executionContext|callsiteStore|ruleVariableStores|activeRuleFiberIds|nextInlineFiberId)' packages/core/src/brain/brain.ts`
   returns nothing.
2. `grep -nE 'new (VM|FiberScheduler)\(' packages/core/src/brain/brain.ts`
   returns nothing.
3. `Brain.initialize()` builds the nested four-tier
   `PlatformServices` literal from local `callsiteStore` /
   `ruleVariableStores` and passes the assembled
   literal into a single `new BrainRuntime(...)` call.
   Service-assembly call sites
   (`createCallsiteStore`, `createRuntimeServices`,
   `createProgramServices`, `createRuleVariableServices`)
   remain in `brain.ts` for B3 + B4 and move into the
   runtime constructor in B5.
4. `Brain.initialize()` reads as: snapshot capture,
   resolve `linkEnvironment`, compile-link-treeshake,
   `this.compiledProgram = compiled`, the `assignFuncIds`
   loop over local `ruleIndex`, `PlatformServices`
   nested-literal assembly from locals, the
   `new BrainRuntime(...)` call, the event-bridge
   subscription. Anything else there is a regression.
5. `grep -nE 'this\.(program|pageMetadata|ruleIndex)\s*=' packages/core/src/brain/brain.ts`
   returns nothing. The facade does not store
   `program`, `pageMetadata`, or `ruleIndex` as fields;
   they live as locals inside `initialize()` and
   long-term inside `BrainRuntime`. `Brain.getProgram()`
   and `Brain.getPages()` are one-liner delegations to
   `this.runtime`.
6. The `BrainRuntime` constructor populates `vm`,
   `scheduler`, `executionContext` before returning. None
   of the three carries a `| undefined` union.
7. The full gate passes from `packages/core` with zero
   noise.
8. The `__firewall__.spec.ts` baseline is still zero.
9. Behavior tests: `brain.spec.ts`,
   `callsite-host-state-lifetime.spec.ts`,
   `vm-*.spec.ts`, `rule-services.spec.ts`,
   `runtime-services.spec.ts`,
   `mindcraft-environment.spec.ts`, `apps/sim` test suite
   all pass without modification.

### Risks

- **Construction order inside the runtime constructor**
  is load-bearing. `installVariableTable` must run before
  anything that reads variable slots;
  `executionContext` construction closes over
  `services` and the variable-slot accessors, so it
  runs after `services` is assigned and after
  `installVariableTable`. `new VM` consumes
  `this.services`. The agent must not reorder.
- **Re-initialization semantics.** Today,
  `ManagedMindcraftBrain.initialize()` calls
  `super.shutdown()` then `super.initialize(contextData)`.
  After B3, `super.shutdown()` calls
  `this.runtime?.shutdown()` (the runtime's shutdown is
  still triggered by the FSM in `Brain` until B5);
  `super.initialize()` constructs a *new* `BrainRuntime`,
  replacing `this.runtime`. The old runtime must be
  garbage-collectable: no field on `Brain` may keep it
  alive, and the event subscriptions registered against
  the old runtime's emitter must be torn down (or simply
  go out of scope along with the emitter).
- **Transitional getters on `BrainRuntime`** (procedure
  step 5) are a code smell. They exist for at most two
  phases. B5's acceptance includes deleting them.

---

## Phase B4 -- Move Activation / Deactivation Hook Drivers

**Purpose.** Move concern 7 (activation / deactivation hook
drivers) from `Brain` to `BrainRuntime`. After this phase,
the seven hook-driver methods live on `BrainRuntime`.
`Brain` no longer references `BytecodeExecutableAction`,
`VmStatus`, or the `vm.spawnFiber` / `vm.runFiber`
low-level surface.

**Why before B5.** The hook drivers are called from inside
the FSM (`activatePage` calls `runBytecodeInitializerHook` /
`runHostInitializerHook` / `runBytecodeActivationHook` /
`runHostActivationHook`; `deactivateCurrentPage` calls
`runHostDeactivationHook` / `runBytecodeDeactivationHook`).
If B5 moves the FSM first, the FSM has to call back into
`Brain` to invoke the hooks, which is the wrong direction.

**Precondition.** B3 shipped. `BrainRuntime` owns `vm`,
`scheduler`, `executionContext`, `callsiteStore`,
`nextInlineFiberId`. Transitional getters on `BrainRuntime`
expose those fields to `Brain` for the FSM still living
there.

### Source paths (the agent edits / inspects these)

- **Source of truth (today):**
  `packages/core/src/brain/brain.ts`. Methods:
  `runHostActivationHook` (713),
  `runHostInitializerHook` (731),
  `runBytecodeInitializerHook` (749),
  `runBytecodeActivationHook` (753),
  `runBytecodeDeactivationHook` (757),
  `runHostDeactivationHook` (761),
  `runBytecodeHook` (779).
- **Destination:**
  `packages/core/src/runtime/brain-runtime.ts`.
- **Imports to relocate from `brain.ts`:**
  - `BytecodeExecutableAction` and `VmStatus` (used by
    `runBytecodeHook`).
  - `Error` from `platform/error` (already present in
    `brain-runtime.ts` from B1; do not re-add).
- **FSM call sites that stay on `Brain` until B5:**
  `Brain.activatePage` lines 549-585 (calls all four
  activation hook drivers),
  `Brain.runDeactivationHooksForCurrentPage` lines
  645-672. These call sites change from
  `this.run<X>Hook(...)` to `this.runtime.run<X>Hook(...)`.

### Procedure (execute in order; the tree compiles after each step)

1. **Move the seven methods verbatim** to `BrainRuntime`.
   JSDoc preserved. Visibility stays `private` -- but the
   FSM call sites in `Brain` need access to them between
   B4 and B5. The methods are `public` on `BrainRuntime`
   for the duration of B4-B5; B5 demotes them back to
   `private` once the FSM caller moves into the runtime
   (B5 step 9). Mark each with a JSDoc tag
   `@deprecated transitional`.
2. **Replace `Brain`'s call sites** with
   `this.runtime.<method>(...)`. `Brain.activatePage` and
   `Brain.runDeactivationHooksForCurrentPage` are the
   only callers.
3. **Remove the `BytecodeExecutableAction` and `VmStatus`
   imports from `brain.ts`** if no other reference
   remains. Confirm via
   `grep -nE 'BytecodeExecutableAction|VmStatus' packages/core/src/brain/brain.ts`.
4. **Confirm hook-context construction is correct on the
   runtime side.** `runBytecodeHook` builds a
   `hookContext` via spread `{ ...this.executionContext, currentCallSiteId, currentRuleFuncId: undefined }`.
   After the move, `this.executionContext` is the
   runtime's own field; the spread shape is unchanged.
5. **Run the full gate.** Behavior tests for action
   lifecycle (`callsite-host-state-lifetime.spec.ts`,
   every `*lifecycle*` spec) must pass without
   modification.

### Acceptance (validation checklist)

1. `grep -nE 'private run(Host|Bytecode)(Activation|Initializer|Deactivation)Hook' packages/core/src/brain/brain.ts`
   returns nothing.
2. `grep -nE 'private runBytecodeHook' packages/core/src/brain/brain.ts`
   returns nothing.
3. `grep -nE 'BytecodeExecutableAction|VmStatus' packages/core/src/brain/brain.ts`
   returns nothing.
4. `Brain.activatePage` and
   `Brain.runDeactivationHooksForCurrentPage` reference
   each hook driver only via `this.runtime.<method>`.
5. The seven hook drivers exist on `BrainRuntime` with
   their JSDoc preserved verbatim (plus the
   `@deprecated transitional` tag).
6. The full gate passes from `packages/core` with zero
   noise.
7. Behavior tests covering action initialization
   (`onInitialized`, `initializerFuncId`), page-entered
   (`onPageEntered`, `activationFuncId`), and page-exited
   (`onPageExited`, `deactivationFuncId`) hooks pass
   without modification.

### Risks

- **Hook-context spread.** The hook context is a fresh
  object literal each time, with `currentCallSiteId` /
  `currentRuleFuncId` overrides. This is a behavioral
  invariant: hooks must not mutate the persistent
  `executionContext`'s `currentCallSiteId` /
  `currentRuleFuncId`, and the `try / finally` discipline
  in `runHost*Hook` restores them on the persistent
  context. The move preserves this verbatim; review must
  verify the persistent vs hook-local context split
  survives.
- **Synchronous-throw semantics in `runBytecodeHook`.** A
  faulted bytecode hook throws a `platform/error`. Today
  `Brain` is the throw site; after B4 it is
  `BrainRuntime`. Any external test or call site that
  catches the throw must see the same `Error.message`
  content. The message format
  ("Page <label> for action '<key>' faulted: <inner.message>"
  and "Page <label> for action '<key>' cannot suspend")
  is preserved verbatim.

---

## Phase B5 -- Move Page Lifecycle FSM And Page Lookup Tables

**Purpose.** Move concerns 6 and 8 (page lifecycle FSM and
page lookup tables) from `Brain` to `BrainRuntime`. After
this phase, `BrainRuntime` is fully self-contained: it
executes ticks, owns the activation / deactivation FSM,
drives the hook callers, and manages the page-by-id /
page-by-name lookup tables. `Brain` holds only the
authoring graph and the compile / link / treeshake
pipeline.

**Precondition.** B3 and B4 shipped. The transitional
getters on `BrainRuntime` (B3) and the `@deprecated
transitional` tags on the hook drivers (B4) are still
present; B5 deletes both.

### Source paths (the agent edits / inspects these)

- **Source of truth (today):**
  `packages/core/src/brain/brain.ts`.
  - **State fields:** `enabled` (52), `interrupted` (53),
    `currentPageIndex` (54), `desiredPageIndex` (55),
    `previousPageIndex` (56), `restartPageRequested` (57),
    `lastThinkTime` (58).
  - **Page lookup tables:** `pageIdToIndex` (143),
    `pageNameToIndex` (146).
  - **FSM methods:** `setEnabled` (393), `isEnabled`
    (397), `interrupt` (401), `clearInterrupt` (405),
    `isInterrupted` (409), `requestPageChange` (413),
    `requestPageChangeByPageId` (425),
    `requestPageChangeByName` (435),
    `requestPageRestart` (444), `getCurrentPageId` (449),
    `getPreviousPageId` (455), `startup` (462),
    `shutdown` (475), `think` (494),
    `activatePage` (529), `cancelActiveFibers` (610),
    `deactivateCurrentPage` (623),
    `runDeactivationHooksForCurrentPage` (645),
    `thinkPage` (677), `shouldRespawnFiber` (700),
    `isValidPageIndex` (804).
  - **Page lookup table construction (today):**
    `Brain.initialize()` lines 227-235.
- **Destination:**
  `packages/core/src/runtime/brain-runtime.ts`.
- **Event bridge (per the B0 bridge rules):** `Brain.events()`
  returns `this.runtime.events()` (already wired in B3);
  the facade's subscriber for `page_activated` /
  `page_deactivated` invokes
  `this.pages.get(pageIndex)?.activate()` /
  `?.deactivate()`.
- **Subclass that overrides FSM methods:**
  `packages/core/src/mindcraft.ts` --
  `ManagedMindcraftBrain.startup` (~line 1019),
  `.shutdown` (~line 1025), `.initialize` (~line 996).
  The override pattern relies on `super.startup()` /
  `super.shutdown()` delegating to
  `this.runtime.startup()` / `shutdown()`. The
  override-around-`super` shape is preserved; the
  override runs arbitrary facade-side code (status
  checks, `started` bookkeeping) before / after the
  `super` call.

### Procedure (execute in order; the tree compiles after each step)

1. **Grow `IBrainRuntime`.** In
   `runtime/host-bindings.ts`, add the FSM public surface
   to `IBrainRuntime` (`startup`, `shutdown`, `think`,
   `setEnabled`, `isEnabled`, `interrupt`,
   `clearInterrupt`, `isInterrupted`, `requestPageChange`,
   `requestPageChangeByPageId`, `requestPageChangeByName`,
   `requestPageRestart`, `getCurrentPageId`,
   `getPreviousPageId`), and remove the same
   signatures from `IBrain`'s own body. After this step,
   `IBrain`'s own body declares only `initialize` and
   `getCompiledProgram`; everything else is inherited
   from `IBrainRuntime`.
2. **Move the seven FSM state fields** verbatim from
   `Brain` to `BrainRuntime` with JSDoc preserved. They
   are private on the runtime.
3. **Move the two page-lookup-table fields**
   (`pageIdToIndex`, `pageNameToIndex`) verbatim. The
   lookup-table construction block (today inside
   `Brain.initialize()` lines 227-235) moves into the
   `BrainRuntime` constructor, immediately after `vm` and
   `scheduler` are assigned and before `executionContext`
   is built. Reads `this.pageMetadata` (now a
   constructor parameter).
4. **Move every FSM method verbatim.** All 21 methods
   listed under "Source paths" move to `BrainRuntime`.
   JSDoc preserved. The `pages: List<BrainPage>` field
   stays on `Brain`; the FSM never reads it -- the
   `page.activate()` / `page.deactivate()` calls in
   today's `activatePage` / `deactivateCurrentPage` are
   **replaced with event emits**
   (`this.emitter_.emit("page_activated", { pageIndex })`
   / `("page_deactivated", { pageIndex })`). The facade's
   subscriber (registered in B3) invokes
   `BrainPage.activate()` / `.deactivate()`.
5. **Adjust `activatePage` and `deactivateCurrentPage`**
   so they reference `this.pageMetadata` (constructor
   parameter), `this.program` (constructor parameter,
   stored as a field), `this.scheduler`, `this.vm`,
   `this.executionContext`, `this.activeRuleFiberIds`,
   `this.callsiteStore` -- all already on `BrainRuntime`
   after B3. No call to `this.pages.get(pageIndex)?.activate()`
   / `.deactivate()` survives in `BrainRuntime`; that
   wiring is on the facade side via the event bridge.

   The event emit ordering is pinned by the B0 bridge
   rules: `activatePage` emits `page_activated` *after*
   spawning the fibers; `deactivateCurrentPage` emits
   `page_deactivated` *after* running the deactivation
   hooks and cancelling fibers.
6. **Move the `EventEmitter<BrainEvents>`** field
   (`emitter_` line 51) from `Brain` to `BrainRuntime`.
   `Brain.events()` becomes `return this.runtime.events()`.
7. **Replace `Brain`'s FSM methods with delegations.**
   Each public FSM method on `Brain` becomes a one-liner
   that forwards to `this.runtime.<method>(...)`. The
   private helpers (`activatePage`, `cancelActiveFibers`,
   `deactivateCurrentPage`,
   `runDeactivationHooksForCurrentPage`, `thinkPage`,
   `shouldRespawnFiber`, `isValidPageIndex`) are deleted
   from `Brain` outright -- they have no external
   callers.
8. **Delete the transitional getters on `BrainRuntime`**
   (the ones added in B3 to expose `vm` / `scheduler` /
   `executionContext` / `callsiteStore` /
   `ruleVariableStores` / `activeRuleFiberIds` /
   `nextInlineFiberId` to the FSM on `Brain`). These
   fields are now private and have no readers outside
   `BrainRuntime`.
9. **Demote the seven hook drivers** from `public` (the
   B4 transitional shape) to `private`. Remove the
   `@deprecated transitional` JSDoc tag. The only callers
   of the hook drivers are `activatePage` and
   `runDeactivationHooksForCurrentPage`, both now on
   `BrainRuntime`.
10. **Confirm `Brain.startup()` / `Brain.shutdown()` are
    now one-liners** that delegate to `this.runtime`.
    `ManagedMindcraftBrain` continues to override them;
    the override calls `super.startup()` /
    `super.shutdown()`, which now hit the delegating
    one-liner. The override-around-`super` shape is
    preserved.
11. **`IBrain` -> `IBrainRuntime` cutover.** With every
    runtime-surface member now declared on
    `IBrainRuntime`, narrow
    `createRuntimeServices(brain: IBrain, callsiteStore)`
    in `runtime/runtime-services.ts` to
    `createRuntimeServices(brain: IBrainRuntime, callsiteStore)`.
    Move the `createCallsiteStore()` /
    `createRuntimeServices(this, this.callsiteStore)` /
    `createProgramServices` /
    `createRuleVariableServices` calls and the
    nested-literal `brain`-tier assembly from
    `Brain.initialize()` into the `BrainRuntime`
    constructor (the "B5 -- runtime owns assembly"
    shape from the B3 spec section). Narrow the runtime
    constructor's services parameter from full
    `PlatformServices` to
    `Omit<PlatformServices, "brain">` (the three
    host-supplied tiers `runtime`, `shared`, `app`);
    rename the parameter to `hostServices` to match.
    The runtime builds the `brain` tier internally
    (binding the in-flight `callsiteStore`,
    `ruleVariableStores`, `program`, `pageMetadata`,
    and the FSM accessors -- now its own state) and
    assembles the full nested `PlatformServices`
    literal as `{ ...hostServices, brain: { ... } }`
    inside the constructor.
    `Brain.initialize()` now passes only the three
    host-tier sub-aggregates from `this.services`
    into
    `new BrainRuntime(linked.program, linked.pages, { runtime: this.services.runtime, shared: this.services.shared, app: this.services.app }, contextData, previousVariables)`
    (the `previousVariables` snapshot is still captured
    at the top of `initialize()` per B2).
    After this step, `IBrain` is referenced only by the
    facade's own `implements` clause and by
    `IBrainPage.brain()`; no parameter type under
    `runtime/` reads `IBrain` any more.
12. **Run the full gate.**

### Acceptance (validation checklist)

1. `grep -nE 'private (enabled|interrupted|currentPageIndex|desiredPageIndex|previousPageIndex|restartPageRequested|lastThinkTime|pageIdToIndex|pageNameToIndex)' packages/core/src/brain/brain.ts`
   returns nothing.
2. `grep -nE 'private (activatePage|cancelActiveFibers|deactivateCurrentPage|thinkPage|shouldRespawnFiber|isValidPageIndex|runDeactivationHooksForCurrentPage)' packages/core/src/brain/brain.ts`
   returns nothing.
3. `grep -nE 'page\.activate\(|page\.deactivate\(' packages/core/src/runtime/brain-runtime.ts`
   returns nothing -- the runtime never calls `BrainPage`
   methods directly.
4. `grep -nE 'page\.activate\(|page\.deactivate\(' packages/core/src/brain/brain.ts`
   returns matches only inside the event subscriber
   callbacks registered in `Brain.initialize()`.
5. `Brain.events()` returns `this.runtime.events()` (one
   line).
6. The runtime emits `page_activated` after fiber spawn
   and `page_deactivated` after hook + fiber-cancel, per
   B0 table 3.
7. The seven hook drivers on `BrainRuntime` are
   `private` with no `@deprecated transitional` tag.
8. The transitional getters on `BrainRuntime` (B3) are
   deleted.
9. `IBrain` -> `IBrainRuntime` cutover complete:
   `grep -nE ': IBrain[^a-zA-Z_]' packages/core/src/runtime/`
   matches only `IBrainPage.brain(): IBrain` in
   `host-bindings.ts`. No parameter or field type under
   `runtime/` declares `IBrain` any more.
10. `grep -nE 'createCallsiteStore|createRuntimeServices|createProgramServices|createRuleVariableServices' packages/core/src/brain/brain.ts`
    returns nothing -- service assembly lives entirely
    inside the `BrainRuntime` constructor.
11. `Brain` has zero `private` methods, only the public
   `IBrain` surface plus `getCompiledProgram` and
   `isInitialized`. Field set is `brainDef`, `services`,
   `linkEnvironment`, `pages`, `compiledProgram`,
   `runtime`, plus the subscription handles required for
   cleanup. (`program`, `ruleIndex`, `pageMetadata` were
   never stored on the facade -- B3 routes them through
   locals and delegating reads to `this.runtime`.)
12. The full gate passes from `packages/core`,
    `apps/sim`, `apps/vscode-extension`, and any other
    package whose API surface depends on `IBrain`.
13. Behavior tests:
    - `brain.spec.ts` (page activation, deactivation,
      restart, page-by-id, page-by-name lookups,
      enable / disable / interrupt, fiber respawn
      semantics).
    - `callsite-host-state-lifetime.spec.ts` (callsite
      reset on deactivation, brain-instance scope).
    - `mindcraft-environment.spec.ts` (rebuild flow with
      `ManagedMindcraftBrain`).
    - `apps/sim` end-to-end (page-driven actor
      behavior).

    All pass without modification beyond fixture-builder
    type adjustments (if any IBrain-typed test helper
    moves to `IBrainRuntime`, update the import).

### Risks

- **Event-emit ordering.** Today, `activatePage` emits
  `page_activated` after `page.activate()` runs; after
  the split, the runtime emits before the facade's
  subscriber runs `BrainPage.activate()`. Per the B0
  bridge rules, the facade's subscriber registers first
  and runs synchronously inside the emit, so external
  listeners still observe the event after
  `BrainPage.activate()` has run. The agent must verify
  `EventEmitter` behaves synchronously (it does in
  `packages/core/src/util`); if it ever becomes async,
  this invariant breaks silently.
- **`ManagedMindcraftBrain` override surface.** The
  `super.shutdown()` call inside
  `ManagedMindcraftBrain.shutdown()` now hits a
  one-liner that delegates to `this.runtime.shutdown()`.
  If `this.runtime` is `undefined` (the facade was
  constructed but never initialized), the delegate must
  short-circuit safely. The facade's one-liner reads
  `this.runtime?.shutdown()` (optional chaining),
  preserving today's behavior where `Brain.shutdown()`
  is a no-op pre-initialization.

---

## Phase B6 -- Reduce `Brain` To A Facade

**Purpose.** Final cleanup. Confirm that `Brain` holds only
authoring + compile / link / treeshake state, exposes the
`IBrain` surface entirely via delegation to `this.runtime`,
and contains no runtime concerns. Remove residual fields and
imports that survived B2-B5 only because they had a single
remaining reader on the facade.

**Precondition.** B5 shipped. The facade's field set, per
B5 acceptance item 11, is `brainDef`, `services`,
`linkEnvironment`, `pages`, `compiledProgram`, `runtime`,
plus event-subscription handles. `program`, `ruleIndex`,
and `pageMetadata` are absent (B3 routes them through
locals; `Brain.getProgram()` / `Brain.getPages()` delegate
to `this.runtime`).

### Source paths (the agent edits / inspects these)

- **`packages/core/src/brain/brain.ts`** -- the facade.
- **`packages/core/src/runtime/brain-runtime.ts`** -- the
  runtime.
- **External call sites that read facade-only fields:**
  - `brain.spec.ts` -- reads `getProgram()` in 6 tests,
    `getCompiledProgram()` in test fixtures.
  - `mindcraft-environment.spec.ts` -- reads
    `getProgram()`.
  - `mindcraft.ts` --
    `ManagedMindcraftBrain.refreshLinkedActionRevisions()`
    reads `getProgram()`.
  - `ManagedMindcraftBrain.refreshLinkEnvironment()`
    mutates the `linkEnvironment` parameter passed into
    the facade constructor.

### Procedure (execute in order; the tree compiles after each step)

1. **Audit the facade field set.** For each field on
   `Brain`, determine whether the facade needs to read or
   write it. Decision matrix:
   - `brainDef` -- needed by `getLinkEnvironment()` and
     the ctor's `BrainPage` construction. **Keep.**
   - `services` -- needed by `getLinkEnvironment()` and
     by the three host-tier sub-aggregates
     (`this.services.runtime`, `this.services.shared`,
     `this.services.app`) passed to the runtime
     constructor. **Keep.**
   - `linkEnvironment` -- needed for re-initialization
     (`ManagedMindcraftBrain.refreshLinkEnvironment`
     mutates it). **Keep.**
   - `pages: List<BrainPage>` -- the facade's event
     subscriber reads `this.pages.get(pageIndex)`.
     **Keep.**
   - `compiledProgram` -- exposed via
     `getCompiledProgram()`. **Keep.**
   - `runtime` -- the only runtime reference. **Keep.**

   `program`, `ruleIndex`, and `pageMetadata` were never
   stored on the facade -- B3 routes them through locals
   and `Brain.getProgram()` / `Brain.getPages()` delegate
   to `this.runtime`. B6 confirms this and does not
   reintroduce them.
2. **Apply the audit.** No field deletions are required
   (B3 already removed `program`, `ruleIndex`, and
   `pageMetadata`). Confirm `Brain.getProgram()` and
   `Brain.getPages()` are still one-liner delegations to
   `this.runtime`.
3. **Audit the facade import set.** Run
   `grep -nE '^import' packages/core/src/brain/brain.ts`.
   The surviving imports must be:
   - `Dict`, `List`, `Error` from `../platform/*` (only
     if used by surviving code).
   - `BrainEvents`, `IBrain`, `PageMetadata`,
     `UnlinkedBrainProgram`, `BrainLinkEnvironment`,
     `linkBrainProgram`, `treeshakeProgram` from
     `../runtime`.
   - `Program` from `../runtime/program` (return type
     of `getProgram()`).
   - `PlatformServices` from `../runtime/services`.
   - `BrainRuntime` from `../runtime/brain-runtime`.
   - `compileBrain` from `./compiler`.
   - `IBrainDef`, `IBrainPageDef` from `./interfaces`.
   - `BrainPage` from `./page`.
   - `BrainServices` from `./services`.
   - `EventEmitterConsumer` from `../util` (if
     `Brain.events()` return type is annotated
     directly; otherwise the type comes through
     `IBrain`).

   Imports that should NOT be present after B6:
   - `VM`, `FiberScheduler`, `ExecutionContext`,
     `BytecodeExecutableAction`, `ICallsiteStore`,
     `MathOps`, `NIL_VALUE`, `Value`, `FiberState`,
     `VmStatus`, `createCallsiteStore`,
     `createRuntimeServices`, `createProgramServices`,
     `createRuleVariableServices`,
     `RuleVariableStores`.
   - `BrainRule` (the facade does not reference rules
     directly; `BrainPage` does).
   - `EventEmitter` (only the consumer type is needed;
     the emitter itself lives on the runtime).

   Delete every import outside the surviving set. Each
   deletion removes one piece of evidence that runtime
   concerns leaked into the facade.
4. **Confirm `Brain.initialize()` matches the post-split
   shape.** The body reads:
   1. Resolve `linkEnvironment`.
   2. `compileBrain` -> `linkBrainProgram` ->
      `treeshakeProgram` (assign result to `linked`).
   3. `this.compiledProgram = compiledProgram`.
   4. For each page in `this.pages`, call
      `page.assignFuncIds(linked.ruleIndex, pageIdx)`.
   5. Build the `hostServices` literal from
      `this.services`:
      `{ runtime: this.services.runtime, shared: this.services.shared, app: this.services.app }`
      (the three non-`brain` tiers of
      `PlatformServices`).
   6. `this.runtime = new BrainRuntime(linked.program, linked.pages, hostServices, contextData)`.
   7. Subscribe to `this.runtime.events()` for
      `page_activated` / `page_deactivated`. Store the
      unsubscribe callbacks for cleanup in `shutdown`.

   No other code in `initialize()`. If anything else is
   there, it is residual runtime concern that B2-B5
   missed; lift it to the runtime and re-run the gate.
5. **Confirm `Brain.isInitialized()` is
   `this.runtime !== undefined`.**
6. **Confirm `Brain.shutdown()`** is a short body:
   `this.runtime?.shutdown()`, then invoke each stored
   unsubscribe callback and clear the list. Today's
   `clearVariables` / `callsiteStore.clearAll` /
   `vm?.shutdown` etc. all live inside
   `BrainRuntime.shutdown()` after B5.
7. **Run the full gate** from `packages/core`,
   `apps/sim`, `apps/vscode-extension`, and any package
   that imports `Brain` or `IBrain`.

### Acceptance (validation checklist)

1. `Brain` field set is exactly: `brainDef`, `services`,
   `linkEnvironment`, `pages`, `compiledProgram`,
   `runtime`, and a private subscription disposer (e.g.
   a `List<() => void>` returned by `events().on(...)`).
   `program`, `ruleIndex`, `pageMetadata` are absent
   (B3 already kept them as locals).
2. `grep -nE '^import' packages/core/src/brain/brain.ts`
   matches the surviving import set in step 3.
3. `Brain.initialize()` is shorter than 30 lines, body
   matches the post-split shape in step 4.
4. `Brain.shutdown()` calls `this.runtime?.shutdown()`
   and tears down subscriptions; nothing else.
5. `Brain.events()`, `Brain.getProgram()`,
   `Brain.getPages()`, `Brain.think()`,
   `Brain.startup()`, every `Brain.requestPage*`,
   `Brain.getCurrentPageId()`, `Brain.getPreviousPageId()`,
   `Brain.setEnabled` / `isEnabled` / `interrupt` /
   `clearInterrupt` / `isInterrupted`, every
   variable-accessor: each is a one-liner delegating to
   `this.runtime`. (`Brain` does not declare an `rng()`
   method; RNG reaches the VM via `services.app.rng`.)
6. `Brain.getCompiledProgram()` and
   `Brain.isInitialized()` are the only methods on
   `Brain` that do *not* delegate to `this.runtime`.
7. The full gate passes from every affected package.
8. `__firewall__.spec.ts` still reports
   `BASELINE_VIOLATIONS = 0`.

### Risks

- **Subscription cleanup on re-initialization.**
  `ManagedMindcraftBrain.initialize()` calls
  `super.shutdown()` then `super.initialize()`. The
  `super.initialize()` constructs a new `BrainRuntime`
  (and registers fresh event subscribers). If
  `super.shutdown()` did not unsubscribe the old
  subscribers, they leak (closures over `this.pages`
  outlive the old runtime, but the old runtime's
  emitter goes out of scope, so the callbacks become
  unreachable -- safe by GC). To avoid any subtle
  leak, `super.shutdown()` clears the subscription
  handles unconditionally; a subsequent
  `super.initialize()` registers fresh ones.
- **`getProgram()` returning `undefined`** before
  `initialize()` is the existing semantics. After B6,
  `getProgram()` reads `this.runtime?.getProgram()` --
  still `undefined` before `initialize()`. Tests that
  assert this stay green.

---

## Phase B7 -- Lock-In: Greppable Acceptance And Self-Test

**Purpose.** Mechanize the architectural invariants the
split exists to enforce, and demonstrate the
constrained-target construction path with a runtime-only
self-test. After this phase, no future change can silently
re-introduce a runtime import of `brain/` or a
`BrainRuntime` dependency on authoring types.

**Precondition.** B6 shipped. `Brain` is a thin facade;
`BrainRuntime` is self-contained.

### Source paths (the agent edits / inspects these)

- **Firewall test:**
  `packages/core/src/runtime/__firewall__.spec.ts`.
  Confirm `BASELINE_VIOLATIONS = 0`. Update the
  doc-comment to reference `brain-runtime.ts` as the
  load-bearing example of a runtime-side consumer ("the
  firewall ratchets shut the moment
  `runtime/brain-runtime.ts` exists; B7 documents this
  in the test header").
- **New self-test:**
  `packages/core/src/runtime/brain-runtime.spec.ts`.
  New file. Constructs a `BrainRuntime` from a
  pre-built `Program` and a test-only `PlatformServices`
  (built via the runtime-only test factory at
  `packages/core/src/runtime/test-only-runtime-services-factory.ts`).
  Imports nothing from `brain/`. Asserts:
  1. The constructor returns a fully-initialized
     runtime (`getProgram()` returns the input program;
     `getPages()` returns the input page metadata).
  2. `startup()` -> `think(t)` -> `shutdown()` runs
     without throwing on a minimal one-page,
     zero-rule program.
  3. Variable storage is sized to
     `program.variableNames.size()` and slot reads
     return `NIL_VALUE` for unwritten slots.
  4. `requestPageChangeByName("page-2")` advances the
     FSM when a second page exists.
  5. **Hot-reload carry-forward.** Construct a first
     `BrainRuntime` from a one-variable program; write
     a value into the variable; call
     `snapshotVariables()`; construct a second
     `BrainRuntime` from a two-variable program (the
     first variable name preserved, a second added) with
     the snapshot passed as `previousVariables`; assert
     the first variable read returns the previously
     written value and the second reads as unwritten.
  6. The test file's import set is rooted at
     `packages/core/src/runtime/` and
     `packages/core/src/platform/` only. The firewall
     test enforces this for the source file; the
     self-test asserts the platform-services factory's
     return value does not silently grow
     authoring-side members (a structural assertion on
     the factory's output: every key is in the
     `PlatformServices` contract surface).
- **Existing self-test fixture:**
  `packages/core/src/runtime/__fixtures__/disallowed-import.fixture.ts`.
  Confirm the firewall self-test still detects the
  synthetic violation.

### Procedure (execute in order)

1. **Confirm firewall baseline is zero.** Run
   `npm test -- --test-name-pattern firewall` from
   `packages/core`. Record the violation count in the
   test output; if non-zero, a regression slipped in
   between B6 and B7 -- bisect and fix before
   continuing.
2. **Update the firewall test's header doc-comment** to
   name `runtime/brain-runtime.ts` as the canonical
   runtime-side consumer of `runtime/`-only imports.
   The point is to make the load-bearing nature of the
   firewall obvious to a future reader.
3. **Write the self-test.** `brain-runtime.spec.ts`
   constructs a `Program` literal directly (no
   `compileBrain` / `linkBrainProgram` /
   `treeshakeProgram` call). The minimal program has:
   - one page with one root rule that does nothing
     (a `RETURN` with no value),
   - empty `variableNames`,
   - empty `actions`,
   - `pageMetadata` listing the one page.

   Build the `PlatformServices` via
   `__test__createPlatformServices()` (the
   runtime-only test factory introduced by the
   module-decoupling plan M4.1). Assert the six
   behaviors listed under "Source paths".
4. **Run the full gate.**

### Acceptance (validation checklist)

1. `__firewall__.spec.ts` reports
   `BASELINE_VIOLATIONS = 0` and the
   synthetic-violation self-test still passes.
2. `packages/core/src/runtime/brain-runtime.spec.ts`
   exists. Constructs a `BrainRuntime` from a
   hand-built `Program` with no `compileBrain` /
   `linkBrainProgram` / `treeshakeProgram` call.
3. `grep -nE 'from "[^"]*\.\./brain' packages/core/src/runtime/`
   returns nothing.
4. `grep -nE 'from "[^"]*\.\./brain' packages/core/src/runtime/brain-runtime.ts`
   returns nothing (subsumed by item 3 but called out
   for emphasis).
5. `grep -nE 'IBrainDef|IBrainPageDef|IBrainRuleDef|BrainServices|BrainLinkEnvironment|BrainPage|BrainRule|compileBrain|linkBrainProgram|treeshakeProgram' packages/core/src/runtime/brain-runtime.ts`
   returns nothing.
6. `grep -nE 'page\.activate\(|page\.deactivate\(' packages/core/src/runtime/`
   returns nothing.
7. `grep -nE 'class BrainRuntime' packages/core/src/runtime/brain-runtime.ts`
   returns exactly one match.
8. `grep -nE 'class Brain\b' packages/core/src/brain/brain.ts`
   returns exactly one match (the facade).
9. The full gate passes from `packages/core` and
    every downstream package.

### Risks

- The `__test__createPlatformServices` factory used by
  the self-test is itself an artifact of the
  module-decoupling plan (M4.1). If it grows
  authoring-side defaults in a future change, the
  self-test silently starts depending on `brain/`
  semantics through the factory. Mitigation: the
  self-test asserts in a `before()` hook that the
  factory's returned services expose exactly the
  contracted member names. `PlatformServices` is the
  nested four-tier struct
  `{ runtime, shared, app, brain }`; the
  assertion enumerates each tier and each leaf member
  explicitly --
  `services.runtime`: `types`, `functions`,
  `operatorTable`, `actions`;
  `services.shared`: `conversions`;
  `services.app`: `rng`;
  `services.brain`: `program`, `brainVars`, `ruleVars`,
  `pages`, `callsite` --
  with `assert.notStrictEqual(services.<tier>.<leaf>, undefined)`;
  do not iterate via `Object.keys` or wrap the literal
  in a `Dict`. The `__test__createPlatformServices`
  factory itself accepts an optional
  `app?: Partial<AppServices>` parameter; the
  self-test exercises both the default
  (`MathOps.random()`-backed RNG) and an injected
  deterministic RNG to confirm the host-supplied seam.
- Hand-building a `Program` directly is brittle if the
  `Program` shape changes. The self-test constructs a
  `Program` literal inline (the type lives under
  `runtime/program.ts` and is part of the runtime
  contract; the test file's literal is the worked
  example of the contract surface). If the `Program`
  shape changes, the self-test must be updated in the
  same diff -- this is the intended coupling.

---

## Phase B8 -- Document The Split In `vm-contract.md`

**Purpose.** Pin the `BrainRuntime` constructor signature,
the runtime surface, and the firewall guarantee in the
contract document, so a future port reads one canonical
source of truth.

**Precondition.** B7 shipped. `BrainRuntime` is
self-contained and exercised by `brain-runtime.spec.ts`.

### Source paths (the agent edits / inspects these)

- **Contract doc:** `docs/specs/core/vm-contract.md`. Add
  a new section
  `## BrainRuntime: Compiled-Program Entry Point` placed
  immediately after `## Construction And Services Boundary`.
- **Source-of-truth files (cited by the new section):**
  `packages/core/src/runtime/brain-runtime.ts`,
  `packages/core/src/runtime/host-bindings.ts` (`IBrain`
  / `IBrainRuntime`),
  `packages/core/src/runtime/brain-runtime.spec.ts` (the
  self-test demonstrating the constrained-target path).

### Procedure (execute in order)

1. **Draft the new section.** It contains exactly the
   following sub-sections, in order:
   1. **Purpose.** One paragraph: `BrainRuntime` is the
      runtime entry point for a compiled Mindcraft
      program. A constrained-target port consumes this
      contract; the authoring-side `Brain` facade in
      `packages/core/src/brain/` is one consumer of the
      contract, not the contract itself.
   2. **Constructor signature.** A code block with the
      exact `BrainRuntime` constructor signature from
      `brain-runtime.ts`, plus one paragraph stating
      that variable-name -> slot binding is read from
      `program.variableNames` inside the constructor
      and no separate name list is accepted.
   3. **Runtime surface.** A bulleted list of every
      method on `IBrainRuntime`, grouped by concern:
      lifecycle (`startup`, `shutdown`, `think`),
      page navigation (`requestPageChange*`,
      `requestPageRestart`, `getCurrentPageId`,
      `getPreviousPageId`), control (`setEnabled`,
      `isEnabled`, `interrupt`, `clearInterrupt`,
      `isInterrupted`), variables (six methods),
      program access (`getProgram`, `getPages`),
      events (`events`). Note that `rng()` is **not**
      on `IBrainRuntime`; randomness is a host-scoped
      service exposed through `services.app.rng`, see
      the next sub-section.
   3a. **Tiered service aggregate.** One paragraph plus
       a small table: `PlatformServices` is a nested
       four-tier struct
       `{ runtime, shared, app, brain }`.
       `RuntimeLangServices` (`runtime` -- `types`,
       `functions`, `operatorTable`, `actions`; owned
       by `coreModule()` and other Mindcraft modules,
       installed at environment setup) carries the
       VM-time language registries.
       `SharedLangServices` (`shared` -- `conversions`)
       carries language registries consulted by both
       runtime and edit time.
       `AppServices` (`app` -- `rng`; future
       host-scoped services like network / wallClock /
       logger / telemetry land here) is supplied by
       the embedding application at
       `MindcraftEnvironment` construction (the
       `apps/sim` `SimEnvironmentStore.create()` site
       is the worked example).
       `BrainInstanceServices` (`brain` -- `program`,
       `brainVars`, `ruleVars`, `pages`, `callsite`)
       is built per-brain by the `BrainRuntime`
       constructor. Constrained-target ports register
       the three host- and module-supplied tiers
       (`runtime`, `shared`, `app`) once at process
       startup and pass them as the `hostServices`
       constructor parameter on each `BrainRuntime`
       construction.
   4. **Firewall guarantee.** One paragraph: nothing
      under `packages/core/src/runtime/` value-imports
      from `packages/core/src/brain/`. The
      `__firewall__.spec.ts` test enforces this with
      `BASELINE_VIOLATIONS = 0`. A constrained-target
      port is therefore reachable from `runtime/` and
      `platform/` alone.
   5. **Constrained-target construction example.** A
      pointer to `brain-runtime.spec.ts` as the
      canonical example of constructing `BrainRuntime`
      without going through the authoring side. The
      spec file itself is the worked example; the
      contract section does not duplicate it.
2. **Cross-link.** The existing
   `## Construction And Services Boundary` section
   gains a one-line reference: "For brain-program
   execution, see `## BrainRuntime: Compiled-Program Entry Point`
   below." No other section needs editing.
3. **Run the doc gate.** `npm run check` from the
   `packages/docs` directory (if applicable) plus a
   visual review of the rendered Markdown in VS Code.

### Acceptance (validation checklist)

1. `vm-contract.md` contains a section
   `## BrainRuntime: Compiled-Program Entry Point` with
   the five sub-sections in order.
2. The constructor signature in the doc cites the same
   four parameter names and types as the constructor
   declaration in `brain-runtime.ts`.
3. The runtime surface section groups methods by
   concern (per the procedure); for the canonical
   per-method list it points to the `IBrainRuntime`
   declaration in `host-bindings.ts` rather than
   duplicating it.
4. The cross-link from
   `## Construction And Services Boundary` is in
   place.
5. No code changes outside `vm-contract.md`.

### Risks

- The contract doc and the `IBrainRuntime` declaration
  both describe the runtime surface. The doc deliberately
  delegates the per-method list to `IBrainRuntime` (see
  acceptance item 3) to avoid drift.

---

## Completion Criteria

The plan is complete when:

1. Every phase B0-B8 has an entry in the Phase Log per
   the workflow convention.
2. `Brain` contains only the authoring graph +
   compile-pipeline + facade delegations (per B6
   acceptance).
3. `BrainRuntime` is the sole runtime entry point for
   compiled Mindcraft programs and is self-contained
   under `packages/core/src/runtime/`.
4. `__firewall__.spec.ts` reports zero violations and
   the synthetic-violation self-test passes.
5. `brain-runtime.spec.ts` constructs a `BrainRuntime`
   from a hand-built `Program` with no path through
   `brain/`.
6. `vm-contract.md` documents the `BrainRuntime`
   constructor signature, runtime surface, and
   firewall guarantee.
7. The full gate passes from every affected package.
