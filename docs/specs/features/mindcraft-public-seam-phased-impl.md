# Mindcraft Public Seam -- Phased Implementation Plan

Reshape the public integration seams of `@mindcraft-lang/core` and
`@mindcraft-lang/bridge-app` so Mindcraft-enabled apps can compose the runtime,
user-authored tile compilation, and bridge connectivity without depending on
global registries, concrete runtime classes, or low-level transport objects.

Companion design doc: [mindcraft-seam-design.md](mindcraft-seam-design.md).

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

As of 2026-04-04, none of the phases in this document have been implemented.
The current product behavior works, but the recommended integration path still
has three structural problems:

- `@mindcraft-lang/core` integration is centered on process-global state
  (`registerCoreBrainComponents()`, `getBrainServices()`,
  `setTileVisualProvider()`).
- `@mindcraft-lang/bridge-app` integration is centered on `AppProject`, which
  exposes low-level transport internals (`session`, `files`) and also mixes in
  optional compilation behavior.
- `apps/sim` proves the stack works, but it has to compose it through deep
  imports, compatibility hooks, synthetic file-import events, and app-owned
  caches that should instead be hidden behind clearer package seams.

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
   - Records the outcome in the Phase Log (bottom of this doc). The Phase Log
     is a post-mortem artifact -- never write it during implementation.
   - Amends upstream specs with dated notes if they were wrong or
     underspecified.
   - Propagates discoveries to upcoming phases in this doc (updated risks,
     changed deliverables, new prerequisites).
   - Writes a repo memory note with key decisions for future conversations.
5. **Next phase** -- New conversation (or same if context is not exhausted).

The planning doc is the source of truth across conversations. Session memory
does not survive. Keep this doc current.

---

## Non-Goals

This plan does **not** aim to:

- redesign the bridge protocol message shapes
- change bytecode or VM semantics
- change the functional behavior of the compiler pipeline
- preserve old public seams purely for backward compatibility

The first goal is a clean new seam, not artificial continuity with legacy API
shapes.

The plan also does **not** assume up front that the final recommended app-facing
entrypoint must live directly in `@mindcraft-lang/core`. If the core package's
multi-target constraints make that materially worse, a dedicated node/browser
facade package is an acceptable outcome.

There are currently no external compatibility constraints on this work. If a
breaking API cleanup is the cleanest path, that is acceptable. Temporary
adapters or shims are only justified when they reduce implementation risk or
help stage the migration of internal call sites such as sim.

Any temporary shim or adapter introduced during this work must have an explicit
removal point. By the end of this plan, temporary shims/adapters should no
longer exist in the codebase unless they have been consciously promoted into a
permanent, intentional API.

---

## Current State

(2026-04-04)

### Core integration seam

- `packages/core/src/brain/index.ts` exposes
  `registerCoreBrainComponents()`, which creates services, writes them into the
  global singleton in `packages/core/src/brain/services.ts`, then registers
  runtime and tile components.
- `packages/core/src/brain/services.ts` stores a single mutable global
  `BrainServices` instance and exposes `getBrainServices()`,
  `setBrainServices()`, `hasBrainServices()`, and reset aliases.
- `packages/core/src/brain/tiles/catalog.ts` stores a single mutable global
  tile visual provider through `setTileVisualProvider()`.
- The practical integration story for apps is still:
  - initialize the global services once
  - register app-specific types/functions/tiles into those services
  - instantiate `Brain` directly from `@mindcraft-lang/core/brain/runtime`
  - read and mutate registries through `getBrainServices()`

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

### Sim as proof of the current seam

- `apps/sim/src/bootstrap.ts` calls `setTileVisualProvider()`,
  `registerCoreBrainComponents()`, `registerBrainComponents()`,
  `registerUserTilesAtStartup()`, and `initProject()` during bootstrap.
- `apps/sim/src/services/brain-runtime.ts` imports the concrete `Brain` class,
  uses `getBrainServices()` to build catalogs and resolve host actions, and
  keeps app-owned user action artifact maps.
- `apps/sim/src/services/user-tile-registration.ts` directly manipulates the
  tile and type registries through `getBrainServices()`, instantiates concrete
  tile definition classes, and persists user tile metadata separately from the
  compiler and runtime.
- `apps/sim/src/services/vscode-bridge.ts` constructs `AppProject`, reaches into
  `project.session`, `project.files`, and `project.compilation`, and triggers a
  synthetic `import` notification to seed startup compilation.

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

---

## Target End State

The final integration story should support three clean adoption tiers.

The examples below assume the clean seam can live directly in
`@mindcraft-lang/core`. If Phase S1 determines that doing so would require too
many Roblox-driven compromises in the default app-facing API, the same examples
may instead use a dedicated node/browser facade package layered over core.

That facade option does **not** replace the required Roblox-facing root import
pattern of `@mindcraft-lang/core`; it only offers a cleaner node/browser-facing
entrypoint if needed.

### 1. Core-only app

```ts
import { createMindcraftEnvironment, coreModule } from "@mindcraft-lang/core";

const environment = createMindcraftEnvironment({
  modules: [coreModule(), createAppModule()],
});

const brain = environment.createBrain(brainDef, {
  context: actor,
  catalogs: [brainDef.catalog()],
});
```

### 2. Core + TypeScript-authored tiles

```ts
import { createMindcraftEnvironment, coreModule } from "@mindcraft-lang/core";
import { createWorkspaceCompiler } from "@mindcraft-lang/ts-compiler";

const environment = createMindcraftEnvironment({
  modules: [coreModule(), createAppModule()],
});

const compiler = createWorkspaceCompiler({ ambientFiles, tsconfig });
const snapshot = compiler.compile();

environment.replaceActionBundle(snapshot.bundle);
```

### 3. Core + compiler + VS Code bridge

```ts
import { createAppBridge } from "@mindcraft-lang/bridge-app";
import { createCompilationFeature } from "@mindcraft-lang/bridge-app/compilation";

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
- module installation API
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

Optional facade package owns:

- a cleaner node/browser-facing integration surface when exposing that seam
  directly from `@mindcraft-lang/core` would be too distorted by multi-target
  constraints
- re-exporting/adapting the recommended runtime-facing APIs for app consumers

The facade package would not replace core internally. It would sit above core as
the preferred app-facing package for browser/node apps if Phase S1 concludes
that this produces a better seam.

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

### Allowed packaging escape hatch

If a clean app-facing seam in `@mindcraft-lang/core` would require awkward
API-level gymnastics because of the multi-target / Roblox-safe requirements,
this plan explicitly allows introducing a dedicated node/browser facade package.

Use that option only if it genuinely improves the default app experience. The
facade should stay thin:

- core remains the implementation foundation
- the facade re-exports/adapts rather than re-implements semantics
- bridge-app and ts-compiler compose against the facade for app-facing usage,
  while remaining separate packages

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
contracts for the new seam without changing the underlying behavior yet.

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
   - `MindcraftModule`
   - `MindcraftModuleApi`
   - `CreateBrainOptions`
   - `CompiledActionBundle`
2. Add top-level bridge-app public contract types for the new seam:
   - `AppBridge`
   - `AppBridgeOptions`
   - `AppBridgeSnapshot`
   - `WorkspaceAdapter`
   - `AppBridgeFeature`
3. Add a new bridge-app compilation subpath contract:
   - `WorkspaceCompiler`
   - `DiagnosticSnapshot`
   - `createCompilationFeature(...)`
4. Lock the naming and export-map story before deeper refactors begin.
5. Add minimal tests that verify the new symbols export cleanly and can be
   imported without reaching into old subpaths.
6. Confirm that any new `packages/core` export-map or file-layout changes do not
  conflict with the node/esm/rbx package shape.
7. Decide whether the recommended app-facing seam should live directly in
   `@mindcraft-lang/core` or in a dedicated node/browser facade package layered
   over core. Document that decision before Phase S2 begins.
8. Preserve the existing Roblox-facing root import shape of `@mindcraft-lang/core`,
  including the `brain` namespace export and `brain.compiler` /
  `brain.tiles` access pattern.

**Notes:**

- Phase S1 is intentionally shallow. It defines the public seam first so later
  phases can refactor internals without renaming the API every step.
- The new contracts should avoid leaking `BrainServices`, `ProjectSession`,
  `ProjectFiles`, or concrete tile-definition classes.
- If the facade-package path is chosen, S1 should also settle its scope: thin
  re-export/adapter layer only, not a second implementation stack.
- S1 should also explicitly decide which legacy exports will be retained
  temporarily for internal migration only, and which can be removed outright.

**Risks:**

- Premature naming churn. If the public names are unstable, later phases become
  expensive. Keep S1 focused on the smallest useful API vocabulary.

**Common failure modes:**

- S1 defines names that still leak `BrainServices`, `ProjectSession`,
  `ProjectFiles`, or other low-level internals into the new seam.
- S1 leaves the direct-core-vs-facade decision unresolved, forcing later phases
  to build against a moving target.
- S1 introduces provisional aliases or export shims without clear ownership or
  a removal plan.
- S1 produces a second implementation stack instead of a thin facade if the
  facade-package option is chosen.
- S1 accidentally breaks or de-emphasizes the required Roblox import shape from
  `@mindcraft-lang/core`, especially the `brain` namespace export.

---

## Phase S2: Environment-scoped core runtime and module installation

**Objective:** Make the new core integration path environment-scoped rather than
process-global, with legacy globals retained only if they still reduce internal
migration risk.

**Prerequisites:** Phase S1.

This phase assumes S1 has already decided whether the primary app-facing symbols
are exported directly from `@mindcraft-lang/core` or from a thin facade layered
over it.

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
2. Implement `coreModule()` as the environment-scoped replacement for
   `registerCoreBrainComponents()`.
3. Add `environment.createCatalog()` and `environment.createBrain(...)`.
4. Route host action resolution and catalog composition through the environment
   rather than through `getBrainServices()` in the new path.
5. Decide explicitly whether legacy singleton-oriented APIs are:
  - removed outright in this phase, or
  - retained temporarily as thin migration shims over the new environment.
6. Add tests proving that two environments can coexist without leaking types,
   tiles, actions, or operator registrations into each other.
7. Validate that the environment implementation is Roblox-safe in shared core
   code: no Node/browser-only assumptions, no forbidden shared-code constructs,
   and no breakage of the existing platform abstraction pattern.
8. Ensure the new seam coexists with the preserved root export shape so Roblox
  consumers can continue using `import { brain, List, logger } from
  "@mindcraft-lang/core"`.

If S1 chose the facade-package route, S2 still implements the environment in
core; the facade only re-exports/adapts the finished core seam.

**Notes:**

- The critical success condition for S2 is that a new app can use the new core
  API without touching the singleton seam.
- Existing deep subpaths or singleton helpers do not need to be preserved unless
  they still earn their keep during internal migration.

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

1. Implement `environment.replaceActionBundle(bundle)` and
   `environment.removeActions(keys)`.
2. Define the exact core contract for a `CompiledActionBundle` so
   `@mindcraft-lang/ts-compiler` can produce data that the core runtime can
   consume without app-owned side maps.
3. Add a compiler-side adapter or helper that maps project compile output into
   the bundle contract.
4. Introduce a non-global tile presentation seam for the new path, such as a
   presentation resolver or catalog-scoped presentation source.
5. Decide whether `setTileVisualProvider()` is still worth keeping as a
  temporary migration shim or whether this phase should remove it from the
  primary integration path entirely.
6. Add tests covering bundle replacement, bundle removal, and presentation
   isolation across multiple environments.
7. Ensure the semantic bundle contract remains platform-neutral so it can be
  consumed by the Roblox, node, and esm core runtimes without target-specific
  public API branches.

**Notes:**

- Phase S3 is the boundary between the compiler and the runtime. If this seam is
  well-shaped, app code no longer needs to directly maintain user action
  artifact maps and tile metadata registries just to consume compiler output.
- Startup metadata hydration for persisted brains must remain supported.
- Tile presentation is especially important to isolate here because it is more
  naturally app/UI-facing, while `packages/core` must remain viable for Roblox
  and other non-DOM consumers.
- The compiler package is still not a Roblox target. The requirement here is
  that the bundle contract it emits for core stays platform-neutral enough for
  the multi-target core runtime.

**Risks:**

- Persisted brains currently depend on user tile metadata being available early
  enough for deserialization. The new bundle/presentation seam must preserve
  that startup behavior.
- Do not let presentation concerns leak back into the semantic bundle contract.

**Common failure modes:**

- The compiled action bundle contract carries app/UI details that do not belong
  in a core runtime seam.
- The compiler-side adapter keeps app-owned state alive instead of collapsing it
  into the new bundle seam.
- Presentation remains effectively process-global even though the API shape has
  been renamed.
- Temporary bundle/presentation adapters remain in place after the new core seam
  is fully wired.

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
2. Introduce `WorkspaceAdapter` as the seam between app-owned workspace state
   and the bridge transport.
3. Support the essential lifecycle and query methods on the new facade:
   - `start()`
   - `stop()`
   - `requestSync()`
   - `snapshot()`
   - `onStateChange(...)`
   - `onRemoteChange(...)`
4. Decide whether `AppProject` remains temporarily as an internal migration aid
  or is replaced outright by the new facade in this phase.
5. Add tests for connection status transitions, join-code propagation, remote
   file-change delivery, and sync behavior.

**Notes:**

- S4 should prefer adapting over the existing `Project`/`ProjectSession`
  machinery rather than rebuilding bridge logic from scratch.
- The new facade should not expose `session`, `files`, or any `Project`-level
  internals.

**Risks:**

- It is easy to build a facade that still leaks transport detail through its
  callbacks or snapshot model. Keep the public vocabulary at the app-domain
  level.

**Common failure modes:**

- `createAppBridge()` still effectively exposes `Project`, `session`, or
  `files`, just under softer naming.
- The facade is so thin that apps still need to understand low-level transport
  behavior to use it correctly.
- `AppProject` remains the real primary integration path and the new facade is
  only cosmetic.
- A temporary adapter layer around `AppProject` survives after the facade has
  taken over.

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

1. Introduce `createCompilationFeature({ compiler, publishStatus? })` on the
   new `@mindcraft-lang/bridge-app/compilation` subpath.
2. Replace the root-level `CompilationProvider` seam with a feature-oriented
   `WorkspaceCompiler` seam for the new integration path.
3. Refactor `CompilationManager` into the feature implementation so it is no
   longer conceptually part of the base bridge connection object.
4. Preserve the current diagnostic replay behavior when an extension pairs after
   compilation has already run.
5. Decide whether the old `AppProject({ compilationProvider })` shape survives
  temporarily as an internal migration shim or is replaced directly by the
  feature-based surface.

**Notes:**

- The bridge protocol does not need to change in S5. The improvement is purely
  at the package seam.
- The new shape should let apps opt into bridge connectivity without also taking
  a dependency on compiler-specific abstractions.

**Risks:**

- Startup compile ordering and cached-diagnostic replay are easy to break when
  refactoring this seam. Preserve the current behavior before trying to improve
  it.

**Common failure modes:**

- The compilation feature is still conceptually welded into the base bridge
  connection object.
- The old `compilationProvider` path remains the primary codepath instead of a
  short-lived migration aid.
- Diagnostic replay or startup compile ordering regresses during the refactor.
- Temporary dual-wiring between the old and new compilation seams remains after
  feature-based wiring is complete.

---

## Phase S6: Migrate sim to the new core seam

**Objective:** Prove the new core environment/module seam against the real sim
app and remove direct registry access from the normal sim integration path.

**Prerequisites:** Phases S2 and S3.

**Packages/files touched:**

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
   rather than importing and constructing `Brain` directly.
4. Update the user-authored action integration path so the sim consumes compiler
   output through `replaceActionBundle(...)` rather than maintaining the primary
   runtime state in app-owned maps.
5. Preserve persisted-brain loading, startup user tile hydration, and rebuild of
   active brains whose linked action revisions changed.
6. Confirm that the new sim-facing core integration is still built on top of a
  core API that remains valid for Roblox-targeted consumers, rather than a
  browser-specific shortcut.
7. If a facade package is used for sim, keep that strictly as a node/browser
  convenience layer; do not move the required Roblox-facing root export shape
  out of `@mindcraft-lang/core`.

**Notes:**

- Some advanced sim code may still need deep subpaths temporarily. The goal of
  S6 is to move the composition root and ordinary runtime path first.
- If an internal helper still uses `getBrainServices()` during migration, that
  is acceptable as an intermediate step as long as the new app-facing seam is in
  place and the composition root no longer depends on it.

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
- Temporary app-level adapters added to get sim across the transition remain in
  the codebase after the new seam is working.
- The sim-oriented refactor accidentally becomes the default shape for Roblox
  consumers too, even though their root import pattern is required to stay
  supported.

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
5. Remove, privatize, or explicitly demote legacy app-facing seams that are no
   longer justified once sim has migrated:
   - `registerCoreBrainComponents()` if it no longer serves a clear internal role
   - `getBrainServices()` as an app-integration primitive
   - `setTileVisualProvider()` as a primary integration mechanism
   - `AppProject` as the recommended app-facing bridge API

**Notes:**

- S7 should end with the new seam documented as the gold-standard path.
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

---

## Phase Ordering Rationale

- S1 fixes names and exports first so later work has a stable target.
- S2 and S3 establish the new core seam before the app migration starts.
- S4 and S5 establish the new bridge seam before sim's bridge layer migrates.
- S6 proves the core seam in a real app.
- S7 proves the bridge seam in the same app and updates the public guidance.

This ordering keeps each phase focused on a single package boundary while still
producing useful partial outcomes.

---

## Success Criteria

This plan is successful when all of the following are true:

1. A new app can integrate Mindcraft runtime features through the recommended
  app-facing package -- either `@mindcraft-lang/core` directly or a dedicated
  facade layered over core -- without calling `registerCoreBrainComponents()`
  or `getBrainServices()`.
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