# Brain/Platform Decoupling Pre-Refactors -- Draft Spec

**Status:** Draft
**Date:** 2026-04-27

## Overview

Prepare the compiler, runtime, and supporting infrastructure for non-brain
compilation targets (program mode, future platform apps) by removing
brain-only assumptions baked into shared types and call sites. Each
refactor is a behavior-preserving change to existing tile compilation; no
new modes or features are introduced.

This spec is a prerequisite for
[standalone-cli-compiler.md](standalone-cli-compiler.md) (program mode +
platform apps). After these phases land, that spec's Phase 1 reduces to
adding a mode flag and a sibling project class on top of cleanly-layered
infrastructure rather than threading new conditionals through brain-coupled
code.

## Design Principles

- **Behavior-preserving.** Every phase keeps tile compilation, the brain
  runtime, and all existing tests green. No diagnostics, IR ops, or
  bytecode change.
- **Independent phases.** Each phase is a standalone change that can ship
  on its own merit. Later phases assume earlier ones but do not require
  the program-mode feature spec to exist.
- **Locality.** Brain-specific logic moves *toward* the brain runtime;
  platform-neutral logic moves *away* from it. The split is along
  dependency lines, not feature lines.
- **No new public API surface for program mode.** This spec adds types
  (`PlatformServices`, `PlatformContext`) but no new project class, no
  new compile mode, no new artifact format. Those land in the program-
  mode spec.
- **Greenfield.** No back-compat shims for renamed types beyond an
  internal transition window inside a single phase.

## Non-Goals

- Adding program mode, `CompiledProgram`, `UserProgramProject`,
  `CompileMode`, or any CLI. Those belong to the program-mode spec.
- Reworking the VM instruction set, fiber scheduler, or bytecode format.
- Changing how brains schedule rules, activate pages, or manage actions.
- Improving validator coverage, error messages, or diagnostics
  classification beyond what the relocations require.

---

## Current State Summary

| Layer | Today | Problem |
|---|---|---|
| Services | `BrainServices` is the only services type. Bundles 8 registries; only 5 are platform-neutral. | Compiler files that need only `types`/`functions`/`conversions` import the whole brain bundle. |
| Execution context | `ExecutionContext` carries many fields; VM dispatch reaches into brain state via several internal methods, not just HOST_CALL. | VM cannot run without a brain shim. |
| Program type | `Program` is structurally brain-clean but lives in `packages/core/src/brain/interfaces/vm.ts`, and the VM duck-types it as `ExecutableBrainProgram` at runtime ([vm.ts:278](packages/core/src/brain/runtime/vm.ts#L278)). | Non-brain consumers must import from `brain/`, and the VM still treats brain extensions as the expected shape. |
| Compile pipeline | `project.ts` skips files that lack a default export entirely, then runs `extractDescriptor` (which already emits its own diagnostics) on the rest. | The silent-skip step needs separating from the descriptor-shape check. |
| Lowering | `descriptor: ExtractedDescriptor` is a required parameter of `lowerProgram`. Several decisions inside the body branch on its presence. | Cannot lower a file without a descriptor. |
| Test fixtures | Only `__test__createBrainServices()` exists. | No way to write a compiler test that doesn't exercise the brain bundle. |

The gaps above are partially independent. Each phase below closes one.

### Verified observations from a dry-run pass

During spec drafting, the following code-level facts were verified and are
called out per phase below as concrete gotchas:

- `Program` has three direct subtypes living in `brain/interfaces/runtime.ts`:
  `UnlinkedBrainProgram`, `ExecutableBrainProgram`, `UserActionArtifact`. After
  Phase A the supertype and subtypes intentionally live in different
  directories.
- The VM's `prog: Program` is duck-typed to `ExecutableBrainProgram` in
  [vm.ts:278-279](packages/core/src/brain/runtime/vm.ts#L278): the body
  reaches into `.actions` if it's present. The VM is brain-coupled even with
  `Program` relocated.
- Brain-flavored execution-context plumbing is woven throughout
  `vm.ts`: `bindExecutionContext`, `syncExecutionContextFromTopFrame`,
  `resolveDirectRuleFuncId`, `resolveCalleeRuleFuncId`, and
  `getOrCreateActionInstance` are called from at least 8 instruction sites,
  not just HOST_CALL. Phase E is broader than originally scoped.
- `extractDescriptor` already emits `MissingDefaultExport` itself; the silent
  skip in `project.ts:268` is the separate `hasDefaultExport(sourceFile)`
  guard. Helper files in multi-file projects rely on that silent skip and
  must continue to.
- `services.types.removeUserTypes()` is called once per `compileAll()` pass
  ([project.ts:262](packages/ts-compiler/src/compiler/project.ts#L262)).
  Type-registry mutation is a shared concern across modes.

---

## Phase Plan

The phases are ordered by dependency, not size. Phase D depends on Phases
A and B; everything else is parallelizable.

### Phase A -- Move `Program` to a neutral location

**What.** Relocate the `Program` interface (and its companion type
`FunctionBytecode` if it lives in the same file and is used outside the
brain) from `packages/core/src/brain/interfaces/vm.ts` to a new
`packages/core/src/runtime/program.ts`.

**Why.** Establishes the existence of a non-brain `runtime/` directory in
core and removes the symbolic implication that bytecode is brain-owned.

**Steps.**
1. Create `packages/core/src/runtime/program.ts` exporting `Program` (and
   any bytecode-format types that genuinely have no brain dependency).
2. Delete the original definitions from `brain/interfaces/vm.ts`.
3. Update all imports in `packages/core` and `packages/ts-compiler` to
   import from the new location.
4. Run typecheck + full test suite.

**Touches.** `packages/core/src/runtime/program.ts` (new),
`packages/core/src/brain/interfaces/vm.ts`,
`packages/core/src/brain/interfaces/runtime.ts` (the three
`extends Program` subtypes),
`packages/core/src/brain/interfaces/index.ts` (barrel re-export), every
importer.

**Gotchas.**

- `Program` has three subtypes in `brain/interfaces/runtime.ts`:
  `UnlinkedBrainProgram` ([line 28](packages/core/src/brain/interfaces/runtime.ts#L28)),
  `UserActionArtifact` ([line 62](packages/core/src/brain/interfaces/runtime.ts#L62)),
  and `ExecutableBrainProgram` ([line 97](packages/core/src/brain/interfaces/runtime.ts#L97)).
  After Phase A the supertype lives in `runtime/` and the subtypes stay in
  `brain/`. This is correct (the subtypes are brain-specific) but means the
  inheritance hierarchy spans two directories. Document this in the file
  header to prevent future contributors from "unifying" them.
- The VM constructor takes `prog: Program` but immediately duck-types it
  to `ExecutableBrainProgram` at
  [vm.ts:278](packages/core/src/brain/runtime/vm.ts#L278):
  `if ((this.prog as ExecutableBrainProgram).actions !== undefined)`.
  Phase A does NOT eliminate this coupling -- the VM still expects brain
  extensions to be present. That refactor belongs to Phase E.
- `brain/interfaces/index.ts` does `export * from "./vm"`. After Phase A,
  `Program` no longer comes through that barrel. Verify whether any
  external consumer (`packages/bridge-app`, `apps/sim`) imports `Program`
  via the barrel and update import paths.
- The `runtime/` directory does not exist yet under `packages/core/src/`.
  Create it with an `index.ts` barrel from the start; otherwise downstream
  phases (B, E) will need to backfill the layout.

**Risk.** XS. Pure rename, but touches a public-facing type that is
re-exported through a barrel.

**Acceptance.** All existing tests pass. No file under
`packages/ts-compiler/` imports `Program` from `brain/...`. The three
`extends Program` subtypes still compile from their existing location.

---

### Phase B -- Split `BrainServices` into `PlatformServices` + `BrainServices`

**What.** Introduce `PlatformServices` as the supertype of `BrainServices`.
Re-type every consumer that doesn't read brain-only fields to take
`PlatformServices` instead.

**Why.** Compiler files that only need types/functions/conversions today
must import the brain bundle. After this split, the brain coupling lives
only at the few call sites that actually need it (`descriptor.ts`,
`call-def-builder.ts`, brain-runtime code).

**Steps.**
1. Define in a neutral location (recommended:
   `packages/core/src/runtime/platform-services.ts`):

   ```ts
   export interface PlatformServices {
     types: ITypeRegistry;
     functions: IFunctionRegistry;
     conversions: IConversionRegistry;
     operatorTable: IOperatorTable;
     operatorOverloads: IOperatorOverloadRegistry;
   }
   ```

2. Modify `BrainServices` in
   [packages/core/src/brain/services.ts](packages/core/src/brain/services.ts):

   ```ts
   export interface BrainServices extends PlatformServices {
     tiles: ITileCatalog;
     actions: IBrainActionRegistry;
     tileBuilder: IBrainTileDefBuilder;
   }
   ```

3. Re-type these consumers from `BrainServices` to `PlatformServices`:
   - `packages/ts-compiler/src/compiler/lowering.ts`
   - `packages/ts-compiler/src/compiler/emit.ts`
   - `packages/ts-compiler/src/compiler/ambient.ts`
   - The platform-neutral helpers in
     `packages/ts-compiler/src/compiler/project.ts` (everything except the
     descriptor branch and `buildCallDef` invocation).
4. Leave brain-specific consumers (`descriptor.ts`, `call-def-builder.ts`,
   the tile-mode branch of `project.ts`, brain runtime code) typed as
   `BrainServices`.
5. The `services` field of `CompileOptions` keeps its current type
   (`BrainServices`). This phase widens *internal* parameter types only;
   public API is unchanged. Loosening the public API to `PlatformServices`
   happens in the program-mode spec.

**Touches.** `packages/core/src/runtime/platform-services.ts` (new),
`packages/core/src/brain/services.ts`, ~6-8 files under
`packages/ts-compiler/src/compiler/`.

**Gotchas.**

- The platform-neutral registries (`types`, `functions`, etc.) are
  *interfaces*, but the concrete implementations may hold backreferences to
  the full `BrainServices` they were constructed against. If a registry
  method internally reaches into a sibling brain-only registry, narrowing
  the parameter type to `PlatformServices` produces correct types but
  **does not actually narrow runtime behavior**. Audit each registry impl
  before claiming the narrowing is safe; do not move construction sites in
  this phase.
- `services.types.removeUserTypes()` is called between compile passes
  ([project.ts:262](packages/ts-compiler/src/compiler/project.ts#L262)). It
  mutates shared state. Document that program-mode and tile-mode both share
  the same `services.types` instance, so a single user-type clear is
  sufficient regardless of mode.
- `operatorTable` and `operatorOverloads` are populated by
  `installCoreBrainComponents`. Decide explicitly whether "core operators"
  are platform-neutral (yes for `+`, `-`, etc.; ambiguous for any operator
  whose overload set today references brain-only types). Audit
  [packages/core/src/brain/runtime/operators.ts](packages/core/src/brain/runtime/operators.ts)
  before classifying these as `PlatformServices` fields.
- `CompileOptions.services` keeps its `BrainServices` type in this phase.
  Confirm that none of the re-typed internal helpers' callers break because
  they were relying on covariance through option objects (TypeScript
  generally allows this; spot-check the few generic call sites).

**Risk.** S->M. Type-only on the surface but the registry-impl audit can
uncover real coupling.

**Acceptance.** `BrainServices` is a strict subtype of `PlatformServices`.
Every file in `packages/ts-compiler/src/compiler/` that does not invoke
brain-only registries imports `PlatformServices`. Registry-impl audit
documented in the phase post-mortem (no hidden brain reach-throughs, or
list of any found). Tests pass.

---

### Phase C -- Extract `findEntryKind` from descriptor extraction

**What.** Separate "is this file an entry-point candidate?" from "is the
default export a valid Sensor/Actuator descriptor?" Today `project.ts`
first silently skips files lacking any default export
([project.ts:268](packages/ts-compiler/src/compiler/project.ts#L268)), then
runs `extractDescriptor` on the rest -- which already emits its own
diagnostics for malformed default exports.

**Why.** Lets a future non-tile entry path (program mode) plug in without
restructuring the project compiler. Helper files (no default export) must
continue to be silently skipped; they are the dominant case in multi-file
projects.

**Corrected behavior model.**

| File shape | Today | After Phase C (tile mode) |
|---|---|---|
| No default export | Silent skip | Silent skip (unchanged) |
| Default export present, not Sensor/Actuator call | `InvalidDefaultExport` diagnostic | `InvalidDefaultExport` diagnostic (unchanged) |
| Default export `Sensor(...)` / `Actuator(...)` | Compile | Compile |

This phase is **purely structural** in tile mode: no diagnostic changes.
The value is the new `findEntryKind` seam, used by program mode later.

**Steps.**
1. Introduce `findEntryKind(sourceFile)` in
   `packages/ts-compiler/src/compiler/entry.ts`:

   ```ts
   export type EntryKind =
     | { kind: "tile"; descriptorCall: ts.CallExpression }
     | { kind: "helper" };          // no default export; not an entry
   // Program mode (later) adds: | { kind: "program" }

   export function findEntryKind(sourceFile: ts.SourceFile): EntryKind;
   ```

2. Refactor [project.ts](packages/ts-compiler/src/compiler/project.ts#L260)
   to call `findEntryKind` first, then dispatch:
   - `kind === "helper"`: silent skip (today's `!hasDefaultExport` path).
   - `kind === "tile"`: call existing `extractDescriptor(...)` path.
     Optionally pass the already-discovered `descriptorCall` to avoid
     re-walking the AST.
3. Refactor `extractDescriptor` to accept the pre-resolved
   `ts.CallExpression` (its first 30 lines re-discover what `findEntryKind`
   already found). This is optional but worth doing now to avoid two AST
   walks.
4. No new tests required: behavior is unchanged. A structural test asserting
   `findEntryKind` is the single dispatch point in `project.ts` is
   sufficient.

**Touches.** `packages/ts-compiler/src/compiler/entry.ts` (new),
`packages/ts-compiler/src/compiler/project.ts`,
`packages/ts-compiler/src/compiler/descriptor.ts` (signature only).

**Gotchas.**

- The original draft of this phase said the silent skip becomes a
  diagnostic. **That is wrong** -- helper files (e.g. shared utility
  modules in multi-file projects) have no default export by design and
  should remain silently skipped. Verify with the multi-file test suite.
- `descriptorCall` discovery in `findEntryKind` and `extractDescriptor`
  must agree. Either pass the call expression through (preferred) or
  factor the discovery into a shared helper.
- The diagnostic codes namespace (`DescriptorDiagCode`) stays where it is.
  No new codes in this phase.

**Risk.** XS. No observable behavior change.

**Acceptance.** `project.ts` calls `findEntryKind` exactly once per file
and dispatches on the returned discriminant. `extractDescriptor` accepts
the pre-resolved call expression and no longer searches for the default
export itself. Tile-mode tests pass with byte-identical output.

---

### Phase D -- Make `descriptor` optional in lowering

**What.** Change the lowering entry signature so `descriptor` is optional,
threading optionality through to the wiring around `<module-init>`.
`<module-init>` synthesis itself is already descriptor-agnostic.

**Why.** Removes the last hard dependency in the lowering pipeline on
the descriptor's existence. After this phase, lowering can run on a file
that has no Sensor/Actuator export and produce a valid `Program` whose
entry is `<module-init>`.

**Depends on.** Phase B (so the optional path can take `PlatformServices`
instead of `BrainServices`) and Phase C (so callers know whether a
descriptor is expected).

**Steps.**
1. Change `lowerProgram(sourceFile, descriptor, ...)` in
   [lowering.ts:808](packages/ts-compiler/src/compiler/lowering.ts#L808) to
   take `descriptor?: ExtractedDescriptor`. (Note: original spec cited
   line 1148; the actual signature is at line 808.)
2. When `descriptor` is undefined:
   - Skip lowering of the descriptor's `onExecute` / `onPageEntered`
     methods.
   - The `<module-init>` function (already always synthesized) becomes the
     program's entry by setting `Program.entryPoint = moduleInitFuncId`.
   - Skip emitting any `UserActionArtifact` / `UserAuthoredProgram`
     metadata fields (`name`, `args`, `label`, etc.) -- those require a
     descriptor and are tile-only.
3. Tile-mode callers continue to pass a descriptor; behavior unchanged.
4. Do not introduce a new caller in this phase. The optional path is
   reachable only by future program-mode code.
5. Add a unit test that calls `lowerProgram` with no descriptor on a
   trivial file (e.g. a single function declaration) and verifies the
   produced `Program.entryPoint` references `<module-init>`. This test
   exercises the new code path without requiring program mode to exist.

**Touches.** `packages/ts-compiler/src/compiler/lowering.ts`, one new
test file.

**Gotchas.**

- `lowerProgram` allocates `entryFuncId = funcIdCounter.value++` at
  [lowering.ts:838](packages/ts-compiler/src/compiler/lowering.ts#L838) for
  the descriptor's onExecute. With descriptor undefined, this slot is
  unused -- decide whether to skip the allocation (cleaner) or allocate it
  and leave it empty (simpler diff). Skipping is preferred.
- The lowering result type `ProgramLoweringResult` likely has fields that
  are populated from the descriptor. Audit each field; mark them optional
  or document that they're tile-only.
- Callsite vars semantics: the comment at lowering.ts:833 describes
  callsite vars as "distinct per user tile instance, persist across
  invocations." In program mode there is exactly one "instance" -- the
  program -- so callsite vars become module-level state for the program
  run. The semantic is consistent but the comment will mislead. Update it
  to talk about "compilation unit instances" rather than "tile instances."
- Verify the brain runtime never reads `Program.entryPoint` for tile-mode
  execution -- it should route via the descriptor / action table. If it
  does read `entryPoint` somewhere, setting it to `<module-init>` could
  silently change behavior. Audit before D lands; add a regression assert
  if necessary.
- `services` is currently typed `BrainServices` in the signature. After
  Phase B that becomes `PlatformServices`. Phase D's signature change
  should land *after* Phase B to avoid an interim re-type.

**Risk.** S->M. Tile-mode path is unchanged in behavior, but auditing the
result-type fields and the brain-runtime entryPoint read is real work.

**Acceptance.** `lowerProgram` accepts `undefined` for `descriptor`.
Tile-mode tests unchanged with byte-identical bytecode output (snapshot
test). New unit test passes. `Program.entryPoint` audit documented in the
phase post-mortem.

---

### Phase E -- Split `ExecutionContext` into `PlatformContext` + `BrainExecutionContext`

**What.** Define `PlatformContext` carrying only the fields the VM
actually reads. Define a `VMHooks` interface for every brain-coupled
behavior the VM currently performs inline. Re-type `vm.ts` to consume
`PlatformContext` + `VMHooks`. Move brain-only fields to
`BrainExecutionContext` and brain-coupled behaviors to a brain-supplied
`VMHooks` impl.

**Why.** This is the deepest decoupling change and the only one where the
VM's hot path is actually rewritten.

**Scope correction from the original draft.** The initial draft cited a
single inline rebinding site at `vm.ts:1038-1090`. A code audit shows
brain-coupled VM-internal calls are widespread:

- `bindExecutionContext(fiber, frame, callSiteId, ...)` -- called from
  ~6 instruction sites including HOST_CALL, HOST_CALL_ASYNC, ACTION_CALL
  and async variants.
- `syncExecutionContextFromTopFrame(fiber)` -- called after every
  rebind and at fiber spawn.
- `resolveDirectRuleFuncId(executionContext, funcId)` -- called from
  `spawnFiber`.
- `resolveCalleeRuleFuncId(executionContext, caller, calleeId)` --
  called from CALL/CALL_ASYNC dispatch.
- `getOrCreateActionInstance(fiber.executionContext, callSiteId, 0)` --
  imported from `../interfaces` and called during ACTION_CALL setup.
- `verifyExecutableActions(this.prog as ExecutableBrainProgram, ...)` --
  called from constructor verification when `.actions` is present
  (duck-typed program shape).

All of these are brain-coupled and must either move out of `vm.ts` or
become `VMHooks` callbacks. This phase is **L**, not M.

**Depends on.** Phase A (so `Program` is in `runtime/` and the new
context type can co-locate without dragging brain imports).

**Steps.**
1. Define in `packages/core/src/runtime/platform-context.ts`:

   ```ts
   export interface PlatformContext {
     getVariable<T extends Value>(varId: string): T | undefined;
     setVariable(varId: string, value: Value): void;
     clearVariable(varId: string): void;
     time: number;
     dt: number;
     currentTick: number;
     data: unknown;
   }
   ```

   Variable access is **string-keyed** today (verified at
   [interfaces/runtime.ts:172,205,241](packages/core/src/brain/interfaces/runtime.ts#L172));
   keep that signature. Numeric-slot variable access is out of scope and
   would be a separate, far larger change.

2. Define `BrainExecutionContext extends PlatformContext` in the brain
   runtime (its current location), adding `brain`, `callSiteState`,
   `currentActionInstance`, `currentCallSiteId`, `rule`, `funcIdToRule`.

3. Audit `vm.ts` and `scheduler.ts` for every read of a brain-only
   context field, and every call to a VM-internal method that touches
   brain state. Record the full list (the dry-run found at least the
   6 above). For each, decide:
   - Move out of VM (becomes brain-side; VM gains a hook callback).
   - Stay in VM (if and only if the behavior is generic and only the
     *parameters* were brain-flavored).

4. Define `VMHooks` in `packages/core/src/runtime/vm-hooks.ts`. Start
   from this minimum and grow per the audit:

   ```ts
   export interface VMHooks {
     /** Called before any host call dispatch (sync or async). */
     onBeforeHostCall?(
       ctx: PlatformContext,
       fiber: Fiber,
       callSiteId: number,
       funcId: number,
     ): void;
     /** Resolves which rule funcId is in effect when spawning. */
     resolveSpawnRuleFuncId?(ctx: PlatformContext, funcId: number): number;
     /** Resolves the rule funcId for a call from caller to callee. */
     resolveCallRuleFuncId?(
       ctx: PlatformContext,
       caller: Fiber,
       calleeId: number,
     ): number;
     /** Verifies a program with brain-flavored extensions. */
     verifyProgram?(prog: Program, errors: List<string>): void;
   }
   ```

   The exact shape comes from the audit in step 3.

5. The brain runtime supplies a `VMHooks` implementation that replicates
   today's behavior: `onBeforeHostCall` does the
   `bindExecutionContext` + action-instance lookup; `resolveSpawnRuleFuncId`
   wraps `resolveDirectRuleFuncId`; etc.

6. **Type-bridge for hooks that need brain fields.** Hook impls receive
   `PlatformContext`, but the brain impl needs to read `BrainExecutionContext`
   fields. Options:
   - Hook impls cast: `const bctx = ctx as BrainExecutionContext`. Type
     safety lost; pragmatic.
   - Hooks are generic: `interface VMHooks<C extends PlatformContext>` and
     the VM is parameterized. Cleaner but ripples through every VM use
     site.
   - Hooks receive `unknown` and impl narrows. Worst of both.

   Default: generic VMHooks parameterized on context type. The brain
   declares `VMHooks<BrainExecutionContext>`; the VM internally treats it
   as `VMHooks<PlatformContext>` at the call site. Confirm this works
   with the existing TypeScript settings before committing to it; fall
   back to casts if variance blocks it.

7. Re-type the VM's `prog: Program` field. The duck-typed
   `verifyExecutableActions` access at
   [vm.ts:278](packages/core/src/brain/runtime/vm.ts#L278) moves into the
   brain-supplied `verifyProgram` hook. Without a hook, the VM verifies
   only the generic `Program` invariants.

8. Run the full brain test suite. This is the regression net. Add a
   minimal program-context test (no brain) that constructs a VM with
   `VMHooks = {}` and runs a hand-written `Program` with no host calls.
   Asserts the VM can execute *something* without a brain.

**Touches.** `packages/core/src/runtime/platform-context.ts` (new),
`packages/core/src/runtime/vm-hooks.ts` (new),
`packages/core/src/brain/runtime/vm.ts` (substantial),
`packages/core/src/brain/runtime/scheduler.ts`,
`packages/core/src/brain/runtime/brain.ts` (constructs `VMHooks` impl),
`packages/core/src/brain/interfaces/runtime.ts`, action-instance helpers.

**Gotchas.**

- The `vm.ts` constructor's `verifyExecutableActions` duck-type check is
  the easiest brain reach to miss. Audit constructor and all `verify*`
  methods.
- Hot-path: every hook call adds one indirection per relevant op. Confirm
  the VM benchmark suite (if any) does not regress; if there isn't one,
  flag this as a follow-up rather than blocking.
- `getOrCreateActionInstance` is currently imported from
  `../interfaces` directly into `vm.ts`. After Phase E, this import
  must move out of `vm.ts` -- it lives only inside the brain hook impl.
- Scheduler coupling is not yet enumerated. Before starting, audit
  `scheduler.ts` for context field reads and add to the hook surface as
  needed. May warrant a parallel `SchedulerHooks` interface; default in
  this spec is to fold scheduler hooks into `VMHooks`.
- Async paths (`HostCallAsync`, await/resume) and exception unwinding
  may also touch brain context. Audit those alongside HOST_CALL.
- This is the only phase that risks behavior regression in tile mode.
  Spec D's `lowerProgram` audit and Phase E's `Program.entryPoint` audit
  intersect: both must agree the brain runtime never reads
  `Program.entryPoint` for tile execution.

**Risk.** L. Hot-path runtime change with multi-site coupling.
Mitigations:

- Land Phases A-D first.
- Do this phase in isolation, with no other phases in flight.
- Audit-first: produce the full list of brain reaches in a draft PR
  before writing any hook code, and review the audit independently of
  the implementation.
- The existing brain test suite is the regression net; no new tile-mode
  tests needed, but add the no-brain VM smoke test from step 8.

**Acceptance.** `vm.ts` does not import any symbol from
`brain/interfaces/` or call `getOrCreateActionInstance`. The brain
runtime supplies a `VMHooks` impl that replicates today's behavior at
every enumerated coupling site. All brain tests pass without behavior
changes. The no-brain smoke test passes.

#### Phase E split (recommended)

Phase E is large enough that it should be sequenced as its own mini
roadmap. Each sub-phase is independently landable because the brain-
supplied hook impl preserves today's behavior at every step. Order
matters: E1-E2 are pure scaffolding; E3-E6 migrate one coupling site at
a time; E7 is the cleanup that removes the last brain imports from
`vm.ts`.

| Sub | Scope | Risk | Notes |
|---|---|---|---|
| E1 | Define `PlatformContext`. Make `BrainExecutionContext extends PlatformContext`. No VM changes. | XS | Type-only inheritance split; today's `ExecutionContext` becomes the brain subtype. |
| E2 | Audit pass + define empty `VMHooks` interface. VM stores hooks on construction; brain runtime supplies a no-op impl. | S | Audit is the deliverable; the empty interface lands as the seam. No behavior change. |
| E3 | Migrate the constructor's `verifyExecutableActions` duck-typed cast to a `verifyProgram` hook. | XS | Most isolated coupling; one constructor site. Good warm-up. |
| E4 | Migrate HOST_CALL / HOST_CALL_ASYNC rebinding (`bindExecutionContext` + `getOrCreateActionInstance`) to an `onBeforeHostCall` hook. | M | The classic brain reach. Self-contained to host-call dispatch sites. |
| E5 | Migrate rule-resolution sites (`resolveDirectRuleFuncId` on spawn, `resolveCalleeRuleFuncId` on CALL/CALL_ASYNC) to `resolveSpawnRuleFuncId` / `resolveCallRuleFuncId` hooks. | S->M | Two related sites; covered by spawn + call tests. |
| E6 | Migrate ACTION_CALL action-instance setup to a hook (or fold into E4 if the audit shows the same call path). | S | May collapse into E4; decide after E2 audit. |
| E7 | Sweep: remove the now-unused `getOrCreateActionInstance` import from `vm.ts`, retype `prog: Program` (no longer cast inside VM), audit `scheduler.ts` and either fold its hooks into `VMHooks` or add `SchedulerHooks`. Add no-brain smoke test. | S | Final cleanup; should be near-zero diff if E3-E6 were done thoroughly. |

Dependency: E1 -> E2 -> {E3, E4, E5, E6} (parallelizable per-site) -> E7.

Each of E3-E6 ships with the brain test suite passing unchanged. If any
sub-phase requires behavior changes to keep tests passing, that is a
signal the audit (E2) missed a coupling and the audit should be
re-opened before continuing.

---

### Phase F -- Extract `__test__createPlatformServices()` test helper

**What.** Mirror the existing `__test__createBrainServices()` factory
with a platform-only counterpart that produces a `PlatformServices`
without sensor/actuator/tile registries.

**Why.** Lets future tests exercise the compiler at the
`PlatformServices` level. Also documents the minimum services bundle
required to exercise core compilation.

**Depends on.** Phase B.

**Steps.**
1. Refactor `installCoreBrainComponents` (or its equivalent) to factor
   out the platform-neutral half (`installCorePlatformComponents`).
2. Add `__test__createPlatformServices()` returning a `PlatformServices`
   with all neutral registries populated.
3. `__test__createBrainServices()` becomes a thin wrapper that calls
   `__test__createPlatformServices()` and adds brain-specific registries.
4. Existing tests that call `__test__createBrainServices()` continue to
   work unchanged.

**Touches.** `packages/core/src/brain/test-only-brain-services-factory.ts`
and a new sibling file.

**Gotchas.**

- Registration order matters: some operator overloads or conversions may
  reference brain-installed types. If `installCoreBrainComponents` is
  split, the platform half must run first and the brain half must run
  after types are present. Audit the install function before factoring.
- Test files that import from a re-exported barrel (e.g.
  `@mindcraft-lang/core/brain/__test__`) need updates only if the
  barrel's surface changes. Keep `__test__createBrainServices()`
  exported from the same path it always was.

**Risk.** XS. Test-only code.

**Acceptance.** `__test__createBrainServices()` returns the same value it
did before. New `__test__createPlatformServices()` is callable and
returns a valid `PlatformServices`. No production code changes.

---

## Phase Dependency Graph

```
A (move Program)  -----> E (split ExecutionContext)
                         ^
                         |
B (split Services) ------+----> D (descriptor optional in lowering)
                         |
                         +----> F (test helper)
                         
C (findEntryKind)  -------------> D
```

Parallelizable: {A, B, C} can land independently. D needs B and C. E needs
A. F needs B.

---

## Test Plan

Each phase has an **acceptance check**: the existing test suite passes
unchanged, plus any phase-specific assertions noted above.

No new feature tests in this spec. The only new tests added are:

- Phase D: unit test calling `lowerProgram` with `descriptor: undefined`
  on a trivial file. Also a snapshot test asserting tile-mode bytecode is
  byte-identical.
- Phase E: no-brain VM smoke test that constructs a VM with `VMHooks = {}`
  and runs a hand-written `Program` with no host calls.

Both are minimal and exist to lock in the new entry points so the program-
mode spec doesn't have to re-verify them.

## Risk Summary (post dry-run)

| Phase | Original | Adjusted | Reason |
|---|---|---|---|
| A | XS | XS | Confirmed. Adds one note about split inheritance hierarchy. |
| B | S | S->M | Registry-impl audit may surface hidden brain reach-throughs. |
| C | S | XS | Original behavior change was wrong; phase is purely structural. |
| D | S | S->M | `Program.entryPoint` audit + lowering-result field audit are real work. |
| E | M | **L** (split into E1-E7) | VM brain coupling is multi-site (>=6 internal methods + duck-typed cast + scheduler). Original single-hook proposal understated scope. See "Phase E split" subsection. |
| F | XS | XS | Confirmed. Adds one note about install order. |

The biggest delta is Phase E. It is the only phase that should land alone,
and it should be preceded by an explicit audit pass (see Phase E step 3)
with the audit reviewed independently of the implementation.

---

## Open Questions

1. **`PlatformServices` location.** This spec puts it in
   `packages/core/src/runtime/`. Alternative: keep it in
   `packages/ts-compiler/src/compiler/services.ts` since the compiler is
   the primary consumer. Default: `packages/core/src/runtime/`, because
   `PlatformContext` lives there and the runtime side will eventually
   want to validate that a runtime's host functions match a program's
   declared signatures.
2. **`VMHooks` generic over context type?** Step 6 of Phase E proposes
   parameterizing `VMHooks<C extends PlatformContext>` so the brain
   declares `VMHooks<BrainExecutionContext>` without casts. Validate
   this works under the project's TypeScript settings (variance,
   strictness) before committing. Fallback: pragmatic casts inside hook
   impls.
3. **`<module-init>` as program entry.** Phase D wires
   `Program.entryPoint = <module-init>.id` when no descriptor is present.
   Confirm the brain runtime never reads `entryPoint` for tile-mode
   programs (it shouldn't -- it routes via descriptor). Audit before D
   lands.
4. **Naming.** `PlatformContext` vs `RuntimeContext` vs `VMContext`. The
   program-mode spec uses `PlatformContext`; this spec follows. If the
   word "platform" feels overloaded with the platform-app concept,
   `VMContext` is a reasonable alternative -- decide before Phase E.
5. **Should Phase A relocate `FunctionBytecode` too?** It depends on
   whether anything in `brain/` peeks at internal opcode fields. Audit
   imports before splitting.
6. **VM duck-typed program shape.** The VM constructor casts
   `this.prog as ExecutableBrainProgram` to detect brain-flavored
   verification. Phase E moves this to a `verifyProgram` hook. Confirm
   no other VM site relies on the duck-typed cast before Phase E.
7. **Scheduler coupling.** Not enumerated in the dry-run pass. Before
   Phase E, audit `scheduler.ts` for context-field reads and decide
   whether `VMHooks` covers it or a separate `SchedulerHooks` is
   needed.
