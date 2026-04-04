# Brain Action Execution -- Phased Implementation Plan

Created: 2026-04-03
Audience: Copilot-style implementation agents
Status: Proposed

Rearchitect brain action execution so that sensors and actuators compile against
an executable Brain-local action table instead of the global `FunctionRegistry`.

This document is optimized for **execution by an AI coding agent**. It is not a
general architecture essay. Each phase is written as a bounded unit of work with
explicit scope, ordered tasks, verification, and stop conditions.

This plan supersedes the abandoned Phase 4 direction in
[user-tile-compilation-pipeline.md](user-tile-compilation-pipeline.md).

Depends on:
- [brain-action-execution-architecture.md](brain-action-execution-architecture.md)
- [user-authored-sensors-actuators.md](user-authored-sensors-actuators.md)
- [user-tile-compilation-pipeline.md](user-tile-compilation-pipeline.md)
- [ctx-as-native-struct.md](ctx-as-native-struct.md)

---

## Workflow Convention

Each phase follows this loop:

1. **Kick off** -- "Implement Phase N." The implementer reads this doc, the
   architecture spec, and any relevant instruction files before writing code.
   After implementation, STOP and present the work for review. Do not write the
   Phase Log entry, amend this doc, or perform post-mortem updates during
   implementation.
2. **Review + refine** -- Followup prompts within the same conversation. A human
   reviewer is expected to inspect the work before the next phase begins.
3. **Declare done** -- "Phase N is complete." Only the user can declare the
   phase complete.
4. **Post-mortem** -- "Run post-mortem for Phase N." This step:
   - diffs planned deliverables vs actual work
   - records the result in the Phase Log
   - propagates discoveries to later phases
   - updates upstream specs if needed
   - writes any needed repo memory notes
5. **Next phase** -- Start the next implementation request explicitly. Do not
   proceed automatically.

The planning doc is the source of truth across conversations.

---

## How To Use This Doc

### Phase granularity

- Implement **exactly one phase per user request** unless the user explicitly
  asks to combine phases.
- Do not pull work from a later phase into the current one just because the code
  is nearby.
- If the current phase reveals a design flaw in a later phase, note it in your
  final response, but do not edit this doc until the post-mortem step.
- Between phases, assume a human reviewer will inspect the work. Do not start
   the next phase until the user explicitly requests it.

### Priority order

When the current code conflicts with this plan, prefer:

1. the architecture spec
2. this phased plan
3. the existing implementation

### Completion rule

After implementing a phase:

- run the required verification commands for each modified package
- summarize what changed and any unresolved risks
- stop and wait for review

Do not write the Phase Log during implementation, and do not continue to the
next phase without user approval.

---

## Required Reading For Every Phase

Before starting any phase, reread:

1. [brain-action-execution-architecture.md](brain-action-execution-architecture.md)
2. this document
3. `.github/instructions/global.instructions.md`
4. any instruction files matching the code area you will edit

Minimum area mapping:

- `packages/core/src/brain/**` -> `brain.instructions.md`
- `packages/core/src/brain/runtime/**` -> `vm.instructions.md`
- `packages/core/**` -> `core.instructions.md`
- `apps/sim/**` -> `sim.instructions.md`

---

## Global Execution Rules

These rules apply to every phase.

1. **Do not preserve the flawed abstraction.** Avoid adapters whose only purpose
   is to keep the old global action dispatch model alive.
2. **Do not preserve backward compatibility.** Serialized brains, metadata
   caches, and wrapper-oriented runtime behavior may be invalidated or deleted.
3. **Do not start in the sim app.** Core platform changes come first. App-side
   wiring comes later.
4. **Do not use user-authored host-function wrappers as a transitional end state.**
   A temporary helper is acceptable only if the phase explicitly calls
   for it and it is removed in the same phase.
5. **Keep host intrinsics intact.** Operators, conversions, struct methods, and
   VM builtins remain host-function based unless a phase explicitly says
   otherwise.
6. **Prefer narrow, structural edits.** Change the contract at the right layer;
   do not scatter compatibility branches across the codebase.
7. **If blocked by a missing prerequisite from an earlier phase, stop and report that exact prerequisite.**
   Do not invent a workaround from a later phase.

---

## Verification Commands

Run the commands for every package modified in the current phase.

### `packages/core`

```sh
cd packages/core && npm run check && npm run build && npm test
```

### `packages/typescript`

```sh
cd packages/typescript && npm run typecheck && npm run check && npm test
```

### `apps/sim`

```sh
cd apps/sim && npm run typecheck && npm run check
```

If a phase touches multiple packages, run all applicable command sets.

---

## Sequencing Constraints

These are hard boundaries, not suggestions.

1. **Do not begin Phase 2 until Phase 1 is complete.** Phase 2 assumes action
   tiles no longer store `BrainFunctionEntry`.
2. **Do not begin Phase 3 until Phase 2 is complete.** The linker contract must
   resolve action slots, not global host IDs.
3. **Do not begin Phase 4 until Phase 3 is complete.** VM action dispatch needs
   an executable action table.
4. **Do not begin Phase 5 until Phase 4 is complete.** Action-state scoping only
   makes sense once action frames exist.
5. **Do not begin Phase 6 until Phases 1 through 5 are complete.** The
   TypeScript package should target the new core contract, not a hybrid.
6. **Do not begin Phase 7 until Phase 6 is complete.** The sim app should wire
   up final artifacts, not unstable intermediate forms.
7. **Do not begin Phase 8 until the new runtime path is working.** Cleanup is
   last.

---

## Current State

As of 2026-04-03 after Phase 7, the action execution stack now reaches the
resolver-backed sim runtime path end to end, while the remaining work is
cleanup, persistence policy, and documentation alignment:

1. Sensor and actuator tile defs store `ActionDescriptor` metadata instead of
   `BrainFunctionEntry`.
2. Brain compilation emits `UnlinkedBrainProgram` artifacts with program-local
   `actionRefs`, `ACTION_CALL` / `ACTION_CALL_ASYNC`, and
   `PageMetadata.actionCallSites`.
3. Core runtime interfaces now distinguish `UnlinkedBrainProgram`,
   `ResolvedAction`, `ExecutableAction`, and `ExecutableBrainProgram`, with a
   `BrainActionResolver` boundary between compile and runtime.
4. `Brain.initialize()` now follows `compile -> link -> instantiate`.
   `linkBrainProgram()` resolves action slots into
   `ExecutableBrainProgram.actions` before the VM is created.
5. Built-in core sensors and actuators now publish descriptors and host
   bindings directly. Core runtime registration installs those bindings into a
   `BrainActionRegistry`, and built-in tile registration consumes descriptor
   exports instead of deriving action metadata from `FunctionRegistry` entries.
6. The linker currently builds its descriptor lookup from both the `BrainDef`
   rule tree and registered tile catalogs so programmatic action tiles still
   link even when they were never catalog-registered.
7. `Brain` page activation and VM `ACTION_CALL` / `ACTION_CALL_ASYNC` now read
   the explicit executable action table for host-backed actions. Operators and
   conversions still compile and execute through the host intrinsic path using
   `HOST_CALL*`.
8. `linkBrainProgram()` now merges bytecode resolved actions into the
   executable program and materializes `BytecodeExecutableAction` entries with
   remapped function IDs, constants, and variable-name indexes. If present,
   `activationFuncId` is linked as executable metadata.
9. VM `ACTION_CALL` now executes sync bytecode-backed actions on the current
   fiber by entering an action-root frame, while `ACTION_CALL_ASYNC` runs async
   bytecode-backed actions on child fibers and resolves the returned handle
   from child-fiber completion.
10. The bytecode verifier now checks executable-program action entries and
   rejects statically knowable sync suspension paths. The VM still faults the
   fiber if a sync bytecode action reaches suspension through an indirect or
   otherwise runtime-only path.
11. Persistent action state is now represented by page-activation-scoped
   `ActionInstance` records keyed by action callsite. `ExecutionContext`
   binds the current action instance explicitly, and bytecode
   `LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR` now resolve through that action
   binding instead of the fiber-global runtime path.
12. Page activation now resets each action callsite deterministically and
   dispatches the correct activation hook once per activation for both host
   `onPageEntered` handlers and bytecode `activationFuncId` hooks.
13. `packages/typescript` now emits `UserActionArtifact`-shaped user programs
   with stable `ActionKey`s, artifact-local `entryFuncId` /
   `activationFuncId`, direct `isAsync`, and `revisionId` fields instead of
   wrapper-era runtime metadata.
14. `packages/typescript` no longer exports a VM/scheduler-capturing wrapper
   runtime for user tiles. `linkUserPrograms()` now remains only as a pure
   bytecode merge/remap helper returning artifact offsets and remapped debug
   metadata.
15. `packages/typescript` runtime registration now publishes parameter tiles,
   tile metadata, and direct `BytecodeResolvedAction` artifacts into the core
   action registry without mutating `FunctionRegistry` entries in place.
16. `apps/sim` built-in sensor and actuator registration now constructs
   `ActionDescriptor` metadata and host action bindings directly. Sim tile
   defs no longer derive action metadata from `FunctionRegistry` entries.
17. Sim startup now hydrates user-tile catalog metadata from
   `sim:user-tile-metadata` before live bridge compilation begins, so
   persisted brains can deserialize by tile ID without fabricating empty
   compiled-program stubs or no-op host wrappers.
18. `apps/sim` now creates brains through a resolver-backed factory that links
   against both core host-backed actions and the current user-action artifact
   registry. Actor construction, brain replacement, and persisted-brain loads
   now all flow through that resolver path.
19. User tile recompilation in the sim now publishes direct artifacts,
   preserves the last successful live artifacts when recompilation fails, and
   rebuilds only active brains whose tracked action revisions are stale.
20. The sim currently derives deterministic content-based action revisions for
   rebuild invalidation because compiler-emitted `revisionId` values are
   build-ephemeral. No executable-brain cache has been added yet, so affected
   actor brains are recreated individually from current artifacts.

The codebase already contains the raw capabilities needed for the new design:

- user-authored actions compile to bytecode programs with explicit entry
  functions and persistent state slot counts
- the VM supports injected context, child fibers, async handles, and frame-local
  state
- the brain compiler already manages program-local tables for functions and
  constants

No backward compatibility constraints apply. Existing serialized brains may be
discarded or recreated.

---

## Phase 1: Split Action Metadata From Host Dispatch

### Goal

Separate sensor/actuator tile metadata from host-function dispatch so action
tiles no longer store `BrainFunctionEntry`.

### Read first

- Architecture spec sections C, D.1, D.2, H, I
- Current code in tile defs, host-function interfaces, operator overloads, and
  services

### In scope

- introduce `ActionDescriptor`
- move sensor and actuator tile defs to `ActionDescriptor`
- narrow the host-function subsystem conceptually to host intrinsics
- keep operators and conversions bound to host-function entries

### Out of scope

- compiler opcode changes
- VM dispatch changes
- link-step changes
- app-side user tile registration changes

### Ordered tasks

1. Define `ActionDescriptor` in core interfaces.
2. Update action tile interfaces and base classes to store descriptors instead of
   host-function entries.
3. Update sensor and actuator registration code to construct descriptors from the
   existing host-function registrations.
   This is a Phase 1 bridge only, not the permanent architecture. By the end of
   Phase 3, the long-term resolver/binding path should no longer depend on
   `BrainFunctionEntry -> ActionDescriptor` derivation as the source of truth
   for built-in actions.
4. Keep operator and conversion interfaces on the host-function path.
5. Rename the host-function subsystem if the rename can be completed cleanly in
   this phase. If not, keep names stable but ensure the tile model is already
   decoupled.

### Likely files

- `packages/core/src/brain/interfaces/functions.ts`
- `packages/core/src/brain/interfaces/tiles.ts`
- `packages/core/src/brain/interfaces/operators.ts`
- `packages/core/src/brain/interfaces/conversions.ts`
- `packages/core/src/brain/model/tiledef.ts`
- `packages/core/src/brain/tiles/sensors.ts`
- `packages/core/src/brain/tiles/actuators.ts`
- `packages/core/src/brain/runtime/functions.ts`
- `packages/core/src/brain/services.ts`
- `packages/core/src/brain/services-factory.ts`

### Verification

- no sensor or actuator tile definition stores `BrainFunctionEntry`
- operators and conversions still compile and resolve through host entries
- editor/catalog-facing metadata remains intact

Run:

```sh
cd packages/core && npm run check && npm run build && npm test
```

### Stop when

- action tile metadata is decoupled from host-function entries
- no compiler or runtime behavior has been changed yet

### Common failure modes

- leaking `BrainFunctionEntry` through helper accessors or convenience fields
- accidentally refactoring operators/conversions onto the new action path

---

## Phase 2: Compile Brain Programs Against Action Slots

### Goal

Make the brain compiler emit program-local action slots and action callsites
instead of global host-function IDs for sensors and actuators.

### Read first

- Architecture spec sections D.3, E.1, E.5, F
- Current brain compiler, emitter, runtime interfaces, and verifier logic

### Phase 2 precondition

Do not start Phase 2 until the Phase 1 tile-model split is present on the
current branch.

At the start of Phase 2, assume this baseline:

- `ActionDescriptor` exists in core interfaces
- sensor and actuator tile defs already store `action` metadata
- parser, type inference, and editor-facing paths already read
   `action.callDef` and `action.outputType`
- `BrainCompiler` and the runtime interfaces still use
   `PageMetadata.hostCallSites`; no `actionRefs` or `actionCallSites` exist yet
- `ExprCompiler` still resolves `action.key` through
   `getBrainServices().functions` and still emits `HOST_CALL` /
   `HOST_CALL_ASYNC` for sensors and actuators
- `mkActionDescriptor()` may still derive descriptors from
   `BrainFunctionEntry`; that is acceptable at the start of Phase 2 but remains
   transitional only and must not survive as the permanent built-in action model
   past Phase 3
- downstream registration code in `packages/typescript` and `apps/sim` may
   still target the pre-Phase-1 action tile constructors; that breakage is
   expected and remains out of scope for Phase 2

If that baseline is not present on the current branch, stop and regenerate or
complete Phase 1 first.

What remains for Phase 2 is not more tile metadata refactoring. Phase 2 starts
at the compiler boundary and removes the remaining sensor/actuator dependency on
compiler-side lookups back into the global `FunctionRegistry`.

### In scope

- add action-slot metadata to compiled brain programs
- add action-call opcodes or equivalent dedicated instruction forms
- replace `PageMetadata.hostCallSites` with `PageMetadata.actionCallSites`
- emit action calls for sensors and actuators
- remove compiler-side resolution from `ActionDescriptor` back to
   `BrainFunctionEntry` for sensor/actuator invocation

### Out of scope

- executable action linking
- actual VM action execution
- user-authored artifact format changes
- sim integration
- repairing stale app-side or `packages/typescript` action-tile constructor
   call sites left behind by the Phase 1 contract change

### Ordered tasks

1. Extend runtime interfaces with `ActionRef` and `ActionCallSiteEntry`.
2. Extend the program metadata emitted by `BrainCompiler` to store `actionRefs`
   at program scope and `actionCallSites` inside each `PageMetadata` entry.
3. Extend the bytecode emitter with action-call emission helpers.
4. Update the rule compiler so sensors and actuators intern action keys into
   local slots, stop resolving them through `getBrainServices().functions`, and
   emit action-call instructions.
5. Leave `HOST_CALL*` in place for operators, conversions, and other host
   intrinsics.
6. Update verifier types if needed, but do not implement runtime dispatch yet.

### Likely files

- `packages/core/src/brain/interfaces/runtime.ts`
- `packages/core/src/brain/interfaces/vm.ts`
- `packages/core/src/brain/compiler/emitter.ts`
- `packages/core/src/brain/compiler/rule-compiler.ts`
- `packages/core/src/brain/compiler/brain-compiler.ts`

### Verification

- brain compilation no longer reads `fnEntry.id` for sensor/actuator invocation
- compiled page metadata contains action callsites, not host callsites
- host intrinsic emission remains unchanged

Run:

```sh
cd packages/core && npm run check && npm run build && npm test
```

### Stop when

- compiled programs contain unresolved action slots
- runtime still cannot execute them yet

### Common failure modes

- converting operators or conversions to action calls by accident
- keeping both host and action callsites for the same sensor/actuator path
- leaving a fallback `ActionDescriptor -> FunctionRegistry` lookup in the
   compiler path after action slots have been introduced
- introducing a separate top-level `actionCallSites` list instead of replacing
   the field inside `PageMetadata`
- spending Phase 2 effort on downstream registration fixes in `apps/sim` or
   `packages/typescript` instead of completing the core compiler boundary

---

## Phase 3: Introduce An Explicit Brain Link Step

### Goal

Add a formal link step that resolves action descriptors into host bindings or
bytecode artifacts, then produces the executable runtime artifact used by
`Brain`.

### Read first

- Architecture spec sections D.4, D.5, F.3, F.4
- Current `compileBrain()`, `BrainDef.compile()`, `Brain.initialize()`, and service construction

Current branch note:

- Phase 2 may already have temporary `ACTION_CALL` / `ACTION_CALL_ASYNC`
   runtime handlers that resolve `BrainProgram.actionRefs` back through
   `getBrainServices().functions`.
- Phase 3 must remove that implicit runtime lookup from the steady-state design
   by routing action binding through the explicit link artifact instead.
- Current `BrainDef.compile()` still returns a `Brain` runtime instance, not an
   unlinked program. The explicit compile -> link boundary therefore lives
   below that API unless Phase 3 changes the API cleanly on purpose.

### In scope

- define a resolver return type distinct from final bytecode executable entries
- define `ExecutableAction`
- define `ExecutableBrainProgram`
- define `BrainActionResolver` or equivalent resolver interface
- change runtime lifecycle to compile -> link -> instantiate

### Out of scope

- VM action execution logic
- action-instance state scoping
- TypeScript artifact rewrites
- sim resolver implementation

### Ordered tasks

1. Add resolved-action, executable-action, and executable-program interfaces to
   core.
2. Define the resolver/environment interface core will use to resolve actions.
   For bytecode actions, the resolver must return an artifact with
   artifact-local function IDs, not a pre-remapped executable entry.
3. Refactor the brain lifecycle so `Brain` no longer instantiates the VM from a
   raw compiled program.
4. Thread the resolver/environment through an explicit link step and into
   `Brain` construction/initialization in the cleanest way available.
   The lower-level compile step (`compileBrain()` / `BrainCompiler`) must
   remain the compile step that produces the unlinked program. If
   `BrainDef.compile()` remains a runtime factory, it must not collapse compile
   and link into an opaque single-phase implementation boundary.
5. Keep the link step interface-only. Do not make core depend on
   `packages/typescript`.

### Likely files

- `packages/core/src/brain/interfaces/runtime.ts`
- `packages/core/src/brain/compiler/brain-compiler.ts`
- `packages/core/src/brain/model/braindef.ts`
- `packages/core/src/brain/runtime/brain.ts`
- `packages/core/src/brain/services.ts`
- `packages/core/src/brain/services-factory.ts`

### Verification

- `Brain` instantiation now consumes an executable program artifact
- core no longer assumes action resolution comes directly from
   `getBrainServices().functions`; any temporary execution bridge must read the
   explicit link artifact instead
- resolver boundary is interface-only
- the resolver boundary does not assume final merged program layout for
   bytecode action function IDs

Run:

```sh
cd packages/core && npm run check && npm run build && npm test
```

### Stop when

- the link step exists structurally
- action resolution is plumbed into Brain construction/initialization
- VM dispatch is still pending

### Common failure modes

- implementing app-specific resolver logic inside core
- leaving a hidden fallback from action dispatch to the global host registry
- making the resolver fabricate final `entryFuncId` values before bytecode
   artifacts have been merged into the executable brain program
- collapsing compile and link back into one opaque runtime-factory path and
   losing the explicit `UnlinkedBrainProgram -> ExecutableBrainProgram`
   boundary, even if `BrainDef.compile()` remains the public entry point
- leaving Phase 1 `BrainFunctionEntry -> ActionDescriptor` derivation in place
  as the permanent built-in action source of truth after the explicit resolver
  and link-step boundary has been introduced

---

## Phase 4: Implement VM Action Dispatch

### Goal

Teach the VM to execute host-backed and bytecode-backed actions through the
executable action table.

### Read first

- Architecture spec sections E.1 through E.4
- Current VM instruction handlers, verifier, and scheduler behavior

Current branch note:

- Phase 3 already introduced `ExecutableBrainProgram.actions`, and the current
   VM now dispatches existing host-backed actions from that executable table.
- Bytecode action linking and dispatch are still missing. The linker currently
   throws for bytecode bindings, and `ACTION_CALL` / `ACTION_CALL_ASYNC`
   intentionally stop at host-backed actions only.
- Phase 4 therefore needs both bytecode-action link-step work and VM dispatch
   work. Updating VM handlers alone is not enough.
- Phase 4 must preserve the existing host-backed executable-action-table path
   while extending it to bytecode-backed sync and async actions.
- `linkBrainProgram()` currently recovers `ActionDescriptor` metadata from both
   the `BrainDef` rule tree and the registered tile catalogs. Phase 4 bytecode
   action linking must preserve that behavior for programmatic tests and
   non-catalog-registered action tiles.

### In scope

- bytecode executable-action materialization in the core link step
- sync action dispatch
- async action dispatch
- verifier bounds checks for action slots
- static rejection of suspension paths inside sync bytecode actions where
   knowable
- binding `currentCallSiteId` and `rule` through the action path

### Out of scope

- final action-state scoping redesign
- TypeScript artifact changes
- sim-side resolver wiring

### Ordered tasks

1. Extend the explicit brain link step so bytecode resolved actions are merged
   into the executable program and materialized as
   `BytecodeExecutableAction` entries with remapped program-global function
   IDs.
2. Preserve the existing host-backed executable-action-table dispatch path and
   extend `ACTION_CALL` to support bytecode-backed sync actions.
3. Extend `ACTION_CALL_ASYNC` to support bytecode-backed async actions using
   child fibers and handle completion.
4. Dispatch bytecode-backed sync actions by pushing an action-root frame onto
   the current fiber and returning through ordinary `RET` semantics. Do not use
   `spawnFiber()` plus an inline blocking run for sync dispatch.
5. Add static verifier and compiler checks that reject suspension paths inside
   sync bytecode actions where they are knowable, including `YIELD`, `AWAIT`,
   `HOST_CALL_ASYNC`, and `ACTION_CALL_ASYNC`.
6. Fault the fiber at runtime if a sync bytecode action still reaches a
   suspension point through a path that was not rejected statically.
7. Keep verifier checks aligned with executable-program action tables and
   tighten them further if needed for merged bytecode actions.
8. Add or update linker/VM tests covering host-backed regression behavior plus
   bytecode-backed action paths.

### Likely files

- `packages/core/src/brain/interfaces/runtime.ts`
- `packages/core/src/brain/runtime/linker.ts`
- `packages/core/src/brain/runtime/vm.ts`
- `packages/core/src/brain/interfaces/vm.ts`
- `packages/core/src/brain/runtime/vm.spec.ts`

### Verification

- bytecode-backed actions are linked into executable action entries with
   remapped program-global function IDs before dispatch
- sync host-backed actions execute without the old sensor/actuator host registry
  path
- sync bytecode-backed actions execute on the current fiber's frame stack and
   return through `RET`
- sync bytecode-backed action faults propagate through the caller's normal
   handler chain
- statically invalid sync bytecode actions are rejected before runtime where
   knowable
- sync bytecode-backed actions cannot suspend
- async bytecode-backed actions execute in child fibers and resolve handles
  correctly

Run:

```sh
cd packages/core && npm run check && npm run build && npm test
```

### Stop when

- the VM can execute executable actions end-to-end
- persistent action-state scoping is still the old model or a temporary bridge

### Common failure modes

- using externally captured VM wrappers instead of the executable action table
- implementing sync bytecode dispatch as child-fiber execution instead of
   current-fiber frame entry
- allowing sync bytecode actions to suspend and implicitly block the parent
   fiber
- relying only on runtime faults and skipping the static verifier/compiler
   rejection for knowable suspension paths
- breaking `AWAIT` / handle semantics for host async execution
- assuming action descriptor recovery can rely on catalogs alone and breaking
  programmatic action-tile use cases during bytecode-action linking

---

## Phase 5: Replace Fiber-Global Callsite Vars With Action State

### Goal

Move persistent action state from a fiber-global slot to explicit
action-instance state bound to the current action frame chain and current host
action context.

### Read first

- Architecture spec sections E.4, E.5, E.6, G.3
- current `fiber.callsiteVars`, `ExecutionContext.callSiteState`, and
   action-frame binding usage plus TS compiler assumptions around
   `numCallsiteVars`

Current branch note:

- Host-backed actions already execute through `ExecutableBrainProgram.actions`
   and still rely on `ExecutionContext.currentCallSiteId` plus
   `getCallSiteState()` / `setCallSiteState()`.
- Bytecode-backed actions now link into `ExecutableBrainProgram.actions` and
   execute through current-fiber action-root frames or async child fibers.
- Phase 4 intentionally kept persistent state on the temporary
   `ExecutionContext.callSiteState` / `fiber.callsiteVars` bridge, and
   `activationFuncId` is linked but not yet used for unified page-entry
   dispatch.
- Phase 4 already introduced action-frame metadata for bytecode dispatch.
   Phase 5 should refine that binding model around a unified action-instance
   record rather than add a second parallel frame/action binding path.
- Phase 5 should unify lifetime and scoping, not force host-backed actions onto
   a `numStateSlots`-style binding contract.

### In scope

- action-state storage model
- frame/action binding model
- page activation state reset semantics
- host-side `getCallSiteState()` / `setCallSiteState()` rebinding
- compiler/runtime contract rename if appropriate

### Out of scope

- sim integration
- removal of user wrapper artifacts from `packages/typescript`
- any `packages/typescript` edits in this phase must stay limited to field
   renames and contract alignment needed by the new action-state model, not
   artifact-shape redesign or runtime-path replacement

### Ordered tasks

1. Replace or redefine the temporary `fiber.callsiteVars` /
   `ExecutionContext.callSiteState` bridge so state is bound to the current
   action frame chain, not to the whole fiber or an execution-context global
   map keyed only by call-site ID.
2. Redefine `ExecutionContext` host-state helpers so host-backed actions read
   and write the current action instance, not an ExecutionContext-owned global
   map keyed only by call-site ID.
3. Ensure helper `CALL`s inside an action inherit the same action-state binding.
4. Update page activation so each action callsite gets deterministic state
   creation/reset and unified activation dispatch.
5. Rename runtime/compiler-facing concepts from legacy terms like
   `numCallsiteVars` to `numStateSlots` if the rename can be completed cleanly in
   this phase.
6. Update tests to cover multiple action callsites within one rule fiber and
   host-backed action state reset/access behavior.

### Likely files

- `packages/core/src/brain/interfaces/vm.ts`
- `packages/core/src/brain/interfaces/runtime.ts`
- `packages/core/src/brain/runtime/vm.ts`
- `packages/core/src/brain/runtime/brain.ts`
- `packages/core/src/brain/runtime/sensors/*.ts`
- `packages/typescript/src/compiler/types.ts`
- `packages/typescript/src/compiler/lowering.ts`
- `packages/typescript/src/compiler/project.ts`
- `packages/typescript/src/compiler/codegen.spec.ts`

### Verification

- two distinct action callsites in the same rule fiber do not overwrite each
  other's persistent state binding
- host-backed actions using `getCallSiteState()` / `setCallSiteState()` now
   read and write action-instance-scoped state
- persistent state survives across ticks and root-rule respawns
- page activation resets action state deterministically and invokes the correct
   activation hook once per activation

Run:

```sh
cd packages/core && npm run check && npm run build && npm test
cd packages/typescript && npm run typecheck && npm run check && npm test
```

### Stop when

- persistent action state is scoped correctly to action callsites
- wrapper-specific naming and tests may still exist, but the runtime semantics
  are no longer fiber-global

### Common failure modes

- storing persistent state on the fiber object in a different field name
- resetting state only for bytecode-backed actions but not uniformly by
  action-callsite lifecycle
- preserving `ExecutionContext.callSiteState` as an independent parallel store
   outside the unified action-instance model
- forcing host-backed actions onto a `numStateSlots`-style executable binding
   contract instead of rebinding the existing ctx helper API to the unified
   action-instance record

---

## Phase 6: Convert User-Authored Tiles To Action Artifacts

### Goal

Remove the runtime wrapper model from `packages/typescript` and publish user
action artifacts that the core linker can bind directly.

### Read first

- Architecture spec sections G and J
- current TS compiler artifact shape, linker, and wrapper runtime files

Current branch note:

- `UserAuthoredProgram` now uses `numStateSlots` rather than
   `numCallsiteVars`, but it still carries wrapper-era runtime fields such as
   `initFuncId`, `lifecycleFuncIds`, `execIsAsync`, and
   `programRevisionId`.
- `UserTileLinkInfo` still exposes wrapper-oriented linked IDs
   (`linkedInitFuncId` and `linkedOnPageEnteredFuncId`), so
   `linkUserPrograms()` remains coupled to wrapper execution instead of being a
   pure artifact/link helper.
- `packages/typescript/src/runtime/authored-function.ts` now binds wrapper
   fibers through the core action-instance model, but it still captures a
   VM/scheduler pair and executes user tiles as host-function closures.
- `packages/typescript/src/runtime/registration-bridge.ts` still registers user
   tiles through `FunctionRegistry` and mutates existing async entries in
   place, even though it now constructs `ActionDescriptor`-based tiles through
   the current constructor contract.
- `linkUserPrograms()` is still being used as wrapper-preparation glue for
   downstream registration. Phase 6 must turn it into pure artifact/link
   support or remove it from that runtime role.

### In scope

- user action artifact shape
- activation function export shape
- removal of VM-capturing wrapper execution from runtime path
- registration bridge contract changes

### Out of scope

- sim resolver implementation
- app-side brain rebuild behavior
- cleanup of old persistence paths
- fixing sim-side synthetic empty-program/bootstrap registration shims; those
   belong to Phase 7

### Ordered tasks

1. Replace `UserAuthoredProgram` runtime-facing fields with a cleaner action
   artifact shape aligned with the architecture spec.
2. Collapse `initFuncId` plus `lifecycleFuncIds` wrapper semantics into a
   direct `activationFuncId` export if possible.
3. Keep `entryFuncId` and `activationFuncId` artifact-local. Do not precompute
   merged-program function indexes inside `packages/typescript`.
4. Remove `createUserTileExec` from the intended runtime path.
5. Change the registration bridge so it publishes tile metadata plus compiled
   action artifacts, not host-function closures or `FunctionRegistry`
   swap-in-place mutations.
6. If `linkUserPrograms()` remains in this phase, keep it only as a pure
   bytecode merge/remap helper. It must stop returning wrapper-oriented linked
   IDs for runtime registration.
7. Update compiler and linker tests accordingly.

### Likely files

- `packages/typescript/src/compiler/types.ts`
- `packages/typescript/src/compiler/lowering.ts`
- `packages/typescript/src/compiler/project.ts`
- `packages/typescript/src/linker/linker.ts`
- `packages/typescript/src/runtime/authored-function.ts`
- `packages/typescript/src/runtime/registration-bridge.ts`
- `packages/typescript/src/runtime/authored-function.spec.ts`

### Verification

- no compiled user tile is converted into a VM-capturing host-function wrapper
- the TypeScript package emits artifacts suitable for direct core action linking
- activation behavior is represented directly in the emitted artifact shape
- emitted bytecode artifact function IDs are still artifact-local and are left
   for the core brain link step to remap

Run:

```sh
cd packages/typescript && npm run typecheck && npm run check && npm test
```

If core interfaces changed during the same phase, also run:

```sh
cd packages/core && npm run check && npm run build && npm test
```

### Stop when

- `packages/typescript` targets the new action-linking contract
- sim integration still has not been rewritten

### Common failure modes

- keeping wrappers in place "for now" and calling the phase complete
- encoding app-specific resolver assumptions into the TypeScript package
- treating artifact-local function IDs as if they were final executable-program
   indexes
- keeping `linkUserPrograms()` coupled to host-wrapper registration instead of
   narrowing it to pure artifact/link support
- trying to repair sim's synthetic empty-program bootstrap path here instead of
   finishing the TypeScript artifact contract first

---

## Phase 7: Sim Integration And Brain Rebuild Strategy

### Goal

Wire the sim app into the new resolver model and replace global host-function
mutation with executable-brain invalidation and rebuild.

### Read first

- Architecture spec sections D.5, J, and K
- current sim-side tile registration, compilation, actor brain lifecycle, and
  engine update flow

Current branch note:

- `apps/sim/src/brain/tiles/sensors.ts` and
   `apps/sim/src/brain/tiles/actuators.ts` still build built-in tiles from
   `FunctionRegistry` entries using the old constructor shape.
- `apps/sim/src/services/user-tile-registration.ts` still reconstructs fake
   metadata-only programs, imports removed pre-Phase-6 TypeScript APIs
   (`UserTileLinkInfo`, `linkUserPrograms(...).userLinks`,
   `registerUserTile(linkInfo, noOpHostFn)`), and still fabricates
   wrapper-era artifact fields such as `numCallsiteVars`, `execIsAsync`,
   `lifecycleFuncIds`, and `programRevisionId`.
- After Phase 6, `packages/typescript` now publishes direct bytecode actions
   and `registerUserTile(program)` metadata registration instead. Phase 7 must
   switch the sim to that artifact model rather than adapt the old wrapper API.
- That synthetic metadata/bootstrap path still lags the core
   `UnlinkedBrainProgram` shape (`actionRefs` missing) and the current
   `UserActionArtifact` shape (`key`, `isAsync`, `numStateSlots`,
   `revisionId`). Phase 7 should delete or replace it, not keep it alive with
   padded fake fields.
- Startup still depends on early user-tile catalog hydration so persisted
   brains can deserialize before the first live compile finishes. Phase 7 must
   preserve that startup guarantee without pretending cached metadata is a
   compiled action artifact.
- `apps/sim/src/brain/actor.ts`, `apps/sim/src/brain/engine.ts`, and
   `apps/sim/src/services/brain-persistence.ts` still call `brainDef.compile()`
   directly, and user-tile recompilation currently only refreshes tile
   registration state plus listeners. There is no dependency-scoped executable
   program invalidation or active-brain rebuild path yet.
- `apps/sim/src/services/vscode-bridge.ts` still routes compilation updates to
   `handleRecompilation()` only. Phase 7 needs a rebuild coordinator, not just
   catalog refresh notifications.

### In scope

- sim-side action artifact registry
- sim-side `BrainActionResolver`
- active brain rebuild/invalidation on user action changes
- optional executable-brain artifact caching
- failed-compile behavior that preserves the last successful live runtime

### Out of scope

- legacy compatibility with old persisted brain data
- final cleanup of obsolete docs and persistence code

### Ordered tasks

1. Update sim-side built-in sensor and actuator tile registration to construct
   `ActionDescriptor` metadata instead of passing `BrainFunctionEntry`
   directly.
2. Split user tile registration into two explicit responsibilities:
   metadata-only catalog hydration for startup/deserialization and compiled
   action-artifact publication for live execution.
3. Delete the synthetic empty-program/user-link bootstrap path used only to
   register cached metadata, and replace it with metadata-only registration or
   last-successful artifact hydration that does not fabricate compiled
   programs.
4. Ensure startup still registers user-tile metadata early enough for cached
   brain deserialization before any actor or engine path compiles a `BrainDef`.
5. Implement a sim-side resolver that resolves both built-in and user-authored
   action keys.
6. Thread that resolver through every sim brain creation path, including actor
   construction, brain replacement, startup brain loads, and persisted-brain
   deserialization.
7. Replace the current recompilation listener flow with a coordinator that
   compares changed action revisions against executable-brain dependencies.
8. On successful user action recompilation, invalidate executable-brain cache
   entries whose linked action revisions include the changed key at an older
   revision.
9. Replace every active Brain instance using an invalidated executable program.
   Restart the Brain from the same `BrainDef` and same host object; do not
   patch the live VM or scheduler in place.
10. On failed recompilation, keep the last successful action artifacts and keep
   existing active brains running.
11. Add executable-brain caching only if it reduces clear repeated work without
   obscuring correctness.

### Likely files

- `apps/sim/src/bootstrap.ts`
- `apps/sim/src/brain/tiles/sensors.ts`
- `apps/sim/src/brain/tiles/actuators.ts`
- `apps/sim/src/services/user-tile-registration.ts`
- `apps/sim/src/services/user-tile-compiler.ts`
- `apps/sim/src/services/vscode-bridge.ts`
- `apps/sim/src/services/brain-persistence.ts`
- `apps/sim/src/brain/actor.ts`
- `apps/sim/src/brain/engine.ts`

### Verification

- `apps/sim` typechecks again without restoring removed wrapper-era exports in
   `packages/typescript`
- cold startup can hydrate user-tile catalogs early enough for persisted-brain
   deserialization without fabricating empty compiled-program stubs
- recompiling a user tile no longer mutates a global host-function entry
- sim no longer fabricates empty unlinked-program stubs just to register cached
  user-tile metadata
- active actors depending on the changed action rebuild from current compiled
   artifacts
- actors whose executable brains do not depend on the changed action are not
   rebuilt
- failed recompilation leaves the last successful live brains running
- multiple actors sharing one `BrainDef` execute without cross-Brain leakage

Run:

```sh
cd apps/sim && npm run typecheck && npm run check
cd packages/core && npm run check && npm run build && npm test
cd packages/typescript && npm run typecheck && npm run check && npm test
```

### Stop when

- the sim is using the new action resolver model end-to-end
- obsolete persistence and wrapper paths may still exist, but they are no longer
  required for normal execution

### Common failure modes

- reintroducing `UserTileLinkInfo` or other removed compatibility exports in
   `packages/typescript` instead of rewriting sim against the new artifact API
- fixing only user-tile registration and forgetting the built-in sim
   sensor/actuator tile registration that now needs `ActionDescriptor`
   construction
- moving startup metadata registration behind engine or actor creation and
   breaking persisted brains that reference user tiles
- padding fake `actionRefs` or other compiled-program fields onto metadata-only
  stubs instead of removing the synthetic-program path
- treating tile-catalog refresh notifications as sufficient and never
   rebuilding executable brains after action revision changes
- rebuilding only some active Brain instances for a changed action key
- patching the executable action table or VM in place instead of restarting the
   affected Brain instances
- tearing down live brains on compile failure before a replacement executable
   program exists
- caching VM instances instead of caching immutable executable programs
- leaving a hidden global-registry fallback for user-authored actions

---

## Phase 8: Cleanup And Persistence Reset

### Goal

Delete the obsolete wrapper-oriented path and remove only the persistence
assumptions that are actually incompatible with the final resolver-based
startup/runtime path.

### Read first

- Architecture spec section J
- current sim persistence and user tile registration code

Current branch note:

- After Phase 7, the sim now uses the resolver-based action path end to end.
   Remaining cleanup is concentrated in startup/persistence policy and docs,
   not in missing runtime wiring.
- `sim:user-tile-metadata` is now a pure startup metadata cache used to
   register user tile catalogs before the first live compile. It no longer
   fabricates compiled programs or no-op host bindings.
- The persisted `BrainDef` format itself is still tile-ID based and has not
   been version-bumped by the action execution redesign. The real persistence
   question for Phase 8 is whether the metadata cache should be kept,
   version-bumped, or cleared explicitly.
- No executable-brain cache landed in Phase 7. Rebuild invalidation currently
   tracks dependencies per live `Brain` instance and recreates affected actor
   brains individually.
- The sim runtime currently derives deterministic content-based action
   revisions for rebuild invalidation because compiler-emitted `revisionId`
   values are build-ephemeral. Phase 8 should not treat raw compiler revision
   IDs as persistence-stable cache keys.

### In scope

- delete sim-side compatibility helpers that only exist to mimic user-tile
   host-function registration
- delete remaining swap-in-place host-function behavior
- remove outdated wrapper-oriented docs
- reset or version-bump only the local persistence entries that are genuinely
   incompatible with the final startup/runtime path

### Out of scope

- further architecture redesign
- state-preserving migration tools

### Ordered tasks

1. Delete any remaining sim-side compatibility helpers kept only to emulate
   wrapper-era user-tile registration, including no-op host bindings or stale
   metadata bootstrap shapes.
2. Delete any remaining host-function swap-in-place behavior or compatibility
   branches for user-authored tiles.
3. Evaluate persistence item by item. Keep existing saved `BrainDef`s if the
   Phase 7 startup path still lets them deserialize and compile by tile ID.
   Version-bump or clear only the entries that no longer have a sound load
   path, such as wrapper-era user-tile metadata caches if they cannot be read
   by the final startup contract.
4. Remove outdated wrapper-based execution documentation.
5. Make any required persistence invalidation explicit in code and docs rather
   than relying on accidental incompatibility.

### Likely files

- `apps/sim/src/services/user-tile-registration.ts`
- `apps/sim/src/services/brain-persistence.ts`
- `apps/sim/src/services/vscode-bridge.ts`
- `docs/specs/features/user-tile-compilation-pipeline.md`
- `docs/specs/features/user-authored-sensors-actuators.md`

### Verification

- no runtime path depends on user tiles being registered as host functions
- existing saved brains remain deserializable and compilable after startup for
   every tile whose metadata is intentionally retained by the final load path
- only genuinely incompatible local storage state is cleared or versioned out
   explicitly; do not assume `sim:user-tile-metadata` must be reset unless its
   retained shape is shown to be unsound
- if any persisted brain keys must be invalidated, the exact incompatibility is
   identified and documented instead of assuming all saved brains are stale
- a clean sim startup after any required reset repopulates tile metadata and
   compiles brains through the resolver path
- docs point to the new action execution architecture as the source of truth

Run:

```sh
cd apps/sim && npm run typecheck && npm run check
cd packages/core && npm run check && npm run build && npm test
cd packages/typescript && npm run typecheck && npm run check && npm test
```

### Stop when

- the old wrapper-oriented runtime path is gone
- any persistence reset or invalidation is limited to entries that are actually
   incompatible with the final load path

### Common failure modes

- leaving dead compatibility code behind because it seems harmless
- invalidating persistence implicitly instead of making the reset explicit in
   code and docs
- clearing all saved brains just because runtime internals changed, without a
   concrete deserialization or tile-resolution incompatibility
- conflating wrapper-era user-tile metadata cache invalidation with a
   `BrainDef` serialization-format break
- treating Phase 8 as a place to finish unresolved Phase 7 resolver wiring

---

## Recommended Implementation Order

Always implement in this order:

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8

The highest-leverage path is:

- define the right core contracts first
- compile against those contracts
- link and execute through those contracts
- only then rewire the app and compiler integration layers

Do not start from the app layer and work backward.

---

## Final Response Expectations For Each Phase

After implementing a phase, the AI should report:

1. what changed structurally
2. which verification commands were run
3. whether the phase acceptance target was reached
4. what remains intentionally untouched because it belongs to a later phase

That last item is important. The user needs to know the AI stopped at the phase
boundary on purpose.

---

## Phase Log

(Written during post-mortem only. Do not edit during implementation.)

### Phase 1 (2026-04-03)

**Planned vs actual:**

All 5 ordered tasks were delivered within the intended core-only scope.

- `ActionDescriptor`, `ActionKey`, `ActionKind`, and `mkActionDescriptor()`
   were added in core interfaces.
- `IBrainActionTileDef` and `BrainActionTileBase` now store `action`
   metadata instead of `fnEntry`.
- Built-in core sensor and actuator registration now constructs tile metadata
   from existing host-function registrations through `mkActionDescriptor()`.
- Parser, type inference, and tile-suggestion paths now read
   `tileDef.action.callDef` and `tileDef.action.outputType` instead of reaching
   through `BrainFunctionEntry`.
- Operators and conversions stayed on the host-function path unchanged.

One planned item was intentionally left as "keep names stable": the
host-function subsystem was not renamed in Phase 1.

**Bridge left in place on purpose:**

- `packages/core/src/brain/compiler/rule-compiler.ts` still resolves
   `action.key -> getBrainServices().functions.get(...)` for sensor and
   actuator invocation. This is the Phase 1 bridge and matches the plan's stop
   condition. Phase 2 must remove compiler-side action dispatch lookups back
   into the global `FunctionRegistry`.

**Deviations and discoveries:**

- The core package needed a Roblox-safe adjustment during verification:
   `BrainTileSensorDef.outputType` had to remain a plain readonly property, not
   a getter.
- The constructor contract change immediately breaks downstream registration
   code that still passes `BrainFunctionEntry` directly into
   `BrainTileSensorDef` / `BrainTileActuatorDef`. Confirmed stale call sites:
   `packages/typescript/src/runtime/registration-bridge.ts`,
   `apps/sim/src/brain/tiles/sensors.ts`, and
   `apps/sim/src/brain/tiles/actuators.ts`.
- Those downstream breakages are acceptable for this phase. They should not be
   repaired piecemeal before the planned TypeScript and sim integration phases.

**Verification:**

- Ran `cd packages/core && npm run typecheck && npm run check && npm run build && npm test`
- Final result: pass. Core typecheck passed, check passed, build passed, and
   530 tests passed.

**Spec updates from this post-mortem:**

- Updated `Current State` to reflect the Phase 1 baseline instead of the
   pre-implementation model.
- Updated Phase 7 to explicitly include the sim-side built-in action tile
   registration files that now need `ActionDescriptor` construction when app
   integration resumes.

### Phase 2 (2026-04-03)

**Planned vs actual:**

Ordered tasks 1 through 5 landed within the intended compiler-boundary scope.
Ordered task 6 landed only partially as planned and partially ahead of the
phase boundary.

- `ActionRef` and `ActionCallSiteEntry` were added in core runtime interfaces.
- `BrainProgram` now carries `actionRefs`, and `PageMetadata` now carries
   `actionCallSites`.
- `ACTION_CALL` and `ACTION_CALL_ASYNC` were added to the VM opcode model, and
   the bytecode emitter now has action-call helpers.
- `BrainCompiler` now interns sensor and actuator action keys into
   program-local slots and collects page action callsites.
- `ExprCompiler` now emits `ACTION_CALL` / `ACTION_CALL_ASYNC` for sensors and
   actuators and no longer reads `fnEntry.id` for that path.
- Operators and conversions stayed on the host intrinsic path through
   `HOST_CALL_ARGS` / `HOST_CALL_ARGS_ASYNC`.

**Deviation from planned stop condition:**

- Phase 2 did not stop at compiler metadata and verifier updates only.
- `packages/core/src/brain/runtime/vm.ts` added temporary `ACTION_CALL` /
   `ACTION_CALL_ASYNC` handlers, and
   `packages/core/src/brain/runtime/brain.ts` now resolves page-entry hooks
   from `actionRefs`.
- Those handlers still resolve `actionSlot -> actionRefs[actionSlot].key ->
   getBrainServices().functions.get(...)`. This keeps built-in host-backed
   actions executable, but it is not the explicit link-step or executable-action-table
   architecture.

**Deviations and discoveries:**

- The temporary runtime bridge was necessary to keep the existing core runtime
   tests green once sensors and actuators began emitting `ACTION_CALL`
   bytecode. Later phases must replace it rather than build on it.
- Bytecode verifier checks currently validate action slots against
   `BrainProgram.actionRefs.size()` because the VM still executes the unlinked
   compiled program. Once Phase 3 introduces `ExecutableBrainProgram.actions`,
   verifier responsibility should move to that executable artifact.
- Added direct regression coverage for emitted action-slot metadata and VM
   action-slot bounds checks in
   `packages/core/src/brain/runtime/brain.spec.ts` and
   `packages/core/src/brain/runtime/vm.spec.ts`.
- The downstream stale registration issues identified during Phase 1 remain
   unchanged and are still intentionally deferred.

**Verification:**

- Ran `cd packages/core && npm run typecheck && npm run check && npm run build && npm test`
- Final result: pass. Core typecheck passed, check passed, build passed, and
   533 tests passed.

**Spec updates from this post-mortem:**

- Updated `Current State` to reflect the Phase 2 baseline instead of the
   post-Phase-1 model.
- Updated Phase 3 and Phase 4 to call out the temporary Phase 2 runtime bridge
   explicitly so later work removes it instead of treating it as the target
   design.

### Phase 3 (2026-04-03)

**Planned vs actual:**

Ordered tasks 1 through 5 landed within the intended core-side scope, with one
small forward step into the next runtime phase boundary.

- Core runtime interfaces now distinguish `UnlinkedBrainProgram`,
   `ResolvedAction`, `ExecutableAction`, `ExecutableBrainProgram`, and the
   resolver/link environment contracts needed for the explicit link step.
- `compileBrain()` and `BrainCompiler` remained the compile step that produces
   the unlinked artifact.
- `Brain.initialize()` now compiles, links, then instantiates the VM, and
   `Brain` exposes both the linked executable program and the compiled unlinked
   program for inspection.
- `linkBrainProgram()` was added as the explicit core link step. It resolves
   action slots through an interface-only resolver and materializes
   `ExecutableBrainProgram.actions`.
- Built-in core sensors and actuators now publish stable descriptors and host
   bindings directly. Core runtime registration installs those bindings into a
   `BrainActionRegistry`, and built-in tile registration consumes descriptor
   exports instead of deriving `ActionDescriptor` from `FunctionRegistry`
   entries.
- The runtime no longer routes action execution or page-entry hooks through
   `getBrainServices().functions` for the steady-state action path.

**Deviation from planned phase boundary:**

- Phase 3 moved existing host-backed `ACTION_CALL` / `ACTION_CALL_ASYNC` and
   page-entry execution onto the executable action table instead of leaving that
   swap entirely for Phase 4.
- This did not implement bytecode-backed action execution. The phase still
   stopped short of merged bytecode artifacts, action-root frames, child-fiber
   bytecode actions, or action-state scoping changes.

**Deviations and discoveries:**

- The linker needed to recover `ActionDescriptor` metadata from both the
   `BrainDef` rule tree and the registered tile catalogs. Programmatic tests can
   construct action tiles directly without catalog registration, so future work
   must not assume descriptor lookup can rely on catalogs alone.
- The built-in core binding model no longer uses
   `BrainFunctionEntry -> ActionDescriptor` as the source of truth for actions.
   `FunctionRegistry` still exists for host intrinsics and legacy test access,
   but built-in action metadata and bindings now live on the runtime descriptor
   exports plus `BrainActionRegistry`.
- Because the VM now executes linked artifacts, action-slot verification moved
   from `BrainProgram.actionRefs.size()` to
   `ExecutableBrainProgram.actions.size()`. Later phases must preserve that
   executable-artifact boundary while extending dispatch to bytecode actions.
- Custom runtime tests that previously registered ad hoc actions only in
   `FunctionRegistry` now also need explicit action-registry bindings. This is a
   useful signal that the resolver boundary is real rather than an alias for the
   old global host registry.

**Verification:**

- Ran `cd packages/core && npm run typecheck && npm run check && npm run build && npm test`
- Final result: pass. Core typecheck passed, check passed, build passed, and
   534 tests passed.

**Spec updates from this post-mortem:**

- Updated `Current State` to reflect the Phase 3 baseline instead of the
   post-Phase-2 model.
- Updated Phase 4 to start from the current host-backed executable-action-table
   dispatch path instead of the removed registry bridge.

### Phase 4 (2026-04-03)

**Planned vs actual:**

Ordered tasks 1 through 8 landed within the intended core-side scope.

- `linkBrainProgram()` now merges bytecode-backed resolved actions into the
   executable program tables and materializes `BytecodeExecutableAction`
   entries with remapped function, constant, and variable-name indexes.
- `ACTION_CALL` now preserves the existing host-backed executable-action-table
   path and also executes sync bytecode-backed actions on the current fiber by
   pushing an action-root frame that returns through ordinary `RET` semantics.
- `ACTION_CALL_ASYNC` now preserves existing host-backed handle behavior and
   also executes async bytecode-backed actions on child fibers whose completion,
   fault, and cancellation resolve the outer handle.
- The verifier now checks executable-program bytecode action entries and
   rejects statically knowable sync suspension paths including `YIELD`,
   `AWAIT`, `HOST_CALL_ASYNC`, `HOST_CALL_ARGS_ASYNC`, and
   `ACTION_CALL_ASYNC`.
- The VM now faults the fiber if a sync bytecode action still reaches a
   suspension point through an indirect path that was not rejected statically.
- Added linker and VM regression coverage for host-backed behavior, sync
   bytecode dispatch, async bytecode dispatch, caller `TRY` propagation, and
   caller rule binding.

**Deviation from planned phase boundary:**

- No material deviation. Phase 4 stopped short of the Phase 5 action-state
   redesign and did not add unified bytecode page-activation dispatch.

**Deviations and discoveries:**

- Preserving caller `TRY` behavior, caller rule binding, and async handle
   completion semantics required explicit frame/fiber metadata
   (`ruleFuncId`, `actionBinding`, and `asyncResultHandleId`) rather than
   treating bytecode action dispatch as a thin wrapper around existing call
   paths.
- Sync-suspension rejection needs both static and runtime enforcement. Direct
   `CALL` reachability is verifier-visible, but indirect calls can still reach
   suspension points only discoverable at runtime.
- Link-time bytecode remapping must rewrite nested `FunctionValue` constants,
   constant-pool-bearing instructions, and variable-name references, not just
   direct `CALL` targets.
- `activationFuncId` is now linked through executable bytecode actions, but
   page activation still does not invoke bytecode activation hooks. Later
   phases must not assume activation dispatch is already uniform.
- Persistent action state still flows through the temporary
   `ExecutionContext.callSiteState` / `fiber.callsiteVars` bridge. That remains
   the next phase boundary, not a Phase 4 regression.

**Verification:**

- Ran `cd packages/core && npm run check && npm run build && npm test`
- Final result: pass. Core check passed, build passed, and 541 tests passed.

**Spec updates from this post-mortem:**

- Updated `Current State` to reflect the Phase 4 baseline instead of the
   post-Phase-3 model.
- Updated Phase 5 to start from the new bytecode-action dispatch baseline and
   call out the temporary state bridge plus deferred bytecode activation
   dispatch.

### Phase 5 (2026-04-03)

**Planned vs actual:**

Ordered tasks 1 through 6 landed within the intended core-first scope, with
only the limited `packages/typescript` contract alignment explicitly allowed by
the phase.

- Core runtime now defines page-activation-scoped `ActionInstance` records and
   threads them through `ExecutionContext.currentActionInstance` plus action
   frame bindings.
- VM `LOAD_CALLSITE_VAR` / `STORE_CALLSITE_VAR` now resolve through the current
   action-instance state slots, and helper `CALL`s inside an action inherit the
   same binding.
- Host `getCallSiteState()` / `setCallSiteState()` now read and write the
   current action instance rather than an execution-context-global map keyed
   only by callsite ID.
- `Brain.activatePage()` now resets each action callsite deterministically and
   dispatches both host `onPageEntered` hooks and bytecode
   `activationFuncId` hooks once per activation.
- Runtime-facing `packages/typescript` fields now use `numStateSlots`, the
   wrapper runtime binds current action instances, and local
   linker/registration/spec helpers were aligned to the current
   `BrainProgram` and tile-constructor contracts.
- Added regression coverage for action-state slot isolation, host-backed state
   isolation/reset behavior, and bytecode activation-hook behavior.

**Deviation from planned phase boundary:**

- No material deviation. `packages/typescript` edits stayed limited to field
   renames and contract alignment needed to keep the existing wrapper path
   compiling and type-safe; Phase 6 wrapper removal and artifact-shape redesign
   remain pending.

**Deviations and discoveries:**

- Page activation has to run action-state reset and activation dispatch before
   spawning root rule fibers, otherwise one-shot activation semantics and clean
   page-restart reset behavior are not deterministic.
- Host-backed actions fit the unified model cleanly once `ExecutionContext`
   carries `currentActionInstance`; forcing them onto a `numStateSlots`-style
   executable contract would have been the wrong abstraction.
- A narrow `fiber.callsiteVars` fallback is still needed for current
   wrapper-oriented direct VM/test paths, but core action dispatch no longer
   depends on that fiber-global bridge.
- Phase 5 exposed stale downstream core-contract assumptions beyond
   `numStateSlots`, specifically missing `actionRefs` in linked-program helpers
   and old tile-constructor usage in `packages/typescript`
   registration/test code. Those were fixed as contract alignment, not as
   Phase 6 artifact redesign.
- Bytecode activation hooks now execute inline during page activation and
   cannot suspend. Later phases must treat activation dispatch as eager startup
   work, not as scheduler-driven async behavior.

**Verification:**

- Ran `cd packages/core && npm run typecheck`
- Ran `cd packages/core && npm run check && npm run build && npm test`
- Ran `cd packages/typescript && npm run typecheck && npm run check && npm test`
- Final result: pass. Core typecheck passed; core check, build, and test passed
   with 544 tests passing. TypeScript typecheck, check, and test passed with
   533 tests passing.

**Spec updates from this post-mortem:**

- Updated `Current State` to reflect the Phase 5 baseline instead of the
   post-Phase-4 model.
- Updated Phase 6 current-branch notes to reflect the limited TypeScript
   contract alignment already landed in Phase 5 and narrow the remaining
   wrapper-removal work.

### Phase 6 (2026-04-03)

**Planned vs actual:**

Ordered tasks 1 through 7 landed within the intended `packages/typescript`
scope.

- `UserAuthoredProgram` now extends the core `UserActionArtifact` contract.
   Wrapper-era runtime fields were removed in favor of `key`, `isAsync`,
   artifact-local `activationFuncId`, and `revisionId`.
- TypeScript lowering and project assembly now expose one optional activation
   hook instead of separate `initFuncId` plus lifecycle-wrapper fields. The
   compiler still keeps `<module-init>` as an internal helper when needed, but
   only `activationFuncId` escapes in the emitted artifact.
- `linkUserPrograms()` now stays in the package only as a pure bytecode
   merge/remap helper. It returns artifact offsets plus remapped debug metadata
   instead of wrapper-oriented linked runtime IDs.
- `packages/typescript/src/runtime/authored-function.ts` and its wrapper-runtime
   tests were deleted from the intended runtime path and public exports.
- `registerUserTile()` now registers parameter tiles plus tile metadata and
   publishes direct `BytecodeResolvedAction` artifacts into the core action
   registry instead of mutating `FunctionRegistry` entries in place.
- Compiler, linker, debug-metadata, multi-file, and runtime registration tests
   were updated to assert activation semantics and direct artifact publication.

**Deviation from planned phase boundary:**

- No material deviation. Phase 6 stayed inside `packages/typescript`, reused
   the Phase 5 core contract as-is, and left sim integration unchanged for
   Phase 7.

**Deviations and discoveries:**

- The runtime-facing lifecycle surface can collapse to one
   `activationFuncId` without removing the internal module-init helper. Keeping
   `<module-init>` as a compiler-private detail preserves lowering structure
   while exposing the cleaner artifact contract from the architecture spec.
- The pure merge/remap helper also has to rewrite variable-name indexes and
   constant-pool-bearing collection/struct instructions, not just direct
   function or constant references.
- The main stale integration point is now `apps/sim` user-tile registration,
   which still expects `userLinks`, no-op host wrappers, and metadata-only fake
   programs. Phase 7 must replace that path with catalog metadata plus direct
   artifact-registry updates.
- Generated activation debug names now use `<activation>`. Downstream tooling
   and specs should not keep assuming the old `<onPageEntered-wrapper>` naming.

**Verification:**

- Ran `cd packages/typescript && npm run typecheck && npm run check && npm test`
- Final result: pass. TypeScript typecheck, check, and test passed with 520
   tests passing.

**Spec updates from this post-mortem:**

- Updated `Current State` to reflect the Phase 6 baseline instead of the
   post-Phase-5 model.
- Updated Phase 7 current-branch notes to reflect the direct artifact
   registration API that the sim app now needs to consume.

### Phase 7 (2026-04-03)

**Planned vs actual:**

Ordered tasks 1 through 7, 9, and 10 landed within the intended sim-side
scope. Ordered task 8 became moot because no executable-brain cache was
introduced, and ordered task 11 was intentionally left unimplemented.

- Sim built-in sensor and actuator registration now constructs
   `ActionDescriptor` metadata and host-backed bindings directly. Tile defs no
   longer consume `BrainFunctionEntry` for action metadata.
- User tile registration now has two explicit responsibilities: startup
   metadata hydration from `sim:user-tile-metadata` and live artifact
   publication from successful compile results.
- The synthetic empty-program and user-link bootstrap path was removed.
   Cached user tiles no longer fabricate compiled programs or no-op host
   wrappers just to populate the catalog.
- Startup now registers cached user-tile metadata before bridge compilation
   begins so persisted brains can deserialize by tile ID before the first live
   compile finishes.
- `apps/sim` now creates brains through a resolver-backed factory that links
   against both core host-backed actions and the current user-action artifact
   registry.
- Recompilation now compares tracked per-brain action revisions, rebuilds only
   affected active brains, and restarts each affected actor brain from the
   same `BrainDef` and host object instead of patching live VM or scheduler
   state.
- Failed recompilation now keeps the last successful action artifacts and the
   currently running brains alive.
- No executable-brain cache was added. This matched the optional task 11
   boundary and kept correctness-focused invalidation explicit.

**Deviation from planned phase boundary:**

- No material deviation. The optional executable-brain cache was intentionally
   omitted; invalidation currently targets active brain instances directly
   instead of cached immutable programs.

**Deviations and discoveries:**

- `packages/typescript` `revisionId` values are build-ephemeral rather than
   content-stable. The sim therefore normalizes user artifacts to deterministic
   content-hash revisions before comparing dependencies for rebuild
   invalidation.
- The startup metadata cache remains necessary for early persisted-brain tile
   resolution, but it is now pure tile metadata rather than a fake compiled
   program bootstrap. Phase 8 should decide explicitly whether to keep,
   version-bump, or clear that cache.
- Correct failed-recompile behavior requires keeping the last successful action
   artifact for a file when the latest compile result still has diagnostics and
   no emitted program. Treating "no new artifact" as an implicit deletion
   would tear down live runtime state incorrectly.
- Rebuild scope is per live actor brain, not process-wide. Actors that share a
   `BrainDef` still recreate separate `Brain` instances so VM, scheduler,
   fiber, and action-instance state remain isolated.

**Verification:**

- Ran `cd apps/sim && npm run typecheck && npm run check`
- Ran `cd packages/core && npm run check && npm run build && npm test`
- Ran `cd packages/typescript && npm run typecheck && npm run check && npm test`
- Final result: pass. Sim typecheck and check passed; core check, build, and
   test passed with 544 tests passing; TypeScript typecheck, check, and test
   passed with 520 tests passing.

**Spec updates from this post-mortem:**

- Updated `Current State` to reflect the Phase 7 baseline instead of the
   post-Phase-6 model.
- Updated Phase 8 current-branch notes to reflect the resolver-based sim
   baseline, the remaining metadata-cache decision, and the absence of an
   executable-brain cache.