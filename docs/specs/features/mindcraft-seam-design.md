# Mindcraft Seam Design

Phased implementation plan: [mindcraft-public-seam-phased-impl.md](mindcraft-public-seam-phased-impl.md).
That document is the authoritative source for sequencing, phase scope, and
implementation workflow.

Date: 2026-04-04

## Goal

Design a clean public seam so that:

- apps can use `@mindcraft-lang/core` by itself
- apps can optionally add TypeScript-authored tiles from `@mindcraft-lang/ts-compiler`
- apps can optionally add the VS Code bridge stack
- each layer composes cleanly without importing hidden registries, transport internals, or concrete runtime classes

## What Is Wrong Today

The current seam works, but it is harder to understand and integrate than it should be.

### Core problems

- `packages/core/src/brain/services.ts` uses a process-global `BrainServices` singleton.
- `packages/core/src/brain/tiles/catalog.ts` uses a process-global tile visual provider.
- integration code reaches into low-level registry objects through `getBrainServices()`.
- apps instantiate `Brain` directly from `@mindcraft-lang/core/brain/runtime` instead of using a stable factory.
- app code imports implementation classes like `BrainTileSensorDef`, `BrainTileActuatorDef`, and `BrainTileParameterDef`.

### Bridge problems

- `packages/bridge-app/src/app-project.ts` subclasses the low-level `Project` and exposes `session` and `files` to app code.
- `packages/bridge-app/src/app-project.ts` also owns optional compilation behavior, so one public class now mixes connection state, workspace sync, join code, and diagnostics transport.
- `apps/sim/src/services/vscode-bridge.ts` has to know about `project.session`, `project.files.raw.export()`, `project.compilation`, and synthetic import notifications just to bootstrap the flow.

### Composition problems

- `apps/sim/src/bootstrap.ts`, `apps/sim/src/brain/index.ts`, `apps/sim/src/services/brain-runtime.ts`, and `apps/sim/src/services/user-tile-registration.ts` split one logical integration across several global hooks.
- user-authored tile metadata, compiled artifacts, action revision tracking, and tile registration live in separate app services instead of one cohesive extension boundary.
- semantic tile registration and visual tile presentation are coupled even though they belong to different layers.

## Design Principles

The new seam should follow these rules.

1. No process-global mutable runtime state in the public API.
2. Composition over inheritance at package boundaries.
3. Public APIs expose domain concepts, not internal registries.
4. Core owns language semantics and runtime. It does not own transport.
5. Bridge packages own transport and synchronization. They do not own core runtime construction.
6. TypeScript compilation is optional and should plug into core and bridge through narrow interfaces.
7. Semantic tile definitions and editor presentation should be separate concerns.
8. `@mindcraft-lang/core` is a multi-target package, so the public seam must be designed for Roblox-TS constraints first, not retrofitted later.

## Core Platform Constraint

`@mindcraft-lang/core` targets three environments:

- Node.js
- ESM/browser
- Roblox-TS / Luau

The seam redesign has to respect the hardest target in that set. In practice,
that means avoiding public or internal shared-code designs that depend on
Node/browser-only behavior, dynamic JS metaprogramming, or patterns that do not
survive the existing `.ts` + `.node.ts` + `.rbx.ts` platform split.

This concern is specific to `@mindcraft-lang/core` and to contracts that cross
into the core runtime surface. It does **not** mean that
`@mindcraft-lang/ts-compiler`, `@mindcraft-lang/bridge-app`, or
`@mindcraft-lang/bridge-client` must themselves target Roblox-TS. Those
packages remain node/browser-oriented; the important constraint is that they do
not impose a JS-only seam on core.

This is not just an implementation detail. It should influence the shape of the
public API itself:

- environment/module APIs should compile cleanly in shared core code
- semantic contracts consumed by core should stay platform-neutral
- presentation and app-shell concerns should stay out of the shared runtime seam
- compatibility wrappers must not quietly push the real logic back into a
  process-global JS-only model

There is also an export-shape constraint here, not just an implementation
constraint. Roblox-side application code relies on the root-package import style
that `@mindcraft-lang/core` already supports:

```ts
import { brain, List, logger } from "@mindcraft-lang/core";

const { mkCallDef } = brain;
const { parseRule } = brain.compiler;
const {
  BrainTileSensorDef,
  BrainTileModifierDef,
  BrainTileParameterDef,
  BrainTileLiteralDef,
  BrainTileOperatorDef,
  BrainTileControlFlowDef,
} = brain.tiles;
const {
  CoreTypeIds,
  mkParameterTileId,
  mkModifierTileId,
  CoreControlFlowId,
  getBrainServices,
  VOID_VALUE,
  registerCoreBrainComponents,
} = brain;
```

That import pattern must remain valid. A cleaner seam can be added alongside it,
but the redesign cannot require Roblox consumers to abandon the root
`{ brain, List, logger }` package shape or the `brain.compiler` /
`brain.tiles` namespace traversal style.

If S2 reveals that Roblox constraints distort the app-facing API, we may
introduce a thin node/browser facade package; that decision is deferred.

## Target Layering

```text
App
|- uses @mindcraft-lang/core
|- optionally uses @mindcraft-lang/ts-compiler for user-authored tiles
|- optionally uses @mindcraft-lang/bridge-app for bridge connectivity

@mindcraft-lang/core
|- environment
|- modules
|- catalogs
|- model/compiler/runtime

@mindcraft-lang/ts-compiler
|- workspace compiler
|- diagnostics
|- compiled action bundle output

@mindcraft-lang/bridge-app
|- app-facing bridge connection
|- workspace sync
|- optional features such as diagnostics publishing

@mindcraft-lang/bridge-client
|- low-level websocket and filesystem sync primitives
```

The important point is that `core` and `bridge-app` should not know each other directly. They meet in the app through explicit interfaces.

## Proposed Core Public API

The main public object in core should be an environment, not a singleton.

```ts
export interface MindcraftEnvironment {
  createCatalog(): MindcraftCatalog;
  hydrateTileMetadata(snapshot: HydratedTileMetadataSnapshot): void;
  createBrain(definition: BrainDef, options?: CreateBrainOptions): MindcraftBrain;
  replaceActionBundle(bundle: CompiledActionBundle): ActionBundleUpdate;
  onBrainsInvalidated(listener: (event: BrainInvalidationEvent) => void): Disposable;
  rebuildInvalidatedBrains(brains?: Iterable<MindcraftBrain>): void;
}

export interface MindcraftBrain extends IBrain {
  readonly id: string;
  readonly definition: BrainDef;
  readonly status: "active" | "invalidated" | "disposed";
  rebuild(): void;
  dispose(): void;
}

export interface MindcraftCatalog {
  has(tileId: string): boolean;
  get(tileId: string): TileDefinitionInput | undefined;
  getAll(): readonly TileDefinitionInput[];
  registerTile(def: TileDefinitionInput): string;
  delete(tileId: string): boolean;
}

export interface CreateBrainOptions {
  context?: unknown;
  catalogs?: readonly MindcraftCatalog[];
}

export interface MindcraftModule {
  readonly id: string;
  install(api: MindcraftModuleApi): void;
}

export interface MindcraftModuleApi {
  defineType(def: MindcraftTypeDefinition): string;
  registerHostSensor(def: HostSensorDefinition): void;
  registerHostActuator(def: HostActuatorDefinition): void;
  registerFunction(def: HostFunctionDefinition): void;
  registerTile(def: TileDefinitionInput): string;
  registerOperator(def: OperatorDefinition): void;
  registerConversion(def: ConversionDefinition): void;
}

export interface HydratedTileMetadataSnapshot {
  readonly revision: string;
  readonly tiles: readonly TileDefinitionInput[];
}

export interface CompiledActionBundle extends HydratedTileMetadataSnapshot {
  readonly actions: Dict<string, CompiledActionArtifact>;
}

export interface ActionBundleUpdate {
  readonly changedActionKeys: readonly string[];
  readonly invalidatedBrains: readonly MindcraftBrain[];
}

export interface BrainInvalidationEvent extends ActionBundleUpdate {}

export declare function createMindcraftEnvironment(options?: {
  modules?: readonly MindcraftModule[];
}): MindcraftEnvironment;

export declare function coreModule(): MindcraftModule;
```

Invalidation semantics:

- the environment owns a current invalidation set for the brains it created
- each successful `replaceActionBundle(...)` unions newly affected brains into
  that set; it does not reset the set until brains are rebuilt or disposed
- `rebuildInvalidatedBrains()` with no arguments rebuilds the full current
  invalidation set at call time
- `ActionBundleUpdate.invalidatedBrains` and
  `BrainInvalidationEvent.invalidatedBrains` describe the brains affected by
  that specific replacement, not a durable deferred rebuild token across later
  overlapping bundle replacements

For v1, modules are supplied during environment construction through
`createMindcraftEnvironment({ modules: [...] })`.

The public seam intentionally omits runtime install/uninstall and module
handles until a concrete product use case exists. The current requirements only
need constructor-time installation.

`MindcraftModuleApi.registerFunction(...)` is required because the runtime has
a distinct function registry for callable built-ins that are neither operators
nor tile-backed sensors/actuators. This covers cases such as element/index
access helpers, map operations, math functions, and string methods. Operators
remain a separate path because they participate in precedence/fixity lookup
rather than ordinary function dispatch.

Default ambient declaration generation should still live in
`@mindcraft-lang/ts-compiler`, not in `@mindcraft-lang/core`. But v1 does not
need a public `MindcraftEnvironmentDescription` /
`describeMindcraftEnvironment(...)` contract to make that work.

Once S2 makes the registries environment-scoped, the compiler can read the
environment-owned registry state directly instead of reading
`getBrainServices()` or going through a new public description type. If a later
non-TypeScript tooling consumer needs a narrower formal metadata contract, that
can be added then.

`MindcraftBrain` must not be a lifecycle-only token. It is the stable
app-facing runnable brain object returned by `createBrain(...)`.

That means the new seam must preserve the current execution surface apps depend
on, including:

- startup/shutdown/tick style runtime control
- page control and page inspection
- executable-program and compiled-program inspection
- access to execution state needed by app/runtime integration, such as
  execution context and scheduler state

If `IBrain` is kept, `MindcraftBrain` should extend it. If `IBrain` is replaced
by a successor interface, the successor must still carry those observable
runtime capabilities. Apps should not need to import or downcast to the
concrete `Brain` runtime class just to use a created brain.

`BrainDef` and `MindcraftBrain` also need a clean many-to-one mapping.
Sim's current model is the right reference point: a small number of authored
brain definitions may be reused across many live actor instances, and each live
actor still needs its own runnable brain.

So the seam should treat:

- `BrainDef` as a reusable authored definition/template
- `environment.createBrain(definition, options)` as a request to create one new
  runnable instance from that definition
- `MindcraftBrain` as that per-instance runtime controller

Many `MindcraftBrain` values may therefore share the same `definition`, but
they must not share per-instance runtime state such as:

- variables
- current and previous page state
- scheduler/fiber state
- execution context data
- linked-action revision tracking

Changing which definition an app wants a live entity to use remains an app-level
decision. Reusing or editing a `BrainDef` must not implicitly merge or alias the
runtime state of already-created brains.

## Catalog Model

`MindcraftCatalog` is the semantic tile catalog in the new seam.

It narrows raw app-facing use of `ITileCatalog`, but the composition model
should stay close to the current runtime so brain compilation, deserialization,
and editor tooling continue to see the same kinds of semantic tile metadata.

This is a public contract narrowing, not license to replace the underlying
serialization/storage model with a new unrelated data structure. In v1,
`MindcraftCatalog` should be backed by `TileCatalog` or by a direct successor
that preserves the same distributed-ownership serialization protocol.

That means the existing ownership chain remains intact:

- `BrainDef -> catalog() -> serialize` / `deserialize`
- `BrainDef -> catalog() -> toJson` / `fromJson`
- `TileCatalog` (or its direct successor) remains the owner of per-brain tile
  serialization and tile-definition round-tripping

So `brainDef.catalog()` is still the per-brain local serialization owner.
`MindcraftCatalog` is the public interface over that implementation, not a
separate storage format.

There are three distinct catalog roles:

1. Environment-shared catalogs.
  These hold tiles that should be visible to every brain created from the
  environment.
2. App-owned overlay catalogs.
  These are extra mutable catalogs created by the app and passed explicitly to
  `createBrain(...)` when needed.
3. Brain-local catalogs.
  `brainDef.catalog()` continues to hold per-brain serialized tiles such as
  literals, variables, page tiles, and missing-tile placeholders.

### What `createCatalog()` returns

`environment.createCatalog()` returns a new empty mutable overlay catalog.

That overlay catalog should use the same underlying catalog implementation
family as the rest of the model-layer catalog chain so deserialization,
editor/tooling lookup, and tile-definition ownership stay coherent.

It does not return:

- a snapshot of environment-installed tiles
- a clone of the current bundle tiles
- a live view over every tile visible to the environment

The intent is app-owned overlay state, not access to the environment's shared
catalog internals.

Example:

```ts
const sessionCatalog = environment.createCatalog();
sessionCatalog.registerTile(debugTile);

const brain = environment.createBrain(brainDef, {
  context: actor,
  catalogs: [sessionCatalog],
});

brain.startup();
brain.think(now);
```

### Where module, hydration, and bundle tiles live

Tiles registered through `MindcraftModuleApi.registerTile(...)` live in the
environment's shared installed catalog state established during environment
construction.

Module-installed runtime functions registered through
`MindcraftModuleApi.registerFunction(...)` live in the environment's shared
function registry state. That registry is distinct from the operator table and
from the environment's shared tile catalogs.

`hydrateTileMetadata(snapshot)` loads a startup-hydration fallback catalog from
persisted semantic tile metadata before the compiler runs.

`CompiledActionBundle.tiles` live in a separate environment-managed bundle
catalog state that is synchronized by `replaceActionBundle(...)`.

If authored actions are removed, the next complete bundle snapshot simply omits
them. V1 does not add a second public incremental mutation API for authored
action removal.

Publicly, both of those behave as environment-shared catalogs that are visible
to all brains created by that environment. The implementation may internally
segment them per module or per bundle to support replacement cleanly, but that
segmentation is an internal detail rather than the public model.

### How `createBrain(...)` composes catalogs

`environment.createBrain(definition, options)` should compile/link against the
effective catalog set in this order:

1. environment-installed shared tiles
2. startup-hydrated fallback tiles from `hydrateTileMetadata(...)`
3. environment bundle-managed tiles from the current `CompiledActionBundle`
4. any additional app-owned overlay catalogs from `options.catalogs`
5. `definition.catalog()` as the automatic brain-local catalog

`definition.catalog()` is therefore not something callers should manually pass
back through `CreateBrainOptions`. It is already part of the brain definition
and should always be included automatically.

Successful `replaceActionBundle(...)` is the authoritative update path. It
should replace the startup-hydrated fallback metadata rather than coexisting
with it indefinitely.

Because catalog lookup is effectively first-match-wins, the hydration-to-bundle
handoff must be atomic. The current seam does not model multiple independent
hydrated tile domains, so the startup-hydrated fallback tiles should be treated
as one snapshot-sized fallback set:

- the full hydrated fallback set stays visible until the first successful
  `replaceActionBundle(...)` completes
- that first successful bundle install atomically discards the entire hydrated
  fallback set and replaces it with the bundle-managed tile set
- hydrated tile IDs that do not appear in the fresh bundle are removed as part
  of that atomic handoff; they do not remain visible as stale fallback entries
- after that handoff, authored tile visibility comes from bundle-managed state,
  not from a mixture of bundle tiles plus leftover hydrated fallback tiles

In practice, tile IDs should remain unique across the effective catalog set.
The new seam should not rely on cross-catalog shadowing or override precedence
as a normal integration mechanism.

### Relationship between `CompiledActionBundle.tiles` and catalogs

`CompiledActionBundle.tiles` are semantic tile definitions, not runtime
bindings.

Their role is to project compiler output into the environment's bundle-managed
shared catalog so that:

- deserialization can find those tile IDs
- editor and tooling surfaces can inspect stable action metadata
- brain compilation and linking can see the same semantic tile definitions

They are environment-shared, not brain-local, because they represent authored
action types that may be referenced by many brains in the same environment.

The corresponding runtime implementations still come from
`CompiledActionBundle.actions`. In other words:

- `tiles` answers "what semantic tile definitions exist?"
- `actions` answers "what executable implementations back those actions?"

That separation should remain explicit in the seam.

Completeness note:

- `CompiledActionBundle.tiles` must be a complete snapshot of the authored-tile
  semantic set managed by the bundle, not an incremental diff of only recently
  changed tiles
- the same rule applies to the bundle-managed authored action set as a whole:
  a successful bundle install replaces the current bundle-managed snapshot with
  the next complete snapshot
- if two authored actions share supporting semantic tiles, such as parameter
  tiles, those shared tiles must still appear in the next emitted bundle even
  when only one action's source changed
- this is what replaces the current sim-side parameter-tile ref counting:
  shared-tile retention becomes a compiler-side snapshot-completeness concern,
  not a runtime-side register/unregister counter
- if incremental patch semantics are ever wanted later, they need a different
  contract. `replaceActionBundle(...)` is defined in terms of whole-snapshot
  replacement

## Startup Hydration of Persisted Brains

Persisted brain loading needs a pre-compiler semantic hydration path.

The current sim startup sequence works because cached tile metadata is loaded
into the shared catalog before persisted brains are deserialized. The new seam
needs the same capability explicitly.

The baseline design is:

1. the app persists a `HydratedTileMetadataSnapshot` from the last successful
   semantic compiler projection
2. at startup, after creating the environment and installing modules, the app
   calls `environment.hydrateTileMetadata(snapshot)`
3. persisted `BrainDef` data is deserialized against the environment's shared
   catalog state
4. later, fresh compiler output arrives as a `CompiledActionBundle`, and
  `replaceActionBundle(...)` atomically removes the full hydrated fallback
  snapshot and installs the fresh tile/action set

Important constraints:

- hydrated tile metadata is semantic-only; it makes deserialization, editor
  loading, and type-aware tooling possible before the compiler has finished
- hydrated tile metadata does not provide executable actions
- hydrated fallback metadata is a startup-only fallback snapshot, not a
  long-lived secondary tile layer that can linger beside fresh bundle data
- startup code should therefore treat hydration as a data-model bootstrap step,
  not as proof that executable brains can already be linked against user-
  authored actions

The clean requirement for S2/S3 is that persisted-brain deserialization must be
environment-scoped. Whether that becomes an explicit
`environment.deserializeBrain(...)` helper or an environment-aware model-layer
deserializer is an implementation choice. What is not acceptable is keeping the
normal persisted-brain path hardwired to a process-global tile catalog.

Recommended startup sequence:

```ts
const environment = createMindcraftEnvironment({
  modules: [coreModule(), createSimModule()],
});

const cachedTiles = loadPersistedTileMetadata();
if (cachedTiles) {
  environment.hydrateTileMetadata(cachedTiles);
}

const brainDef = loadPersistedBrainDef(environment, serializedBrain);
const snapshot = compiler.compile();
const update = environment.replaceActionBundle(snapshot.bundle);

if (update.invalidatedBrains.length > 0) {
  scheduleBrainRebuild();
}
```

## Brain Rebuild Lifecycle

`replaceActionBundle(...)` should not be a fire-and-forget rebuild trigger.

The replacement for sim's current `brainActionRevisions` plus
`rebuildActiveBrainsUsingChangedActions()` split is:

- the environment tracks only the `MindcraftBrain` instances it created
- each tracked brain records the linked action revisions from its last
  successful link/rebuild
- bundle replacement diffs revisions, marks only affected brains as
  `invalidated`, and returns that invalidation set
- the app chooses when rebuild work actually runs

That gives the new seam the same selective-rebuild behavior the sim currently
relies on, without forcing the app to keep its own dependency graph.

Important ownership rules:

- environment tracking is explicit, not GC-magic; `MindcraftBrain.dispose()` is
  what removes a brain from invalidation tracking
- the environment should not attempt to discover arbitrary `Brain` instances it
  did not create
- `replaceActionBundle(...)` updates environment-owned action state and
  invalidation state, but does not eagerly rebuild by default
- successive `replaceActionBundle(...)` calls accumulate invalidation until the
  affected brains are rebuilt or disposed
- authored-action removal is represented by the next complete replacement
  bundle omitting those actions, not by a separate public incremental API
- apps can rebuild immediately, on the next animation frame, or in any other
  batch boundary by calling `rebuildInvalidatedBrains(...)` or
  `brain.rebuild()` on the affected brains
- deferred or coalesced rebuild scheduling should use
  `rebuildInvalidatedBrains()` with no arguments so the environment drains its
  full current invalidation set at execution time

The recommended shape is that `MindcraftBrain` is a stable environment-owned
runnable controller/handle. Rebuild swaps its underlying executable/runtime
state, but the app continues to hold and use the same `MindcraftBrain` object.

That avoids pushing object-replacement bookkeeping back into every app-level
brain container while still letting the app control timing.

The important constraint is that rebuild stability must not come at the cost of
runtime usability. The object the app rebuilds and disposes must also remain the
object it can tick and inspect. If runtime access is split behind an accessor,
that accessor must stay valid across rebuilds so the app does not have to keep
a second hidden runtime reference.

The same rule applies to reused authored definitions. If ten brains are created
from the same `BrainDef`, invalidation and rebuild operate on those ten runtime
instances, not on one shared runtime hidden behind the definition.

Example:

```ts
const update = environment.replaceActionBundle(snapshot.bundle);

if (update.invalidatedBrains.length > 0) {
  requestAnimationFrame(() => {
    environment.rebuildInvalidatedBrains();
  });
}
```

Deferred rebuild code should prefer the no-args form. A captured
`update.invalidatedBrains` or `event.invalidatedBrains` array can be stale if
another `replaceActionBundle(...)` call lands before the scheduled rebuild
runs.

If the app is not the direct caller that applies the bundle, it can subscribe
through `onBrainsInvalidated(...)` and schedule the same no-args rebuild pass
there.

## Registration Machinery Note

Making `coreModule()` real is not just a matter of wrapping the current
`registerCoreBrainComponents()` entrypoint.

Today, the top-level registration functions are only shallow orchestrators.
They fan out into many leaf registration functions that resolve their target
registries by calling `getBrainServices()` internally. The same pattern exists
in sim's `registerBrainComponents()` -> `registerTypes()` / `registerFns()` /
`registerTiles()` chain.

That means the implementation needs a real installation mechanism, not just a
new name.

The intended end-state is explicit registration context threading.
`coreModule().install(api)` should adapt the public `MindcraftModuleApi` into
an internal registration context and pass that down through the registration
call tree.

That context has to cover the distinct function registry as well as types,
operators, conversions, sensors, actuators, and tiles. Core built-in registrars
such as `registerElementAccessBuiltins()`, `registerMapBuiltins()`,
`registerMathBuiltins()`, and `registerStringBuiltins()` currently target
`getBrainServices().functions` and need a first-class module API path rather
than being implicitly treated as operators.

The public `MindcraftModuleApi` does not have to be threaded directly into every
leaf. A narrower internal `CoreRegistrationContext` / `SimRegistrationContext`
style object is likely cleaner. The important point is that the registration
call trees have to be re-plumbed away from assuming a pre-existing default
global services instance.

If a tightly scoped install-time ambient mechanism is needed during migration,
it should be treated only as a temporary bridge to the threaded end-state. It
must not become a renamed replacement for the current process-global singleton
model.

### Why this is better

- `registerCoreBrainComponents()` becomes `coreModule()` supplied during explicit
  environment construction.
- `registerBrainComponents()` becomes an app module instead of hidden global registration.
- `createSimBrain()` becomes `environment.createBrain(...)`.
- environment-owned shared catalogs replace the current implicit global tile
  catalog, while `brainDef.catalog()` stays the per-brain local catalog.
- cached semantic tile metadata can hydrate persisted-brain deserialization
  before fresh compiler output exists.
- compiled user tiles become a replaceable bundle instead of several ad hoc maps and caches.
- apps no longer need `getBrainServices()` for normal integration.
- the environment owns selective action dependency tracking, while the app
  still controls rebuild timing.
- the main integration seam becomes explicit without abandoning the multi-target constraints that `packages/core` already has to satisfy.

### What stays available for advanced and Roblox consumers

Advanced subpaths can remain if they are still useful, but they should stop
being the default integration story and do not need to be preserved just for
backward compatibility.

Separately, the root `@mindcraft-lang/core` namespace-style import pattern using
`brain` must remain available for Roblox consumers. That is not just a legacy
convenience surface; it is a required supported shape.

- `@mindcraft-lang/core` -> stable integration surface
- `@mindcraft-lang/core/model` -> data model types
- `@mindcraft-lang/core/runtime` -> advanced runtime APIs
- `@mindcraft-lang/core/compiler` -> advanced compiler APIs

And at the root package level:

- `import { brain, List, logger } from "@mindcraft-lang/core"` remains valid
- `brain.compiler`, `brain.tiles`, and `brain.<symbol>` access remains valid

The current `@mindcraft-lang/core/brain/*` surface can remain temporarily during
internal migration if useful, but there is no requirement to preserve it as a
public compatibility layer.

## Separate Semantics From Presentation

`setTileVisualProvider()` should not remain a process-global part of the core integration path.

The design requirement here is narrower than naming a specific new resolver
type. The seam needs explicit ownership and composition rules first:

- core owns semantic tile definitions and runtime behavior, not visual
  presentation
- the normal path should keep tile presentation app/UI-owned rather than making
  it part of the core runtime API
- runtime semantics, linking, and deserialization must remain usable with no
  presentation configuration at all
- presentation must be scoped to one app/runtime context and must not leak
  across environments through a process-global singleton
- if lookup by tile ID is only needed inside UI/editor code, a per-app or
  per-environment presentation map/provider in that layer is sufficient and is
  preferable to a new core-owned registry
- only if S3 proves that non-UI consumers need presentation lookup should the
  design introduce a dedicated non-global lookup seam, and that seam must then
  specify who creates it, who owns it, and how it composes with an environment

So the current design should not pre-commit to a public
`TilePresentationResolver` interface or to an environment-scoped presentation
registry. S3 should choose the smallest non-global shape that satisfies the sim
migration and the presentation-isolation requirements.

## Proposed Bridge-App Public API

The app-facing bridge package should expose a small composed facade instead of a subclass of the low-level `Project`.

```ts
import type {
  ExportedFileSystem,
  FileSystemNotification,
} from "@mindcraft-lang/bridge-client";

export type WorkspaceSnapshot = ExportedFileSystem;
export type WorkspaceChange = FileSystemNotification;

export interface AppBridge {
  start(): void;
  stop(): void;
  requestSync(): Promise<void>;
  snapshot(): AppBridgeSnapshot;
  onStateChange(listener: (state: AppBridgeState) => void): Disposable;
  onRemoteChange(listener: (change: WorkspaceChange) => void): Disposable;
}

export interface AppBridgeSnapshot {
  status: AppBridgeState;
  joinCode?: string;
}

export type AppBridgeState = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface AppBridgeOptions {
  app: {
    id: string;
    name: string;
    projectId: string;
    projectName: string;
  };
  bridgeUrl: string;
  workspace: WorkspaceAdapter;
  features?: readonly AppBridgeFeature[];
}

export interface WorkspaceAdapter {
  exportSnapshot(): WorkspaceSnapshot;
  applyRemoteChange(change: WorkspaceChange): void;
  onLocalChange(listener: (change: WorkspaceChange) => void): Disposable;
}

export interface AppBridgeFeature {
  attach(context: AppBridgeFeatureContext): Disposable;
}

export interface AppBridgeFeatureContext {
  snapshot(): AppBridgeSnapshot;
  workspaceSnapshot(): WorkspaceSnapshot;
  onStateChange(listener: (state: AppBridgeState) => void): Disposable;
  onRemoteChange(listener: (change: WorkspaceChange) => void): Disposable;
  onDidSync(listener: () => void): Disposable;
  publishDiagnostics(file: string, diagnostics: readonly DiagnosticEntry[]): void;
  publishStatus(update: AppBridgeFeatureStatus): void;
}

export interface AppBridgeFeatureStatus {
  file: string;
  success: boolean;
  diagnosticCount: {
    error: number;
    warning: number;
  };
}

export declare function createAppBridge(options: AppBridgeOptions): AppBridge;
```

Source note:

- `WorkspaceSnapshot` should be the bridge-app seam alias for
  `ExportedFileSystem` from `@mindcraft-lang/bridge-client`
- `WorkspaceChange` should be the bridge-app seam alias for
  `FileSystemNotification`, which is owned in
  `@mindcraft-lang/bridge-protocol` and re-exported by
  `@mindcraft-lang/bridge-client`
- `bridge-app` should not invent a second full-snapshot or change-notification
  schema for this seam

Ownership note:

- the workspace state behind `WorkspaceAdapter` is app-owned
- `bridge-app` reads it through `exportSnapshot()` and mutates it through
  `applyRemoteChange(...)`
- persistence of that workspace snapshot remains app-owned; bridge-app should
  not expose a bridge-owned raw VFS that the app has to reach back into to save
- browser apps should persist after successful workspace mutation, typically
  with debouncing, and should batch full-import/full-sync updates into a single
  persisted snapshot write

Feature note:

- `AppBridgeFeatureContext` is the entire capability surface for optional
  bridge features
- features receive bridge state, bridge-originated workspace changes, and a
  sync-complete replay hook through that context
- features do not touch `session`, `files`, or other `Project` internals
- `publishDiagnostics(...)` and `publishStatus(...)` are the outbound bridge
  publication hooks for the compilation feature path
- `onDidSync(...)` exists so features with cached state, such as diagnostics,
  can replay that state after pairing or full filesystem sync
- `WorkspaceAdapter.exportSnapshot()` is the user-authored workspace only; it
  is not the place where generated compiler inputs such as `mindcraft.d.ts` or
  compiler-controlled system files such as `tsconfig.json` get smuggled into
  the system

### Why this is better

- app code no longer touches `session`, `files`, or other transport internals
- join code and connection state are available from one stable snapshot API
- bridge-app can stay focused on app-role bridge concerns
- advanced callers can still use `@mindcraft-lang/bridge-client` directly when they need low-level control
- VFS persistence is attached to the app-owned workspace store instead of being
  coupled to a bridge-owned filesystem object

## Move Compilation Out Of The Root Bridge-App Facade

Compilation should be optional and capability-based.

The root `@mindcraft-lang/bridge-app` package should handle connection and workspace sync only.

Optional compilation support should live behind a separate public feature surface such as:

- `@mindcraft-lang/bridge-app/compilation`

Example API:

```ts
export interface WorkspaceCompiler {
  replaceWorkspace(snapshot: WorkspaceSnapshot): void;
  applyWorkspaceChange(change: WorkspaceChange): void;
  compile(): DiagnosticSnapshot;
  onDidCompile(listener: (snapshot: DiagnosticSnapshot) => void): Disposable;
}

export interface DiagnosticSnapshot {
  files: ReadonlyMap<string, readonly DiagnosticEntry[]>;
}

export declare function createCompilationFeature(options: {
  compiler: WorkspaceCompiler;
  publishStatus?: boolean;
}): AppBridgeFeature;
```

Type note:

- `WorkspaceCompiler` should use the same `WorkspaceSnapshot` /
  `WorkspaceChange` aliases introduced above
- the compilation feature should not define a second workspace snapshot or
  change model that diverges from the bridge facade

Compiler-owned inputs note:

- `WorkspaceAdapter` exposes user workspace content only; compiler-only inputs
  stay outside that app-owned snapshot
- `WorkspaceCompiler` still owns internally controlled system files such as
  `tsconfig.json`; even if that file is serialized in a fileset, the compiler
  replaces it with the authoritative internal version before compile
- in the sim app, this replaces the current behavior of injecting generated
  `mindcraft.d.ts` and `tsconfig.json` into the bridge-owned filesystem before
  compilation starts
- ambient declarations should default to internal generation on the new path;
  the generator must stop reading `getBrainServices()` implicitly
- `@mindcraft-lang/ts-compiler` should read environment-owned registry state
  directly from the provided environment once those registries are no longer
  process-global
- core should not grow a TypeScript-specific ambient declaration generator just
  to support that compiler path
- v1 should not standardize a caller-supplied ambient/support-files provider;
  if a concrete app later needs custom compiler-only overlays, add that seam
  then

Dependency direction note:

- `WorkspaceCompiler` is a consumer-owned feature port defined by
  `@mindcraft-lang/bridge-app/compilation`
- this preserves the current dependency direction of `CompilationProvider`:
  bridge-app defines the port, and app code supplies an implementation or
  adapter
- `@mindcraft-lang/ts-compiler` does not need to depend on
  `@mindcraft-lang/bridge-app` to participate in this seam
- the normal expectation is that app code, or an optional adapter helper,
  wraps the concrete ts-compiler API into a value that matches
  `WorkspaceCompiler`
- if a reusable adapter is added later, it should live in app code or in a
  ts-compiler-owned helper/subpath, not by introducing a hard package cycle

So the `compiler` parameter passed to `createCompilationFeature(...)` is not
necessarily the raw object returned by `@mindcraft-lang/ts-compiler`. It is the
bridge-facing compiler adapter value.

Raw ts-compiler note:

- the public `createWorkspaceCompiler(...)` API in `@mindcraft-lang/ts-compiler`
  is expected to return a richer compiler object than the bridge-facing
  `WorkspaceCompiler` port
- that raw object should own the current user-workspace snapshot plus any
  internal compiler-only state it needs
- its `compile()` result should include, at minimum:
  - per-file diagnostics for the current workspace
  - an optional `CompiledActionBundle` value when compilation succeeds far
    enough to produce runtime-consumable authored actions and semantic tiles
  - optional per-file or debug metadata if ts-compiler wants to surface richer
    editor/debug information
- the bridge adapter's job is to narrow that richer ts-compiler result to the
  `WorkspaceCompiler` feature port by forwarding diagnostics/status to
  bridge-app, while app/core integration code can still consume the raw bundle
  result directly

`createCompilationFeature(...)` should be implementable using only
`AppBridgeFeatureContext`:

- seed the compiler from `workspaceSnapshot()`
- apply inbound bridge mutations from `onRemoteChange(...)`
- inspect connectivity through `snapshot()` / `onStateChange(...)`
- replay cached diagnostics after `onDidSync(...)`
- publish diagnostics and compile status through
  `publishDiagnostics(...)` / `publishStatus(...)`

That is intentionally enough to replace the current `CompilationManager`
dependencies on a raw session sender, connection-status predicate,
filesystem-sync replay hook, and `onRemoteFileChange()` wiring.

This keeps the transport seam clean:

- apps that only want bridge connectivity use `createAppBridge(...)`
- apps that also want compiler diagnostics add `createCompilationFeature(...)`
- the compiler itself still lives in `@mindcraft-lang/ts-compiler`
- the bridge feature port lives in `@mindcraft-lang/bridge-app/compilation`
- the adapter boundary between them lives in app code unless a dedicated helper
  is introduced later

Container note:

- `CompiledActionBundle` is a core-facing contract because
  `MindcraftEnvironment.replaceActionBundle(...)` consumes it directly
- that means it should use core-safe container types such as `Dict` when it
  remains part of the core seam, even if `@mindcraft-lang/ts-compiler` is the
  package that produces the bundle values
- `DiagnosticSnapshot` is different because it lives on the
  bridge-app/compiler side of the seam rather than inside `packages/core`, so
  it does not automatically inherit the Roblox-safe container constraint

## Recommended Responsibilities By Package

### `@mindcraft-lang/core`

Owns:

- language model
- runtime
- compiler for tile brains
- module definitions and environment-construction-time installation
- action bundle contract consumed by the runtime

Does not own:

- websocket sessions
- filesystem sync
- browser localStorage policy
- editor tile visuals as process-global mutable state

### `@mindcraft-lang/ts-compiler`

Owns:

- TypeScript workspace compilation
- diagnostics
- producing compiled action bundles that conform to core's runtime-facing
  bundle contract
- concrete compiler APIs that app code can adapt to bridge-app's
  `WorkspaceCompiler` port

Does not own:

- websocket publishing
- bridge session lifecycle
- app-specific tile registration policy

### `@mindcraft-lang/bridge-app`

Owns:

- app-role bridge connection
- join code management
- workspace synchronization
- optional bridge features via composition

Does not own:

- core runtime construction
- concrete compiler implementation
- app gameplay semantics

### `@mindcraft-lang/bridge-client`

Owns:

- low-level websocket client
- filesystem sync primitives
- protocol-aware request/response plumbing

Does not own:

- app-facing ergonomics
- join code policy
- diagnostics semantics

## Example Integration Shapes

### Core-only app

```ts
import { createMindcraftEnvironment, coreModule } from "@mindcraft-lang/core";

const environment = createMindcraftEnvironment({
  modules: [coreModule(), createSimModule()],
});

const brain = environment.createBrain(brainDef, {
  context: actor,
});

brain.startup();
brain.think(now);
```

### Core plus TypeScript-authored tiles

```ts
import { createMindcraftEnvironment, coreModule } from "@mindcraft-lang/core";
import { createWorkspaceCompiler } from "@mindcraft-lang/ts-compiler";

const environment = createMindcraftEnvironment({
  modules: [coreModule(), createSimModule()],
});

const compiler = createWorkspaceCompiler({ environment });
const snapshot = compiler.compile();

const update = environment.replaceActionBundle(snapshot.bundle);
if (update.invalidatedBrains.length > 0) {
  scheduleBrainRebuild();
}
```

### Core plus bridge plus compiler diagnostics

```ts
import { createAppBridge } from "@mindcraft-lang/bridge-app";
import { createCompilationFeature } from "@mindcraft-lang/bridge-app/compilation";
import { createWorkspaceCompiler } from "@mindcraft-lang/ts-compiler";

const compiler = createWorkspaceCompiler({ environment });

const bridge = createAppBridge({
  app: {
    id: "sim",
    name: "Sim",
    projectId: "sim-default",
    projectName: "Sim",
  },
  bridgeUrl,
  workspace,
  features: [createCompilationFeature({ compiler })],
});

bridge.start();
```

## Migration Planning Note

Implementation sequencing lives in
[mindcraft-public-seam-phased-impl.md](mindcraft-public-seam-phased-impl.md).
This design doc defines the target architecture and the steady-state API shape;
it is not a second phase plan. If the design doc and the phased implementation
plan ever differ on ordering or migration scope, follow the phased
implementation plan.

## Concrete Mapping From Today To Tomorrow

- `registerCoreBrainComponents()` -> `coreModule()` installed into `createMindcraftEnvironment()`
- `registerBrainComponents()` -> `createSimModule()`
- `createSimBrain()` -> `environment.createBrain()`
- `getBrainServices().tiles/...` -> `MindcraftModuleApi` methods
- `getBrainServices().functions/...` -> `MindcraftModuleApi.registerFunction(...)`
- `AppProject` -> `createAppBridge()`
- `CompilationManager` -> internal implementation of `createCompilationFeature()`
- `user-tile-registration.ts` maps and caches -> compiler snapshot plus
  `hydrateTileMetadata()`, `replaceActionBundle()`, `onBrainsInvalidated()`, and scheduled
  `rebuildInvalidatedBrains()`

## Recommendation

Treat this as a compositional seam redesign, not a rename pass.

The essential move is:

- core becomes an explicit environment plus modules
- bridge-app becomes an explicit bridge facade plus optional features
- ts-compiler becomes the producer of replaceable action bundles and diagnostics
- app code becomes the composition root that wires these pieces together

That gives you a clean story for three kinds of adopters:

1. core-only apps
2. core plus ts-compiler apps
3. core plus ts-compiler plus bridge apps