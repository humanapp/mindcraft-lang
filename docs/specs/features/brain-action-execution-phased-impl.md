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

As of 2026-04-03 after Phase 1, the action execution stack is split across a
partially migrated model:

1. Sensor and actuator tile defs now store `ActionDescriptor` metadata instead
   of `BrainFunctionEntry`.
2. Built-in core action registration still derives those descriptors from
   `FunctionRegistry` entries via `mkActionDescriptor()`. This is the intended
   Phase 1 bridge, not the permanent built-in binding model.
3. Brain compilation and runtime dispatch still emit and execute `HOST_CALL` /
   `HOST_CALL_ASYNC` through the global `FunctionRegistry`.
4. User-authored tiles are still compiled as ordinary bytecode programs, then
   wrapped back into host-function closures so the brain runtime can invoke
   them.
5. Downstream registration code in `packages/typescript` and `apps/sim` still
   targets the pre-Phase-1 action tile constructors and is expected to remain
   broken until the later integration phases update those paths.

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
- Current `BrainDef.compile()`, `Brain.initialize()`, and service construction

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
   `BrainDef.compile()` must remain the compile step that produces the
   unlinked program, not a combined compile-and-link entry point.
5. Keep the link step interface-only. Do not make core depend on
   `packages/typescript`.

### Likely files

- `packages/core/src/brain/interfaces/runtime.ts`
- `packages/core/src/brain/model/braindef.ts`
- `packages/core/src/brain/runtime/brain.ts`
- `packages/core/src/brain/services.ts`
- `packages/core/src/brain/services-factory.ts`

### Verification

- `Brain` instantiation now consumes an executable program artifact
- core no longer assumes action dispatch comes from `getBrainServices().functions`
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
- collapsing compile and link back into a single `BrainDef.compile()` path and
   losing the explicit `UnlinkedBrainProgram -> ExecutableBrainProgram`
   boundary
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

### In scope

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

1. Implement `ACTION_CALL` in the VM.
2. Implement `ACTION_CALL_ASYNC` in the VM.
3. Dispatch host-backed actions directly from the executable action table.
4. Dispatch bytecode-backed sync actions by pushing an action-root frame onto
   the current fiber and returning through ordinary `RET` semantics. Do not use
   `spawnFiber()` plus an inline blocking run for sync dispatch.
5. Dispatch bytecode-backed async actions using child fibers and handle
   completion.
6. Add static verifier and compiler checks that reject suspension paths inside
   sync bytecode actions where they are knowable, including `YIELD`, `AWAIT`,
   `HOST_CALL_ASYNC`, and `ACTION_CALL_ASYNC`.
7. Fault the fiber at runtime if a sync bytecode action still reaches a
   suspension point through a path that was not rejected statically.
8. Add verifier checks for action slots.
9. Add or update VM tests covering host-backed and bytecode-backed action
   paths.

### Likely files

- `packages/core/src/brain/runtime/vm.ts`
- `packages/core/src/brain/interfaces/vm.ts`
- `packages/core/src/brain/runtime/vm.spec.ts`

### Verification

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

---

## Phase 5: Replace Fiber-Global Callsite Vars With Action State

### Goal

Move persistent action state from a fiber-global slot to explicit
action-instance state bound to the current action frame chain and current host
action context.

### Read first

- Architecture spec sections E.4, E.5, E.6, G.3
- current `fiber.callsiteVars` usage and TS compiler assumptions around
  `numCallsiteVars`

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

1. Replace or redefine `fiber.callsiteVars` so state is bound to the current
   action frame chain, not to the whole fiber.
2. Redefine `ExecutionContext` host-state helpers so host-backed actions read
   and write the current action instance, not an ExecutionContext-owned global
   map keyed only by call-site ID.
3. Ensure helper `CALL`s inside an action inherit the same action-state binding.
4. Update page activation so each action callsite gets deterministic state
   creation/reset.
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
- page activation resets action state deterministically

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

---

## Phase 6: Convert User-Authored Tiles To Action Artifacts

### Goal

Remove the runtime wrapper model from `packages/typescript` and publish user
action artifacts that the core linker can bind directly.

### Read first

- Architecture spec sections G and J
- current TS compiler artifact shape, linker, and wrapper runtime files

### In scope

- user action artifact shape
- activation function export shape
- removal of VM-capturing wrapper execution from runtime path
- registration bridge contract changes

### Out of scope

- sim resolver implementation
- app-side brain rebuild behavior
- cleanup of old persistence paths

### Ordered tasks

1. Replace `UserAuthoredProgram` runtime-facing fields with a cleaner action
   artifact shape aligned with the architecture spec.
2. Collapse `initFuncId` plus lifecycle wrapper semantics into a direct
   `activationFuncId` export if possible.
3. Keep `entryFuncId` and `activationFuncId` artifact-local. Do not precompute
   merged-program function indexes inside `packages/typescript`.
4. Remove `createUserTileExec` from the intended runtime path.
5. Change the registration bridge so it publishes tile metadata plus compiled
   action artifacts, not host-function closures.
6. Update compiler and linker tests accordingly.

### Likely files

- `packages/typescript/src/compiler/types.ts`
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

---

## Phase 7: Sim Integration And Brain Rebuild Strategy

### Goal

Wire the sim app into the new resolver model and replace global host-function
mutation with executable-brain invalidation and rebuild.

### Read first

- Architecture spec sections D.5, J, and K
- current sim-side tile registration, compilation, actor brain lifecycle, and
  engine update flow

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
2. Split user tile registration into catalog metadata registration and compiled
   action artifact registration.
3. Implement a sim-side resolver that resolves both built-in and user-authored
   action keys.
4. Update actor/engine brain creation to use the new resolver path.
5. On successful user action recompilation, invalidate executable-brain cache
   entries whose linked action revisions include the changed key at an older
   revision.
6. Replace every active Brain instance using an invalidated executable program.
   Restart the Brain from the same `BrainDef` and same host object; do not
   patch the live VM or scheduler in place.
7. On failed recompilation, keep the last successful action artifacts and keep
   existing active brains running.
8. Add executable-brain caching only if it reduces clear repeated work without
   obscuring correctness.

### Likely files

- `apps/sim/src/brain/tiles/sensors.ts`
- `apps/sim/src/brain/tiles/actuators.ts`
- `apps/sim/src/services/user-tile-registration.ts`
- `apps/sim/src/services/user-tile-compiler.ts`
- `apps/sim/src/services/vscode-bridge.ts`
- `apps/sim/src/brain/actor.ts`
- `apps/sim/src/brain/engine.ts`

### Verification

- recompiling a user tile no longer mutates a global host-function entry
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

- fixing only user-tile registration and forgetting the built-in sim
   sensor/actuator tile registration that now needs `ActionDescriptor`
   construction
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

Delete the obsolete wrapper-oriented path and remove persistence assumptions tied
to the old architecture.

### Read first

- Architecture spec section J
- current sim persistence and user tile registration code

### In scope

- delete no-op host registration for user tiles
- delete swap-in-place host-function behavior
- remove outdated wrapper-oriented docs
- reset or version-bump local persistence

### Out of scope

- further architecture redesign
- state-preserving migration tools

### Ordered tasks

1. Delete no-op host-function registration for user tiles.
2. Delete host-function swap-in-place behavior for user-authored tiles.
3. Remove outdated wrapper-based execution documentation.
4. Reset or version-bump local persistence for brains and user tile metadata.

### Likely files

- `apps/sim/src/services/user-tile-registration.ts`
- `apps/sim/src/services/brain-persistence.ts`
- `docs/specs/features/user-tile-compilation-pipeline.md`
- `docs/specs/features/user-authored-sensors-actuators.md`

### Verification

- no runtime path depends on user tiles being registered as host functions
- local persisted brains from the old model are deliberately invalidated
- docs point to the new action execution architecture as the source of truth

Run:

```sh
cd apps/sim && npm run typecheck && npm run check
cd packages/core && npm run check && npm run build && npm test
cd packages/typescript && npm run typecheck && npm run check && npm test
```

### Stop when

- the old wrapper-oriented runtime path is gone
- persistence has been explicitly reset or invalidated

### Common failure modes

- leaving dead compatibility code behind because it seems harmless
- invalidating persistence implicitly instead of making the reset explicit in
  code and docs

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