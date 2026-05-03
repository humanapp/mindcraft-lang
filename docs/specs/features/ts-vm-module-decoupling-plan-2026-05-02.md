# TS VM Module Decoupling Plan

Date: 2026-05-02
Status: Phased implementation plan.

## Scope And Sibling Spec

This spec covers two concerns:

- **A. Module/import topology.** The runtime VM and everything it
  needs to execute Mindcraft bytecode lives under
  `packages/core/src/runtime/` and imports nothing from
  edit/compile-only code (tile catalog, tile builder,
  parser/authoring registries, editor descriptors, suggestion
  services, source-label enrichment). The legacy
  `packages/core/src/brain/runtime/` directory is removed by this
  spec; nothing under `brain/` retains a `runtime/` subfolder.
- **B. Service contract shape.** The VM is constructed from a runtime
  `Program` plus a `PlatformServices` aggregate plus an optional
  `VMEvents` observer. Registries and conversions move behind those
  contracts. Program verification is **not** a VM responsibility in
  this spec (see Non-Goals).

The end state of this spec is: the VM can be constructed and stepped
from a runtime `Program` + `PlatformServices` + (optional) `VMEvents`,
with no edit/compile imports reachable from the executor. After this
spec, `brain/` contains only the object model the dense-runtime-state
spec will rewrite (`Brain`, `BrainPage`, `BrainRule`,
`ActionInstance`, plus their immediate helpers); everything that
participates in bytecode execution lives under `runtime/`. The brain /
page / rule / action-instance object model itself, the
`ExecutionContext` shape, host function signatures, and runtime
behavior are unchanged.

The complementary work -- replacing the object-shaped runtime state
(`Brain`, `BrainPage`, `BrainRule`, `ActionInstance`, the rich
`ExecutionContext`) with a compact ids/slots/side-tables model that TS,
WODAL, and the C++ CODAL port can mirror -- lives in
[ts-vm-dense-runtime-state-plan-2026-05-02.md](ts-vm-dense-runtime-state-plan-2026-05-02.md).
That spec depends on this one being complete; this spec does not depend
on it.

## Goal

```text
Program + PlatformServices + (VMEvents?)
        |
        v
TS VM / scheduler
        |
        v
Runtime hosts supply required services and passive event observers.
```

The primary seam this spec enforces is **runtime-required vs
edit/compile-only**. Pages, rules, callsites, action state, and some
tile-derived metadata are runtime concepts when bytecode execution or
host functions observe them; they live under `runtime/`. Tile
catalogs, parser grammar, editor layout, authoring descriptors,
suggestion data, and rich source labels are edit/compile/debug concepts
and must not be reachable from any `runtime/` file.

**Framing.** This spec treats the boundary as a **dependency invariant**
first and a layout change second. The invariant -- "every file under
`packages/core/src/runtime/` value-imports only from `runtime/` and
`platform/`" -- is mechanized as a `dependency-cruiser` rule landed in
Phase M0.5, *before* any relocation begins. That rule starts as a
baseline-violation-count assertion (a red gate measured against HEAD)
and each subsequent unit drives the count down. M4.3 flips the
assertion from "baseline N" to "zero," turning the ratchet into a hard
gate. Layout changes (M1.x) and contract changes (M2.x, M3.x) exist to
satisfy the invariant; the firewall is the source of truth for whether
they did.

## Non-Goals

- No bytecode instruction changes.
- No dense MCU binary writer.
- No flattening of `Brain` / `BrainPage` / `BrainRule` / `ActionInstance`
  -- those stay as today's TS objects through the end of this spec.
- No reshaping of `ExecutionContext` field set or host function
  signatures.
- No WODAL or CODAL implementation.
- No behavior changes to current Mindcraft program execution.
- **No program verifier.** Bytecode/program metadata verification is
  out of scope for the TS VM. The TS VM trusts the `Program` it is
  handed because the TS toolchain produces it in-process. A separate
  program-metadata verifier is planned only for the MCU-targeted
  C++ build, which is the only VM that loads bytecode produced
  elsewhere; that work lives in a future spec, not this one.

## Desired End State

- `Program`, bytecode types, `FunctionBytecode`, constants, opcodes, and
  VM config live in a runtime module path that contains everything
  needed to execute Mindcraft bytecode. Edit/compile artifacts
  (`UnlinkedBrainProgram`, authoring descriptors, tile/editor metadata,
  parser-only action forms, source labels not consumed by runtime
  faults) live elsewhere.
- `PlatformServices` is the single aggregate the VM accepts at
  construction. It carries the registries the VM uses today: types,
  functions, conversions, operator table, and operator overloads. It
  does **not** carry a program verifier.
- `VMEvents` is the single passive-observer aggregate the VM accepts.
  Event handlers must not decide bytecode semantics or mutate required
  VM state.
- Every file under `packages/core/src/runtime/` imports nothing from
  edit/compile modules (transitively, value imports only -- type-only
  imports are excluded). An import-firewall
  test enforces this and fails CI on regression.
- The VM can be constructed and stepped against a runtime-only
  `Program` with no edit/compile services and no event observers.
- All current runtime behavior tests pass unchanged through every
  phase.

## Key Invariants

- Existing Mindcraft bytecode output remains semantically unchanged.
- Current runtime behavior tests remain green after every unit.
- Service migration is behavior-preserving. If a service boundary
  changes behavior, the unit is too large or the boundary is wrong.
- VM events are passive. Event handlers do not decide bytecode
  semantics or mutate required VM state.
- The TS VM remains the full semantic reference. This spec does not
  introduce a reduced MCU bytecode subset.

---

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

Each unit lands as one coherent change. Whether the working tree is
committed between units is up to the user; this plan does not require
commits as a workflow step.

---

## Multi-Target Core Constraints (Roblox-ts portability)

`packages/core` is a multi-target package (Node TS, browser TS,
Roblox-ts/Luau). Every unit in this plan that touches shared core
code -- whether under `packages/core/src/brain/` or new locations
introduced by this plan such as `packages/core/src/runtime/` -- must
obey `.github/instructions/core.instructions.md`:

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
  are erased at compile time and are allowed. This constraint
  applies to every file relocated or split by this plan; the M1
  module split must be checked for value-level cycles before the
  unit lands.

---

## Workflow Convention

Phases are numbered M0-M5. Units within a phase are numbered M<N>.<K>
when a phase is broken into units; otherwise the phase number alone
identifies the unit (e.g. M3).

Each unit follows this loop:

1. Agent implements the unit.
2. Agent stops and presents work for review.
3. The user reviews, requests changes or approves.
4. Only after the user declares the unit complete does the post-mortem
   happen.
5. Post-mortem updates Status, Current State, propagates new risks to
   future phases, and writes any useful repo memory notes
   (`/memories/repo/vm-decouple-M<N>[.<K>].md`). The `vm-decouple-`
   prefix is shared with the dense-runtime-state spec, which uses
   `vm-decouple-D<N>[.<K>].md`.

Do NOT amend Current State, propagate risks, or create repo memory
notes during implementation.

### Post-mortem content rules

**STOP. If you are about to write a post-mortem entry, re-read this
section in full first. Do not work from memory of these rules; do not
reuse the framing of the implementation summary you just gave the
user. Those two artifacts have different audiences and different
length budgets.**

The post-mortem is a forward-looking artifact for future-phase
agents, not a changelog and not a recap of the work for the user.
The user already saw the work. The future agent has the unit's spec
section above the Current State entry and does not need it
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

**Mandatory pre-write checklist.** Before writing the Current State
entry, answer each of these out loud (in the chat, not in the doc):

1. What is the one-sentence summary?
2. Did any new spec section, contract surface, or public API land?
   List them, one line each, or write "none."
3. What is the verification line?
4. Is the draft within the 5-15 line target? Count lines.
5. Does the draft contain any item from the "Do NOT include" list?
   Read the list and check each one.

If you skip the checklist or answer in your head instead of in the
chat, you will violate the rules. This has happened in every prior
session where these rules were not enforced this way.

**Current State entry for the unit (HARD CAP: 15 lines, including
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
  Current State entry is a delta on top.
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

**Repo memory note (`/memories/repo/vm-decouple-M<N>[.<K>].md`, target:
10-25 lines).** Write only if the unit established invariants or owed
work that a future agent must respect. Content categories:

- Invariants the runtime / compiler must preserve (one line each).
- Owed tests or follow-ups with no current enforcement.
- Non-obvious gotchas that would silently break a future phase.

The memory note is also subject to the "Do NOT include" list above.
It is not a place to dump implementation details that did not earn
their way into the Current State entry.

Each unit must:

- Compile, type-check, lint, build, and test green at HEAD.
  Run `npm run typecheck && npm run check && npm test && npm run build`
  from `packages/core` and any downstream package whose API surface
  changed (`apps/sim`, `apps/vscode-extension`, etc.).
  `npm run build` is mandatory -- it is the only step that runs
  `rbxtsc` and catches Luau-incompatible code.
- Once Phase M0.5 has landed the firewall as a baseline assertion,
  every subsequent unit that relocates code or changes imports must
  drive the baseline count down (or hold it at zero) and update the
  baseline constant in the same unit. Increasing the count is a
  unit-level failure -- treat it the same as a failing test. The
  firewall spec runs under `npm test`; no separate gate.
- Update `docs/specs/core/vm-contract.md` as part of the same unit
  when the change is contract-shaping. **Exception:** this plan
  defers all `vm-contract.md` updates for M2-M4 to Phase M5; see
  M5's Authoring rule.
- Have its own test additions. No "tests will follow."
- **No phase/unit markers in shipped code.** Do not embed strings
  like "Phase M0.5", "M1.x", "M4.3", or references to this spec
  file in source comments, test names, JSDoc, or config-file
  comments. Phase numbers and this spec are ephemeral planning
  artifacts; the code that ships under them must read as if it had
  always been there. State invariants and behavior in the present
  tense, with no reference to the unit that introduced them. This
  rule applies to every unit in this plan and is checked during
  review.

---

## Current State

Work units completed: M0.5, M1.1, M1.2, M1.3, M1.4, M2.0, M2.1, M2.2.
Next up: M3.1.

### M2.2 -- VM Construction Flipped To PlatformServices

VM constructor signature is now `(prog: Program, services: PlatformServices, ...)`;
all construction sites in core and ts-compiler updated. `VM.shutdown()` added
to encapsulate handle teardown (not in spec; Brain.shutdown no longer reaches
into vm.handles directly).

Verification: full gate green (681/681 core tests, 972/972 ts-compiler tests).

### Risks (M2.2)

- **`VM.shutdown()` is unspecified.** The method was added to plug an
  encapsulation hole discovered during review. M3 or a follow-up should
  confirm whether this method belongs in the vm-contract.md surface or
  should be removed in favour of a lifecycle pattern introduced by M3.
- **`apps/sim` and `apps/vscode-extension` had no VM construction sites.**
  The spec listed them as required update targets but they construct the VM
  only transitively through `Brain`. If either app ever constructs a VM
  directly, the new argument order must be used.
- **HandleTable injection overload preserved.** The 3-argument overload
  `(prog, services, handles)` was kept for test harnesses that inject
  pre-populated handles. M3+ must not add a 4th positional argument;
  new optional parameters should trail as named config.

### M2.1 -- PlatformServices Interface Introduced

`PlatformServices` interface (`functions`, `types`) added to
`runtime/services.ts` and barrel-exported from `runtime/index.ts`.

Verification: full gate green (681/681 core tests).

### Risks (M2.1)

- **No consumers yet.** `PlatformServices` is declared but nothing
  constructs it at value level until M2.2. If M2.2 is reverted or
  delayed, the interface is dead code; the firewall will not catch this.

### M2.0 -- PlatformServices decision tables pinned

M2.0 pinned PlatformServices to runtime registries consumed by VM execution.
New spec section: Phase M2 Decisions.
New contract surface: PlatformServices member-set decision (`functions`, `types`).
Verification: full gate green (docs-only unit, no tests run).

### Risks (M2.0)

- **Decision-table drift before M2.1 lands.** If VM execution paths
  gain new registry reads before M2.1, the pinned member set can go
  stale. Re-run the M2.0 inventory immediately before cutting
  `runtime/services.ts`.
- **Program-action path dependency remains implicit.** M2.0 excludes
  action/conversion/operator registries because VM executes through
  program-local artifacts today. If M2.1 or M2.2 redirects execution
  back through registries, this decision must be re-opened.

### M1.4 -- Runtime-execution interface files promoted into runtime/

All runtime-execution interface files relocated from `brain/interfaces/`
into `packages/core/src/runtime/`; `brain/` barrels no longer re-export
any runtime symbol. New module in runtime: `tile-ids.ts` (`TileId`,
tile-id helpers, `CoreActuatorId`, `CoreSensorId`, `CoreParameterId`).
`brain/interfaces/` now contains only `catalog`, `emitter`, `model`,
`tiles`.

Verification: full gate green (681/681 core, 972/972 ts-compiler).

### Risks (M1.4)

- **`vm-types.ts` still value-imports `EventEmitter` from
  `../util/event-emitter`.** This is the single remaining firewall
  violation (`BASELINE_VIOLATIONS = 1`). The options are: move
  `EventEmitter` into `runtime/` or `platform/`, extract the
  `HandleTable` events surface behind a plain callback aggregate in
  `runtime/`, or extend the allow-list to include `util/`. M4.3
  deletes `BASELINE_VIOLATIONS`; this must be resolved before then.
- **`brain/` barrels no longer re-export runtime symbols.** Any
  consumer that previously reached runtime symbols via
  `@mindcraft-lang/core/brain` will fail to type-check. In-tree
  consumers were updated in this unit; out-of-tree tooling or examples
  that pinned the brain subpath will break silently at runtime if not
  recompiled.
- **`runtime/context.ts -> brain/interfaces/runtime` for `IBrain` /
  `IBrainRule` remains type-only.** M0 table 1 closure failure (a) is
  still open. M2 must split those interfaces before any value-edge
  appears, or the firewall ratchet stalls.

### M1.3 -- Extender disposition applied

M0 table 3 discharged. New surfaces: `ProgramArtifact` (runtime),
`LinkedBrainProgram` and `BrainActionMetadata` (brain),
`IBrain.getPages()`. `Program.actions` is now optional.

Verification: full gate green (681/681 core, 972/972 ts-compiler).

### Risks (M1.3)

- **`UserActionArtifact` kept as `extends ProgramArtifact,
  BrainActionMetadata` rather than literally flattened to hold a
  `program: Program` field.** The brain/runtime split table 3
  cares about is enforced at the `BytecodeResolvedAction` seam;
  the convenience type stays flat. If a later unit (e.g. dense-
  state) needs the flat shape gone, every artifact construction
  site will need updating.
- **M0 table 1 closure failure (a) deferred.** `runtime/context.ts`
  still imports `IBrain` / `IBrainRule` type-only from
  `brain/interfaces/runtime`. M1.3 took option (b). The brain-
  shaped action-metadata edges from context.ts ARE gone. M2 owns
  splitting `IBrain` / `IBrainRule` before any value-edge appears.
- **`Program.actions` is optional.** Any new consumer that reads
  `prog.actions` outside `vm.ts`'s `ACTION_CALL` path must guard
  for undefined; an unlinked program reaching the executor throws
  "program does not define executable actions".
- **Firewall baseline held at 1.** Only type-only cross-edges
  added; no value-imports out of `runtime/`. M4.3 still requires
  the count to reach 0.

### M1.2 -- ExecutionContext and runtime action-binding types relocated

`ExecutionContext`, the runtime action-binding union
(`HostActionBinding`, `ResolvedAction` / `BytecodeResolvedAction`,
`ExecutableAction` / `BytecodeExecutableAction`,
`UserActionArtifact`, `ActionInstance` / `ActionInstanceMap` /
`CallSiteStateMap`), and the call-site state helpers
(`getActionInstance`, `getOrCreateActionInstance`,
`resetActionInstance`, `getCallSiteState`, `setCallSiteState`)
live under `packages/core/src/runtime/context.ts`. Reachable via
the existing `@mindcraft-lang/core/runtime` subpath; the
`@mindcraft-lang/core/app` barrel re-exports `ExecutionContext`
and the call-site state helpers for app consumers.

Verification: full gate green (681/681 core tests, 972/972
ts-compiler tests).

### Risks (M1.2)

- **`runtime/context.ts` now imports `IBrain` and `IBrainRule`
  type-only from `brain/interfaces/runtime`.** Table 1's closure
  failure (a) names this edge as the next firewall violation to
  resolve before M2 and gives M1.3 two options: split `IBrain` /
  `IBrainRule` into a minimal runtime-facing interface that moves
  with `context.ts`, or accept the edge and treat it as the next
  baseline-ratchet item. Either way M1.3 owns the resolution. The
  edge is type-only so the firewall remains green at baseline 1.
- **`runtime/context.ts` also imports brain-shaped action metadata
  type-only.** `ActionDescriptor`, `ActionKey`, `ActionKind`,
  `BrainActionCallDef` (from `brain/interfaces/functions`), and
  `TypeId` (from `brain/interfaces/type-system`) are reached only
  through `UserActionArtifact`, which Table 3 disposes
  `flatten-to-composition` in M1.3 -- the brain-shaped fields
  (`key`, `kind`, `callDef`, `outputType`) move to a brain-side
  action-metadata record referenced by `BrainActionResolver`, and
  these type-only edges disappear with them.
- **Firewall baseline held at 1, did not decrease.** The remaining
  violation is M1.1's `runtime/value.ts -> NativeType` value-import.
  M1.2 added only type-only cross-edges (which the firewall
  ignores), so the count is unchanged. M4.3 still requires this to
  reach 0.
- **`brain/` barrels no longer re-export the moved symbols.** No
  shims were added per spec. Any out-of-tree consumer that imports
  `ExecutionContext` (or any other moved symbol) from
  `@mindcraft-lang/core/brain` will fail to type-check. In-tree
  consumers were all updated; app code reaches for
  `@mindcraft-lang/core/app` (which re-exports the host-facing
  surface) or `@mindcraft-lang/core/runtime` directly.

### M1.1 -- Pure bytecode types relocated

Pure bytecode types, value primitives, and `Program` moved out of
`brain/interfaces/vm.ts` into `packages/core/src/runtime/`
(`bytecode.ts`, `value.ts`, `program.ts`, barrel `index.ts`). New
public package subpath: `@mindcraft-lang/core/runtime`. Extender
hierarchy preserved: `brain/interfaces/runtime.ts` extenders import
`Program` from `runtime/program` unchanged.

Verification: full gate green (681/681 core tests, 972/972
ts-compiler tests).

### Risks (M1.1)

- **Firewall baseline raised from 0 to 1.** `runtime/value.ts`
  value-imports `NativeType` from `brain/interfaces/type-system` for
  the struct-snapshot path. M4.3 deletes `BASELINE_VIOLATIONS`; this
  one violation must be eliminated before then, either by relocating
  `NativeType` into `runtime/` or by reshaping the struct path so
  the value side does not need it.
- **Runtime tests cannot use relative imports.** `platform/dict.ts`
  is a `declare class`-only file; the runtime JS comes from
  `dict.node.ts` via the post-build `require` rewriter. Tests that
  import `runtime/*` modules directly via relative paths fail at
  runtime with `Class extends value undefined`. Runtime spec files
  must import via `@mindcraft-lang/core/runtime` (resolves through
  `dist/` after `pretest`). Document this in any new runtime test
  added by M1.2-M1.4.
- **Downstream import drift.** Many downstream files (notably
  `packages/ts-compiler` specs) were rewritten in this unit to
  source moved symbols from `@mindcraft-lang/core/runtime`. There
  is no automated check that future code does not re-route them
  back through `brain/`; the firewall only constrains imports
  *inside* `runtime/`. If brain/ accidentally re-exports a moved
  symbol again, downstream code will still compile.

### M0.5 -- Firewall landed as red gate

`dependency-cruiser` installed and wired up as a `npm test`-time gate
asserting the runtime allow-list at a baseline of zero violations,
with a self-test fixture proving the rule fires.

Verification: full gate green (680/680 tests).

### Risks (M0.5)

- **`dependency-cruiser` is ESM-only.** No `require` condition in its
  `exports` map. The spec compiles under `module=commonjs` and uses
  dynamic `await import("dependency-cruiser")` which `tsx` preserves.
  Any future test/tool that adds a top-level value-import of
  `dependency-cruiser` from a CJS-emitted file will break at runtime;
  use the same dynamic-import pattern.
- **Fixture re-included implicitly by globs.** Build tsconfigs exclude
  `**/__fixtures__/**`, but a future tsconfig added without that
  exclusion will pull the fixture into `dist/` and emit a Luau file
  that value-imports `brain/` -- defeating the firewall's purpose at
  the artifact level. Any new `tsconfig.*.json` under `packages/core`
  must add the same exclude.
- **Baseline ratchet is advisory until M4.3.** The constant tolerates
  whatever the repo currently does; if a future unit forgets to
  update `BASELINE_VIOLATIONS` after relocating code, the test
  silently fails closed (count mismatch) or silently passes if the
  count happens to match. Per-unit checklist already requires the
  update; the gate that makes "forgot to update" impossible is
  M4.3's deletion of the constant.
- **`tsConfig` resolution sanity check is single-fixture.** The
  self-test only proves the rule fires when handed an unresolved /
  cross-tree import. A subtler config bug -- the `tsConfig` reference
  silently failing to resolve TS path aliases -- would still let
  alias-only edges slip past the firewall. If M1.x introduces any
  alias-mediated runtime imports, extend the self-test with a
  fixture that violates via a `paths` alias.

---

## Phase M0 Decisions

Tables below describe the repository at HEAD after M1.1 and M1.2 have
already landed (`bytecode.ts`, `context.ts`, `program.ts`, `value.ts`
relocated under `packages/core/src/runtime/`). Anything those units
moved is treated as already in `runtime/`; the inventory captures
what remains brain-coupled.

### Table 1 -- Runtime-type-source export inventory

Source files: `packages/core/src/brain/interfaces/vm.ts` (vm.ts) and
`packages/core/src/brain/interfaces/runtime.ts` (runtime.ts). Symbols
reachable transitively through the `runtime-type` closure are
included even when defined in adjacent files; their source path is
shown in the second column.

| symbol | source file | classification | notes |
| --- | --- | --- | --- |
| `OverflowError` | brain/interfaces/vm.ts | runtime-type | thrown by capacity guards in `brain/runtime/vm.ts` (push/spawn paths) |
| `UnderflowError` | brain/interfaces/vm.ts | runtime-type | thrown by stack-underflow guards in `brain/runtime/vm.ts` |
| `throwOverflow` | brain/interfaces/vm.ts | runtime-type | helper used inside `brain/runtime/vm.ts` capacity guards |
| `throwUnderflow` | brain/interfaces/vm.ts | runtime-type | helper used inside `brain/runtime/vm.ts` underflow guards |
| `isOverflowError` | brain/interfaces/vm.ts | runtime-type | dispatch-loop fault classification in `brain/runtime/vm.ts` |
| `isUnderflowError` | brain/interfaces/vm.ts | runtime-type | dispatch-loop fault classification in `brain/runtime/vm.ts` |
| `VmConfig` | brain/interfaces/vm.ts | runtime-type | constructor config for `VM` in `brain/runtime/vm.ts` |
| `HostSyncFn` | brain/interfaces/vm.ts | runtime-type | HOST_CALL synchronous dispatch in `brain/runtime/vm.ts` (`this.fns.getSyncById(...).fn.exec`) |
| `HostAsyncFn` | brain/interfaces/vm.ts | runtime-type | HOST_CALL_ASYNC dispatch in `brain/runtime/vm.ts` (`this.fns.getAsyncById(...).fn.exec`) |
| `HostFn` | brain/interfaces/vm.ts | runtime-type | union shape of values returned by `IFunctionRegistry` to the VM |
| `StructFieldGetterFn` | brain/interfaces/vm.ts | runtime-type | `StructTypeDef` getter invoked in `brain/runtime/vm.ts` GET_FIELD/MEMBER_CALL paths |
| `StructFieldSetterFn` | brain/interfaces/vm.ts | runtime-type | `StructTypeDef` setter invoked in `brain/runtime/vm.ts` SET_FIELD path |
| `StructSnapshotNativeFn` | brain/interfaces/vm.ts | runtime-type | invoked from `deepCopyValue` in `brain/runtime/vm.ts` for native structs |
| `VmStatus` | brain/interfaces/vm.ts | runtime-type | returned by `VM.runFiber` in `brain/runtime/vm.ts` |
| `VmRunResult` | brain/interfaces/vm.ts | runtime-type | returned by `VM.runFiber` in `brain/runtime/vm.ts` |
| `FiberState` | brain/interfaces/vm.ts | runtime-type | fiber lifecycle transitions in `brain/runtime/vm.ts` |
| `ActionFrameBinding` | brain/interfaces/vm.ts | runtime-type | per-frame action binding produced by ACTION_CALL in `brain/runtime/vm.ts` |
| `Frame` | brain/interfaces/vm.ts | runtime-type | call/frame stack maintained by `brain/runtime/vm.ts` |
| `Handler` | brain/interfaces/vm.ts | runtime-type | exception-handler stack used by `brain/runtime/vm.ts` |
| `AwaitSite` | brain/interfaces/vm.ts | runtime-type | await/resume bookkeeping in `brain/runtime/vm.ts` |
| `Fiber` | brain/interfaces/vm.ts | runtime-type | core fiber object manipulated throughout `brain/runtime/vm.ts` |
| `HandleState` | brain/interfaces/vm.ts | runtime-type | `HandleTable` lifecycle states consumed by `brain/runtime/vm.ts` |
| `Handle` | brain/interfaces/vm.ts | runtime-type | rows in `HandleTable` (constructed in `brain/runtime/vm.ts`) |
| `HandleTableEvents` | brain/interfaces/vm.ts | runtime-type | event payloads emitted by `HandleTable` (subscribed in `brain/runtime/vm.ts`: `this.vm.handles.events.on("completed", ...)`) |
| `HandleTable` | brain/interfaces/vm.ts | runtime-type | constructed and owned by `VM` in `brain/runtime/vm.ts` |
| `Scheduler` | brain/interfaces/vm.ts | runtime-type | called by `brain/runtime/vm.ts` (`enqueueRunnable`, `addFiber`, `onHandleCompleted`); the four optional `on*` hooks below are passive-event candidates that M3 will lift |
| `IVM` | brain/interfaces/vm.ts | runtime-type | implemented by `VM` in `brain/runtime/vm.ts` |
| `FiberSchedulerStats` | brain/interfaces/vm.ts | runtime-type | returned by `IFiberScheduler.getStats`, implemented in `brain/runtime/vm.ts` |
| `IFiberScheduler` | brain/interfaces/vm.ts | runtime-type | implemented by `FiberScheduler` in `brain/runtime/vm.ts` |
| `Scheduler.onFiberFault?` | brain/interfaces/vm.ts | passive-event | M3 `VMEvents.onFiberFault`; emit sites `brain/runtime/vm.ts:352, 1087, 1144, 2080`; payload `(fiberId: number, err: ErrorValue)` -- IDs + primitives |
| `Scheduler.onFiberDone?` | brain/interfaces/vm.ts | passive-event | M3 `VMEvents.onFiberDone`; emit site `brain/runtime/vm.ts:857`; payload `(fiberId: number, retv: Value)` -- ID + Value (no Brain/BrainPage/BrainRule references) |
| `Scheduler.onFiberCancelled?` | brain/interfaces/vm.ts | passive-event | M3 `VMEvents.onFiberCancelled`; emit site `brain/runtime/vm.ts:1925`; payload `(fiberId: number)` |
| `Scheduler.onFiberWaiting?` | brain/interfaces/vm.ts | passive-event | M3 `VMEvents.onFiberWaiting`; emit site `brain/runtime/vm.ts:1102`; payload `(fiberId: number, handleId: HandleId)` |
| `ActionRef` | brain/interfaces/runtime.ts | edit-compile | populated by `brain/compiler/brain-compiler.ts` into `UnlinkedBrainProgram.actionRefs`; consumed by `brain/runtime/linker.ts` when resolving action slots |
| `ActionCallSiteEntry` | brain/interfaces/runtime.ts | edit-compile | embedded in `PageMetadata.actionCallSites`; populated by compiler, consumed by `brain/runtime/linker.ts` |
| `UnlinkedBrainProgram` | brain/interfaces/runtime.ts | edit-compile | output of `brain/compiler/brain-compiler.ts`, consumed by `brain/runtime/linker.ts` (link-time) and stored on `brain/runtime/brain.ts` for inspection; never read by `brain/runtime/vm.ts` |
| `BrainProgram` | brain/interfaces/runtime.ts | edit-compile | alias for `UnlinkedBrainProgram` |
| `ExecutableBrainProgram` | brain/interfaces/runtime.ts | runtime-type | consumed at execution by `brain/runtime/vm.ts:939` (`(this.prog as ExecutableBrainProgram).actions`); also produced by linker and consumed by `tree-shaker.ts` and `brain/runtime/brain.ts` |
| `BrainActionResolver` | brain/interfaces/runtime.ts | link-time | linker entry point `brain/runtime/linker.ts` resolves `ActionDescriptor -> ResolvedAction` |
| `IBrainActionRegistry` | brain/interfaces/runtime.ts | link-time | mutable registry passed to the linker; not touched at execution |
| `BrainLinkEnvironment` | brain/interfaces/runtime.ts | link-time | linker input bundle (catalogs + action resolver) consumed by `brain/runtime/linker.ts` |
| `PageMetadata` | brain/interfaces/runtime.ts | edit-compile | produced by compiler; consumed by `brain/runtime/brain.ts` page activation and by `tree-shaker.ts`; not read by `brain/runtime/vm.ts` |
| `BrainEvents` | brain/interfaces/runtime.ts | edit-compile | event surface of `IBrain` (`page_activated`, `page_deactivated`); subscribed by hosts/UI, never by `brain/runtime/vm.ts` |
| `IBrain` | brain/interfaces/runtime.ts | runtime-type | reached transitively from `ExecutionContext.brain` (defined in `runtime/context.ts`); host functions read brain variables through it during HOST_CALL execution |
| `IBrainPage` | brain/interfaces/runtime.ts | edit-compile | brain-shaped page handle; not reached by `brain/runtime/vm.ts` (vm reads `(this.prog as ExecutableBrainProgram).actions`, not page objects) |
| `IBrainRule` | brain/interfaces/runtime.ts | runtime-type | reached transitively via `ExecutionContext` (used by host functions executed inside HOST_CALL/HOST_CALL_ASYNC) |

Closure failures (`runtime-type` symbols whose closure pulls in
non-runtime symbols, blocking M1 unless resolved):

- `IBrain` and `IBrainRule` are `runtime-type` by closure (reached
  through `ExecutionContext.brain`, defined in the already-relocated
  `runtime/context.ts`) but live in `brain/interfaces/runtime.ts`
  and pull `BrainEvents`, `IBrainPage`, and the brain page/rule
  shape with them. M1.3 must either (a) split `IBrain` /
  `IBrainRule` into a minimal runtime-facing interface (variable
  read/write, fiber-spawn surface, current-rule handle) that
  relocates with `context.ts`, with the brain-only methods
  (`getProgram`, `getCompiledProgram`, page-change requests, page
  metadata) staying in `brain/`, or (b) accept that
  `runtime/context.ts` already imports `IBrain`/`IBrainRule` from
  `brain/interfaces/runtime.ts` (see Table 2 row "context.ts ->
  brain/interfaces") and treat that import as the next firewall
  violation to resolve before M2.
- `ExecutableBrainProgram` is `runtime-type` because of the single
  `(this.prog as ExecutableBrainProgram).actions` read in
  `brain/runtime/vm.ts`. Its sub-table (Table 3) routes the offending
  `actions` field onto the relocated runtime `Program`, which removes
  `ExecutableBrainProgram` from the runtime-type closure entirely.

### Table 2 -- `brain/runtime/vm.ts` external-import inventory

Imports below are the lines in `brain/runtime/vm.ts` (HEAD) that
cross out of the future `runtime/` tree -- i.e., everything not
already under `../../runtime/` or `../../platform/`. Imports
satisfied from `runtime/` or `platform/` are firewall-clean and not
listed.

| imported symbol | source path | classification | first-use line |
| --- | --- | --- | --- |
| `ExecutableBrainProgram` (type) | `../interfaces` | runtime-type | 939 (`(this.prog as ExecutableBrainProgram).actions`) |
| `IFiberScheduler` (type) | `../interfaces` | runtime-type | 2121 (`class FiberScheduler implements IFiberScheduler`) |
| `ITypeRegistry` (type) | `../interfaces` | runtime-type | 171 (`deepCopyValue(..., types: ITypeRegistry, ...)`) |
| `IVM` (type) | `../interfaces` | runtime-type | 263 (`class VM implements IVM`) |
| `StructTypeDef` (type) | `../interfaces` | runtime-type | 1398 (`this.services.types.get(typeId) as StructTypeDef`) |
| `TypeId` (type) | `../interfaces` | runtime-type | 135 (`enum(key: string, typeId: TypeId)`) |
| `VmConfig` (type) | `../interfaces` | runtime-type | 102 (`DEFAULT_VM_CONFIG: VmConfig`) |
| `isOverflowError` (value) | `../interfaces` | runtime-type | dispatch-loop error classification |
| `isUnderflowError` (value) | `../interfaces` | runtime-type | dispatch-loop error classification |
| `NativeType` (value) | `../interfaces` | runtime-type | 130 (`{ t: NativeType.Number, v }`) |
| `throwOverflow` (value) | `../interfaces` | runtime-type | capacity guards |
| `throwUnderflow` (value) | `../interfaces` | runtime-type | underflow guards |
| `Fiber` (type) | `../interfaces/vm` | runtime-type | central fiber type |
| `Frame` (type) | `../interfaces/vm` | runtime-type | frame stack |
| `Handler` (type) | `../interfaces/vm` | runtime-type | handler stack |
| `HandleTable` (type) | `../interfaces/vm` | runtime-type | owned by VM (`this.handles`) |
| `Scheduler` (type) | `../interfaces/vm` | runtime-type | constructor parameter / call sites throughout |
| `VmRunResult` (type) | `../interfaces/vm` | runtime-type | `runFiber` return type |
| `FiberState` (value) | `../interfaces/vm` | runtime-type | fiber state transitions |
| `HandleState` (value) | `../interfaces/vm` | runtime-type | handle state transitions |
| `VmStatus` (value) | `../interfaces/vm` | runtime-type | `runFiber` status codes |
| `BrainServices` (type) | `../services` | runtime-type | constructor parameter; vm only reads `services.functions` and `services.types` (see closure note below) |

Closure note for `BrainServices`. Although declared as a single
import, only two of its eight fields are touched at execution by
`brain/runtime/vm.ts`: `services.functions` (HOST_CALL dispatch) and
`services.types` (`StructTypeDef` lookups, `deepCopyValue`). The
other six (`tiles`, `actions`, `operatorTable`, `operatorOverloads`,
`tileBuilder`, `conversions`) are never read by vm.ts. M2 should
introduce a `RuntimeServices` aggregate of just `{ functions, types
}` and pass that to the VM; `BrainServices` becomes a brain-side
superset that composes `RuntimeServices`.

In addition, `runtime/context.ts` (already relocated by M1.2) has a
type-only import `import type { IBrain, IBrainRule } from
"../brain/interfaces/runtime"`. That edge is not in vm.ts but is in
the runtime tree; it is the next firewall violation surfaced by the
M0 closure analysis (see Table 1 closure failures).

### Table 3 -- `Program` extender disposition

| extender | disposition | rationale (one line) |
| --- | --- | --- |
| `UnlinkedBrainProgram` | `keep-extending` | Pure compiler artifact; only consumed by linker and brain-side inspection. Stays in `brain/`, continues to extend the relocated runtime `Program`. |
| `BrainProgram` (alias for `UnlinkedBrainProgram`) | `keep-extending` | Type alias; follows `UnlinkedBrainProgram`. |
| `ExecutableBrainProgram` | `flatten-to-composition` | Single execution-time field (`actions`) moves onto the relocated runtime `Program`; the remaining brain-shaped fields move to a runtime-side table owned by `brain/runtime/brain.ts`. After this split there is no `ExecutableBrainProgram extends Program` anymore; vm.ts holds a plain `Program` reference and the brain side-table is reached via `brain/runtime/brain.ts`. |
| `UserActionArtifact` | `flatten-to-composition` | Already in `runtime/context.ts` but carries brain-shaped action-call metadata (`callDef: BrainActionCallDef`, `key`, `kind`). Split the bytecode-relevant fields (`entryFuncId`, `activationFuncId`, `numStateSlots`, `isAsync`, `revisionId`) onto a runtime `ProgramArtifact` and move the brain-shaped fields to a brain-side action-metadata record referenced by `BrainActionResolver`. |

#### `ExecutableBrainProgram` field sub-table

| field | type | disposition | target location |
| --- | --- | --- | --- |
| `actions` | `List<ExecutableAction>` | `runtime-Program` | merged onto `Program` (or a thin runtime extension thereof) at `packages/core/src/runtime/program.ts`; `ExecutableAction` already lives at `packages/core/src/runtime/context.ts` |
| `ruleIndex` | `Dict<string, number>` | `runtime-side-table` | brain-side artifact attached to the brain runtime container `packages/core/src/brain/runtime/brain.ts` (consumed by `Brain` page-activation paths; never read by vm.ts) |
| `pages` | `List<PageMetadata>` | `runtime-side-table` | same brain-side artifact as `ruleIndex`; `PageMetadata` is brain-shaped and stays in `brain/interfaces/runtime.ts` |

---

## Phase M2 Decisions

### Table 1 -- Runtime registry inventory

Source of evidence: `packages/core/src/runtime/vm.ts` constructor and execution paths, plus transitive registry surface on `packages/core/src/brain/services.ts`.

| registry symbol | source file | execution-time call site | include in PlatformServices? | rationale |
| --- | --- | --- | --- | --- |
| `services.functions` (`IFunctionRegistry`) | `packages/core/src/brain/services.ts` | `VM.execHostCall` and `VM.execHostCallAsync` in `packages/core/src/runtime/vm.ts` (`this.fns.size()`, `getSyncById(...).fn.exec`, `getAsyncById(...).fn.exec`) | yes | |
| `services.types` (`ITypeRegistry`) | `packages/core/src/brain/services.ts` | `deepCopyValue(..., this.services.types, ...)` and struct field access in `packages/core/src/runtime/vm.ts` (`findStructField`, `makeStructFields`, `execStructCopyExcept`, `execGetField`, `execSetField`) | yes | |
| `services.conversions` (`IConversionRegistry`) | `packages/core/src/brain/services.ts` | none in `packages/core/src/runtime/vm.ts` | no | consumed by registration/linking paths, not by VM execution dispatch in current runtime |
| `services.operatorTable` (`IOperatorTable`) | `packages/core/src/brain/services.ts` | none in `packages/core/src/runtime/vm.ts` | no | consumed by registration/linking paths, not by VM execution dispatch in current runtime |
| `services.operatorOverloads` (`IOperatorOverloads`) | `packages/core/src/brain/services.ts` | none in `packages/core/src/runtime/vm.ts` | no | consumed by registration/linking paths, not by VM execution dispatch in current runtime |
| `services.actions` (`IBrainActionRegistry`) | `packages/core/src/brain/services.ts` | none in `packages/core/src/runtime/vm.ts` (`VM` reads `program.actions`, not action registry) | no | execution-time action resolution is program-local (`Program.actions`) and registry resolution is link-time |

### Table 2 -- Registry-interface relocation plan

Rows include every table 1 symbol marked `yes`.

| interface | current file | relocate in M2.1? | target file |
| --- | --- | --- | --- |
| `IFunctionRegistry` | `packages/core/src/runtime/function-defs.ts` | no | `packages/core/src/runtime/function-defs.ts` |
| `ITypeRegistry` | `packages/core/src/runtime/type-defs.ts` | no | `packages/core/src/runtime/type-defs.ts` |

---

## Phase M0 -- Decision Tables For Phase M1

**Purpose.** Produce the small set of decisions that Phase M1 cannot
proceed without. This is **not** a full audit of `vm.ts` couplings.
Phase M0 only produces what would otherwise force a redesign mid-M1.

**File-naming convention.** There are two `vm.ts` files in the repo
at the start of M0:

- `packages/core/src/brain/interfaces/vm.ts` -- type definitions
  (`Op`, `Instr`, `Program`, etc.).
- `packages/core/src/brain/runtime/vm.ts` -- the executor.

Never refer to either as bare `vm.ts` in the inventory or in M0/M1
unit specs; always use the full path. M1.1 deletes the first;
M1.4 moves the second to `packages/core/src/runtime/vm.ts` and
removes `packages/core/src/brain/runtime/` entirely. From Phase M2
onward there is exactly one `vm.ts` in the repo and it lives at
`packages/core/src/runtime/vm.ts`.

**Work.** Produce three tables (table 3 carries one nested
field-level sub-table for `ExecutableBrainProgram`; see below).

**Classification tiebreaker.** The four classifications
(`runtime-type`, `link-time`, `edit-compile`, `passive-event`) are
exclusive. If a symbol qualifies for more than one, apply this
precedence (highest wins):

1. `runtime-type` -- if any execution-time call site (anything
   reachable from `brain/runtime/vm.ts` during bytecode execution)
   consumes it, the symbol is `runtime-type` regardless of other
   uses.
2. `link-time` -- consumed by the linker but never at execution.
3. `edit-compile` -- consumed by editor/compiler only.
4. `passive-event` -- consumed only as fault/trace/diagnostic
   payload by today's vm.ts emit sites that M3 will lift into
   `VMEvents`.

**Transitive-closure rule.** Table 1's `runtime-type` set is closed
under type reachability: if a `runtime-type` export references
another type (as a field, method parameter, return type, generic
argument, or extends/implements clause), that referenced type is
also in the inventory and is also classified. Expand the inventory
until the `runtime-type` closure has no `edit-compile` or
`link-time` items. If the closure cannot be made clean (a
`runtime-type` genuinely needs an `edit-compile` symbol), stop and
record the violation in the table; this is a Phase M0 failure to
resolve before M1 starts, not a problem to push into M1.

1. **Runtime-type-source export inventory.** Every `export` in
   `packages/core/src/brain/interfaces/vm.ts` and
   `packages/core/src/brain/interfaces/runtime.ts`, plus every type
   transitively reachable from a `runtime-type` export per the
   closure rule above. Classification per the four-way tiebreaker.

   Table schema:

   ```text
   | symbol | source file | classification | notes |
   ```

   `notes` is one short clause: for `runtime-type`, the consuming
   call site (e.g. "`vm.ts` HOST_CALL dispatch"); for `link-time`,
   the linker entry point; for `edit-compile`, the editor/compiler
   module; for `passive-event`, the proposed `VMEvents` method
   name and the emit-site source line (e.g.
   "`onFiberFault` -- vm.ts:1842"). M3.1 generates the `VMEvents`
   interface body from these `passive-event` rows.

2. **`brain/runtime/vm.ts` external-import inventory.** Every
   `import` statement in `packages/core/src/brain/runtime/vm.ts`
   that crosses out of `runtime/`, with the same four-way
   classification as table 1. This is the baseline for the Phase M4
   import-firewall test.

   Table schema:

   ```text
   | imported symbol | source path | classification | first-use line |
   ```

3. **`Program` extender disposition.** For each interface that
   currently extends `Program` (`UnlinkedBrainProgram`,
   `ExecutableBrainProgram`, `UserActionArtifact`, plus any others
   the audit finds), one of:
   - `keep-extending` -- extender stays in `brain/` and continues to
     extend the relocated runtime `Program`;
   - `flatten-to-composition` -- extender is rewritten to hold a
     `program: Program` field instead of extending it;
   - `runtime-side-table` -- the extender's brain-shaped fields move
     to a runtime side table reachable from the executor (today's
     object form is fine; reshaping is dense-state-spec work);
   - `delete` -- no current consumer.

   Extender table schema:

   ```text
   | extender | disposition | rationale (one line) |
   ```

   For each field on `ExecutableBrainProgram` specifically, also
   record one of `runtime-Program` / `runtime-side-table` /
   `edit-compile` / `delete`, so M1.3 can apply it field-by-field.

   Field sub-table schema:

   ```text
   | field | type | disposition | target location |
   ```

   `target location` is the file path for `runtime-Program` /
   `edit-compile`, or the owning structure for `runtime-side-table`
   (per the M1.3 side-table tiebreaker).

Out of scope for Phase M0:

- Cataloguing every `currentCallSiteId` / `currentActionInstance` /
  action-instance binding site. The dense-state spec owns these.
- Designing the dense state shape. Same.
- Listing every `.actions` read or `funcIdToRule` use. Same.

**Passive-event payload sanity check.** As part of producing table 1,
for each row that would otherwise be classified `passive-event`,
inspect the existing emit site's payload. If the payload contains
only IDs and primitive values (or values trivially derivable from
them at the emit site without a side-table lookup), keep the row
`passive-event`. If the payload references today's object-shaped
`Brain` / `BrainPage` / `BrainRule` / `ActionInstance`, mark the row
`passive-event-blocked-on-dense-state` and add one note column
identifying which object reference forces the block. Phase M3 only
lifts rows classified `passive-event`; the blocked rows are deferred
to the dense-runtime-state spec. This check exists so M3 does not
discover mid-implementation that the event-payload content rule
cannot be satisfied for a row M0 already counted in.

**Deliverable.**

- A `## Phase M0 Decisions` section appended to this plan, directly
  below `## Current State`, containing the three tables above and
  nothing else.

**Acceptance.**

- M1.1, M1.2, and M1.3 can each be implemented from the M0 tables
  without further source spelunking on the questions M0 covers.
- No code changes.

## Phase M0.5 -- Land The Firewall As A Red Gate

**Purpose.** Install the `dependency-cruiser` rule that mechanizes
the architectural invariant *before* any relocation begins. Every
subsequent unit then has a numeric "did this work?" gate instead of
a hand-verified "looks right?" claim.

**Why this phase exists.** The load-bearing claim of the entire
spec is "no edit/compile imports reachable from the executor." That
claim has exactly one mechanical check. Landing it last (after every
relocation has already happened) means several units of churn occur
with no continuous evidence the invariant is being satisfied; landing
it first turns each later unit into a measurable ratchet.

**Tooling choice.** Use `dependency-cruiser` (MIT, mature, actively
maintained, rule-driven). It natively understands the
`import type` / value-import distinction, resolves TS path aliases
via `tsConfig`, and produces structured per-rule violation output.
Do **not** use `madge` (visualizer-first, thin rule support, no
native type-only awareness). Do **not** hand-roll a walker; the AST
and re-export edge cases are too easy to get silently wrong, and the
load-bearing nature of this guardrail makes a battle-tested tool the
lower-risk choice. Pin the major version in `packages/core`'s
`package.json`; minor/patch bumps are safe.

**"Reachable" definition (binding for this phase and M4.3).**
*Reachable* means the value-import transitive closure of the source
files under the firewall scope. Type-only imports (`import type`,
`export type`, inline-type positions) are excluded -- excluding them
is consistent with the no-value-circular-imports rule and lets
shared interfaces live wherever the package's type graph requires.

**Allow-list source-of-truth (binding for this phase and M4.3).**
The firewall is expressed as an **allow-list**: imports from
`runtime/` are permitted only into an enumerated set of paths
(`runtime/`, `platform/`, plus any narrow shims the build requires).
Anything else is forbidden by default. The allow-list is the
architectural invariant -- "the executor depends only on runtime +
platform" -- expressed directly. Adding a new permitted dependency
requires editing `packages/core/.dependency-cruiser.cjs` in the same
unit that introduces the dependency; that edit *is* the
architectural review.

**Firewall scope.** The rule applies to every file under
`packages/core/src/runtime/`. Before M1.4 this directory contains
only the type files relocated in M1.1-M1.3 (so the baseline count is
low); after M1.4 it contains the executor and every sibling that
participates in bytecode execution (the count rises briefly during
M1.4 then falls as imports are rewritten in the same unit).

**Work.**

- Add `dependency-cruiser` as a `devDependency` of `packages/core`,
  major-version-pinned.
- Add `packages/core/.dependency-cruiser.cjs` containing one
  `forbidden` rule named `runtime-allow-list`:
  - `from.path`: `^packages/core/src/runtime/`.
  - `to.path`: `^packages/core/src/` (scope the rule to
    intra-package edges; third-party / `node_modules` imports are
    not the firewall's concern and are not enumerated).
  - `to.pathNot`: `^packages/core/src/(runtime|platform)/` (the
    allow-list -- expand only when a new permitted runtime
    dependency is genuinely added; each addition requires a comment
    in the config explaining why).
  - `to.dependencyTypesNot`: includes `type-only` (so
    `import type` imports are excluded per the "Reachable"
    definition).
  - `comment`: restates the allow-list source-of-truth rule and
    points at this spec's M0.5 / M4 sections as the canonical
    architectural justification.
- Configure `tsConfig.fileName` to point at `packages/core`'s main
  `tsconfig.json` (not `tsconfig.spec.json`) so path aliases
  resolve correctly. State this in the config comment;
  silently-passing alias misses are the most likely
  configuration-bug failure mode.
- Add `packages/core/src/runtime/__firewall__.spec.ts` that:
  - Invokes `dependency-cruiser`'s programmatic API
    (`cruise(...)` from `dependency-cruiser`) against the config
    above.
  - Asserts the violation count equals a `BASELINE_VIOLATIONS`
    constant declared at the top of the file. M0.5 sets the
    constant to whatever count HEAD produces; subsequent units
    drive it down; M4.3 deletes the constant and asserts zero.
  - Emits one line per violation in the failure path, in this
    format:

    ```text
    firewall: <importer-path>:<line> imports <symbol> from <imported-path> (rule: runtime-allow-list)
    ```

  - On success, prints the current count on one line
    (`firewall: <N> baseline violations`) so unit ratchets are
    visible in test output.
- Self-test: include one fixture-driven assertion that
  `dependency-cruiser` *does* fire when handed a synthetic source
  file under `runtime/` that imports a path outside the allow-list
  (e.g. a `brain/` module). This guards against config typos
  (wrong glob, wrong rule severity, missing `tsConfig` reference)
  silently passing the firewall check. The self-test is a separate
  assertion in the same spec file; it never reads the baseline
  constant.

**Risks.**

- A misconfigured `tsConfig` reference makes path aliases
  unresolved, which silently produces zero violations. The
  self-test fixture above is the mitigation.
- Major-version churn in `dependency-cruiser` could change rule
  semantics. Mitigation: pin the major version; review changelogs
  on bump.
- The baseline assertion is *not* a hard gate -- it tolerates
  whatever the repo currently does. The hard gate is M4.3. Until
  then, the value of this phase comes entirely from each later
  unit ratcheting the constant down; if a unit lands without
  updating the constant the ratchet is silently broken.

**Acceptance.**

- `dependency-cruiser` is a `devDependency` of `packages/core`,
  major-version-pinned.
- `packages/core/.dependency-cruiser.cjs` exists with the
  `runtime-allow-list` rule and the source-of-truth comment.
- `__firewall__.spec.ts` passes at the recorded baseline count.
- The self-test fixture proves `dependency-cruiser` fires on a
  deliberately disallowed import.
- Failure message format matches the contract above.
- No relocation has occurred yet; M1 has not started.

## Phase M1 -- Relocate Runtime Types Into `packages/core/src/runtime/`

M1 is split into four units. M1.1 is mechanical and has no dependent
decisions. M1.2 relocates execution-context and runtime
action-binding types, where the only decision is module split. M1.3
applies the M0 extender-disposition table to brain-shaped extenders
of `Program`. M1.4 moves the executor and its runtime-shaped
siblings out of `brain/runtime/` and removes that directory.

**End-state directory layout.** After M1.4:

- `packages/core/src/runtime/` contains the type interfaces (M1.1,
  M1.2), the executor (`vm.ts`), and every sibling required to
  execute bytecode (linker, tree-shaker, type-system, conversions,
  functions, operators, action-registry, builtins, sensors,
  actuators) plus their collocated `*.spec.ts`.
- `packages/core/src/brain/runtime/` does not exist.
- `packages/core/src/brain/` contains only the object model the
  dense-runtime-state spec will rewrite (`brain.ts`, `page.ts`,
  `rule.ts`, and their immediate helpers) plus interfaces still
  classified `link-time` per M1.3.

**Module split inside `packages/core/src/runtime/` (type files,
introduced by M1.1-M1.3).** The starting shape is:

- `runtime/bytecode.ts` -- `Op`, `Instr`, `FunctionBytecode`,
  `ConstantPools`, `ConstantOffsets`, `BYTECODE_VERSION`.
- `runtime/value.ts` -- `Value`, `HandleId`, `NIL_VALUE`, and any
  other value-tagged primitives M0 table 1 marks `runtime-type`.
- `runtime/program.ts` -- `Program` (final relocated home).
- `runtime/context.ts` -- `ExecutionContext` and the runtime
  action-binding types that reference it (`HostActionBinding` and
  friends from `brain/interfaces/runtime.ts`, per M0 table 1).
- `runtime/index.ts` -- barrel re-exporting the runtime surface.

A unit may further split a file if size demands; it must not
coalesce two files in this list.

**Barrel-export policy (applies to all of M1).**

- `runtime/index.ts` re-exports every export of every other file
  under `runtime/` (no filtering, no aliasing). Every consumer
  imports from this barrel or from a specific `runtime/*` file --
  never both for the same symbol.
- Existing `brain/` barrels (`brain/index.ts`, `brain/interfaces/
  index.ts`, etc.) **stop exporting moved symbols entirely**.
  Consumers that previously imported a moved symbol from a `brain/`
  barrel are updated in the same unit to import from the runtime
  barrel. No re-export shim of the form
  `export { Program } from "../runtime"` is added to any `brain/`
  barrel.
- The package-level barrel (`packages/core/src/index.ts`) exposes
  the runtime surface under a `runtime` subpath only:
  `export * as runtime from "./runtime"`. It does not flatten
  runtime symbols into the top-level export namespace.
- Downstream packages (`apps/sim`, `apps/vscode-extension`,
  `packages/ts-compiler`, `packages/bridge-app`, etc.) import as
  `import { Program } from "@mindcraft-lang/core/runtime"` or
  `import { runtime } from "@mindcraft-lang/core"`, never from a
  `brain/` path for relocated symbols.

### Unit M1.1 -- Move Pure Bytecode Types

**Purpose.** Mechanical relocation of types that have no
brain-specific surface area.

**Work.**

- Move from `packages/core/src/brain/interfaces/vm.ts` to
  `packages/core/src/runtime/bytecode.ts` and
  `packages/core/src/runtime/value.ts`:
  - `Op`, `Instr`, `FunctionBytecode`, `ConstantPools`,
    `ConstantOffsets`, `BYTECODE_VERSION`;
  - `Value`, `HandleId`, `NIL_VALUE`, and any other value-primitive
    exports M0 table 1 marks `runtime-type` and that no `link-time`
    export depends on transitively.
- Move `Program` to `packages/core/src/runtime/program.ts`. The
  extender hierarchy is preserved in this unit: existing extenders
  in `brain/interfaces/runtime.ts` continue to `extends Program` by
  importing from `runtime/program`. Whether any extender is later
  flattened is M1.3.
- Update every in-monorepo import site in this same unit. No
  re-export aliases. Old export sites in
  `brain/interfaces/vm.ts` are deleted.
- Add a one-line smoke test:
  `import { Program, Op, BYTECODE_VERSION } from "<runtime barrel>"`.
  The test is intentionally trivial; the load-bearing firewall test
  arrives in M4.

**Risks.**

- Broad import churn through barrels.
- A type listed as `runtime-type` in M0 table 1 may transitively pull
  in a `link-time` or `edit-compile` type. If discovered
  mid-implementation, stop and update M0 table 1 before continuing
  -- do not silently leave the dependency.

**Acceptance.**

- All bytecode types and `Program` live under `runtime/`.
- `brain/interfaces/runtime.ts` extenders still compile by importing
  `Program` from `runtime/`.
- The firewall baseline count (`BASELINE_VIOLATIONS` in
  `__firewall__.spec.ts`) decreases or holds at its M0.5 value.
  Update the constant in this same unit; the test must remain green.
- No behavior or bytecode output changes.

### Unit M1.2 -- Move ExecutionContext And Runtime Action-Binding Types

**Purpose.** Relocate the runtime types that the executor and host
functions reach for, but that are not pure bytecode.

**Scope.** This unit *moves* `ExecutionContext` and the runtime
action-binding union; it does **not reshape** either. Reshaping is
the dense-state spec's job.

**Work.**

- Move from `packages/core/src/brain/interfaces/runtime.ts` to
  `packages/core/src/runtime/context.ts` (or further split per the
  module-split list above):
  - `ExecutionContext` -- field set unchanged.
  - `HostActionBinding`, `BytecodeExecutableAction`,
    `ExecutableAction`, `ResolvedAction`, `BytecodeResolvedAction`,
    `UserActionArtifact`, `ActionInstance`, `ActionInstanceMap` --
    or whatever subset M0 table 1 marks `runtime-type`. Items marked
    `link-time` stay in `brain/` until M1.3 decides their home.
- `UserActionArtifact extends Program` continues to hold; it
  imports `Program` from `runtime/program` going forward.
- Update every in-monorepo import site in this same unit. No
  re-export aliases.
- Extend the M1.1 smoke import test to include `ExecutionContext`.

**Risks.**

- `ExecutionContext` is referenced from app host functions (sim,
  bridge). All references switch to the new path in this unit.
- Some action-binding types reference link-time descriptors
  (`ActionDescriptor`, `ActionKey`). Those imports may need to
  cross from `runtime/` back into `brain/` until M1.3 decides where
  link-time types live. That cross-import is allowed *only* when
  the symbol is `link-time` per M0 table 1; document each such case
  in the unit's risks block.

**Acceptance.**

- `ExecutionContext` and runtime action-binding types live under
  `runtime/`.
- App host functions import `ExecutionContext` from the runtime
  barrel.
- The firewall baseline count decreases or holds. Update
  `BASELINE_VIOLATIONS` in this unit; the test must remain green.
- No behavior or bytecode output changes.

### Unit M1.3 -- Apply The Extender Disposition

**Purpose.** Discharge M0 table 3 for the brain-shaped extenders of
`Program` (`UnlinkedBrainProgram`, `ExecutableBrainProgram`,
`UserActionArtifact`, plus any others M0 found).

**Work.**

- For each extender, apply its M0 disposition:
  - `keep-extending` -- nothing to do beyond the import-path fix
    M1.1/M1.2 already made.
  - `flatten-to-composition` -- rewrite the extender as a struct
    holding a `program: Program` field; update every consumer.
  - `runtime-side-table` -- the brain-shaped fields move to a
    runtime-reachable side table per the tiebreaker below. Today's
    object form is fine; the dense-state spec will reshape later.
  - `delete` -- remove the extender and every consumer.

  **Side-table location tiebreaker.** Default the field onto
  `Brain` (the existing runtime structure that already owns
  per-brain runtime state). Introduce a new `Dict` only if **both**:
  (a) the field is per-program rather than per-brain (multiple
  brains over time may share or swap programs), **and** (b) the
  field has a stable, obvious key (e.g. an existing id type). If a
  field cannot be placed by this rule, stop and surface the
  decision rather than guessing. Fields landed on `Brain` by this
  unit will be migrated by the dense-runtime-state spec along
  with the rest of the object model; M1.3 is not the unit that
  reshapes them.
- For each `ExecutableBrainProgram` field, apply its field-level
  disposition the same way.
- Decide where `link-time` types live (M0 table 1):
  `BrainActionResolver`, `IBrainActionRegistry`,
  `BrainLinkEnvironment`, and any others. Default: stay in
  `brain/`. Move to a new `packages/core/src/link/` module only if
  M1.3 finds runtime imports reaching them, in which case the move
  is the fix.
- Update every in-monorepo import site in the same unit. No
  re-export aliases.

**Risks.**

- A field tagged `runtime-side-table` may be consumed from
  `brain/runtime/vm.ts` today; the side-table form must remain
  reachable from the executor. M4's import firewall will catch
  regressions, but M1.3 itself has no firewall yet -- verify by
  hand that `brain/runtime/vm.ts` still type-checks against the new
  shape.
- Flattening an extender may break call sites that destructure or
  rely on prototype-chain lookups. Update those sites in the same
  unit.

**Acceptance.**

- M0 table 3 is fully discharged.
- Every former `ExecutableBrainProgram` field is in its tagged
  location.
- `link-time` types are in their decided home.
- The firewall baseline count decreases or holds. Update
  `BASELINE_VIOLATIONS` in this unit; the test must remain green.
- No behavior or bytecode output changes.

### Unit M1.4 -- Move Executor And Runtime-Shaped Siblings Into `runtime/`

**Purpose.** Collapse the two-directory split (`runtime/` for
types, `brain/runtime/` for the executor and everything that runs
alongside it) into one canonical `runtime/` home. This is the
relocation that makes the M4 firewall scope cover the executor.

**Files moved.** Move the entire current contents of
`packages/core/src/brain/runtime/` to
`packages/core/src/runtime/` (preserving file names and collocated
`*.spec.ts` siblings). At the time of writing this includes:
`vm.ts` + `vm.spec.ts`, `linker.ts` + `linker.spec.ts`,
`tree-shaker.ts` + `tree-shaker.spec.ts`,
`type-system.ts` + `type-system.spec.ts`,
`conversions.ts`, `functions.ts`, `operators.ts`,
`action-registry.ts`, `*-builtins.ts`,
`brain.ts` + `brain.spec.ts`, `page.ts`, `rule.ts`,
`context-types.ts`, `index.ts`, and the `actuators/` and
`sensors/` subtrees. The implementing agent re-runs `ls
packages/core/src/brain/runtime` at unit-start to catch any file
added since this spec was written; new files move with the rest.

**Brain-object-model exception.** `brain.ts`, `page.ts`, `rule.ts`,
`brain.spec.ts`, and any helper file whose top-level exports are
*only* the `Brain` / `BrainPage` / `BrainRule` / `ActionInstance`
object model **stay under `packages/core/src/brain/`** (move them
there if they are currently nested in `brain/runtime/`). The
dense-runtime-state spec rewrites these; keeping them in `brain/`
makes that spec's scope obvious. Any file that mixes object-model
and executor-required code is split before M1.4 ends, with the
executor portion moving to `runtime/` and the object-model portion
staying in `brain/`.

**Work.**

- For every file moved, update every in-monorepo import site to
  the new path in the same unit. No re-export aliases, no
  `brain/runtime/` shim files left behind.
- Delete the empty `packages/core/src/brain/runtime/` directory.
- Update `runtime/index.ts` to re-export the new value-level
  surface (the executor entry points, registry implementations,
  and any sibling that downstream packages currently import from
  `brain/runtime/`). The barrel-export policy from M1 still
  applies: `runtime/index.ts` re-exports every export of every
  other file under `runtime/`; no `brain/` barrel re-exports a
  moved symbol.
- Verify the M1.1/M1.2 smoke import test still loads from the
  runtime barrel; extend it to include `vm` (the executor entry)
  if not already present.

**Risks.**

- Hidden cycles: `vm.ts` and its siblings (linker, type-system,
  registries) may import from `brain/` modules that themselves
  import from `brain/runtime/`. After the move, those cycles can
  flip from "both inside `brain/`" to "`runtime/` <-> `brain/`,"
  which exposes the value-level cycle the Multi-Target Core
  Constraints forbid. Cycles are no longer caught by hand: the
  firewall baseline jumps when the executor lands in `runtime/`
  and only returns to its prior value once cross-folder value
  imports are rewritten or made type-only. The unit lands when
  the count is back at (or below) its pre-M1.4 value.
  Break any new cycle by promoting the shared symbol to
  `runtime/` or making the cross-folder import type-only.
- Downstream import paths shift en masse: `apps/sim`,
  `apps/vscode-extension`, `packages/ts-compiler`,
  `packages/bridge-app`, `packages/bridge-protocol`,
  `packages/service-api`, and every other package that imported
  from `@mindcraft-lang/core`'s `brain/runtime/` subpath updates
  in the same unit.
- Spec-file relocation can drop test discovery if the test runner
  has a hard-coded glob. Verify `npm test` from `packages/core`
  still finds and runs every relocated `*.spec.ts`.

**Acceptance.**

- `packages/core/src/brain/runtime/` does not exist.
- Every executor-required file (per the brain-object-model
  exception above) lives under `packages/core/src/runtime/`.
- `npm run typecheck && npm run check && npm test && npm run
  build` is green from `packages/core` and from every downstream
  package whose imports changed.
- The firewall baseline count is at or below its pre-M1.4 value.
  Update `BASELINE_VIOLATIONS` in this unit. The expected end
  state after M1.4 is a low single-digit count (or zero) -- the
  bulk of the relocation is done; remaining violations should
  correspond to the small set of legitimately-shared symbols that
  need promotion or type-only-ification.
- No behavior or bytecode output changes.
- `runtime/index.ts` re-exports the value-level executor surface
  (the entry point and any registry implementations downstream
  packages currently consume).

## Phase M2 -- Introduce PlatformServices Aggregate

**Purpose.** Stop runtime code from depending on edit/compile
registries by funnelling the registries the VM already uses through a
single aggregate.

**Scope note.** Phase M2 is *only* about today's registries
(types/functions/conversions/operators). Program verification is
explicitly **not** part of `PlatformServices` -- per Non-Goals, the
TS VM trusts its `Program` and a verifier is a future MCU-only
concern. Action resolution, rule/callsite state, platform entity
access, RNG, and other runtime services that are currently
object-shaped on `Brain` / `BrainPage` / `BrainRule` are explicitly
out of scope -- they belong to the dense-runtime-state spec.

M2 is split into three units. M2.0 is a decision step that produces
the `PlatformServices` member set; M2.1 introduces the interface and
relocates the registry interfaces it references; M2.2 flips the VM
constructor and call sites in one shot.

### Unit M2.0 -- PlatformServices Decision Tables

**Purpose.** Pin the set of registries that earn a slot in
`PlatformServices` from execution-time evidence, not from a guess.
Without this, M2.1's interface could ship dead fields or miss a
required one.

**Work.** Produce two tables, appended to this plan under a new
`## Phase M2 Decisions` section directly below `## Phase M0
Decisions`.

1. **Runtime registry inventory.** Every registry-shaped symbol
   imported (directly or transitively) by the executor (the file
   currently at `packages/core/src/brain/runtime/vm.ts`; M1.4
   relocates it to `packages/core/src/runtime/vm.ts`) and consumed
   at execution time.

   Table schema:

   ```text
   | registry symbol | source file | execution-time call site | include in PlatformServices? | rationale |
   ```

   `include in PlatformServices?` is `yes` / `no`. Any `no` row
   must give a one-line rationale (e.g. "consumed only by
   edit/compile, reached via accident through a brain-shaped
   helper -- unlinks in M2.1"). Program verification is not a
   row in this table.

2. **Registry-interface relocation plan.** For each registry symbol
   marked `yes` in table 1, the current home of its *interface*
   (not its implementation) and whether M2.1 must relocate it
   under `runtime/`.

   Table schema:

   ```text
   | interface | current file | relocate in M2.1? | target file |
   ```

   Relocation is required iff the current file is outside
   `packages/core/src/runtime/` and the interface is referenced
   from `runtime/services.ts` (introduced in M2.1). Implementations
   stay where they are -- only the interface declarations move.


**Acceptance.**

- M2.1 can name every field on `PlatformServices` from table 1.
- M2.1 knows exactly which interface files to move and where.
- No code changes.

### Unit M2.1 -- Introduce `PlatformServices` And Relocate Registry Interfaces

**Purpose.** Land the interface and the type-level moves it depends
on, with no behavioral change and no consumer rewrites.

**Work.**

- Add `packages/core/src/runtime/services.ts` containing the
  `PlatformServices` interface, with one field per `yes` row from
  M2.0 table 1. The shape is:

  ```ts
  export interface PlatformServices {
    // one field per M2.0 table 1 row marked yes.
    // ... fields per M2.0 table 1 ...
  }
  ```

- Relocate the registry interfaces flagged in M2.0 table 2 into
  `runtime/` (one file per interface, or grouped per the table's
  `target file` column). Implementations stay at their current
  location and are updated to import the relocated interface.
- `runtime/index.ts` re-exports `PlatformServices` and every
  relocated interface, per the M1 barrel-export policy.
- No VM constructor change. No consumer rewrites beyond import-path
  updates required by the interface relocation.

**Acceptance.**

- `packages/core` builds (typecheck + check + test + build).
- `runtime/services.ts` and any relocated interface files import
  only from `runtime/` or from `packages/core/src/platform/`.
- No consumer of `PlatformServices` exists yet (the interface is
  declared but unused at value level).

### Unit M2.2 -- Flip VM Construction To Accept `PlatformServices`

**Purpose.** Make the VM consume the aggregate, in one cross-cutting
change so no intermediate state mixes the old and new constructor
signatures.

**Work.**

- Change the VM constructor signature to:

  ```ts
  new VM(program: Program, services: PlatformServices)
  ```

  (The optional `events?: VMEvents` parameter is added in M3, not
  here.)
- Update every existing VM construction site in the same commit:
  `apps/sim`, `apps/vscode-extension`, `packages/ts-compiler`,
  `packages/bridge-app`, and any test harness. Each call site
  builds a `PlatformServices` from the providers it already
  constructs today; no new authoring/edit aggregate is introduced
  in this phase.
- Audit the registry implementations referenced by each
  `PlatformServices` instance for value-level imports of
  edit/compile modules. Any value-level reach-through that survives
  is a blocker for M3 unless it is type-only; record blockers
  inline in the phase log.

**Authoring-side scope.** Authoring callers continue to import
individual registries directly. No `AuthoringServices` aggregate is
introduced by this spec; if one is wanted later it is a separate
unit of work and is out of scope for M2.

**Risks.**

- Hidden backreferences from registry implementations to
  edit/compile services may make the M2.2 audit fail.
- Construction sites that previously relied on registry singletons
  now must wire them explicitly; missed sites surface as type
  errors at the boundary.

**Acceptance (M2 overall).**

- VM construction compiles when `PlatformServices` is built only
  from runtime-only providers (mechanical proof is deferred to
  M4's import firewall test; M2 acceptance is type-level + the
  existing test suite green).
- No new runtime smoke test in M2; that is M3's deliverable.
- The M2.2 audit either reports zero edit/compile value-level
  reach-throughs from registry implementations, or names every
  remaining one as an M3 blocker.
- The firewall baseline count decreases or holds across M2.1 and
  M2.2. The expected end state after M2.2 is zero (every
  registry implementation reachable from the executor goes
  through `PlatformServices`, with no value-level edit/compile
  reach-throughs left). Update `BASELINE_VIOLATIONS` in whichever
  M2 unit produces the change; the test must remain green.
- `docs/specs/core/vm-contract.md` is **not** updated by M2; the
  contract section that documents `PlatformServices` is written
  in one piece by M5 with full M0-M4 context in hand.

## Phase M3 -- VMEvents Scaffold + Runtime-Only Smoke Test

**Purpose.** Add the passive-observability seam and prove the VM can
be constructed and stepped without edit/compile services.

M3 is split into three units. M3.1 is type-only; M3.2 is the only
unit that touches executor code; M3.3 retroactively validates that
M2 actually decoupled the runtime.

**Constructor signature delta from M2.2.** M2.2 set the signature to
`new VM(program: Program, services: PlatformServices)`. M3.1 changes
it to `new VM(program: Program, services: PlatformServices, events?:
VMEvents)`. The `events` parameter is optional and trails `services`.
No further constructor changes are made by this spec.

**Passivity property (definition used by M3.1, M3.2, and M3.3).** An
event observer is *passive* iff:

1. `vm.ts` never reads from `events` to make a control-flow decision
   (no branches, no return values consumed).
2. Final `Program` state and any host-visible side effects are
   identical for any two executions of the same program that differ
   only in their `VMEvents` argument (including `undefined`).

This property is the load-bearing guarantee of the entire phase.
Acceptance below ties checks to it directly.

**Event-payload content rule (applies to M3.2).** Each event
payload contains only values already locally available at the emit
site. Nothing is computed, looked up, or allocated solely to
satisfy an event. Payloads carry only IDs and primitive values that
will survive the dense-runtime-state spec rewrite. Payloads do
**not** carry references to today's object-shaped `Brain`,
`BrainPage`, `BrainRule`, or `ActionInstance` instances.

### Unit M3.1 -- Declare `VMEvents` And Wire The Constructor Slot

**Purpose.** Land the type and the constructor parameter with no
emit sites and no behavioral change.

**Work.**

- Add `packages/core/src/runtime/events.ts` containing the
  `VMEvents` interface. The interface body is generated from the
  `passive-event` rows of M0 table 1: one optional method per row,
  named per the row's recorded emit-site name. If M0 table 1
  contains no `passive-event` rows yet, M3 is blocked until M0 is
  amended -- M3 does not invent event names.
- Each method is optional (`onX?: (payload: ...) => void`) with a
  payload type that complies with the event-payload content rule
  above.
- `runtime/index.ts` re-exports `VMEvents` and its payload types,
  per the M1 barrel-export policy. `runtime/events.ts` imports
  only from `runtime/` and `packages/core/src/platform/`.
- Change the VM constructor signature per the delta above. Store
  the observer on the VM instance. Do **not** call into it from
  any site; M3.1 leaves all event call sites untouched.

**Acceptance.**

- Package builds (typecheck + check + test + build).
- `vm.ts` does not reference the stored observer at any call site.
- The existing test suite passes unchanged (no behavior delta is
  possible because no emit site is wired).

### Unit M3.2 -- Convert `passive-event` Emit Sites To Observer Calls

**Purpose.** Route the emit sites identified by M0 table 1 through
the optional observer instead of their current sinks.

**Work.**

- For each `passive-event` row in M0 table 1, replace the existing
  emit at that source line with a guarded observer call
  (`this.events?.onX(payload)`).
- Construct payloads only from values already in scope at the emit
  site, per the event-payload content rule above.
- No emit site outside the M0 `passive-event` set is converted.

**Risks.**

- Tempting to lift a not-yet-passive emit site into `VMEvents`. If
  M0 table 1 did not mark it `passive-event`, it does not move in
  M3.2 -- amend M0 first.
- Tempting to assemble a richer payload than the local scope
  provides. The content rule forbids it.

**Acceptance.**

- Diff against M3.1 touches only the M0 `passive-event` source
  lines plus their immediate payload construction.
- The passivity property holds. Mechanical check: a single
  passivity test runs an existing brain program twice -- once with
  `events: undefined`, once with an observer that records every
  call -- and asserts deep equality of final program state and any
  host-visible side effects between the two runs.
- Existing test suite passes unchanged.

### Unit M3.3 -- Runtime-Only VM Smoke Test

**Purpose.** Prove that the M2 decoupling actually holds: a VM can
be constructed and stepped from a hand-authored runtime `Program`
plus a `PlatformServices` built without any edit/compile imports.

**Scope.** One scenario only. The six-scenario expansion belongs to
M4; M3.3 is the precursor that proves the layering, not a behavior
suite.

**Work.**

- Add `packages/core/src/runtime/__test__-services.ts` (or the
  closest collocated equivalent that matches existing
  `packages/core/src` test-helper conventions) exporting a single
  `__test__createPlatformServices()` helper that returns a
  `PlatformServices` whose providers import only from `runtime/`
  and `packages/core/src/platform/`. M4 expands this helper; M3.3
  introduces the minimal surface needed for one smoke test.
- Add `packages/core/src/runtime/vm-smoke.spec.ts` (collocated
  `*.spec.ts`, matching the existing pattern used by
  `vm.spec.ts` and siblings -- which M1.4 relocates into
  `packages/core/src/runtime/`):
  - construct a runtime `Program` literal whose single function
    halts immediately;
  - construct a VM with that program, the helper above, and no
    event observer;
  - run one step;
  - assert termination and zero faults.
- The test imports nothing from `brain/`, nothing from edit/compile
  modules, and nothing from any package outside `@mindcraft-lang/
  core`'s runtime surface.

**Risks.**

- Smuggling `brain/` imports into the test fixture or the helper
  defeats the point of the phase.
- Replicating existing behavior tests under a new directory
  produces noise without coverage gain.

**Acceptance.**

- The new `*.spec.ts` file passes under `npm test` from
  `packages/core`.
- The helper file and the smoke test together import only from
  `runtime/` and `platform/` (the M4 firewall test will enforce
  this mechanically; M3.3 verifies it by inspection).
- No file under `brain/` is modified by M3.3.
- `docs/specs/core/vm-contract.md` is **not** updated by any M3
  unit; the contract section that documents `VMEvents`, the
  passivity property, and the event-payload content rule is
  written in one piece by M5.

## Phase M4 -- Runtime-Only Test Harness And Firewall Hardening

**Purpose.** Prove the new layering works end-to-end with runtime-only
services, and flip the M0.5 firewall from a baseline ratchet to a
hard zero-violation gate so future regressions cannot silently
reintroduce edit/compile imports into runtime modules.

M4 is split into three units. M4.1 expands the M3.3 fixture helper;
M4.2 adds a small layering-focused scenario suite; M4.3 hardens the
firewall installed in M0.5 by removing the baseline constant.

**Firewall scope, "Reachable" definition, and allow-list
source-of-truth.** Defined once in Phase M0.5 and binding for M4.3.
M4 does not redefine them. M0 table 2 remains useful as the
relocation inventory but is **not** the firewall's source of truth.

### Unit M4.1 -- Expand `__test__createPlatformServices()`

**Purpose.** Grow the M3.3 helper from "one-scenario minimum" to
"covers every facet the M4.2 suite needs." Type-only / fixture
work; no new test scenarios in this unit.

**Work.**

- Modify the M3.3 helper file in place (do not split or relocate).
- Add provider stubs for every M2.0 table 1 `yes` row referenced by
  any M4.2 scenario in the table below. Each provider returns the
  minimum data needed for its scenario; none import from `brain/`
  or any edit/compile module.
- Add an `Options` parameter so individual scenarios can override
  one provider without rebuilding the whole aggregate (e.g.
  `__test__createPlatformServices({ functions: customRegistry })`).

**Acceptance.**

- The helper file imports only from `runtime/` and
  `packages/core/src/platform/` (verified by inspection in M4.1;
  mechanically by M4.3).
- Existing M3.3 smoke test still passes unchanged.
- Helper supports the surface required by every M4.2 scenario.

### Unit M4.2 -- Add Six-Scenario Runtime-Only Suite

**Purpose.** Prove each VM facet works under runtime-only services.
Not a behavior regression suite -- one assertion per scenario,
focused on the layering claim.

**Scope rule.** This is **not** a parallel behavior suite. If a bug
in `vm.ts` is found via these tests, the *behavior* test goes next
to the existing executor specs under
`packages/core/src/runtime/` (alongside `vm.spec.ts`), not in this
layering-focused suite. Each scenario file is <=100 lines including
fixtures, and asserts at most two post-state properties.

**Scenarios.** The table below is the *target* set; substitute
1:1 if a listed facet cannot be exercised cleanly under
runtime-only services (for example, if today's VM exposes step
counting differently than the `yield/budget` row assumes).
Record any substitution in the M4.2 phase log along with the
facet the substitute exercises. The total scenario count stays
at six.

```text
| scenario              | program shape                          | services beyond default | assertion                              |
| arithmetic host call  | call host fn `add(2,3)` and return     | functions               | result value == 5                      |
| variable slots        | store local, load local, return        | none                    | post-state slot value matches stored   |
| function call/return  | nested call returns value              | functions               | result on stack matches inner return   |
| yield/budget          | tight loop with budget=N               | none                    | exactly N steps executed, then yield   |
| simple async handle   | call host returning handle, await      | functions, handle table | handle resolves; fiber resumes         |
| fault path            | invalid op (e.g. divide by zero)       | none                    | fault recorded; no host-visible effect |
```

**Work.**

- One `*.spec.ts` per scenario under
  `packages/core/src/runtime/`, naming convention
  `vm-<scenario>.spec.ts` (e.g. `vm-arithmetic.spec.ts`,
  `vm-yield.spec.ts`). This matches the existing collocated
  `*.spec.ts` pattern used elsewhere in `packages/core/src/`.
- Each spec uses `__test__createPlatformServices()` from M4.1,
  optionally with overrides per the table.
- No spec imports from `brain/` or any edit/compile module.

**Acceptance.**

- All six scenarios pass under `npm test` from `packages/core`.
- Each spec file is <=100 lines and asserts <=2 post-state
  properties.
- Diff against M4.1 touches only files under
  `packages/core/src/runtime/`.

### Unit M4.3 -- Harden The Firewall To Zero

**Purpose.** Convert the M0.5 baseline ratchet into a hard
zero-violation gate. By the time this unit runs, M1.1 through M3.3
should have driven the baseline constant to `0` already; M4.3 is the
structural change that makes any future violation a test failure
rather than a count drift.

**Pre-condition.** The `BASELINE_VIOLATIONS` constant in
`packages/core/src/runtime/__firewall__.spec.ts` reads `0` at HEAD.
If it does not, M4.3 cannot start: an earlier unit failed to ratchet
and must be fixed first. Do **not** drive the count to zero inside
M4.3 itself -- mixing relocation work with the gate-flip hides which
unit owed the cleanup.

**Work.**

- In `packages/core/src/runtime/__firewall__.spec.ts`:
  - Delete the `BASELINE_VIOLATIONS` constant.
  - Replace the baseline assertion with
    `assert.strictEqual(violations.length, 0)`.
  - Replace the success log line
    (`firewall: <N> baseline violations`) with
    `firewall: clean (0 violations)`.
  - Leave the self-test fixture assertion unchanged; it has always
    been zero-or-fires regardless of baseline.
- Update the per-unit ratchet language in the Workflow Convention
  is *not* removed -- it stays in force in case a future spec
  re-introduces a baseline (e.g. when adding a second firewall
  scope).

**Risks.**

- Skipping the pre-condition check ("the count is already zero at
  HEAD") and trying to drive remaining violations to zero inside
  M4.3 turns the unit into a debugging session and obscures which
  earlier unit was supposed to land the cleanup.
- A future contributor adding a permitted dependency must update
  `.dependency-cruiser.cjs`'s allow-list, not the spec file. The
  M0.5 config comment is the durable reminder of this; M4.3 does
  not need to re-state it.

**Acceptance.**

- `BASELINE_VIOLATIONS` is gone from `__firewall__.spec.ts`.
- The firewall spec asserts strict zero violations.
- The full test suite passes.
- `docs/specs/core/vm-contract.md` is **not** updated by any M4
  unit; the contract section that documents the firewall rule
  and its scope is written in one piece by M5.

## Phase M5 -- Document The Module/Service Boundary

**Purpose.** Make the contract that downstream specs (the
dense-runtime-state spec, WODAL, CODAL) build on explicit and
permanent. This plan becomes historical once complete; the
vm-contract.md section written here is the only durable record of
the M0-M4 decisions.

**Authoring rule.** M2/M3/M4 acceptance defers `vm-contract.md`
updates to M5, so this phase writes the entire new section once
with full M0-M4 context in hand. Do not split the work back into
the earlier phases.

**Anti-bloat rule.** Target <=120 lines for the new section. Do
**not** copy M0/M2.0 decision tables into the contract; reference
the row classifications in prose (e.g. "the registries enumerated
in M2.0 table 1") and link to this plan by relative path. The
contract states *what the boundary is*, not *how M0-M4 derived
it*.

**Section placement.** Add a single new top-level section titled
`## Construction and services boundary`, inserted immediately
after `## Single-entry guarantee` and before
`## Opcode completeness`. No other top-level sections of
`vm-contract.md` are touched by M5.

**Required subsection structure.** The new top-level section
uses these `###` subsections, in this order. Each subsection is
3-15 lines.

1. **Construction signature.** The exact constructor:
   `new VM(program: Program, services: PlatformServices, events?:
   VMEvents)`. State that `events` is optional and that omitting
   it must yield identical execution.
2. **`PlatformServices` responsibilities.** One line per field on
   the M2.1 interface, naming the field and what the VM uses it
   for. Include the M2 scope rule verbatim: today's registries
   only; **no** program verifier; **no** action resolution / rule
   state / platform entity access / RNG (those belong to the
   dense-runtime-state spec). This bound prevents the aggregate
   from widening downstream.
3. **`VMEvents` permissions and prohibitions.** One line per
   method on the M3.1 interface, naming the method and what it
   observes. Then state the **passivity property** verbatim from
   Phase M3 (both clauses) and the **event-payload content rule**
   verbatim from Phase M3 (no allocations, no lookups, no
   references to today's `Brain` / `BrainPage` / `BrainRule` /
   `ActionInstance` instances). Both rules bind every future
   event added by any downstream spec.
4. **Import-firewall rule.** State the rule scope (every file
   under `packages/core/src/runtime/`), the type-only exclusion
   (value-import transitive closure; `import type` excluded), the
   allow-list source-of-truth
   (`packages/core/.dependency-cruiser.cjs` rule
   `runtime-allow-list`, permitting only `runtime/` and
   `platform/` plus narrowly-justified shims), and where the
   enforcing spec lives
   (`packages/core/src/runtime/__firewall__.spec.ts`).
5. **Out of scope for this boundary.** State that runtime state
   shape (`Brain` / `BrainPage` / `BrainRule` /
   `ActionInstance` / dense `ExecutionContext`) and host ABI
   portability are **not** covered by this section, and link to
   `ts-vm-dense-runtime-state-plan-2026-05-02.md` as the
   follow-on spec.
6. **Maintenance rule.** State that any subsequent spec that
   modifies the VM constructor signature, adds a
   `PlatformServices` field, adds a `VMEvents` method, or
   changes the firewall rule **must update this section in
   lock-step**. Cross-reference the workflow convention's
   "Update `docs/specs/core/vm-contract.md` as part of the same
   unit when the change is contract-shaping."

**Verification.**

- No code changes. There is no automated gate for this unit:
  the repo's root `package.json` has no `check` script, and the
  per-package Biome configs do not lint markdown
  (`biome.json` `files.includes` covers js/jsx/ts/tsx/json/jsonc
  only).
- Manual verification:
  - Every relative link in the new section resolves to an
    existing file.
  - Every intra-document anchor (`#section-id`) resolves to a
    heading that GitHub-flavored-markdown would generate the same
    slug for.
  - Total section length is <=120 lines (`wc -l` on the inserted
    range).

**Risks.**

- The new section is a magnet for drift: future specs (dense
  state, WODAL, CODAL) will modify the VM surface and may forget
  to update it. The Maintenance rule subsection above is the
  mitigation; it must be present and explicit.
- Tempting to copy the M0/M2.0 tables verbatim. The Anti-bloat
  rule above forbids it -- the plan is the canonical source for
  the derivation; the contract is the canonical source for the
  result.
- Tempting to widen `PlatformServices` to anticipate the
  dense-state spec's needs (action resolution, rule state, etc.).
  The M2 scope rule subsection above forbids it.

**Acceptance.**

- A single new top-level section
  `## Construction and services boundary` exists in
  `docs/specs/core/vm-contract.md`, placed immediately after
  `## Single-entry guarantee`.
- The section contains all six required subsections in the
  prescribed order, each within its line budget; total section
  length is <=120 lines.
- The section text matches the M3 passivity property and
  event-payload content rule verbatim.
- The dense-runtime-state spec's prerequisites paragraph cites
  the new section by anchor
  (`vm-contract.md#construction-and-services-boundary`), not by
  M-phase number. Updating that prerequisites paragraph is part
  of M5's diff.
- Manual link-and-anchor verification per the Verification
  section above is performed as part of the unit; the M5 phase
  log records "links verified" with the list of links checked.

## Sequencing Constraints

Phases run in numeric order (M0 -> M0.5 -> M5). M0 must complete before
M0.5; M0.5 must complete before any M1 unit, because every M1+ unit's
acceptance includes a firewall-baseline ratchet that has nowhere to
land if the firewall is not yet installed. M1.1, M1.2, M1.3, M1.4 ship
in that order; M1.2, M1.3, and M1.4 each depend on the prior unit's
relocation. M1.4 must complete before any M2 unit -- M2.0's audit and
M4.3's pre-condition (baseline already at zero) both assume the
executor lives at `packages/core/src/runtime/vm.ts`. M2.0, M2.1, M2.2
ship in that order; M2.1 cannot start until M2.0's tables are
appended, and M2.2 cannot start until M2.1 lands. M3.1, M3.2, M3.3
ship in that order; M3.1 depends on M0 table 1 carrying the
`passive-event` method names, M3.2 depends on M3.1's interface and
constructor slot, and M3.3 depends on M3.2 (the smoke test runs the
wired VM). M4.1, M4.2, M4.3 ship in that order; M4.1 expands the M3.3
helper in place, M4.2 consumes the expanded helper, and M4.3 flips
the firewall baseline assertion to strict zero (the count should
already read zero by the time M4.3 starts -- if it does not, an
earlier unit failed to ratchet and must be fixed before M4.3
proceeds). M5 follows M4. There are no behavior-sensitive migrations
in this spec; that work is in the dense-runtime-state spec.

## Completion Criteria

This spec is complete when:

- The `runtime-allow-list` firewall rule (landed in M0.5, hardened in
  M4.3) asserts zero violations: every file under
  `packages/core/src/runtime/` value-imports only from `runtime/` and
  `platform/`. Type-only imports are excluded per the "Reachable"
  definition.
- The VM can be constructed and stepped from a runtime `Program` plus
  a runtime-only `PlatformServices` with no event observer.
- All current runtime behavior tests pass unchanged.
- The VM contract documents the module/service boundary.
- The dense-runtime-state spec is unblocked.
