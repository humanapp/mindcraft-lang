# Mindcraft Packages -- Integration Guide

This guide explains how to integrate the Mindcraft packages into your own
Vite + React + Tailwind CSS application. All packages are installed from npm -- you do not
need to clone the mindcraft-lang monorepo.

## Package Overview

| Package                | Purpose                                                                | Build model     |
| ---------------------- | ---------------------------------------------------------------------- | --------------- |
| `@mindcraft-lang/core` | Tile-based visual programming language: model, compiler, runtime, VM   | Built (ESM/CJS) |
| `@mindcraft-lang/ui`   | Shared React components: shadcn/ui primitives + brain editor           | Source-only     |
| `@mindcraft-lang/docs` | Documentation sidebar, markdown renderer, standalone docs page         | Source-only     |

`@mindcraft-lang/core` is a conventionally built package with pre-built ESM and CJS output.
It works with standard Node module resolution -- no aliases needed. Import app-facing
symbols from `@mindcraft-lang/core/app`.

**Source-only** means `ui` and `docs` ship their TypeScript source on npm rather than
pre-built JavaScript. Your app compiles them at build time using Vite aliases and tsconfig
path mappings that point into the installed `node_modules` source.

Additional packages are available for TypeScript-authored tiles and VS Code Web integration.
See [TypeScript Compiler + VS Code Bridge](#6-typescript-compiler--vs-code-bridge) below.

### Dependency Graph

```
@mindcraft-lang/docs
  |-- @mindcraft-lang/ui
  |-- @mindcraft-lang/core
  |-- react, react-dom (peer)

@mindcraft-lang/ui
  |-- @mindcraft-lang/core
  |-- react, react-dom (peer)

@mindcraft-lang/core
  (no peer dependencies)
```

---

## 1. Getting Started with Core

```bash
npm install @mindcraft-lang/core
```

The core package provides the brain model, tile catalog, compiler, runtime, and VM. Create
a `MindcraftEnvironment`, install modules, and create brains:

```typescript
import {
  createMindcraftEnvironment,
  coreModule,
  type MindcraftModule,
  type MindcraftModuleApi,
} from "@mindcraft-lang/core/app";

function createAppModule(): MindcraftModule {
  return {
    id: "my-app",
    install(api: MindcraftModuleApi) {
      // Register app-specific types, sensors, actuators, operators, and tiles
    },
  };
}

const environment = createMindcraftEnvironment({
  modules: [coreModule(), createAppModule()],
});

const brain = environment.createBrain(brainDef, { context: actor });
brain.startup();
brain.think(now);
```

All app-facing symbols are exported from `@mindcraft-lang/core/app` -- environment,
modules, brain model, tile definitions, type system, runtime values, and platform utilities.

---

## 2. Adding the Brain Editor

```bash
npm install @mindcraft-lang/ui
```

The UI package provides shadcn/ui primitives, the brain editor, and utility functions.

### BrainEditorConfig

The brain editor requires a `BrainEditorConfig` to decouple it from app-specific concerns:

```tsx
import type { BrainEditorConfig } from "@mindcraft-lang/ui";

const brainEditorConfig: BrainEditorConfig = {
  dataTypeIcons: new Map([
    ["core:number", "/assets/icons/number.svg"],
    ["core:string", "/assets/icons/string.svg"],
    ["core:boolean", "/assets/icons/boolean.svg"],
  ]),
  dataTypeNames: new Map([
    ["core:number", "number"],
    ["core:string", "text"],
    ["core:boolean", "true/false"],
  ]),
  isAppVariableFactoryTileId: (id) => id.startsWith("tile.var.factory->struct:"),
  customLiteralTypes: [],
};
```

| Field                        | Type                               | Required | Purpose                                       |
| ---------------------------- | ---------------------------------- | -------- | --------------------------------------------- |
| `dataTypeIcons`              | `ReadonlyMap<string, string>`      | Yes      | Type ID -> icon URL                           |
| `dataTypeNames`              | `ReadonlyMap<string, string>`      | Yes      | Type ID -> display name                       |
| `isAppVariableFactoryTileId` | `(id: string) => boolean`          | Yes      | Identifies app variable factory tiles         |
| `customLiteralTypes`         | `ReadonlyArray<CustomLiteralType>` | Yes      | App-defined literal tile types (e.g. Vector2) |
| `getDefaultBrain`            | `() => BrainDef \| undefined`      | No       | Factory for "Load Default Brain" action       |
| `onTileHelp`                 | `(tileDef) => void`                | No       | Callback for tile right-click -> Help         |
| `docsIntegration`            | `{ isOpen, toggle, close }`        | No       | Docs sidebar controls for the editor toolbar  |

### Rendering the Editor

Wrap your app with `BrainEditorProvider` and use `BrainEditorDialog` to open it:

```tsx
import { BrainEditorProvider, BrainEditorDialog, Toaster } from "@mindcraft-lang/ui";

function App() {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [brainDef, setBrainDef] = useState<BrainDef | undefined>(undefined);

  return (
    <BrainEditorProvider config={brainEditorConfig}>
      {/* Your app content */}
      <BrainEditorDialog
        isOpen={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        srcBrainDef={brainDef}
        onSubmit={(updatedBrain) => {
          setBrainDef(updatedBrain);
          setIsEditorOpen(false);
        }}
      />
      <Toaster />
    </BrainEditorProvider>
  );
}
```

### UI Primitives and Utilities

The package also re-exports shadcn/ui primitives and utility functions:

```tsx
import { Button, Card, Dialog, Input, Slider } from "@mindcraft-lang/ui";
import { cn, adjustColor, saturateColor } from "@mindcraft-lang/ui";
```

---

## 3. Adding Documentation

```bash
npm install @mindcraft-lang/docs
```

The docs package provides a documentation sidebar, markdown renderer, and standalone docs
page. It depends on both `@mindcraft-lang/core` and `@mindcraft-lang/ui`.

### Minimal Setup

If you have no app-specific documentation, call `buildDocsRegistry()` with no arguments to
get a registry containing only the built-in core docs:

```tsx
import { buildDocsRegistry, DocsSidebar, DocsSidebarProvider } from "@mindcraft-lang/docs";

function App() {
  const docsRegistry = useMemo(() => buildDocsRegistry(), []);

  return (
    <DocsSidebarProvider registry={docsRegistry}>
      {/* Your app content */}
      <DocsSidebar />
    </DocsSidebarProvider>
  );
}
```

### App-Specific Documentation

To add your own tile and pattern docs, create a manifest with metadata entries and markdown
content, then pass them to `buildDocsRegistry()`:

```typescript
import { buildDocsRegistry } from "@mindcraft-lang/docs";
import type { AppTileDocMeta, AppPatternDocMeta } from "@mindcraft-lang/docs";

const appTileDocs: readonly AppTileDocMeta[] = [
  { tileId: "tile.sensor->sensor.see", tags: ["vision"], category: "Sensors", contentKey: "see" },
  { tileId: "tile.actuator->actuator.move", tags: ["movement"], category: "Actuators", contentKey: "move" },
];

// Load markdown content with Vite's import.meta.glob
const tileContent = import.meta.glob<string>("./content/en/tiles/*.md", {
  query: "?raw", import: "default", eager: true,
});

function buildContentMap(modules: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [path, content] of Object.entries(modules)) {
    map[path.split("/").pop()!.replace(/\.md$/, "")] = content;
  }
  return map;
}

export function createDocsRegistry() {
  return buildDocsRegistry({
    appTiles: { meta: appTileDocs, content: buildContentMap(tileContent) },
  });
}
```

### Standalone Docs Page

For a full-page docs view at a `/docs` route:

```tsx
import { DocsPage } from "@mindcraft-lang/docs";

export default function MyDocsPage() {
  const docsRegistry = useMemo(() => createDocsRegistry(), []);
  return <DocsPage registry={docsRegistry} backLabel="Home" backHref="/" />;
}
```

### Connecting Docs to the Brain Editor

To enable the Help context menu on tiles and the docs toggle in the editor toolbar,
bridge the two contexts:

```tsx
import { useDocsSidebar } from "@mindcraft-lang/docs";
import { BrainEditorProvider } from "@mindcraft-lang/ui";

function DocsBrainEditorProvider({ children }: { children: React.ReactNode }) {
  const { openDocsForTile, isOpen, toggle, close } = useDocsSidebar();

  const config = useMemo(
    () => ({
      ...baseBrainEditorConfig,
      onTileHelp: openDocsForTile,
      docsIntegration: { isOpen, toggle, close },
    }),
    [openDocsForTile, isOpen, toggle, close]
  );

  return <BrainEditorProvider config={config}>{children}</BrainEditorProvider>;
}
```

This wrapper must be rendered inside `DocsSidebarProvider` so `useDocsSidebar()` has
access to the docs context.

---

## 4. Build Configuration

### Prerequisites

- **Node.js** >= 18
- **Vite** >= 6 with `@vitejs/plugin-react`
- **React** >= 19
- **Tailwind CSS** v4 (with `@tailwindcss/postcss`)

### Vite

The source-only packages (`ui` and `docs`) need Vite aliases to resolve their TypeScript
source from `node_modules`. The core package needs to be excluded from Vite's dependency
pre-bundling since it already ships as ESM.

```js
// vite.config.mjs
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { uiPlugin } from "./node_modules/@mindcraft-lang/ui/src/vite-plugin.ts";

export default defineConfig({
  plugins: [
    react(),
    uiPlugin(),
  ],
  resolve: {
    alias: {
      "@mindcraft-lang/ui": path.resolve(__dirname, "node_modules/@mindcraft-lang/ui/src"),
      "@mindcraft-lang/docs": path.resolve(__dirname, "node_modules/@mindcraft-lang/docs/src"),
    },
  },
  optimizeDeps: {
    exclude: ["@mindcraft-lang/core"],
  },
});
```

`uiPlugin()` handles the Latin Modern Math font bundled with `@mindcraft-lang/ui`. Without
it the font will fail to load silently.

If you are only using `@mindcraft-lang/core`, you can skip the aliases and `uiPlugin`
entirely and just keep the `optimizeDeps.exclude`.

### TypeScript

Add path mappings so TypeScript can resolve the source-only packages:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "paths": {
      "@mindcraft-lang/ui": ["./node_modules/@mindcraft-lang/ui/src/index.ts"],
      "@mindcraft-lang/ui/*": ["./node_modules/@mindcraft-lang/ui/src/*"],
      "@mindcraft-lang/docs": ["./node_modules/@mindcraft-lang/docs/src/index.ts"],
      "@mindcraft-lang/docs/*": ["./node_modules/@mindcraft-lang/docs/src/*"]
    }
  }
}
```

### Tailwind CSS

Your app's global CSS file must import Tailwind and the shared UI stylesheet, declare the
source-only package directories as content sources, and define the shadcn/ui theme
variables.

```css
@import "tailwindcss";
@import "@mindcraft-lang/ui/ui.css";
@source "../node_modules/@mindcraft-lang/ui/src";
@source "../node_modules/@mindcraft-lang/docs/src";
```

The `ui` package uses shadcn/ui design tokens. See the sim app's `globals.css` for a
complete example of the required `@theme` block and dark mode variant.

---

## 5. Putting It All Together

A complete app using all three packages wires the providers together like this:

```tsx
import type { BrainDef } from "@mindcraft-lang/core/app";
import { DocsSidebar, DocsSidebarProvider, useDocsSidebar } from "@mindcraft-lang/docs";
import { BrainEditorDialog, BrainEditorProvider, Toaster } from "@mindcraft-lang/ui";

export default function App() {
  const docsRegistry = useMemo(() => createDocsRegistry(), []);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [brainDef, setBrainDef] = useState<BrainDef | undefined>(undefined);

  return (
    <DocsSidebarProvider registry={docsRegistry}>
      <DocsBrainEditorProvider>
        <div className="h-screen flex bg-background">
          {/* Your app content */}
        </div>
        <BrainEditorDialog
          isOpen={isEditorOpen}
          onOpenChange={setIsEditorOpen}
          srcBrainDef={brainDef}
          onSubmit={(updated) => {
            setBrainDef(updated);
            setIsEditorOpen(false);
          }}
        />
      </DocsBrainEditorProvider>
      <DocsSidebar />
      <Toaster />
    </DocsSidebarProvider>
  );
}
```

---

## 6. TypeScript Compiler + VS Code Bridge

The packages below extend the core integration with TypeScript-authored tiles and live
editing via the VS Code Web extension. These are optional -- the core + ui + docs integration
above works without them.

### Additional Packages

| Package                           | Purpose                                                              | Build model |
| --------------------------------- | -------------------------------------------------------------------- | ----------- |
| `@mindcraft-lang/ts-compiler`     | TypeScript-to-Mindcraft bytecode compiler for sensors and actuators  | Built (ESM) |
| `@mindcraft-lang/bridge-app`      | App-side client for the VS Code bridge                               | Built (ESM) |
| `@mindcraft-lang/bridge-client`   | WebSocket client SDK for the bridge                                  | Built (ESM) |
| `@mindcraft-lang/bridge-protocol` | Wire types and schemas shared between bridge components              | Built (ESM) |

```
@mindcraft-lang/bridge-app
  |-- @mindcraft-lang/bridge-client
  |-- @mindcraft-lang/bridge-protocol
  |-- @mindcraft-lang/ts-compiler
  |-- @mindcraft-lang/core

@mindcraft-lang/ts-compiler
  |-- @mindcraft-lang/core
```

### Standalone TypeScript Compiler

If you want to compile TypeScript-authored tiles without the VS Code bridge, use
`@mindcraft-lang/ts-compiler` directly:

```bash
npm install @mindcraft-lang/core @mindcraft-lang/ts-compiler
```

```typescript
import { createMindcraftEnvironment, coreModule } from "@mindcraft-lang/core/app";
import { createWorkspaceCompiler } from "@mindcraft-lang/ts-compiler";

const environment = createMindcraftEnvironment({
  modules: [coreModule(), createAppModule()],
});

const compiler = createWorkspaceCompiler({ environment });
compiler.replaceWorkspace(workspaceSnapshot);

const result = compiler.compile();
if (result.bundle) {
  environment.replaceActionBundle(result.bundle);
}
```

### VS Code Bridge

The VS Code bridge allows users to author Mindcraft sensors and actuators in TypeScript
using the [Mindcraft VS Code Web extension](https://marketplace.visualstudio.com/items?itemName=mindcraft-lang.mindcraft-lang-vscode-extension).

```bash
npm install @mindcraft-lang/core @mindcraft-lang/ts-compiler @mindcraft-lang/bridge-app
```

#### Architecture

```
  VS Code Web Extension  <--WebSocket-->  Bridge Server  <--WebSocket-->  Your App
  (TypeScript IDE)                    (vscode-bridge)                     (bridge-app)
```

The bridge server is a stateless WebSocket relay. It pushes file changes bidirectionally
between VS Code and your app. Compilation happens in your app, and diagnostics are
published back through the bridge to VS Code's Problems panel.

#### Workspace

A `WorkspaceAdapter` abstracts the virtual filesystem. The `bridge-app` package provides
`createLocalStorageWorkspace` for browser apps:

```typescript
import { createLocalStorageWorkspace } from "@mindcraft-lang/bridge-app";
import { isCompilerControlledPath } from "@mindcraft-lang/ts-compiler";

const workspace = createLocalStorageWorkspace({
  storageKey: "my-app:vscode-bridge:filesystem",
  shouldExclude: isCompilerControlledPath,
});
```

The `shouldExclude` filter prevents compiler-controlled files (`mindcraft.d.ts`,
`tsconfig.json`) from being persisted -- these are generated by the compiler and injected
automatically when the workspace snapshot is exported to the bridge.

For non-browser apps, implement `WorkspaceAdapter` directly with `exportSnapshot()`,
`applyRemoteChange()`, and `onLocalChange()`.

#### App Project

`createAppProject` is the recommended high-level API. It creates the workspace compiler,
wires it to the bridge, and handles virtual filesystem transfer:

```typescript
import { createLocalStorageWorkspace } from "@mindcraft-lang/bridge-app";
import { createAppProject } from "@mindcraft-lang/bridge-app/compilation";
import type { WorkspaceCompileResult } from "@mindcraft-lang/bridge-app/compilation";

const project = createAppProject({
  environment,
  app: { id: "my-app", name: "My App", projectId: "project-1", projectName: "My Project" },
  bridgeUrl: "localhost:6464",
  workspace,
  bindingToken: loadSavedBindingToken(),
  onBindingTokenChange: (token) => saveBindingToken(token),
  onDidCompile: (result: WorkspaceCompileResult) => {
    if (result.bundle) {
      environment.replaceActionBundle(result.bundle);
    }
  },
});

project.initialize();
```

The returned `AppProjectHandle` exposes:

| Member | Description |
|--------|-------------|
| `compiler` | The underlying `WorkspaceCompiler` instance |
| `bridge` | The `AppBridge` connection (start/stop, state, events) |
| `initialize()` | Loads the workspace snapshot into the compiler and runs the first compile |
| `recreateBridge(url)` | Stops the current bridge and creates a new one with a different URL |

#### Binding Tokens

The bridge uses a binding token make the connection between your app and the
VS Code extension durable. When the app first connects to the bridge, a token is generated and passed to
`onBindingTokenChange`. Persist this token (e.g. in `localStorage`) and pass it back as
`bindingToken` on the next session so that the VS Code editor rebinds to the app automatically.

#### Compilation Pipeline

When files change (locally or from VS Code), the compilation feature automatically:

1. Updates the workspace compiler with the change
2. Runs a full compilation pass
3. Publishes diagnostics back through the bridge to VS Code
4. Fires `onDidCompile` with the result

Your `onDidCompile` handler applies the compiled bundle to the environment:

```typescript
onDidCompile: (result) => {
  if (result.bundle) {
    const update = environment.replaceActionBundle(result.bundle);
    // update.changedActionKeys -- actions that were added/changed/removed
    // update.invalidatedBrains -- brains that reference changed actions
  }
}
```

#### VFS Service Worker (Optional)

For browser apps, `bridge-app` provides a service worker that intercepts fetch requests
for virtual filesystem paths. This enables the brain editor and docs sidebar to display
icons for user-authored sensors and actuators whose assets live in the virtual filesystem
rather than on disk.

```typescript
import { registerVfsServiceWorker } from "@mindcraft-lang/bridge-app";

registerVfsServiceWorker({
  swUrl: "/vfs-sw.js",
  workspace,
  onReady: () => { /* service worker is active */ },
});
```

Your service worker entry point re-exports the handler:

```typescript
// vfs-sw.ts (built as a separate entry point)
import "@mindcraft-lang/bridge-app/vfs-service-worker";
```

---

## 7. Troubleshooting

**TypeScript cannot find module `@mindcraft-lang/ui`**
-- Verify the `paths` entries in `tsconfig.json` point to the correct
`node_modules/@mindcraft-lang/ui/src/index.ts` path. The barrel export must point to the
`.ts` file, not a directory.

**Tailwind classes from ui/docs packages are missing**
-- Add `@source` directives in your globals.css pointing to the package `src/` directories
inside `node_modules`.

**`@mindcraft-lang/core` errors during Vite pre-bundling**
-- Add `@mindcraft-lang/core` to `optimizeDeps.exclude` in your Vite config.

**Brain editor throws "useBrainEditorConfig must be used within a BrainEditorProvider"**
-- Ensure `BrainEditorProvider` wraps any component that renders brain editor UI. If using
the docs integration pattern, `DocsBrainEditorProvider` must be inside
`DocsSidebarProvider`.

**Vite cannot resolve imports inside `@mindcraft-lang/ui` or `@mindcraft-lang/docs`**
-- The Vite alias must point to the `src/` directory so relative imports resolve correctly.
If you see errors about missing modules like `../lib/utils`, check that the alias path is
correct.

**Latin Modern Math font fails to load (OTS parsing error or 404)**
-- `uiPlugin()` from `@mindcraft-lang/ui/src/vite-plugin.ts` is missing from your Vite
config. The plugin handles URL rewriting, dev-server serving, and production asset emission
for the bundled font.
