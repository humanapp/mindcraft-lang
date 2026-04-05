# Mindcraft Seam Design

Phased implementation plan: [mindcraft-public-seam-phased-impl.md](mindcraft-public-seam-phased-impl.md).

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

## Optional Node/Browser Facade Package

The default intent of this design is still to make the clean seam available
directly from `@mindcraft-lang/core`.

However, if doing that would force the public API into awkward Roblox-driven
compromises, an acceptable outcome is to introduce a separate node/browser-only
facade package layered over core.

That package would:

- re-export the recommended app-facing symbols
- adapt core's multi-target-safe primitives into a cleaner node/browser-facing
  integration surface where appropriate
- compose naturally with `@mindcraft-lang/ts-compiler` and
  `@mindcraft-lang/bridge-app`
- leave `@mindcraft-lang/core` as the lower-level cross-target substrate for
  Roblox and advanced consumers

In that model:

- `@mindcraft-lang/core` remains the multi-target implementation foundation
- the facade package becomes the preferred app-facing package for browser/node
  apps such as sim
- Roblox-oriented integrations can continue to use `@mindcraft-lang/core`
  directly, using the preserved root import pattern

This should be treated as an escape hatch, not the first assumption. But it is
explicitly allowed if it produces a meaningfully better app <-> Mindcraft seam.

## Target Layering

```text
App
|- uses @mindcraft-lang/core directly, or a node/browser facade over core
|- optionally uses @mindcraft-lang/ts-compiler for user-authored tiles
|- optionally uses @mindcraft-lang/bridge-app for bridge connectivity

@mindcraft-lang/core
|- environment
|- modules
|- catalogs
|- model/compiler/runtime

optional facade package
|- node/browser app-facing API
|- re-exports/adapts core for non-Roblox consumers

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

The important point is that `core` and `bridge-app` should not know each other directly. They meet in the app, or in a thin app-facing facade layered over core, through explicit interfaces.

## Proposed Core Public API

The main public object in core should be an environment, not a singleton.

```ts
export interface MindcraftEnvironment {
  install(module: MindcraftModule): MindcraftModuleHandle;
  createCatalog(): MindcraftCatalog;
  createBrain(definition: BrainDef, options?: CreateBrainOptions): MindcraftBrain;
  replaceActionBundle(bundle: CompiledActionBundle): void;
  removeActions(keys: Iterable<string>): void;
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
  registerTile(def: TileDefinitionInput): string;
  registerOperator(def: OperatorDefinition): void;
  registerConversion(def: ConversionDefinition): void;
}

export interface CompiledActionBundle {
  readonly revision: string;
  readonly actions: ReadonlyMap<string, CompiledActionArtifact>;
  readonly tiles: readonly TileDefinitionInput[];
}

export declare function createMindcraftEnvironment(options?: {
  modules?: readonly MindcraftModule[];
}): MindcraftEnvironment;

export declare function coreModule(): MindcraftModule;
```

### Why this is better

- `registerCoreBrainComponents()` becomes `coreModule()` installed into an explicit environment.
- `registerBrainComponents()` becomes an app module instead of hidden global registration.
- `createSimBrain()` becomes `environment.createBrain(...)`.
- compiled user tiles become a replaceable bundle instead of several ad hoc maps and caches.
- apps no longer need `getBrainServices()` for normal integration.
- the main integration seam becomes explicit without abandoning the multi-target constraints that `packages/core` already has to satisfy.

If this ends up being too constraining inside `@mindcraft-lang/core` itself,
the same seam can instead be surfaced through a dedicated node/browser facade
package without changing the architectural direction.

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

The better shape is:

- core registers semantic tile definitions only
- UI or app code provides tile presentation through a separate resolver

```ts
export interface TilePresentationResolver {
  getPresentation(tileId: string): TilePresentation | undefined;
}
```

This keeps runtime semantics portable and avoids surprising cross-app global state.

## Proposed Bridge-App Public API

The app-facing bridge package should expose a small composed facade instead of a subclass of the low-level `Project`.

```ts
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

export declare function createAppBridge(options: AppBridgeOptions): AppBridge;
```

### Why this is better

- app code no longer touches `session`, `files`, or other transport internals
- join code and connection state are available from one stable snapshot API
- bridge-app can stay focused on app-role bridge concerns
- advanced callers can still use `@mindcraft-lang/bridge-client` directly when they need low-level control

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

This keeps the transport seam clean:

- apps that only want bridge connectivity use `createAppBridge(...)`
- apps that also want compiler diagnostics add `createCompilationFeature(...)`
- the compiler itself still lives in `@mindcraft-lang/ts-compiler`

## Recommended Responsibilities By Package

### `@mindcraft-lang/core`

Owns:

- language model
- runtime
- compiler for tile brains
- extension/module API
- action bundle contract consumed by the runtime

Does not own:

- websocket sessions
- filesystem sync
- browser localStorage policy
- editor tile visuals as process-global mutable state

### Optional facade package

Owns:

- the cleanest recommended app-facing integration surface for node/browser apps
- re-exporting/adapting core APIs where core's multi-target constraints would
  otherwise leak into the default app experience

Does not own:

- runtime semantics independent of core
- transport internals independent of bridge packages
- separate compiler semantics independent of `@mindcraft-lang/ts-compiler`

### `@mindcraft-lang/ts-compiler`

Owns:

- TypeScript workspace compilation
- diagnostics
- compiled action bundles that core can consume

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
  catalogs: [brainDef.catalog()],
});
```

### Core plus TypeScript-authored tiles

```ts
import { createMindcraftEnvironment, coreModule } from "@mindcraft-lang/core";
import { createWorkspaceCompiler } from "@mindcraft-lang/ts-compiler";

const environment = createMindcraftEnvironment({
  modules: [coreModule(), createSimModule()],
});

const compiler = createWorkspaceCompiler({ ambientFiles, tsconfig });
const snapshot = compiler.compile();

environment.replaceActionBundle(snapshot.bundle);
```

### Core plus bridge plus compiler diagnostics

```ts
import { createAppBridge } from "@mindcraft-lang/bridge-app";
import { createCompilationFeature } from "@mindcraft-lang/bridge-app/compilation";
import { createWorkspaceCompiler } from "@mindcraft-lang/ts-compiler";

const compiler = createWorkspaceCompiler({ ambientFiles, tsconfig });

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

## Migration Plan

### Phase 1

Define the new facade APIs and decide which old entrypoints, if any, deserve a
temporary migration bridge.

- add `createMindcraftEnvironment()` and `coreModule()`
- add `createAppBridge()`
- add `@mindcraft-lang/bridge-app/compilation`

### Phase 2

Reimplement the current sim integration on top of the new facades.

- replace `registerCoreBrainComponents()` and `getBrainServices()` usage in app code with an explicit environment
- replace direct `Brain` construction with `environment.createBrain()`
- replace direct `project.session` and `project.files` access with `AppBridge`

### Phase 3

Remove or sharply narrow the old public integration path.

- remove or demote `getBrainServices()` for app integration
- remove or demote `setTileVisualProvider()` as the default integration path
- remove or demote `AppProject` as the recommended app-facing bridge API

### Phase 4

Trim the docs and examples so new consumers see only the new seam.

## Concrete Mapping From Today To Tomorrow

- `registerCoreBrainComponents()` -> `coreModule()` installed into `createMindcraftEnvironment()`
- `registerBrainComponents()` -> `createSimModule()`
- `createSimBrain()` -> `environment.createBrain()`
- `getBrainServices().tiles/...` -> `MindcraftModuleApi` methods
- `AppProject` -> `createAppBridge()`
- `CompilationManager` -> internal implementation of `createCompilationFeature()`
- `user-tile-registration.ts` maps and caches -> compiler snapshot plus `replaceActionBundle()`

## Recommendation

Treat this as a compositional seam redesign, not a rename pass.

The essential move is:

- core becomes an explicit environment plus modules
- if needed, a facade package presents that seam cleanly to node/browser apps
- bridge-app becomes an explicit bridge facade plus optional features
- ts-compiler becomes the producer of replaceable action bundles and diagnostics
- app code becomes the composition root that wires these pieces together

That gives you a clean story for three kinds of adopters:

1. core-only apps
2. core plus ts-compiler apps
3. core plus ts-compiler plus bridge apps