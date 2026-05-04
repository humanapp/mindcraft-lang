# TS Brain Runtime Split Plan

Date: 2026-05-03
Status: Stub. Phases not yet authored. Prerequisites in flight (see Prerequisite section).

## Scope And Sibling Specs

This spec covers the **physical code split** of `packages/core/src/brain/brain.ts` into two responsibilities housed in two locations:

- **`packages/core/src/runtime/brain-runtime.ts` (new).** Owns the runtime concerns currently mixed into `Brain`: variable storage, VM and scheduler ownership, ExecutionContext construction, page lifecycle FSM (`think`, `activatePage`, `deactivateCurrentPage`, etc.), activation-hook driver, and page lookup tables consumed at runtime.
- **`packages/core/src/brain/` (existing, narrowed).** Owns the edit/compile concerns: authoring graph (`IBrainDef`, `BrainPage`, `BrainRule`), the compile/link/treeshake pipeline (`compileBrain`, `linkBrainProgram`, `treeshakeProgram`), and the user-facing `Brain` facade that constructs a `BrainRuntime` from a definition.

The end state is that a constrained-target port (Roblox-ts, future MCU C++ port, etc.) can compile against `packages/core/src/runtime/` only and instantiate a `BrainRuntime` directly from a pre-compiled `Program` blob plus a `PlatformServices` aggregate, without ever touching the authoring side of `brain/`.

The complementary work that **enables** this split is:

- [ts-vm-module-decoupling-plan-2026-05-02.md](/docs/.archived/ts-vm-module-decoupling-plan-2026-05-02.md): moved the type boundaries so `runtime/` does not value-import authoring types.
- [ts-vm-dense-runtime-state-plan-2026-05-02.md](/docs/.archived/ts-vm-dense-runtime-state-plan-2026-05-02.md): moves the runtime-visible storage (variable reach-through, callsite host state, action state slots) off the authoring object graph and behind contracted dense surfaces. After D2-D4 of that spec land, the runtime side of `Brain` has zero value-imports of `IBrainRule` / `ActionInstance`.

This spec depends on both being complete. **Do not start this plan until the dense-runtime-state plan ships through D5 (lock-in).** Doing the split before the dense contracts land would force `BrainRuntime` to import authoring types or carry shims, defeating the point.

## Goal

```text
                  edit / compile time                 |             runtime
                                                      |
IBrainDef + services                                  |
        |                                             |
        v                                             |
brain/Brain.fromDefinition()  -- constructs -->       |    runtime/BrainRuntime
        |                                             |        ^
        | (passes Program + PageMetadata +            |        |
        |  PlatformServices + variableNames)          |        |
        +---------------------------------------------+--------+
                                                      |
                                                      |   constrained-target port:
                                                      |   loads pre-compiled Program
                                                      |   blob and constructs
                                                      |   BrainRuntime directly,
                                                      |   never touching brain/
```

The primary seam this spec enforces is **edit/compile vs runtime**, expressed as a physical file boundary. The dependency invariant ("nothing under `packages/core/src/runtime/` value-imports from `packages/core/src/brain/`") is already enforced by the module-decoupling firewall; this spec lifts the *code* across that boundary so the firewall is doing meaningful work, not vacuously passing because there's nothing to import.

## Non-Goals

- No bytecode instruction changes.
- No `ExecutionContext` shape changes (the dense plan owns that).
- No new `PlatformServices` members (the dense plan owns that).
- No host function signature changes.
- No constrained-target port itself; this spec **enables** a port, it does not **perform** one.
- No backward compatibility for the prior `Brain` public surface beyond what the facade preserves. If the facade can preserve the surface cleanly, it does; if a method genuinely belongs only to `BrainRuntime` or only to `BrainCompiler`, callers update.
- No relocation of `BrainPage` / `BrainRule` out of `brain/`. They remain authoring-side objects. Their runtime counterparts are the per-page metadata and per-rule funcId lookups already produced by the compile/link pipeline.

## Prerequisite

The work this spec builds on is:

- The runtime contract pinned in [`vm-contract.md#construction-and-services-boundary`](../core/vm-contract.md#construction-and-services-boundary).
- The module-decoupling plan (M0-M5) shipped: `runtime/` has no value-imports of authoring types; the firewall is green.
- The dense-runtime-state plan (D0-D7, with emphasis on D5's lock-in checkpoint) shipped: every reach-through Brain owned for the runtime is now a contracted op on `ExecutionContext` or `PlatformServices`.

If any prerequisite slips, this spec stops -- do not work around a missing seam by reaching back into `brain/` from the new `BrainRuntime` file.

## Brain Concerns Audit (input to phase decomposition)

`packages/core/src/brain/brain.ts` at the inspection commit holds eight distinct concerns. The split assigns each to one side:

| # | Concern                              | Goes to            | Notes                                                                     |
|---|--------------------------------------|--------------------|---------------------------------------------------------------------------|
| 1 | Authoring graph holder               | `brain/`           | `brainDef`, `pages: List<BrainPage>` constructed from definitions         |
| 2 | Compile/link/treeshake pipeline      | `brain/`           | `initialize()` -> compileBrain, linkBrainProgram, treeshakeProgram        |
| 3 | Variable storage owner               | `runtime/`         | `variables`, `varSlotByName`, `getVariable*`/`setVariable*`/installer     |
| 4 | VM + scheduler ownership             | `runtime/`         | `vm: VM`, `scheduler: FiberScheduler`, lifetime tied to `BrainRuntime`    |
| 5 | ExecutionContext construction        | `runtime/`         | The reach-through closures over variable storage live with the storage   |
| 6 | Page lifecycle FSM                   | `runtime/`         | `think`, `activatePage`, `deactivateCurrentPage`, `cancelActiveFibers`,  `thinkPage`, `requestPageChange*`, `requestPageRestart`, `startup`, `shutdown`, `activeRuleFiberIds` |
| 7 | Activation-hook driver               | `runtime/`         | `runHostActivationHook`, `runBytecodeActivationHook`                      |
| 8 | Page lookup tables                   | `runtime/`         | `pageIdToIndex`, `pageNameToIndex`, `requestPageChangeByPageId`/`ByName` |

Concerns 3, 4, 5, 6, 7, 8 (six of eight) move to `runtime/brain-runtime.ts`. Concerns 1 and 2 stay in `brain/`. The `brain/` side becomes a thin `Brain` facade that constructs a `BrainRuntime` from a definition and forwards the runtime methods that the existing public API exposes.

## Desired End State

- `packages/core/src/runtime/brain-runtime.ts` exists. It is the runtime entry point for compiled Mindcraft programs. Its constructor takes:
  - a linked, treeshaken `Program`,
  - a `List<PageMetadata>`,
  - a `PlatformServices`,
  - a `List<string>` of variable names (used to size and name the variable store),
  - an optional `contextData: unknown`.
- `BrainRuntime` exposes the runtime surface previously on `Brain`: `think(currentTime)`, `startup()`, `shutdown()`, `requestPageChange(pageIndex)`, `requestPageChangeByPageId(pageId)`, `requestPageChangeByName(name)`, `requestPageRestart()`, `getCurrentPageId()`, `getPreviousPageId()`, `setEnabled` / `isEnabled` / `interrupt` / `clearInterrupt` / `isInterrupted`, plus the variable-name-keyed and slot-keyed accessors.
- `packages/core/src/brain/brain.ts` becomes a thin facade. Its surface is unchanged for existing callers (sim, tests). It internally constructs a `BrainRuntime` and forwards method calls.
- The firewall (already green from module-decoupling) remains green: nothing under `runtime/` value-imports anything under `brain/`. After this split, that property is non-vacuous because `runtime/brain-runtime.ts` actually executes.
- A constrained-target port can:
  - skip `brain/` entirely,
  - link `runtime/` only,
  - load a pre-compiled `Program` blob (produced off-target by the TS toolchain),
  - construct a `BrainRuntime` directly,
  - call `think(currentTime)` in a tick loop.

## Sketch Of Phase Decomposition (not yet authored)

Each phase will follow the conventions established by the dense-runtime-state plan: precondition gate, source-paths block with file:line references, numbered procedure with "tree compiles after each step" guarantee, greppable acceptance.

- **B0 -- Decision tables.** Pin per-method placement (BrainRuntime vs Brain facade vs delete). Resolve ambiguities (e.g. does `setEnabled` belong to runtime or facade?). Pin the BrainRuntime constructor signature. Pin whether the facade preserves the existing public surface verbatim or trims dead methods.
- **B1 -- Create `BrainRuntime` skeleton (additions only).** New file under `runtime/`. Empty class with the pinned constructor signature. No callers yet. Tree compiles.
- **B2 -- Move variable storage.** Lift fields and methods 3 from `Brain` into `BrainRuntime`. `Brain` delegates. Tree compiles, tests green.
- **B3 -- Move VM/scheduler ownership and ExecutionContext construction.** Lift concerns 4 and 5. `Brain.initialize()` becomes a `BrainRuntime.initialize()` call. Variable closures now close over `BrainRuntime`, not `Brain`.
- **B4 -- Move page lifecycle FSM and activation hooks.** Lift concerns 6 and 7. This is the largest single phase by line count.
- **B5 -- Move page lookup tables.** Lift concern 8.
- **B6 -- Reduce `Brain` to a facade.** Concerns 1 and 2 stay; everything else delegates to a held `BrainRuntime`. Public surface preserved.
- **B7 -- Lock-in.** Greppable acceptance: nothing under `brain/` is reachable from `runtime/`; `BrainRuntime` is constructible without any authoring imports; demonstration test constructs `BrainRuntime` from a serialized `Program` blob without going through `compileBrain`.
- **B8 -- Document the split in `vm-contract.md`.** Add a section pinning the BrainRuntime constructor signature, the runtime surface, and the firewall guarantee.

## Workflow Convention

Same as the dense-runtime-state plan: phases ship one at a time; the agent stops after implementation; the user declares phase complete; a post-mortem unit writes the Phase Log entry and the repo memory note.

## Notes

- The `Brain` facade preserved in B6 may itself be retired in a future plan if/when callers (sim, tests, vscode-bridge) migrate to constructing `BrainRuntime` directly. That retirement is not in scope here.
- The split is structural, not behavioral. Every test that passed before B0 must still pass after B7 with no semantic change. Tests that exercise authoring + runtime together continue to use the `Brain` facade; tests that exercise runtime only may switch to `BrainRuntime` directly.

## Current State

Stub. No phases authored. No work begun. Awaits dense-runtime-state plan completion through D5.
