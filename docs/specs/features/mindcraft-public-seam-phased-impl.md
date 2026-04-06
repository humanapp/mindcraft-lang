# Mindcraft Public Seam -- Phased Implementation Plan

Reshape the public integration seams of `@mindcraft-lang/core` and
`@mindcraft-lang/bridge-app` so Mindcraft-enabled apps can compose the runtime,
user-authored tile compilation, and bridge connectivity without depending on
global registries, concrete runtime classes, or low-level transport objects.

Companion design doc: [mindcraft-seam-design.md](mindcraft-seam-design.md).
Companion requirements doc: [mindcraft-public-seam-requirements.md](mindcraft-public-seam-requirements.md).

Depends on infrastructure from:
- [brain-action-execution-architecture.md](brain-action-execution-architecture.md)
  (runtime linking model and user action artifact flow)
- [user-tile-compilation-pipeline.md](user-tile-compilation-pipeline.md)
  (bridge-backed compiler flow in sim)
- [diagnostics-bridge-pipeline.md](diagnostics-bridge-pipeline.md)
  (current diagnostic transport path)
- [vscode-authoring-debugging.md](vscode-authoring-debugging.md)
  (bridge architecture and extension/app pairing model)
- `packages/core`, `packages/bridge-app`, `packages/bridge-client`, and
  `packages/ts-compiler`

---

## Status

As of 2026-04-05, Phases S1-S3 are complete. Phases S4-S7 remain open.

The codebase now exposes the new package-level runtime/compiler/presentation
seam, while bridge and real-app migration work remains outstanding:

- `@mindcraft-lang/core` now supports `createMindcraftEnvironment()`,
  `coreModule()`, environment-owned catalogs, environment-scoped brain
  deserialization, startup tile hydration, compiled action bundle replacement,
  and runnable `MindcraftBrain` instances without requiring apps to touch the
  singleton seam.
- `@mindcraft-lang/ts-compiler` now exposes `buildCompiledActionBundle()` for
  the new runtime-facing authored-action path.
- `@mindcraft-lang/ui` now supports app-owned tile-presentation resolution
  through editor config instead of relying on process-global core tile-visual
  mutation in the normal path.
- Legacy core globals still exist as secondary migration paths, and some
  internal core code still depends on a tightly scoped environment-owned
  services context via `runWithBrainServices(...)`.
- `@mindcraft-lang/bridge-app` integration is still centered on `AppProject`,
  and `apps/sim` still depends on deep imports, synthetic import events, and
  app-owned compiler/runtime glue.

---

## Workflow Convention

Same loop as the other phased implementation plans in this directory.
Phases here are numbered S1-S7.

1. **Kick off** -- "Implement Phase S1." The implementer reads this doc, the
   relevant specs, and any relevant instruction files before writing code.
   After implementation, STOP and present the work for review. Do not write the
   Phase Log entry, amend the spec, update the Current State section, or
   perform any post-mortem activity.
2. **Review + refine** -- Followup prompts within the same conversation.
3. **Declare done** -- "Phase S1 is complete." Only the user can declare a
   phase complete. Do not move to the post-mortem step until the user requests
   it.
4. **Post-mortem** -- "Run post-mortem for Phase S1." This step:
   - Diffs planned deliverables vs what was actually built.
   - Reviews the phase's prospective `Requirements addressed` section before
     closing the phase.
   - Records the outcome in the Phase Log (bottom of this doc). The Phase Log
     is a post-mortem artifact -- never write it during implementation.
   - Records a `Requirements retrospective` subsection in the Phase Log using
     the planned requirement list as the baseline, for example:
     - `FR-<id>: satisfied as planned`
     - `FR-<id>: partially satisfied (<what was actually covered>; remaining work carries to Phase S<n>)`
     - `FR-<id>: not addressed (deferred to Phase S<n> -- <reason>)`
   - Uses the same retrospective format for any `NFR-<id>` or `INV-<id>` items
     that were listed in the phase's prospective `Requirements addressed`
     section.
   - Ensures every prospectively listed requirement that was not fully
     satisfied names the phase that now owns the remaining work.
   - Amends upstream specs with dated notes if they were wrong or
     underspecified.
   - Propagates discoveries to upcoming phases in this doc (updated risks,
     changed deliverables, new prerequisites).
   - Writes a repo memory note with key decisions for future conversations.
5. **Next phase** -- New conversation (or same if context is not exhausted).

The planning doc is the source of truth across conversations. Session memory
does not survive. Keep this doc current.

Requirement references in this plan should follow the IDs in
[mindcraft-public-seam-requirements.md](mindcraft-public-seam-requirements.md).
When a new requirement is inserted between existing entries, it is acceptable
to use a fractional ID such as `FR-2.5` rather than renumbering the rest of the
document.

The `Requirements retrospective` is append-only. Once a phase is closed and its
retrospective is written to the Phase Log, do not edit that retrospective in a
later phase. Any newly discovered drift should be recorded in the later phase's
own retrospective and carry-forward notes.

---

## Non-Goals

This plan does **not** aim to:

- redesign the bridge protocol message shapes
- change bytecode or VM semantics
- change the functional behavior of the compiler pipeline
- preserve old public seams purely for backward compatibility

The first goal is a clean new seam, not artificial continuity with legacy API
shapes.

If S2 reveals that Roblox constraints distort the app-facing API, we may
introduce a thin node/browser facade package; that decision is deferred.

There are currently no external compatibility constraints on this work. If a
breaking API cleanup is the cleanest path, that is acceptable. Temporary
adapters or shims are only justified when they reduce implementation risk or
help stage the migration of internal call sites such as sim.

Any temporary shim or adapter introduced during this work must have an explicit
removal point. By the end of this plan, temporary shims/adapters should no
longer exist in the codebase unless they have been consciously promoted into a
permanent, intentional API.

For this plan, compatibility-only legacy fallback shims are not eligible for
promotion. They must be removed by the owning cleanup phase rather than kept as
permanent back-compat seams.

---

## Current State

(2026-04-05)

### Core integration seam

- `packages/core/src/mindcraft.ts` now implements
  `createMindcraftEnvironment()`, `coreModule()`, `MindcraftCatalog`,
  `MindcraftBrain`, environment-scoped brain deserialization,
  `replaceActionBundle(...)`, `onBrainsInvalidated(...)`, and
  `rebuildInvalidatedBrains(...)`.
- `packages/core/src/index.ts` exports `createMindcraftEnvironment` and
  `coreModule` at the root package surface while preserving the existing
  `import { brain, ... } from "@mindcraft-lang/core"` shape.
- `packages/core/src/brain/index.ts` still exposes
  `registerCoreBrainComponents()` as a legacy compatibility seam, but it now
  installs through the same explicit-service registration path used by
  `coreModule()`.
- `packages/core/src/brain/services.ts` still stores a default global
  `BrainServices` instance for legacy callers, but shared core code can now also
  resolve an environment-owned active services context via
  `peekBrainServices()` / `runWithBrainServices()`.

### Registration machinery reality

- `registerCoreRuntimeComponents()` and `registerCoreTileComponents()` now
  accept explicit `BrainServices`, and their lower-level leaf registrars no
  longer depend on an already-populated default global services instance.
- Some deeper model/type-system/catalog code still reaches services through the
  scoped active-services context rather than full constructor injection. That is
  now a deliberate internal mechanism for the environment path, not just an
  install-time migration bridge.
- `coreModule()` installs through a structural install-time services accessor
  rather than a concrete `EnvironmentModuleApi` identity check.
- The effective catalog chain is now explicitly ordered as shared -> hydrated
  fallback -> bundle -> overlay -> brain-local so first-match lookup preserves
  pre-S2 behavior under duplicate IDs, even though duplicate IDs are not a
  supported override mechanism.

### Bundle and hydration behavior

- `MindcraftEnvironment.replaceActionBundle(...)`,
  `hydrateTileMetadata(...)`, `onBrainsInvalidated(...)`, and
  `rebuildInvalidatedBrains(...)` now exist in `packages/core` and are covered
  by package tests.
- Managed brains track linked bundle action revisions and invalidate
  selectively; rebuilds preserve the stable `MindcraftBrain` handle.
- The first successful bundle replacement clears the hydrated fallback catalog
  as it installs fresh bundle tiles.
- Persisted-brain deserialization now resolves against shared, hydrated,
  bundle, overlay, and brain-local catalogs in both JSON and binary paths.
- Hydrated and bundle-owned semantic catalogs bypass the legacy global visual
  provider when storing tiles.

### Compiler and presentation seam

- `packages/ts-compiler/src/runtime/action-bundle.ts` now builds whole-snapshot
  `CompiledActionBundle` values from `ProjectCompileResult`, dedupes shared
  parameter tiles, and returns `undefined` when diagnostics or unresolved
  parameter metadata block safe bundle emission.
- `packages/ts-compiler/src/index.ts` now exposes
  `buildCompiledActionBundle()` at the root package surface; the older
  singleton-registration bridge remains a legacy internal path rather than the
  primary exported integration seam.
- `HydratedTileMetadataSnapshot` and `CompiledActionBundle` are now separate
  public contracts even though they currently share `revision` and `tiles`
  fields.
- `packages/ui/src/brain-editor/BrainEditorContext.tsx` now supports
  app-owned `resolveTileVisual(...)` lookup, and
  `packages/ui/src/brain-editor/tile-visual-utils.ts` centralizes label/icon
  fallback so tile presentation stays in UI/app code rather than semantic core
  catalogs.

### Bridge-app integration seam

- `packages/bridge-app/src/app-project.ts` subclasses the low-level
  `Project<TClient, TServer>` class from `bridge-client`.
- `AppProject` hardcodes the `"app"` websocket path and join-code handling,
  but still exposes `session`, `files`, `compilation`, and
  `onRemoteFileChange()` to consumers.
- Optional compilation transport currently lives in the root bridge-app public
  surface via `CompilationProvider`, `CompilationResult`, and
  `CompilationManager`.
- The current API shape makes app code reason about both the domain seam and
  transport internals at the same time.

### Sim as proof of the remaining migration work

- `apps/sim/src/bootstrap.ts` still calls `registerCoreBrainComponents()`,
  `registerBrainComponents()`, `registerUserTilesAtStartup()`, and
  `initProject()` during bootstrap, but no longer uses
  `setTileVisualProvider()` in the normal startup path.
- `apps/sim/src/brain-editor-config.tsx` now supplies
  `resolveTileVisual: genVisualForTile`, so sim presentation is app-owned even
  though the runtime path is not yet migrated.
- `apps/sim/src/services/brain-runtime.ts` still imports the concrete `Brain`
  class, uses `getBrainServices()` to build catalogs and resolve host actions,
  and still owns app-side active-brain bookkeeping that later phases should
  migrate to `MindcraftEnvironment`.
- `apps/sim/src/services/user-tile-registration.ts` still directly mutates tile
  and type registries through `getBrainServices()` and persists startup tile
  metadata outside the new bundle seam.
- `apps/sim/src/services/vscode-bridge.ts` still constructs `AppProject`,
  reaches through transport internals, and injects generated compiler inputs
  into the raw bridge-owned filesystem snapshot.

### Import-shape symptoms

The current sim app imports from all of these shapes:

- `@mindcraft-lang/core`
- `@mindcraft-lang/core/brain`
- `@mindcraft-lang/core/brain/model`
- `@mindcraft-lang/core/brain/runtime`
- `@mindcraft-lang/core/brain/tiles`
- `@mindcraft-lang/bridge-app`
- `@mindcraft-lang/ts-compiler`

Those subpaths are not inherently wrong, but they indicate that the top-level
integration seam is not carrying enough semantic weight.

### Core multi-target constraint

`@mindcraft-lang/core` is not just a browser/node package. It is a multi-target
project that builds for:

- Node.js
- ESM/browser
- Roblox-TS / Luau

That matters for this seam redesign because Roblox-TS imposes constraints that
are much stricter than ordinary TypeScript-on-Node or TypeScript-in-the-browser.
The redesign must treat those constraints as first-class design inputs, not as a
late validation step.

This constraint applies to `packages/core` itself, and to any public contracts
that cross into or are consumed by `packages/core`. It does **not** mean that
`@mindcraft-lang/ts-compiler`, `@mindcraft-lang/bridge-app`, or
`@mindcraft-lang/bridge-client` are Roblox-targeted packages. Those packages
remain node/browser-oriented. The design requirement is that they must not force
`packages/core` into a JS-only public seam.

Important implications:

- shared core code cannot assume Node-only or browser-only APIs
- `packages/core` public API changes must continue to compile through the Roblox
  target, not just type-check in the node/esm targets
- some ordinary TypeScript patterns are invalid or fragile under Roblox-TS,
  including use of the global `Error`, `typeof` checks in shared code,
  `globalThis`, and Luau-reserved identifiers
- some platform abstractions rely on the `.ts` + `.node.ts` + `.rbx.ts`
  implementation pattern, so seam changes must not accidentally bypass or break
  that structure

- the root `@mindcraft-lang/core` export shape used by Roblox application code
  must remain valid, especially:
  - `import { brain, List, logger } from "@mindcraft-lang/core"`
  - destructuring from `brain`
  - namespace traversal like `brain.compiler` and `brain.tiles`

For this reason, any phase that touches `packages/core` must treat the Roblox
build as a primary correctness gate, not a compatibility afterthought.

That includes the registration machinery refactor. A solution that only changes
the top-level bootstrap API while the real registration leaves still depend on
ambient globals is not finished.

---

## Target End State

The final integration story should support three clean adoption tiers.

### 1. Core-only app

```ts
import { createMindcraftEnvironment, coreModule } from "@mindcraft-lang/core";

const environment = createMindcraftEnvironment({
  modules: [coreModule(), createAppModule()],
});

const brain = environment.createBrain(brainDef, {
  context: actor,
});

brain.startup();
brain.think(now);
```

### 2. Core + TypeScript-authored tiles

```ts
import { createMindcraftEnvironment, coreModule } from "@mindcraft-lang/core";
import { createWorkspaceCompiler } from "@mindcraft-lang/ts-compiler";

const environment = createMindcraftEnvironment({
  modules: [coreModule(), createAppModule()],
});

const compiler = createWorkspaceCompiler({ environment });
const snapshot = compiler.compile();

const update = environment.replaceActionBundle(snapshot.bundle);
if (update.invalidatedBrains.length > 0) {
  scheduleBrainRebuild();
}
```

### 3. Core + compiler + VS Code bridge

```ts
import { createAppBridge } from "@mindcraft-lang/bridge-app";
import { createCompilationFeature } from "@mindcraft-lang/bridge-app/compilation";
import { createWorkspaceCompiler } from "@mindcraft-lang/ts-compiler";

const compiler = createWorkspaceCompiler({ environment });

const bridge = createAppBridge({
  app: { id: "sim", name: "Sim", projectId: "sim-default", projectName: "Sim" },
  bridgeUrl,
  workspace,
  features: [createCompilationFeature({ compiler })],
});

bridge.start();
```

### Package responsibility split

`@mindcraft-lang/core` owns:

- language model
- runtime
- compiler for tile brains
- module definition and environment-construction-time installation
- action bundle contract consumed by the runtime

`@mindcraft-lang/ts-compiler` owns:

- TypeScript project compilation
- diagnostics
- compiled user action bundles that core can consume

`@mindcraft-lang/bridge-app` owns:

- app-facing bridge lifecycle
- workspace sync
- join-code management
- optional bridge features attached through composition

`@mindcraft-lang/bridge-client` owns:

- low-level websocket and request/response plumbing
- filesystem sync primitives
- transport-oriented project/session internals

---

## Architecture Strategy

This redesign should be clarity-first and staged for implementation risk.

1. Define the new public seams first.
2. Implement them in the cleanest practical way, using adapters over existing
  internals only where that materially reduces risk.
3. Migrate `apps/sim` to prove the seam against a real app.
4. After the new path is proven, remove or sharply narrow the old path unless a
  specific internal use still justifies keeping part of it.

That sequencing keeps the risk in control and prevents the seam redesign from
turning into a stop-the-world rewrite.

### Core-specific implementation rule

Any seam work inside `packages/core` must preserve all three core targets:

- node
- esm
- rbx

In practice, this means:

- prefer explicit classes/interfaces over clever runtime metaprogramming
- avoid new shared-code dependencies on JS runtime facilities that do not map
  cleanly to Roblox-TS
- keep public contract types and implementation structure compatible with the
  existing platform-file pattern where needed
- validate each core-touching phase with the full `packages/core` build, not
  just type-checking

This rule is scoped to work that changes `packages/core` or the contracts that
`packages/core` exports/consumes. It does not imply that `packages/ts-compiler`
or the bridge packages must themselves become multi-target builds.

---

## Phase S1: Public contract layer and export map stabilization

**Objective:** Introduce the names, package entrypoints, and high-level public
contracts for the new seam without changing the underlying behavior yet or
forcing the facade-package decision prematurely.

**Packages/files touched:**

- `packages/core/src/index.ts`
- new public API files in `packages/core/src/`
- `packages/core/package.json` export map if subpaths are added
- `packages/bridge-app/src/index.ts`
- new public API files in `packages/bridge-app/src/`
- `packages/bridge-app/package.json` export map if subpaths are added

**Concrete deliverables:**

1. Add top-level core public contract types for the new seam:
   - `MindcraftEnvironment`
  - `MindcraftCatalog`
  - `HydratedTileMetadataSnapshot`
   - `MindcraftModule`
   - `MindcraftModuleApi`
   - `CreateBrainOptions`
   - `CompiledActionBundle`
  - ensure `MindcraftModuleApi` includes a distinct runtime function
    registration path in addition to operator registration
2. Add top-level bridge-app public contract types for the new seam:
   - `AppBridge`
   - `AppBridgeOptions`
   - `AppBridgeSnapshot`
   - `WorkspaceAdapter`
   - `AppBridgeFeature`
  - `AppBridgeFeatureContext`
  - `AppBridgeFeatureStatus`
3. Add a new bridge-app compilation subpath contract:
   - `WorkspaceCompiler`
   - `DiagnosticSnapshot`
   - `createCompilationFeature(...)`
4. Lock the naming and export-map story before deeper refactors begin.
5. Add minimal tests that verify the new symbols export cleanly and can be
   imported without reaching into old subpaths.
6. Confirm that any new `packages/core` export-map or file-layout changes do not
  conflict with the node/esm/rbx package shape.
7. Preserve the existing Roblox-facing root import shape of `@mindcraft-lang/core`,
  including the `brain` namespace export and `brain.compiler` /
  `brain.tiles` access pattern.

**Notes:**

- Phase S1 is intentionally shallow. It defines the public seam first so later
  phases can refactor internals without renaming the API every step.
- The new contracts should avoid leaking `BrainServices`, `ProjectSession`,
  `ProjectFiles`, or concrete tile-definition classes.
- S1 should avoid speculative public surface area that is not required by the
  extracted requirements, especially runtime module handles/uninstall and
  incremental authored-action mutation APIs.
- `MindcraftModuleApi` must model callable runtime functions separately from
  operators. Core built-ins such as element/index access helpers, map
  operations, math functions, and string methods currently register through the
  function registry, not the operator table.
- S1 should make it clear that default ambient generation stays in
  `@mindcraft-lang/ts-compiler` and will stop depending on
  `getBrainServices()` once registry ownership becomes environment-scoped.
- S1 should lock the public vocabulary and avoid speculative packaging work.
- S1 should also explicitly decide which legacy exports will be retained
  temporarily for internal migration only, and which can be removed outright.

**Risks:**

- Premature naming churn. If the public names are unstable, later phases become
  expensive. Keep S1 focused on the smallest useful API vocabulary.

**Common failure modes:**

- S1 defines names that still leak `BrainServices`, `ProjectSession`,
  `ProjectFiles`, or other low-level internals into the new seam.
- S1 omits runtime function registration from `MindcraftModuleApi` and
  implicitly treats callable built-ins as operators even though they live in a
  separate function registry.
- S1 leaves the ambient-generation dependency story vague, so later work either
  falls back to `getBrainServices()` again or pushes TypeScript-specific
  declaration generation into core.
- S1 introduces provisional aliases or export shims without clear ownership or
  a removal plan.
- S1 accidentally breaks or de-emphasizes the required Roblox import shape from
  `@mindcraft-lang/core`, especially the `brain` namespace export.

### Requirements addressed

- `FR-1`: partially satisfied (runtime-only seam names and top-level imports are
  defined; implementation is deferred to Phase S2 and real-app proof to
  Phase S6)
- `FR-2`: partially satisfied (compiler seam vocabulary and bundle contract
  names are defined; bridge-free compiler/runtime implementation is deferred to
  Phase S3)
- `FR-3`: partially satisfied (bridge-only public contract vocabulary is
  defined; implementation is deferred to Phase S4)
- `FR-4`: partially satisfied (cross-package seam vocabulary is aligned;
  composed compiler+bridge flow is deferred to Phase S5 and real-app proof to
  Phase S7)
- `FR-5`: partially satisfied (recommended public boundaries are named without
  legacy internals, including a distinct module-level runtime function
  registration path; concrete migration and cleanup are deferred to Phases S2-S7)
- `FR-18`: partially satisfied (the bridge lifecycle surface is named;
  concrete behavior is deferred to Phase S4)
- `FR-22`: partially satisfied (the feature capability surface is named; real
  feature proof is deferred to Phase S5)
- `FR-23`: partially satisfied (diagnostic/status publication hooks are named
  in the contract layer; implementation is deferred to Phase S5)
- `FR-25`: partially satisfied (the contract layer names environment-owned
  registry state as the source of default ambient generation; implementation is
  deferred to Phase S2 and ts-compiler consumption to Phase S5)
- `NFR-3`: partially satisfied (the root import shape is preserved in the
  public contract layer; runtime coexistence with the new core seam is deferred
  to Phase S2)
- `NFR-6`: partially satisfied (the intended standard path is named; final
  demotion of legacy seams is deferred to Phase S7)
- `NFR-7`: partially satisfied (the adoption-tier vocabulary is established;
  final public guidance is deferred to Phase S7)
- `INV-5`: partially satisfied (bridge and compilation are modeled as separate
  optional layers; concrete implementation is deferred to Phases S4-S5)
- `INV-6`: partially satisfied (advanced paths are secondary in the contract
  story; final legacy demotion is deferred to Phase S7)

---

## Phase S2: Environment-scoped core runtime and constructor-time module installation

**Objective:** Make the new core integration path environment-scoped rather than
process-global, with legacy globals retained only if they still reduce internal
migration risk.

This is not a wrapper phase. S2 must make the core registration machinery
environment-aware in a real way.

**Prerequisites:** Phase S1.

**Packages/files touched:**

- `packages/core/src/index.ts`
- `packages/core/src/brain/index.ts`
- `packages/core/src/brain/services.ts`
- `packages/core/src/brain/services-factory.ts`
- new environment/module implementation files in `packages/core/src/`
- runtime/linking files as needed for environment-scoped brain creation

**Concrete deliverables:**

1. Implement `createMindcraftEnvironment()` backed by a private environment
   state container instead of the process-global singleton.
2. Implement `coreModule()` as the environment-construction-time replacement for
   `registerCoreBrainComponents()`.
3. Keep module installation constructor-time only in v1:
  - supply modules through `createMindcraftEnvironment({ modules: [...] })`
  - do not expose a public runtime install/uninstall or module-handle surface
   unless a concrete product need appears during implementation
4. Add `environment.createCatalog()` and `environment.createBrain(...)`.
5. Ensure the value returned by `createBrain(...)` is the runnable app-facing
   brain surface, not a lifecycle-only token:
  - apps can tick it through the supported seam
  - apps can inspect runtime state they currently need, such as program/page
   state, compiled program, execution context, and scheduler state
  - apps do not need the concrete `Brain` class to use created brains
6. Ensure one `BrainDef` can be reused to create many independent runnable
   brains:
  - repeated `createBrain(sharedDef, ...)` calls produce distinct runtime
   instances
  - those instances do not share variables, page state, scheduler state,
   execution-context state, or linked-action revision tracking
  - apps can choose when to replace live instances after a definition change;
   existing instances are not silently collapsed into one shared runtime
7. Route host action resolution, built-in function registration, and catalog
  composition through the environment rather than through
  `getBrainServices()` in the new path.
8. Define the catalog model explicitly:
  - `createCatalog()` returns an empty app-owned overlay catalog
  - module-installed tiles live in environment-shared catalog state
  - startup-hydrated fallback tiles live in an environment-managed semantic
    hydration catalog
  - `brainDef.catalog()` remains a brain-local catalog included automatically
   by `createBrain(...)`
  - environment-owned and overlay catalogs use `TileCatalog` internally, or a
    direct successor that preserves the same distributed-ownership
    `serialize` / `deserialize` and `toJson` / `fromJson` protocol
  - `BrainDef -> catalog()` remains the owner of per-brain tile serialization;
    `MindcraftCatalog` is a public contract over that implementation, not a
    separate storage model
  - duplicate tile IDs across the effective catalog set are not a normal
   override mechanism to rely on
9. Define the persisted-brain deserialization seam so normal brain loading no
  longer hardcodes a process-global tile catalog:
  - either add an environment-scoped deserialize/load helper, or
  - thread environment-shared catalogs into the model-layer deserializers used
    by normal app startup
10. Decide explicitly whether legacy singleton-oriented APIs are:
  - removed outright in this phase, or
  - retained temporarily as thin migration shims over the new environment.
11. Add tests proving that two environments can coexist without leaking types,
  functions, tiles, actions, or operator registrations into each other.
12. Validate that the environment implementation is Roblox-safe in shared core
   code: no Node/browser-only assumptions, no forbidden shared-code constructs,
   and no breakage of the existing platform abstraction pattern.
13. Ensure the new seam coexists with the preserved root export shape so Roblox
  consumers can continue using `import { brain, List, logger } from
  "@mindcraft-lang/core"`.
14. Adopt explicit context threading through the registration call tree as the
  target architecture for core registration.
15. If a tightly scoped services context is used at all, document it as
  an internal environment/module mechanism, define its invariants clearly, and
  avoid describing its removal as an implied S2 cleanup requirement.
  - if a later deeper refactor removes it, that should be treated as separate
    follow-on work rather than as a hidden acceptance criterion for this phase
16. Refactor `registerCoreRuntimeComponents()`,
   `registerCoreTileComponents()`, and their transitive leaf registrations so
  module installation no longer depends on an already-populated default global
  services instance.
  - this includes the distinct function-registry leaves behind
    `registerElementAccessBuiltins()`, `registerMapBuiltins()`,
    `registerMathBuiltins()`, and `registerStringBuiltins()`
17. Introduce an internal registration context type if useful
   (`CoreRegistrationContext`, similar naming, or equivalent) so leaf
   registrations do not have to consume the public `MindcraftModuleApi`
   directly. The public API and the internal wiring do not need to be the same
   object.
18. Make the environment-owned registry state available to core-adjacent
  compiler tooling without going through `getBrainServices()` or a process-
  global singleton. This does not require a new public description type in v1.

**Notes:**

- The critical success condition for S2 is that a new app can use the new core
  API without touching the singleton seam.
- V1 should stop at constructor-time module installation unless real product
  pressure appears. A dynamic module lifecycle can be added later if it becomes
  necessary, but it should not be paid for up front.
- A good S2 result also makes catalog ownership obvious: environment-shared
  tiles, startup-hydrated fallback tiles, app-owned overlay catalogs, and
  automatic brain-local catalogs should each have a clear role.
- A good S2 result also preserves the existing distributed-ownership
  serialization chain for per-brain tiles. Narrowing the public catalog
  interface must not break `BrainDef -> catalog() -> tile defs` round-tripping.
- A good S2 result also makes runtime callable ownership obvious: operators stay
  in the operator table, while callable built-ins register through the distinct
  function-registry path exposed by `MindcraftModuleApi.registerFunction(...)`.
- A good S2 result also makes tooling ownership obvious: `@mindcraft-lang/core`
  owns the environment-scoped registries, while `@mindcraft-lang/ts-compiler`
  owns TypeScript-specific ambient declaration rendering.
- Existing deep subpaths or singleton helpers do not need to be preserved unless
  they still earn their keep during internal migration.
- A good S2 result may still use an internal helper context, but it cannot leave
  the registration tree fundamentally dependent on `getBrainServices()` as an
  implicit install target.
- `MindcraftModuleApi` is the public abstraction. Internally, the implementation
  should adapt it into a narrower registration context rather than threading the
  full public API through every registration leaf.

**Risks:**

- `packages/core` is multi-target (node, esm, rbx). Any environment-scoped
  implementation must preserve the current cross-platform constraints.
- Roblox-TS is the hardest target, not the easiest one. A design that looks
  clean in node/esm but requires JS-only runtime tricks is not acceptable.
- Temporary migration shims must not silently reintroduce global leakage into
  the new path if they are kept at all.

**Common failure modes:**

- The new environment API is just a thin wrapper over the old singleton model,
  so the real dependency shape does not actually improve.
- Shared core implementation starts depending on Node/browser-only behavior and
  only fails later in the Roblox build.
- A temporary default-environment shim becomes the de facto permanent path.
- Legacy singleton helpers remain after their internal migration role is over.
- The environment refactor requires Roblox consumers to switch away from the
  root `brain` namespace import pattern.
- S2 exposes a public runtime module lifecycle even though the current
  requirements only justify constructor-time installation.
- Built-in functions are still misclassified as operators, or still require
  hidden `getBrainServices().functions` access because `MindcraftModuleApi`
  never gained a distinct function-registration path.
- Ambient generation still has to read `getBrainServices()` because the
  environment-scoped registry state was never made available to compiler
  tooling.
- `MindcraftCatalog` gets backed by a new ad hoc storage model instead of
  `TileCatalog` (or a compatible successor), so `BrainDef` no longer preserves
  the existing catalog-owned binary/JSON serialization chain.
- `createCatalog()` ends up as a snapshot or alias of the environment's shared
  tiles, so overlay vs shared catalog ownership is still muddy.
- Persisted-brain deserialization still resolves against a default global tile
  catalog because no environment-scoped load path was ever defined.
- Callers still have to pass `brainDef.catalog()` through
  `CreateBrainOptions` because automatic brain-local catalog composition was
  never made explicit.
- `createBrain(...)` returns a lifecycle-only handle, so apps still need the
  concrete `Brain` runtime class to tick or inspect created brains.
- Multiple `createBrain(...)` calls with the same `BrainDef` end up sharing one
  runtime instance or one mutable runtime-state bag, so archetype-style reuse no
  longer works.
- Only the top-level bootstrap function changes, while the real registration
  leaf functions still depend on `getBrainServices()` and a default global.
- The scoped services context becomes an unbounded implicit dependency again,
  so environment ownership or isolation starts depending on hidden global
  behavior.

### Requirements addressed

- `FR-1`: partially satisfied (the core runtime-only seam is implemented at the
  package level; real-app proof is deferred to Phase S6 and final product
  guidance to Phase S7)
- `FR-5`: partially satisfied (normal core integration no longer depends on
  singleton-oriented APIs, including the hidden function registry; bridge-side
  cleanup is deferred to Phases S4-S7)
- `FR-25`: partially satisfied (core owns the environment-scoped registry state
  that default ambient generation depends on; ts-compiler consumption is
  deferred to Phase S5 and real-app proof to Phases S6-S7)
- `FR-6`: partially satisfied (environment isolation covers registrations and
  created brains; bundle-update isolation is deferred to Phase S3)
- `FR-7`: partially satisfied (environment-shared, app overlay, and brain-local
  catalog roles are implemented; hydrated and bundle-authored tile roles are
  deferred to Phase S3)
- `FR-8`: partially satisfied (load/link resolution covers shared, overlay, and
  brain-local sources; hydrated and compiled authored metadata are deferred to
  Phase S3)
- `FR-14`: partially satisfied (the stable runnable brain handle is introduced;
  rebuild/disposal tracking against authored-action invalidation is deferred to
  Phase S3)
- `FR-15`: partially satisfied (independent runtime instances from a shared
  `BrainDef` are implemented; archetype-style real-app proof is deferred to
  Phase S6)
- `NFR-1`: partially satisfied (the core environment seam and registration
  refactor remain compatible with core targets; bundle-contract work is deferred
  to Phase S3 and real-app proof to Phase S6)
- `NFR-2`: partially satisfied (shared runtime-facing environment logic avoids
  node/browser-only assumptions; bundle consumption work is deferred to
  Phase S3)
- `NFR-3`: fully satisfied
- `NFR-5`: partially satisfied (explicit brain lifecycle starts here;
  invalidation/disposal correctness completes in Phase S3)
- `INV-1`: partially satisfied (the catalog model establishes no-shadowing as
  the normal rule; hydrated/bundle handoff behavior is deferred to Phase S3)

---

## Phase S3: Compiled action bundle seam and tile presentation decoupling

**Objective:** Turn user-authored action integration into a narrow core contract
and remove process-global tile presentation from the new integration path.

**Prerequisites:** Phase S2.

**Packages/files touched:**

- `packages/core/src/`
- runtime/action-linking files in `packages/core/src/brain/runtime/`
- `packages/ts-compiler/src/`
- UI/app integration code that currently depends on `setTileVisualProvider()`

**Concrete deliverables:**

1. Implement `environment.replaceActionBundle(bundle)` as the public
  invalidating operation, not an eager rebuild operation.
  - removal of authored actions is represented by omission from the next full
    replacement bundle, not by a second public incremental mutation API
2. Define the environment-owned brain lifecycle for this path:
  - the environment tracks brains it creates
  - each tracked brain records linked action revisions from its last successful
   link/rebuild
  - `dispose()` removes a brain from tracking
3. Add an explicit invalidation notification and rebuild seam such as
  `onBrainsInvalidated(...)` plus `rebuildInvalidatedBrains(...)` or an
  equivalent brain-level rebuild API so apps can control when rebuild work
  runs.
  - successive `replaceActionBundle(...)` calls must accumulate invalidation in
    the environment until brains are rebuilt or disposed
  - `rebuildInvalidatedBrains()` with no arguments must rebuild the full
    current invalidation set at call time
  - deferred schedulers must be able to use the no-args form instead of
    relying on a previously captured `invalidatedBrains` array
4. Define `HydratedTileMetadataSnapshot` and
  `environment.hydrateTileMetadata(snapshot)` as the pre-compiler startup path
  for semantic tile hydration.
5. Define the exact core contract for a `CompiledActionBundle` so
   `@mindcraft-lang/ts-compiler` can produce data that the core runtime can
   consume without app-owned side maps.
6. Define how startup-hydrated tiles and `CompiledActionBundle.tiles` project
  into environment-owned shared catalog state, including the handoff from
  fallback hydration to fresh compiler-owned bundle state.
7. Define `CompiledActionBundle` as a whole-snapshot contract, not an
   incremental diff contract:
  - every successful bundle emission contains the complete authored tile set
    needed for the bundle-managed domain
  - shared semantic tiles such as parameter tiles remain present even when only
    some authored actions changed
  - bundle replacement does not rely on compiler-side tile ref-count deltas or
    partial tile emissions to preserve correctness
8. Add a compiler-side adapter or helper that maps project compile output into
   the bundle contract.
9. Remove `setTileVisualProvider()` from the normal integration path and define
   the minimum viable non-global presentation story needed by the first real
   consumer:
  - prefer an app/UI-owned presentation map/provider if presentation lookup is
    only needed in UI/editor code
  - do not introduce a new public core resolver/registry type unless S3 proves
    that non-UI consumers need tile-presentation lookup by ID
  - if a dedicated lookup seam is required, S3 must define who creates it, who
    owns it, and how it composes with one environment without leaking across
    contexts
10. Decide whether `setTileVisualProvider()` is still worth keeping as a
  temporary migration shim or whether this phase should remove it from the
  primary integration path entirely.
11. Add tests covering bundle replacement, authored-action removal by omission
  from a later bundle snapshot, startup hydration, persisted-brain
  deserialization against hydrated tiles, selective
  invalidation, deferred rebuild scheduling, disposed-brain removal from the
  tracking set, presentation isolation across multiple environments, and shared
  parameter-tile survival across full-snapshot bundle replacement.
12. Ensure the semantic bundle contract remains platform-neutral so it can be
  consumed by the Roblox, node, and esm core runtimes without target-specific
  public API branches.

**Notes:**

- Phase S3 is the boundary between the compiler and the runtime. If this seam is
  well-shaped, app code no longer needs to directly maintain user action
  artifact maps and tile metadata registries just to consume compiler output.
- Core-side hydration, bundle replacement, selective invalidation, deferred
  rebuild control, and catalog precedence groundwork already landed during S2
  review. S3 should treat those package-level pieces as baseline and focus on
  compiler bundle adaptation, real startup-hydration proof against compiler
  output, and tile-presentation decoupling.
- The new seam must preserve the current split between dependency tracking and
  actual rebuild work. `replaceActionBundle(...)` should mark affected brains as
  invalidated, not immediately recreate them.
- Overlapping bundle replacements must coalesce through the environment's live
  invalidation state. Deferred rebuild code should call no-args
  `rebuildInvalidatedBrains()` rather than treating an earlier
  `invalidatedBrains` array as an overlap-safe token.
- V1 should stay with one public authored-action mutation path. If incremental
  patch/remove semantics are ever needed later, they should be introduced as a
  separate contract rather than smuggled into the snapshot seam.
- The environment owns the dependency graph for the brains it creates. Apps own
  rebuild timing.
- Startup hydration is a semantic fallback path, not an executable action path.
  It exists so persisted brains and editor state can load before the compiler
  produces fresh bundle output.
- `HydratedTileMetadataSnapshot` and `CompiledActionBundle` are distinct
  contracts even though they currently carry the same `revision` and `tiles`
  fields. Keep those declarations separate rather than reintroducing a shared
  base or treating a bundle as the hydration contract itself.
- `CompiledActionBundle` is still a core-facing contract even when
  `@mindcraft-lang/ts-compiler` is the producer. If it remains on the
  `MindcraftEnvironment` seam, keyed runtime-facing collections should use
  core-safe containers such as `Dict` rather than native `Map`.
- The container asymmetry in `CompiledActionBundle` is intentional in V1:
  `actions` is a `Dict` because core diffs, replaces, and resolves actions by
  key, while `tiles` remains a `readonly TileDefinitionInput[]` because it is a
  whole-snapshot transfer list rather than a keyed mutable registry. Core may
  project that array into `TileCatalog`/`List` internally after receipt.
- `CompiledActionBundle.tiles` belongs to the semantic catalog story, not just
  the runtime action story. It should update environment-shared bundle catalog
  state rather than acting like a second unrelated tile registry.
- Presentation is a separate concern from those semantic catalogs. S3 should
  prefer keeping it app/UI-owned unless the first real migration slice proves
  that a dedicated non-global lookup seam is actually required.
- `CompiledActionBundle.tiles` must be complete on every successful bundle
  emission. The replacement contract is snapshot-based, not tile-diff-based.
  Shared parameter tiles or other reused semantic tiles must therefore remain
  present in later bundles even if the specific source file that changed did not
  redefine them.
- This deliberately replaces sim's current runtime-side parameter-tile
  ref-counting. The new seam should not require core to retain or release shared
  parameter tiles one function at a time.
- The hydration-to-bundle handoff must be atomic. Because catalog lookup is
  first-match-wins and the seam does not model multiple independent hydrated
  domains, the first successful bundle install must discard the full hydrated
  fallback snapshot before or as it installs fresh bundle tiles.
- A hydrated tile that does not appear in the fresh bundle must disappear at
  that handoff. It must not remain visible as stale fallback metadata.
- `DiagnosticSnapshot` is different because it lives on the bridge/compiler
  side of the seam rather than inside `packages/core`, so it does not inherit
  that Roblox container constraint by default.
- Because `packages/core` is multi-target, disposal needs to be explicit. Do
  not make the design depend on `WeakRef`, finalizers, or other GC-sensitive
  runtime behavior.
- Startup metadata hydration for persisted brains must remain supported.
- Tile presentation is especially important to isolate here because it is more
  naturally app/UI-facing, while `packages/core` must remain viable for Roblox
  and other non-DOM consumers.
- The compiler package is still not a Roblox target. The requirement here is
  that the bundle contract it emits for core stays platform-neutral enough for
  the multi-target core runtime.
- The scoped services mechanism established in S2 is now an intentional
  internal environment mechanism. S3 should not assume that removing it is part
  of the bundle/presentation deliverables.

**Risks:**

- Persisted brains currently depend on user tile metadata being available early
  enough for deserialization. The new bundle/presentation seam must preserve
  that startup behavior.
- It is easy to solve runtime bundle replacement while still leaving startup
  brain loading broken if semantic hydration before the compiler remains
  unspecified.
- It is easy to accidentally move rebuild responsibility back to the app if the
  environment only stores action bundles and does not also own per-brain linked
  revision tracking.
- Do not let presentation concerns leak back into the semantic bundle contract.

**Common failure modes:**

- The compiled action bundle contract carries app/UI details that do not belong
  in a core runtime seam.
- The compiler-side adapter keeps app-owned state alive instead of collapsing it
  into the new bundle seam.
- S3 names a `TilePresentationResolver`-style API without deciding who owns it,
  who constructs it, or whether the UI layer could have handled presentation
  lookup more simply.
- Startup still depends on fresh compiler output to register tile metadata,
  so persisted brains fail to deserialize on cold load.
- Bundle tiles become a second ad hoc registry instead of the environment's
  bundle-managed shared catalog.
- Fresh compiler bundles never fully replace the startup-hydrated fallback
  metadata, so stale semantic tiles linger after compile succeeds.
- The first bundle install merges with hydrated fallback tiles instead of
  replacing them atomically, so stale hydrated entries remain visible or shadow
  fresh bundle tiles under first-match lookup.
- The compiler emits only changed tile metadata into a replacement bundle, so
  shared parameter tiles or other reused semantic tiles disappear when the
  bundle-managed catalog is swapped.
- The new seam keeps sim's old runtime-side parameter ref-count tables even
  though completeness of the emitted bundle snapshot already defines which
  shared parameter tiles should exist.
- Hydrated tile metadata is mistakenly treated as if it already provided
  executable actions.
- `replaceActionBundle(...)` eagerly rebuilds brains and leaves no scheduling
  hook for apps that need to defer work to a frame boundary.
- Deferred rebuild code captures an earlier `invalidatedBrains` array and misses
  additional brains invalidated by a later overlapping bundle replacement.
- The app still needs its own `brainActionRevisions` or active-brain registry
  because the environment never took ownership of dependency tracking.
- Disposed brains remain in the environment's invalidation set and keep getting
  rebuilt.
- Presentation remains effectively process-global, or a new presentation
  registry is introduced into core even though an app/UI-owned map/provider
  would have been sufficient.
- Temporary bundle/presentation adapters remain in place after the new core seam
  is fully wired.

### Requirements addressed

- `FR-2`: partially satisfied (the bridge-free compiler/runtime bundle seam is
  implemented; real-app proof is deferred to Phase S6)
- `FR-6`: fully satisfied
- `FR-7`: fully satisfied
- `FR-8`: partially satisfied (the package seam resolves effective tile
  visibility across shared, hydrated, compiled, overlay, and brain-local
  metadata; real-app proof is deferred to Phase S6 and final public guidance is
  deferred to Phase S7)
- `FR-9`: partially satisfied (the package-level startup hydration path is
  implemented; real-app cold-start proof is deferred to Phase S6)
- `FR-10`: fully satisfied
- `FR-11`: partially satisfied (authoritative bundle handoff and
  complete-snapshot semantics are implemented; real-app proof is deferred to
  Phase S6)
- `FR-12`: partially satisfied (selective invalidation is implemented at the
  core seam; real-app proof is deferred to Phase S6)
- `FR-13`: partially satisfied (deferred rebuild control is implemented at the
  core seam; real-app proof is deferred to Phase S6)
- `FR-14`: fully satisfied
- `FR-16`: fully satisfied
- `FR-17`: fully satisfied
- `NFR-1`: partially satisfied (the bundle contract remains core-target
  compatible; real-app proof is deferred to Phase S6)
- `NFR-2`: partially satisfied (runtime-facing bundle consumption remains
  platform-neutral; real-app proof is deferred to Phase S6)
- `NFR-4`: partially satisfied (cold-start semantics are implemented at the
  package seam; real-app cold-start proof is deferred to Phase S6)
- `NFR-5`: fully satisfied
- `INV-1`: fully satisfied
- `INV-2`: fully satisfied
- `INV-3`: fully satisfied

---

## Phase S4: Composition-first `createAppBridge()` facade

**Objective:** Add a new app-facing bridge facade that hides low-level
`bridge-client` transport objects behind a narrower composition API.

**Prerequisites:** Phase S1.

**Packages/files touched:**

- `packages/bridge-app/src/index.ts`
- new facade implementation files in `packages/bridge-app/src/`
- `packages/bridge-client/src/` only if small adapter hooks are needed

**Concrete deliverables:**

1. Implement `createAppBridge(options)`.
2. Introduce sourced bridge-app workspace aliases instead of inventing new
  filesystem transport types:
  - `WorkspaceSnapshot = ExportedFileSystem`
  - `WorkspaceChange = FileSystemNotification`
  - `FileSystemNotification` remains protocol-owned in `bridge-protocol`, but
   the bridge-app seam should source it through the public re-export from
   `bridge-client`
3. Introduce `WorkspaceAdapter` as the seam between app-owned workspace state
  and the bridge transport.
4. Support the essential lifecycle and query methods on the new facade:
   - `start()`
   - `stop()`
   - `requestSync()`
   - `snapshot()`
   - `onStateChange(...)`
   - `onRemoteChange(...)`
5. Define `AppBridgeFeatureContext` as the only capability surface for optional
   bridge features. It should provide:
  - current bridge snapshot and state-change subscription
  - current workspace snapshot
  - remote workspace change subscription
  - a sync-complete hook for replay-oriented features
  - outbound publication helpers for diagnostics/status style feature messages
6. Make workspace ownership explicit:
  - the app owns the workspace/VFS state
  - bridge-app reads current contents through `exportSnapshot()`
  - bridge-app applies inbound changes through `applyRemoteChange(...)`
  - persistence remains an app concern, not a bridge concern
  - generated compiler support files are not part of the app-owned workspace
    snapshot and are composed separately by compilation features
7. Define the persistence trigger for browser apps: persist after successful
  workspace mutation, not by reaching into bridge internals. Full import/sync
  operations should result in one batched persisted snapshot write.
8. Decide whether `AppProject` remains temporarily as an internal migration aid
  or is replaced outright by the new facade in this phase.
9. Add tests for connection status transitions, join-code propagation, remote
   file-change delivery, sync behavior, and feature attach/replay behavior.

**Notes:**

- S4 should prefer adapting over the existing `Project`/`ProjectSession`
  machinery rather than rebuilding bridge logic from scratch.
- The new facade should not expose `session`, `files`, or any `Project`-level
  internals.
- S4 should not invent a second snapshot/change schema. The public
  `WorkspaceSnapshot` / `WorkspaceChange` names should stay as bridge-app seam
  aliases over `ExportedFileSystem` and `FileSystemNotification`.
- The feature context is part of the seam, not an internal afterthought. S4 is
  incomplete if optional features still need `Project` or `session` objects to
  function.
- `WorkspaceAdapter.exportSnapshot()` should represent user-authored workspace
  state, not generated compiler support files.
- The bridge facade should not be the owner of persistence. The app-owned
  workspace store is the source of truth and the thing that decides when to
  write a snapshot to localStorage or other persistence.
- 2026-04-05 post-mortem note: the S1 contract layer uses plain `() => void`
  cleanup handles for listener and feature subscriptions. Keep S4 aligned with
  that shape unless a concrete runtime consumer forces a separate abstraction.

**Risks:**

- It is easy to build a facade that still leaks transport detail through its
  callbacks or snapshot model. Keep the public vocabulary at the app-domain
  level.

**Common failure modes:**

- `createAppBridge()` still effectively exposes `Project`, `session`, or
  `files`, just under softer naming.
- The facade is so thin that apps still need to understand low-level transport
  behavior to use it correctly.
- `AppBridgeFeatureContext` is undefined or too weak, so the first real feature
  still has to reach into `Project`, `session`, or transport callbacks.
- `AppProject` remains the real primary integration path and the new facade is
  only cosmetic.
- A temporary adapter layer around `AppProject` survives after the facade has
  taken over.
- `WorkspaceSnapshot` / `WorkspaceChange` become new ad hoc bridge-app types
  instead of sourced aliases over `bridge-client`'s `ExportedFileSystem` /
  `FileSystemNotification`.
- Persistence still depends on reading a bridge-owned VFS snapshot from outside
  the bridge layer.
- Ambient declarations or compiler-controlled system files are still mixed into
  the bridge-owned filesystem snapshot, and `tsconfig.json` is still
  app-injectable instead of being overwritten internally.
- Full import/sync operations cause repeated per-file persistence writes instead
  of one batched snapshot save.

### Requirements addressed

- `FR-3`: partially satisfied (the bridge-only facade is implemented at the
  package level; real-app proof and final guidance are deferred to Phase S7)
- `FR-18`: partially satisfied (the app-facing bridge lifecycle/join-code/
  workspace surface is implemented; real-app proof is deferred to Phase S7)
- `FR-19`: partially satisfied (public remote/local workspace flow is
  implemented; real-app proof is deferred to Phase S7)
- `FR-20`: partially satisfied (the app-owned workspace persistence seam is
  implemented; sim migration proof is deferred to Phases S6-S7)
- `FR-21`: partially satisfied (the batched full-sync persistence boundary is
  implemented; sim proof is deferred to Phases S6-S7)
- `FR-22`: partially satisfied (the feature capability surface is implemented;
  diagnostics/status feature proof is deferred to Phase S5)
- `NFR-6`: partially satisfied (a clean bridge default path exists at the
  package level; final legacy demotion is deferred to Phase S7)
- `INV-5`: partially satisfied (bridge connectivity remains independent of
  compilation in the base bridge facade; compilation feature proof is deferred
  to Phase S5)

---

## Phase S5: Optional compilation bridge feature

**Objective:** Move compiler/diagnostic behavior out of the root bridge-app
facade and into an optional feature surface.

**Prerequisites:** Phase S4.

**Packages/files touched:**

- `packages/bridge-app/src/compilation.ts`
- new files under `packages/bridge-app/src/compilation/` or equivalent
- `packages/bridge-app/package.json` export map for `./compilation`
- app integration code that currently passes `compilationProvider` directly to
  `AppProject`

**Concrete deliverables:**

1. Introduce `createCompilationFeature({ compiler, publishStatus? })`
  on the new `@mindcraft-lang/bridge-app/compilation` subpath.
2. Replace the root-level `CompilationProvider` seam with a feature-oriented
  `WorkspaceCompiler` seam for the new integration path, while preserving the
  current dependency direction:
  - `@mindcraft-lang/bridge-app/compilation` owns the feature port
  - `@mindcraft-lang/ts-compiler` remains independent of `bridge-app`
  - app code or an optional adapter helper supplies a bridge-facing compiler
   adapter value
  - the raw `@mindcraft-lang/ts-compiler` compiler object is expected to expose
    workspace update methods plus a richer compile result that includes
    diagnostics and an optional `CompiledActionBundle`; the adapter to
    `WorkspaceCompiler` narrows that source shape for bridge-app
3. Keep compiler-only inputs compiler-owned in v1 rather than standardizing a
  caller-supplied support-files provider. `tsconfig.json` remains a
  compiler-controlled system file and is not injectable by the app.
4. Define the feature wiring exclusively through `AppBridgeFeatureContext`:
  - seed compiler state from `workspaceSnapshot()`
  - apply bridge-originated changes from `onRemoteChange(...)`
  - replay cached diagnostics after `onDidSync(...)`
  - inspect connection status through `snapshot()` / `onStateChange(...)`
  - publish diagnostics and compile status through the context rather than a
   raw session sender
5. Refactor `CompilationManager` into the feature implementation so it is no
   longer conceptually part of the base bridge connection object.
6. Define how ambient declarations are generated from environment-owned
  registry state by default in the new path, replacing the current implicit
  `buildAmbientDeclarations()` -> `getBrainServices()` dependency, while
  keeping the public seam focused on the default path.
  - let `@mindcraft-lang/ts-compiler` read environment-owned registry state
    directly rather than process-global registries
  - keep `.d.ts` string generation in `@mindcraft-lang/ts-compiler` rather
    than introducing a TypeScript-specific generator into core
  - defer caller-supplied ambient/support-file injection until a concrete app
    actually needs it
7. Preserve the current diagnostic replay behavior when an extension pairs after
   compilation has already run.
8. Decide whether the old `AppProject({ compilationProvider })` shape survives
  temporarily as an internal migration shim or is replaced directly by the
  feature-based surface.

**Notes:**

- The bridge protocol does not need to change in S5. The improvement is purely
  at the package seam.
- The new shape should let apps opt into bridge connectivity without also taking
  a dependency on compiler-specific abstractions.
- A successful S5 result does not need raw session access inside the feature;
  the context from S4 should already provide everything required.
- `WorkspaceCompiler` should consume the S4 `WorkspaceSnapshot` /
  `WorkspaceChange` aliases rather than introducing a separate compiler-only
  snapshot/change model.
- S5 should preserve the current consumer-owned port pattern rather than
  introducing a new package cycle between `bridge-app` and `ts-compiler`.
- S5 should preserve the distinction between user workspace files and
  compiler-controlled system files. Ambient declarations are derived inputs,
  not persisted app workspace content, and `tsconfig.json` remains
  authoritative internal compiler state even if a copy appears in a serialized
  fileset.
- The base setup should work with internally generated declarations and no
  caller-supplied support-files/provider seam.
- 2026-04-05 post-mortem note: S1 already added a small
  `createCompilationFeature(...)` helper and public replay tests. S5 should
  evolve or replace that helper directly rather than keeping parallel feature
  implementations alive.
- 2026-04-05 post-mortem note: keep the legacy `CompilationResult` type
  standalone even if it is structurally compatible with `DiagnosticSnapshot`.
  Do not reintroduce inheritance between those shapes as part of the S5 seam
  work.

**Risks:**

- Startup compile ordering and cached-diagnostic replay are easy to break when
  refactoring this seam. Preserve the current behavior before trying to improve
  it.

**Common failure modes:**

- The compilation feature is still conceptually welded into the base bridge
  connection object.
- The compilation feature still cannot be implemented without reaching into
  `session`, `onRemoteFileChange()`, or other pre-facade internals because the
  feature context never became concrete enough.
- `@mindcraft-lang/ts-compiler` now depends directly on
  `@mindcraft-lang/bridge-app` just to satisfy the feature port type, or
  `bridge-app` now depends on `ts-compiler` for its public contracts.
- The new compiler seam still assumes `mindcraft.d.ts` must be injected because
  no internal default ambient-generation path was defined.
- `tsconfig.json` is still app-injectable, or whichever serialized copy happens
  to be present in the fileset wins over the compiler's authoritative config.
- Ambient declarations still depend on `getBrainServices()` even though the
  environment is supposed to own the registries on the new path.
- Ambient generation invents a new public description contract even though
  direct reads from environment-owned registries would have been sufficient.
- The bridge feature standardizes a public support-files provider even though
  no real caller needs externally supplied compiler-only overlays yet.
- The default path still needs ad hoc caller wiring for compiler-only files
  even though internally generated ambient declarations were supposed to be
  sufficient.
- The compilation feature introduces a second workspace snapshot/change format
  instead of reusing the sourced S4 bridge-app aliases.
- The old `compilationProvider` path remains the primary codepath instead of a
  short-lived migration aid.
- Diagnostic replay or startup compile ordering regresses during the refactor.
- Temporary dual-wiring between the old and new compilation seams remains after
  feature-based wiring is complete.

### Requirements addressed

- `FR-4`: partially satisfied (compiler + bridge composition is implemented at
  the package level; full real-app proof is deferred to Phase S7)
- `FR-22`: fully satisfied
- `FR-23`: fully satisfied
- `FR-24`: partially satisfied (diagnostic replay support is implemented in the
  package seam; real-app proof is deferred to Phase S7)
- `FR-25`: partially satisfied (default ambient generation is implemented in
  the package seam by reading environment-owned registry state instead of
  `getBrainServices()`; real-app proof is deferred to Phases S6-S7)
- `FR-27`: partially satisfied (compiler-owned system-file authority is
  implemented in the package seam; real-app proof is deferred to Phase S6)
- `FR-28`: partially satisfied (user workspace is separated from compiler-only
  inputs in the package seam; sim proof is deferred to Phase S6 and final
  full-stack proof to Phase S7)
- `NFR-6`: partially satisfied (feature layering is clean in the package seam;
  final recommended guidance and legacy cleanup are deferred to Phase S7)
- `INV-4`: partially satisfied (package-level separation is implemented;
  real-app proof is deferred to Phase S6)
- `INV-5`: fully satisfied

---

## Phase S6: Migrate sim to the new core seam

**Objective:** Prove the new core environment/module seam against the real sim
app and remove direct registry access from the normal sim integration path.

**Prerequisites:** Phases S2 and S3.

**Packages/files touched:**

- `apps/sim/src/services/vscode-bridge.ts`
- `apps/sim/src/bootstrap.ts`
- `apps/sim/src/brain/index.ts`
- `apps/sim/src/services/brain-runtime.ts`
- `apps/sim/src/services/user-tile-registration.ts`
- other sim brain/type/tile registration files as needed

**Concrete deliverables:**

1. Introduce a sim module install path such as `createSimModule()` or an
   equivalent environment-facing registration entrypoint.
2. Update bootstrap so sim creates a `MindcraftEnvironment`, installs
   `coreModule()` and the sim module, and passes that environment into the
   services that need it.
3. Update the sim brain runtime path so it uses `environment.createBrain(...)`
  rather than importing and constructing `Brain` directly, while preserving
  the supported ability to tick brains and inspect runtime state through the
  returned brain object.
4. Update the user-authored action integration path so the sim consumes compiler
  output through `buildCompiledActionBundle(...)`,
  `replaceActionBundle(...)`, and environment invalidation events rather than
  maintaining the primary runtime state in app-owned maps and revision
  trackers.
5. Replace `registerUserTilesAtStartup()` with a startup hydration path that:
  - loads the persisted `HydratedTileMetadataSnapshot`
  - calls `environment.hydrateTileMetadata(...)` before persisted brains load
  - lets the first successful compiler bundle atomically replace that fallback
    snapshot
6. Replace the current bridge-owned VFS persistence pattern in
  `vscode-bridge.ts` with an app-owned workspace store that:
  - loads the persisted snapshot at startup
  - exposes the `WorkspaceAdapter` contract to bridge-app
  - persists after successful workspace mutations
  - batches full import/sync application into one persisted snapshot write
7. Replace the current injected `mindcraft.d.ts` / `tsconfig.json` filesystem
  hack with a compiler-owned system-file path that always reinstates the
  authoritative `tsconfig.json`, plus a default ambient-generation path that
  derives declarations from the environment. If a future app proves a concrete
  need for caller-supplied ambient overlays after that, add a separate seam
  then instead of standardizing it preemptively in v1.
8. Preserve persisted-brain loading, startup user tile hydration, and rebuild of
   active brains whose linked action revisions changed.
9. Confirm that the new sim-facing core integration is still built on top of a
  core API that remains valid for Roblox-targeted consumers, rather than a
  browser-specific shortcut.
10. Refactor sim's registration call tree (`registerBrainComponents()` ->
   `registerTypes()` / `registerFns()` / `registerTiles()` and their transitive
   leaf registrations) so the sim module installs against the new environment or
   install context rather than assuming ambient global services.
11. Replace the current `brainActionRevisions` /
  `registerActiveBrainContainer()` /
  `rebuildActiveBrainsUsingChangedActions()` normal-path wiring with the new
  environment-owned invalidation plus sim-controlled rebuild scheduling model.

**Notes:**

- Some advanced sim code may still need deep subpaths temporarily. The goal of
  S6 is to move the composition root and ordinary runtime path first.
- If an internal helper still uses `getBrainServices()` during migration, that
  is acceptable as an intermediate step as long as the new app-facing seam is in
  place and the composition root no longer depends on it.
- The same ownership rule applies to VFS persistence: sim should persist its own
  workspace store, not reach into bridge internals to export and save raw files.
- As with S2, this is not just a top-level wrapper rename. The sim registration
  fan-out is part of the machinery that has to be re-plumbed.
- The startup hydration path is specifically for persisted-brain data loading.
  It should not be treated as a substitute for fresh compiler output when
  executable brains need authored action implementations.
- S3 narrowed the intended ts-compiler runtime path to
  `buildCompiledActionBundle(...)`. S6 should migrate sim to that helper rather
  than reviving the legacy singleton `registerUserTile(...)` path.
- Sim should no longer need to smuggle generated `mindcraft.d.ts` into the
  bridge filesystem just to get correct compiler inputs, and it should never be
  able to control the authoritative `tsconfig.json` through app wiring.
- Sim should be able to defer rebuilds to a safe frame boundary. The new seam is
  incomplete if bundle replacement forces reinitialization inside the compiler
  callback itself.

**Risks:**

- Sim has many existing call sites that assume the singleton seam. Migrate from
  the top down: composition root first, leaf helpers second.
- Do not collapse the working persisted-brain startup flow while simplifying the
  seam.

**Common failure modes:**

- Sim bootstrap still fundamentally depends on singleton-oriented core APIs even
  after the new seam exists.
- Direct `Brain` construction or direct registry manipulation remains in the
  normal sim runtime path.
- The migration breaks persisted-brain loading or startup user tile hydration.
- Sim still needs to register fallback startup tiles through global registries
  because the environment never gained a semantic hydration path.
- Sim still injects generated ambient declarations into the raw workspace
  snapshot because no explicit compiler support-files seam was introduced.
- Sim keeps a parallel action-revision tracking system because the environment
  invalidation contract is too weak.
- Bundle replacement immediately rebuilds active brains at compile time instead
  of letting sim schedule the work.
- Temporary app-level adapters added to get sim across the transition remain in
  the codebase after the new seam is working.
- The sim-oriented refactor accidentally becomes the default shape for Roblox
  consumers too, even though their root import pattern is required to stay
  supported.
- VFS persistence still hangs off bridge callbacks and `project.files.raw.export`
  style reach-through instead of an app-owned workspace store.
- `registerBrainComponents()` keeps calling the old ambient registration chain,
  just under a new module-shaped top-level wrapper.

### Requirements addressed

- `FR-1`: partially satisfied (sim proves the new core runtime path in a real
  app; final tier guidance is deferred to Phase S7)
- `FR-2`: partially satisfied (sim proves compiler output can feed the runtime
  without bridge-specific runtime bookkeeping; final tier guidance is deferred
  to Phase S7)
- `FR-5`: partially satisfied (sim's normal path no longer depends on core
  registries, including the hidden function registry, or concrete runtime
  classes; bridge-side cleanup is deferred to Phase S7)
- `FR-8`: partially satisfied (sim proves load/link against hydrated and
  compiled metadata in a real app; final public guidance is deferred to
  Phase S7)
- `FR-9`: fully satisfied
- `FR-11`: fully satisfied
- `FR-12`: fully satisfied
- `FR-13`: fully satisfied
- `FR-15`: fully satisfied
- `FR-20`: partially satisfied (sim adopts an app-owned workspace store;
  final standardization on the new bridge seam is deferred to Phase S7)
- `FR-21`: partially satisfied (sim proves batched full-sync persistence in the
  app store; final standardization on the new bridge seam is deferred to
  Phase S7)
- `FR-25`: partially satisfied (default ambient generation is proven in sim;
  final full-stack bridge proof is deferred to Phase S7)
- `FR-27`: partially satisfied (compiler-owned system-file authority is proven
  in sim; final bridge-seam proof is deferred to Phase S7)
- `FR-28`: partially satisfied (sim proves user workspace vs compiler-only
  inputs separation; final bridge-seam standardization is deferred to Phase S7)
- `NFR-1`: partially satisfied (a real app proves the core seam remains usable
  without abandoning Roblox-oriented core constraints; final plan completion is
  deferred to Phase S7)
- `NFR-2`: partially satisfied (the real app path continues to avoid
  browser-only assumptions in shared core behavior; final plan completion is
  deferred to Phase S7)
- `NFR-4`: fully satisfied
- `INV-4`: partially satisfied (the separation model is proven in sim; final
  standard-path cleanup is deferred to Phase S7)

---

## Phase S7: Migrate sim to the new bridge seam, then remove or sharply narrow the old path

**Objective:** Prove the full-stack seam in the real app, then update docs and
package surfaces so the new path becomes the standard integration story and the
legacy seam is either removed or reduced to the smallest justified remainder.

**Prerequisites:** Phases S4, S5, and S6.

**Packages/files touched:**

- `apps/sim/src/services/vscode-bridge.ts`
- sim workspace persistence and compiler integration helpers
- `INTEGRATION.md`
- `packages/core/README.md`
- `packages/bridge-app/README.md`
- any package docs/examples that currently teach the old path first

**Concrete deliverables:**

1. Replace sim's direct `AppProject` usage with `createAppBridge(...)`.
2. Replace sim's direct root-level compilation wiring with
   `createCompilationFeature(...)`.
3. Remove direct `project.session`, `project.files`, and `project.compilation`
   access from sim's normal integration path.
4. Update the integration docs so they clearly describe three supported tiers:
   - core only
   - core + ts-compiler
   - core + ts-compiler + bridge
5. Remove legacy app-facing seams that are no longer justified once sim has
   migrated:
   - `registerCoreBrainComponents()` if it no longer serves a clear internal role
   - `getBrainServices()` as an app-integration primitive
   - `setTileVisualProvider()` entirely; it is not allowed to remain as a
     compatibility shim or legacy fallback after S7
   - `AppProject` as the recommended app-facing bridge API

**Notes:**

- S7 should end with the new seam documented as the gold-standard path.
- S7 is the explicit removal point for temporary legacy fallback shims carried
  earlier for migration, including `setTileVisualProvider()`.
- Because there are no external users yet, hard cleanup is in scope where it
  improves clarity and maintainability.

**Risks:**

- Documentation lag can erase most of the benefit of the redesign. S7 is not a
  docs-only cleanup phase; it is part of the product work.

**Common failure modes:**

- The docs describe the new seam, but the real app path still routes through old
  bridge/core objects.
- Legacy public seams remain exposed by default without a deliberate reason.
- Temporary shims/adapters introduced in earlier phases are still present at the
  end of the work.
- The final package surfaces are cleaner on paper than in the actual codebase.

### Requirements addressed

- `FR-1`: fully satisfied (the runtime-only tier is documented and retained as
  a supported standard path)
- `FR-2`: fully satisfied (the runtime + compiler tier is documented and
  retained as a supported standard path)
- `FR-3`: fully satisfied (the bridge-only tier is documented and validated by
  the final bridge seam)
- `FR-4`: fully satisfied (the full-stack runtime + compiler + bridge flow is
  proven in sim and documented)
- `FR-5`: fully satisfied (the standard path no longer requires hidden
  registries, including the function registry, or concrete runtime classes)
- `FR-8`: fully satisfied (the standard path is proven and documented to load,
  link, and deserialize against the full effective shared, hydrated, compiled,
  overlay, and brain-local tile set)
- `FR-18`: fully satisfied (the app-facing bridge lifecycle surface is proven
  in sim and remains the documented standard path)
- `FR-19`: fully satisfied (remote/local workspace flow is proven through the
  final bridge seam)
- `FR-20`: fully satisfied (the standard app story uses app-owned workspace
  persistence rather than bridge-owned raw VFS export)
- `FR-21`: fully satisfied (the standard app story preserves batched full-sync
  persistence)
- `FR-24`: fully satisfied
- `FR-25`: fully satisfied
- `FR-27`: fully satisfied
- `FR-28`: fully satisfied
- `NFR-1`: fully satisfied (the final standard path and package surfaces rely
  only on core-facing seams that have been validated across supported core
  targets)
- `NFR-2`: fully satisfied (the final standard path does not depend on
  browser-only or node-only behavior in shared runtime-facing code)
- `NFR-6`: fully satisfied
- `NFR-7`: fully satisfied
- `INV-4`: fully satisfied
- `INV-6`: fully satisfied

---

## Phase Ordering Rationale

- S1 fixes names and export compatibility first so later work has a stable
  vocabulary.
- S2 establishes the new core seam before the app migration starts.
- S3 then builds the compiler/runtime seam on that core foundation before the
  app migration starts.
- S4 and S5 establish the new bridge seam before sim's bridge layer migrates.
- S6 proves the core seam in a real app.
- S7 proves the bridge seam in the same app and updates the public guidance.

This ordering keeps each phase focused on a single package boundary while still
producing useful partial outcomes.

---

## Success Criteria

This plan is successful when all of the following are true:

1. A new app can integrate Mindcraft runtime features through the recommended
  app-facing seam without calling `registerCoreBrainComponents()` or
  `getBrainServices()`.
2. A new app can add TypeScript-authored tiles without owning the primary runtime
   action-artifact state in app code.
3. A new app can add bridge connectivity without touching `ProjectSession`,
   `ProjectFiles`, or other low-level transport objects.
4. `apps/sim` uses the new seam as the normal path.
5. Legacy app-facing seams have either been removed or reduced to a deliberate,
  explicitly justified internal subset.
6. Any phase that changes `packages/core` continues to satisfy the multi-target
  build contract, with Roblox-TS treated as a first-class target.
7. Temporary shims/adapters introduced during the work have been removed by the
  end of the plan unless they were explicitly promoted into permanent,
  intentional APIs.
8. Roblox application code can still use the preserved root import shape from
  `@mindcraft-lang/core`, including the `brain` namespace and
  `brain.compiler` / `brain.tiles` traversal style.

---

## Phase Log

Add entries only during post-mortem.

Each phase log entry must include a `Requirements retrospective` subsection.
Use the phase's prospective `Requirements addressed` list as the baseline and
record what actually happened, for example:

```md
### Requirements retrospective
- FR-<id>: satisfied as planned
- FR-<id>: partially satisfied (<what was actually covered>; remaining work carries to Phase S<n>)
- FR-<id>: not addressed (deferred to Phase S<n> -- <reason>)
```

Use the same format for any `NFR-<id>` or `INV-<id>` items that were part of the
phase's prospective requirement list. This retrospective is append-only once
the phase is closed.

### Phase S1 -- 2026-04-05

**Planned vs actual:**

All 7 concrete deliverables were implemented.

- `packages/core` now exposes the S1 core seam contract types from a new
  root-level `mindcraft.ts` file, and the root `brain` namespace export
  remains intact.
- `MindcraftModuleApi` includes a distinct `registerFunction(...)` path
  alongside operator registration.
- `packages/bridge-app` now exposes the S1 bridge contract types from a new
  public `app-bridge.ts` file and root barrel exports.
- `@mindcraft-lang/bridge-app/compilation` now exists as an export-map subpath
  with `WorkspaceCompiler`, `DiagnosticSnapshot`, and
  `createCompilationFeature(...)`.
- Public import tests now cover the new root `@mindcraft-lang/core` exports and
  the new bridge-app subpath exports without reaching through legacy subpaths.
- `packages/core/package.json` did not need a new export-map entry because the
  S1 vocabulary fits on the root package surface without disturbing the
  Roblox-facing package shape.
- The preserved root import pattern `import { brain, ... } from
  "@mindcraft-lang/core"` still builds across node, esm, and rbx via the full
  core verification run.

One planned file did not need changes:

- `packages/core/package.json` stayed unchanged because root-level type exports
  were enough for S1; no new core subpaths were required.

**Unplanned additions and discoveries:**

1. `createCompilationFeature(...)` gained a small working implementation and
   replay-oriented tests in S1 even though the host `createAppBridge(...)`
   facade remains deferred to S4.
2. `packages/bridge-app` needed a dedicated `tsconfig.spec.json`, local `tsx`
   devDependency, and `test/**/*.spec.ts` discovery to match the repo's
   standard spec-test workflow.
3. Bridge cleanup handles in the new public seam were reviewed and locked to
   plain `() => void`, not a dedicated `Disposable` contract.
4. The legacy `CompilationResult` type stays standalone; compatibility with the
   new `DiagnosticSnapshot` should remain structural rather than expressed via
   inheritance.
5. S1 deliberately retained the legacy public seams
   (`registerCoreBrainComponents()`, `getBrainServices()`,
   `setTileVisualProvider()`, `AppProject`, `CompilationProvider`,
   `CompilationManager`, and `CompilationResult`) so later phases can migrate
   callers without temporary shims becoming permanent.

**Design decisions:**

- Kept the new core vocabulary as root exports only; no new
  `@mindcraft-lang/core` subpaths were added in S1.
- Preserved the existing `brain` namespace export and validated it through the
  full `packages/core` build, including Roblox.
- Used `() => void` cleanup handles across the new bridge-app contracts for v1
  consistency with the existing codebase.
- Kept `DiagnosticSnapshot` as the new feature-side contract and
  `CompilationResult` as the legacy transport-side contract without an
  inheritance relationship between them.
- Retained legacy exports unchanged in S1 and deferred demotion/removal to the
  migration phases, especially S4-S7.

**Files changed:**

- `packages/core/src/index.ts`
- `packages/core/src/mindcraft.ts`
- `packages/core/src/mindcraft.spec.ts`
- `packages/bridge-app/src/app-bridge.ts`
- `packages/bridge-app/src/compilation.ts`
- `packages/bridge-app/src/index.ts`
- `packages/bridge-app/package.json`
- `packages/bridge-app/tsconfig.spec.json`
- `packages/bridge-app/test/public-api.spec.ts`
- `docs/specs/features/mindcraft-seam-design.md`

**Verification:**

- `packages/core`: `npm run typecheck`, `npm run check`, `npm run build`,
  `npm test`
- `packages/bridge-app`: `npm run typecheck`, `npm run check`, `npm run build`,
  `npm test`

**Acceptance criteria result:**

All S1 concrete deliverables passed review after refinement. The new root/core
and bridge-app import surfaces compile cleanly, the new bridge-app compilation
subpath resolves cleanly, and the legacy seams remain available for migration.

### Requirements retrospective

- `FR-1`: partially satisfied (implemented the root core seam vocabulary and
  import coverage; environment/brain factory behavior remains with Phase S2 and
  real-app proof remains with Phase S6)
- `FR-2`: partially satisfied (implemented `CompiledActionBundle` and related
  compiler/runtime vocabulary; bridge-free bundle/runtime behavior remains with
  Phase S3 and real-app proof remains with Phase S6)
- `FR-3`: partially satisfied (implemented the bridge-app contract vocabulary;
  `createAppBridge(...)` and real-app proof remain with Phases S4 and S7)
- `FR-4`: partially satisfied (aligned the core, bridge, and compilation
  vocabulary and added the `./compilation` subpath plus an early helper
  implementation; the full composed flow remains with Phases S5 and S7)
- `FR-5`: partially satisfied (named the new boundaries and exposed a distinct
  `registerFunction(...)` path; actual migration away from legacy registries,
  concrete runtime classes, and transport internals remains with Phases S2-S7)
- `FR-18`: partially satisfied (named the bridge lifecycle surface; concrete
  bridge behavior remains with Phases S4 and S7)
- `FR-22`: partially satisfied (named the feature capability surface and added
  an early `createCompilationFeature(...)` helper; full feature wiring through
  `createAppBridge(...)` remains with Phases S4-S5)
- `FR-23`: partially satisfied (named diagnostics/status publication hooks and
  added early helper-side publishing behavior; full bridge feature
  implementation remains with Phase S5)
- `FR-25`: partially satisfied (named environment-owned registry state as the
  ambient source of truth; environment implementation remains with Phase S2 and
  ts-compiler consumption remains with Phase S5)
- `NFR-3`: partially satisfied (preserved the root `brain` namespace export and
  validated the core build across targets; coexistence with the new runtime
  seam remains with Phase S2)
- `NFR-6`: partially satisfied (established the new standard vocabulary while
  retaining legacy exports for migration; final demotion/removal remains with
  Phase S7)
- `NFR-7`: partially satisfied (the adoption-tier vocabulary now exists in the
  contract layer; final public integration guidance remains with Phase S7)
- `INV-5`: partially satisfied (kept bridge and compilation as separate
  optional contract layers; the real bridge-only and feature-composed
  implementations remain with Phases S4-S5)
- `INV-6`: partially satisfied (the new contract layer is additive and lower-
  level paths remain explicit; final legacy demotion remains with Phase S7)

### Phase S2 -- 2026-04-05

**Planned vs actual:**

All major S2 seam deliverables landed at the package level, and the new core
integration path is now genuinely environment-scoped rather than a thin wrapper
over the singleton path.

- `packages/core` now implements `createMindcraftEnvironment()` backed by a
  private environment state container and exports it from the root package.
- `coreModule()` now replaces `registerCoreBrainComponents()` in the new path
  and installs the core runtime/tile registrars into environment-owned
  services.
- Module installation remains constructor-time only through
  `createMindcraftEnvironment({ modules: [...] })`; no public runtime module
  lifecycle was added.
- `environment.createCatalog()` and `environment.createBrain(...)` now exist,
  and the returned `MindcraftBrain` is the runnable app-facing handle rather
  than a lifecycle-only token.
- One shared `BrainDef` can now produce multiple independent runnable brain
  instances without shared runtime or invalidation state.
- Persisted-brain loading can now run through environment-scoped
  deserialization helpers instead of assuming the process-global tile catalog.
- Core and tile registration leaves now thread explicit `BrainServices` rather
  than depending on an already-populated default global install target.
- Root-package coexistence with `import { brain, ... } from "@mindcraft-lang/core"`
  was preserved and validated across node, esm, and rbx.
- Review-driven refinements also landed some S3 groundwork early in
  `packages/core`: hydrated fallback catalogs, bundle-managed catalogs,
  selective invalidation, deferred rebuild control, and explicit catalog
  precedence tests.

One planned abstraction did not materialize as a named internal type:

- Deliverable 17's suggested `CoreRegistrationContext` / equivalent was not
  introduced as a standalone type. The implementation instead uses explicit
  `BrainServices` threading plus narrow internal helpers
  (`EnvironmentModuleApi`, structural install-time accessors, and scoped
  services execution).

One planned area remains partial by design:

- Deliverable 18 is only partially complete. Environment-owned registry state
  is now available internally without relying on the default global singleton,
  but ts-compiler-side ambient generation consumption remains deferred to
  Phase S5.

**Unplanned additions and discoveries:**

1. Review found that the initial environment spec filename drifted from repo
   naming conventions, which led to a rename to
   `mindcraft-environment.spec.ts` and a broader naming/layout rule update in
   `.github/copilot-instructions.md`.
2. Review found that `coreModule()` had started depending on a concrete
   `EnvironmentModuleApi` class check. That was replaced with a structural
   install-time services accessor plus a regression test.
3. Review found that the initial S2 catalog chain order was reversed relative
   to first-match lookup semantics and pre-S2 sim behavior. The environment now
   preserves shared-first precedence and has a dedicated regression test for it.
4. Review found that selective bundle invalidation was already necessary to
   keep the environment seam credible, so package-level invalidation tracking
   and rebuild control landed before the formal S3 phase.
5. Review found that the scoped services context is load-bearing beyond module
   install. The planning and design docs now treat it as an intentional
   internal environment mechanism rather than promising it away as implicit S2
   cleanup.
6. Roblox-target verification rejected some JS-style method/value invocation
   patterns during the `coreModule()` refactor; the final implementation had to
   stay within Roblox-safe shared-code constraints.

**Design decisions:**

- Kept legacy singleton-oriented APIs available as migration paths rather than
  removing them in S2.
- Used a structural install-time services accessor for `coreModule()` rather
  than coupling installs to a concrete `EnvironmentModuleApi` identity check.
- Treated the scoped services mechanism as an intentional internal environment
  mechanism for registration, catalog mutation, deserialization, and brain
  lifecycle operations.
- Preserved pre-S2 first-match catalog behavior with explicit precedence:
  shared -> hydrated fallback -> bundle -> overlay -> brain-local.
- Tracked linked bundle action revisions per managed brain and invalidated only
  affected brains on bundle replacement.

**Files changed:**

- `.github/copilot-instructions.md`
- `packages/core/src/index.ts`
- `packages/core/src/mindcraft.ts`
- `packages/core/src/mindcraft.spec.ts`
- `packages/core/src/mindcraft-environment.spec.ts`
- `packages/core/src/brain/index.ts`
- `packages/core/src/brain/services.ts`
- `packages/core/src/brain/runtime/index.ts`
- `packages/core/src/brain/runtime/actuators/index.ts`
- `packages/core/src/brain/runtime/context-types.ts`
- `packages/core/src/brain/runtime/conversions.ts`
- `packages/core/src/brain/runtime/element-access-builtins.ts`
- `packages/core/src/brain/runtime/map-builtins.ts`
- `packages/core/src/brain/runtime/math-builtins.ts`
- `packages/core/src/brain/runtime/operators.ts`
- `packages/core/src/brain/runtime/sensors/index.ts`
- `packages/core/src/brain/runtime/string-builtins.ts`
- `packages/core/src/brain/runtime/type-system.ts`
- `packages/core/src/brain/tiles/index.ts`
- `packages/core/src/brain/tiles/accessors.ts`
- `packages/core/src/brain/tiles/actuators.ts`
- `packages/core/src/brain/tiles/controlflow.ts`
- `packages/core/src/brain/tiles/literals.ts`
- `packages/core/src/brain/tiles/operators.ts`
- `packages/core/src/brain/tiles/parameters.ts`
- `packages/core/src/brain/tiles/sensors.ts`
- `packages/core/src/brain/tiles/variables.ts`
- `docs/specs/features/mindcraft-seam-design.md`

**Verification:**

- `packages/core`: repeated `npm run typecheck`, `npm run check`,
  `npm run build`, and `npm test` during review refinements; final passing
  result was 565 tests, 0 failures

**Acceptance criteria result:**

S2 is accepted at the package level. A new app can now create an environment,
install modules at construction time, create/rebuild/dispose runnable brains,
deserialize persisted brains through the environment seam, use overlay
catalogs, and avoid the singleton seam on the normal core-only path. Bridge
migration, compiler bundle adaptation, tile presentation decoupling, and sim
adoption remain later phases.

### Requirements retrospective

- `FR-1`: partially satisfied (runtime-only adoption now works at the package
  level through `createMindcraftEnvironment()` and `createBrain(...)`; real-app
  proof remains with Phase S6 and final product guidance remains with Phase S7)
- `FR-5`: partially satisfied (the recommended core path no longer requires
  singleton helpers or the concrete `Brain` class; bridge/app migration and
  final legacy demotion remain with Phases S4-S7)
- `FR-25`: partially satisfied (environment-owned registry state now exists and
  is internally accessible without the default global singleton; ts-compiler
  ambient-generation consumption remains with Phase S5 and real-app proof
  remains with Phases S6-S7)
- `FR-6`: fully satisfied (environment-owned registrations, created brains, and
  invalidation state are isolated per runtime context in the package seam)
- `FR-7`: fully satisfied (environment-shared, overlay, and automatic
  brain-local tile scopes are implemented in the package seam)
- `FR-8`: partially satisfied (the effective shared/hydrated/bundle/overlay/
  brain-local lookup order is implemented and regression-tested; compiler-
  produced metadata proof remains with Phase S3 and real-app proof remains with
  Phase S6)
- `FR-14`: partially satisfied (stable brain handles, rebuild-on-handle, and
  explicit disposal semantics are implemented; fuller disposed-brain coverage in
  the authored-bundle path remains with Phase S3 and real-app proof remains
  with Phase S6)
- `FR-15`: fully satisfied (repeated creation from one `BrainDef` now produces
  independent runtime instances with separate runtime and invalidation state)
- `NFR-1`: partially satisfied (the core-facing seam was validated across node,
  esm, and rbx builds; full compiler/app proof remains with Phase S6)
- `NFR-2`: partially satisfied (shared runtime-facing environment behavior and
  bundle consumption remain platform-neutral in `packages/core`; full consumer
  proof remains with Phase S6)
- `NFR-3`: satisfied as planned
- `NFR-5`: partially satisfied (explicit disposal removes brains from
  environment bookkeeping in the package seam; broader authored-bundle
  lifecycle coverage remains with Phase S3)
- `INV-1`: partially satisfied (the seam treats duplicate tile IDs as abnormal
  and keeps no-shadowing as the intended rule, but stable precedence is still
  defined defensively to preserve pre-S2 behavior; remaining bundle/hydration
  hardening stays with Phase S3)

### Phase S3 -- 2026-04-05

**Planned vs actual:**

All 12 concrete S3 deliverables landed at the package seam, although several
details only stabilized through review-driven refinements rather than the first
implementation pass.

- `packages/core` finalized the authored-action bundle seam with environment-
  owned hydration and bundle catalogs, atomic hydration-to-bundle handoff,
  tracked-brain invalidation, explicit rebuild control, and persisted-brain
  deserialization against hydrated and bundled metadata.
- `packages/ts-compiler` now adapts project compile output into whole-snapshot
  `CompiledActionBundle` values via `buildCompiledActionBundle(...)`, including
  deduped shared parameter tiles and a no-bundle result when compile output or
  bundle-time metadata resolution is not safe to install.
- `packages/ui` now owns the normal tile-presentation path through
  `resolveTileVisual(...)`, and sim now feeds presentation through editor config
  instead of bootstrap-time global visual-provider mutation.
- Startup-hydrated metadata and bundle-installed metadata now remain semantic
  only; executable authored actions still arrive only through bundle
  replacement.
- The public bundle/hydration contracts are now explicitly separate, and the
  bundle container shape is intentionally asymmetric: keyed runtime action data
  uses `Dict`, while tile metadata remains a whole-snapshot transfer array.

One planned cleanup landed as a narrowed migration decision rather than
deletion:

- `setTileVisualProvider()` remains in core only as a legacy fallback
  augmentation shim, but it is no longer part of the primary bundle/UI
  integration path.

One planned proof remains deferred by phase design:

- S3 completed the package-level seam and a small sim presentation slice, but
  full sim runtime adoption of `buildCompiledActionBundle(...)`,
  `replaceActionBundle(...)`, and startup hydration remains Phase S6 work.

**Unplanned additions and discoveries:**

1. Review found that persisted-brain binary deserialization could duplicate
   catalog chaining on some rule paths, so S3 threaded extra catalogs through
   `BrainDef`, `BrainPageDef`, and `BrainRuleDef` and added dedicated binary
   regression tests.
2. Review found that generic fallback labels were leaking into app visuals and
   literal formatting. S3 centralized fallback-label handling in core/UI helper
   functions and moved literal/variable/accessor fallback label ownership into
   shared UI resolution.
3. Review found that hydrated and bundle-owned semantic catalogs should not run
   through the global visual provider at all. Environment-owned bundle and
   hydration catalog replacement now uses raw catalog insertion instead of the
   legacy registration path.
4. Review found that treating a compiled bundle as the hydration contract was
   semantically wrong even when the field shapes overlapped. The contracts were
   separated, the design docs were synced, and the temporary shared field
   helper was removed after review.
5. Review found that the ts-compiler root API was still exposing two
   incompatible authored-action paths. The root surface now exposes
   `buildCompiledActionBundle(...)` rather than the legacy singleton
   `registerUserTile(...)` bridge.
6. Review rejected a one-off custom `UnknownUserTileParameterTypeError` as a
   codebase convention break. The final bundle path uses the package's normal
   `undefined` contract instead, while the legacy direct-registration bridge
   remains fail-fast with a plain `Error`.

**Design decisions:**

- Keep tile presentation app/UI-owned through `resolveTileVisual(...)`; do not
  reintroduce a process-global core presentation registry into the normal path.
- Keep `HydratedTileMetadataSnapshot` and `CompiledActionBundle` separately
  declared even when they currently share fields.
- Treat `CompiledActionBundle` as a whole-snapshot seam. `actions` stays a
  keyed `Dict`, while `tiles` stays a readonly transfer list.
- Keep overlap-safe deferred rebuilds on the no-args
  `rebuildInvalidatedBrains()` seam against the environment's live invalidation
  set.
- Keep `setTileVisualProvider()` only as a legacy fallback augmentation shim,
  not as part of the primary authored-action or UI path, and remove it in
  Phase S7.
- Keep the legacy singleton registration bridge off the ts-compiler root API
  and avoid custom runtime error subclasses for unresolved bundle-time metadata.

**Files changed:**

- `packages/core/src/mindcraft.ts`
- `packages/core/src/mindcraft.spec.ts`
- `packages/core/src/mindcraft-environment.spec.ts`
- `packages/core/src/brain/model/braindef.ts`
- `packages/core/src/brain/model/pagedef.ts`
- `packages/core/src/brain/model/ruledef.ts`
- `packages/core/src/brain/model/ruledef.spec.ts`
- `packages/core/src/brain/tiles/catalog.ts`
- `packages/core/src/brain/tiles/catalog.spec.ts`
- `packages/ui/src/brain-editor/BrainEditorContext.tsx`
- `packages/ui/src/brain-editor/BrainTile.tsx`
- `packages/ui/src/brain-editor/BrainPrintView.tsx`
- `packages/ui/src/brain-editor/BrainPrintTextView.tsx`
- `packages/ui/src/brain-editor/BrainTilePickerDialog.tsx`
- `packages/ui/src/brain-editor/hooks/useTileSelection.ts`
- `packages/ui/src/brain-editor/tile-visual-utils.ts`
- `packages/ts-compiler/src/index.ts`
- `packages/ts-compiler/src/runtime/action-bundle.ts`
- `packages/ts-compiler/src/runtime/action-bundle.spec.ts`
- `packages/ts-compiler/src/runtime/user-tile-metadata.ts`
- `packages/ts-compiler/src/runtime/registration-bridge.ts`
- `packages/ts-compiler/src/runtime/registration-bridge.spec.ts`
- `apps/sim/src/bootstrap.ts`
- `apps/sim/src/brain-editor-config.tsx`
- `apps/sim/src/brain/tiles/accessors.ts`
- `apps/sim/src/brain/tiles/variables.ts`
- `apps/sim/src/brain/tiles/visual-provider.ts`
- `docs/specs/features/mindcraft-seam-design.md`

**Verification:**

- `packages/core`: repeated `npm run typecheck`, `npm run check`,
  `npm run build`, and `npm test` during S3 review refinements; final package
  verification passed after the contract-separation cleanup
- `packages/ui`: `npm run typecheck`, `npm run check`
- `apps/sim`: `npm run typecheck`, `npm run check`
- `packages/ts-compiler`: `npm run typecheck`, `npm run check`, `npm test`
  with a final passing result of 559 tests, 0 failures

**Acceptance criteria result:**

S3 is accepted at the package seam. Core now owns hydration, bundle
replacement, invalidation, and persisted-brain deserialization behavior for
authored actions; ts-compiler can emit the whole-snapshot bundle contract that
core consumes; and the normal tile-presentation path is app/UI-owned rather
than process-global. Full sim runtime adoption and final bridge/product
guidance remain with Phases S6-S7.

### Requirements retrospective

- `FR-2`: partially satisfied (the bridge-free compiler/runtime bundle seam is
  implemented and exposed through `buildCompiledActionBundle(...)`; real-app
  proof remains with Phase S6 and final public guidance remains with Phase S7)
- `FR-6`: satisfied as planned
- `FR-7`: satisfied as planned
- `FR-8`: partially satisfied (the package seam now resolves shared,
  hydrated, compiled, overlay, and brain-local metadata during persisted-brain
  load and runtime lookup; real-app proof remains with Phase S6 and final
  public guidance remains with Phase S7)
- `FR-9`: partially satisfied (startup hydration is implemented at the package
  seam and validated against persisted-brain loading; real-app cold-start proof
  remains with Phase S6)
- `FR-10`: satisfied as planned
- `FR-11`: partially satisfied (authoritative whole-snapshot bundle handoff is
  implemented in core and ts-compiler; real-app proof remains with Phase S6)
- `FR-12`: partially satisfied (selective invalidation is implemented and
  regression-tested at the core seam; real-app proof remains with Phase S6)
- `FR-13`: partially satisfied (deferred rebuild control is implemented and
  overlap-safe at the core seam; real-app proof remains with Phase S6)
- `FR-14`: satisfied as planned
- `FR-16`: satisfied as planned
- `FR-17`: satisfied as planned
- `NFR-1`: partially satisfied (the bundle/hydration seam was validated in
  `packages/core` and `packages/ts-compiler` without abandoning core target
  constraints; real-app proof remains with Phase S6 and final full-stack
  completion remains with Phase S7)
- `NFR-2`: partially satisfied (runtime-facing bundle consumption remains
  platform-neutral in shared core code and app-owned presentation stays out of
  core semantic catalogs; real-app proof remains with Phase S6)
- `NFR-4`: partially satisfied (cold-start semantics are implemented and tested
  at the package seam; real-app cold-start proof remains with Phase S6)
- `NFR-5`: satisfied as planned
- `INV-1`: satisfied as planned
- `INV-2`: satisfied as planned
- `INV-3`: satisfied as planned