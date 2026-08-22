# Wendoo Packages -- Integration Guide

This guide explains how to integrate the Wendoo packages into your own
Vite + React + Tailwind CSS application. All packages are installed from npm -- you do not
need to clone the wendoo-lang monorepo.

## Package Overview

| Package                | Purpose                                                                | Build model     |
| ---------------------- | ---------------------------------------------------------------------- | --------------- |
| `@wendoo-lang/core` | Tile-based visual programming language: model, compiler, runtime, VM   | Built (ESM/CJS) |
| `@wendoo-lang/ui`   | Shared React components: shadcn/ui primitives + brain editor           | Source-only     |
| `@wendoo-lang/docs` | Documentation sidebar, markdown renderer, standalone docs page         | Source-only     |

`@wendoo-lang/core` is a conventionally built package with pre-built ESM and CJS output.
It works with standard Node module resolution -- no aliases needed. Import app-facing
symbols from `@wendoo-lang/core/app`.

**Source-only** means `ui` and `docs` ship their TypeScript source on npm rather than
pre-built JavaScript. Your app compiles them at build time using Vite aliases and tsconfig
path mappings that point into the installed `node_modules` source.

Additional packages are available for TypeScript-authored tiles and VS Code Web integration.
See [TypeScript Compiler + VS Code Bridge](#6-typescript-compiler--vs-code-bridge) below.

### Dependency Graph

```
@wendoo-lang/docs
  |-- @wendoo-lang/ui
  |-- @wendoo-lang/core
  |-- react, react-dom (peer)

@wendoo-lang/ui
  |-- @wendoo-lang/core
  |-- react, react-dom (peer)

@wendoo-lang/core
  (no peer dependencies)
```

---

## 1. Getting Started with Core

```bash
npm install @wendoo-lang/core
```

The core package provides the brain model, tile catalog, compiler, runtime, and VM. Create
a `WendooEnvironment`, install modules, and create brains:

```typescript
import {
  createWendooEnvironment,
  coreModule,
  type WendooModule,
  type WendooModuleApi,
} from "@wendoo-lang/core/app";

function createAppModule(): WendooModule {
  return {
    id: "my-app",
    install(api: WendooModuleApi) {
      // Register app-specific types, sensors, actuators, operators, and tiles
    },
  };
}

const environment = createWendooEnvironment({
  modules: [coreModule(), createAppModule()],
});

const brain = environment.createBrain(brainDef, { context: actor });
brain.startup();
brain.think(now);
```

All app-facing symbols are exported from `@wendoo-lang/core/app` -- environment,
modules, brain model, tile definitions, type system, runtime values, and platform utilities.

---

## 2. Adding the Brain Editor

```bash
npm install @wendoo-lang/ui
```

The UI package provides shadcn/ui primitives, the brain editor, and utility functions.

### BrainEditorConfig

The brain editor requires a `BrainEditorConfig` to decouple it from app-specific concerns:

```tsx
import type { BrainEditorConfig } from "@wendoo-lang/ui";

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
| `onTileDocs`                 | `(tileDef) => void`                | No       | Callback opening a tile's documentation       |
| `docsIntegration`            | `{ isOpen, toggle, close }`        | No       | Docs sidebar controls for the editor toolbar  |

### Rendering the Editor

Wrap your app with `BrainEditorProvider` and use `BrainEditorDialog` to open it:

```tsx
import { BrainEditorProvider, BrainEditorDialog, Toaster } from "@wendoo-lang/ui";

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
import { Button, Card, Dialog, Input, Slider } from "@wendoo-lang/ui";
import { cn, adjustColor, saturateColor } from "@wendoo-lang/ui";
```

---

## 3. Adding Documentation

```bash
npm install @wendoo-lang/docs
```

The docs package provides a documentation sidebar, markdown renderer, and standalone docs
page. It depends on both `@wendoo-lang/core` and `@wendoo-lang/ui`.

### Minimal Setup

If you have no app-specific documentation, call `buildDocsRegistry()` with no arguments to
get a registry containing only the built-in core docs:

```tsx
import { buildDocsRegistry, DocsSidebar, DocsSidebarProvider } from "@wendoo-lang/docs";

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
import { buildDocsRegistry } from "@wendoo-lang/docs";
import type { AppTileDocMeta, AppPatternDocMeta } from "@wendoo-lang/docs";

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
import { DocsPage } from "@wendoo-lang/docs";

export default function MyDocsPage() {
  const docsRegistry = useMemo(() => createDocsRegistry(), []);
  return <DocsPage registry={docsRegistry} backLabel="Home" backHref="/" />;
}
```

### Connecting Docs to the Brain Editor

To enable the Help context menu on tiles and the docs toggle in the editor toolbar,
bridge the two contexts:

```tsx
import { useDocsSidebar } from "@wendoo-lang/docs";
import { BrainEditorProvider } from "@wendoo-lang/ui";

function DocsBrainEditorProvider({ children }: { children: React.ReactNode }) {
  const { openDocsForTile, isOpen, toggle, close } = useDocsSidebar();

  const config = useMemo(
    () => ({
      ...baseBrainEditorConfig,
      onTileDocs: openDocsForTile,
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
import { uiPlugin } from "./node_modules/@wendoo-lang/ui/src/vite-plugin.ts";

export default defineConfig({
  plugins: [
    react(),
    uiPlugin(),
  ],
  resolve: {
    alias: {
      "@wendoo-lang/ui": path.resolve(__dirname, "node_modules/@wendoo-lang/ui/src"),
      "@wendoo-lang/docs": path.resolve(__dirname, "node_modules/@wendoo-lang/docs/src"),
    },
  },
  optimizeDeps: {
    exclude: ["@wendoo-lang/core"],
  },
});
```

`uiPlugin()` handles the Latin Modern Math font bundled with `@wendoo-lang/ui`. Without
it the font will fail to load silently.

If you are only using `@wendoo-lang/core`, you can skip the aliases and `uiPlugin`
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
      "@wendoo-lang/ui": ["./node_modules/@wendoo-lang/ui/src/index.ts"],
      "@wendoo-lang/ui/*": ["./node_modules/@wendoo-lang/ui/src/*"],
      "@wendoo-lang/docs": ["./node_modules/@wendoo-lang/docs/src/index.ts"],
      "@wendoo-lang/docs/*": ["./node_modules/@wendoo-lang/docs/src/*"]
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
@import "@wendoo-lang/ui/ui.css";
@source "../node_modules/@wendoo-lang/ui/src";
@source "../node_modules/@wendoo-lang/docs/src";
```

The `ui` package uses shadcn/ui design tokens. See the sim app's `globals.css` for a
complete example of the required `@theme` block and dark mode variant.

---

## 5. Putting It All Together

A complete app using all three packages wires the providers together like this:

```tsx
import type { BrainDef } from "@wendoo-lang/core/app";
import { DocsSidebar, DocsSidebarProvider, useDocsSidebar } from "@wendoo-lang/docs";
import { BrainEditorDialog, BrainEditorProvider, Toaster } from "@wendoo-lang/ui";

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
| `@wendoo-lang/ts-compiler`     | TypeScript-to-Wendoo bytecode compiler for sensors and actuators  | Built (ESM) |
| `@wendoo-lang/bridge-app`      | App-side client for the VS Code bridge                               | Built (ESM) |
| `@wendoo-lang/bridge-client`   | WebSocket client SDK for the bridge                                  | Built (ESM) |
| `@wendoo-lang/bridge-protocol` | Wire types and schemas shared between bridge components              | Built (ESM) |

```
@wendoo-lang/bridge-app
  |-- @wendoo-lang/bridge-client
  |-- @wendoo-lang/bridge-protocol
  |-- @wendoo-lang/ts-compiler
  |-- @wendoo-lang/core

@wendoo-lang/ts-compiler
  |-- @wendoo-lang/core
```

### Standalone TypeScript Compiler

If you want to compile TypeScript-authored tiles without the VS Code bridge, use
`@wendoo-lang/ts-compiler` directly:

```bash
npm install @wendoo-lang/core @wendoo-lang/ts-compiler
```

```typescript
import { createWendooEnvironment, coreModule } from "@wendoo-lang/core/app";
import { createWorkspaceCompiler } from "@wendoo-lang/ts-compiler";

const environment = createWendooEnvironment({
  modules: [coreModule(), createAppModule()],
});

const compiler = createWorkspaceCompiler({ environment });
compiler.replaceWorkspace(projectFileSnapshot);

const result = compiler.compile();
if (result.bundle) {
  environment.replaceActionBundle(result.bundle);
}
```

### VS Code Bridge

The VS Code bridge allows users to author Wendoo sensors and actuators in TypeScript
using the [Wendoo VS Code Web extension](https://marketplace.visualstudio.com/items?itemName=wendoo-lang.wendoo-lang-vscode-extension).

```bash
npm install @wendoo-lang/core @wendoo-lang/ts-compiler @wendoo-lang/bridge-app
```

#### Architecture

```
  VS Code Web Extension  <--WebSocket-->  Bridge Server  <--WebSocket-->  Your App
  (TypeScript IDE)                    (vscode-bridge)                     (bridge-app)
```

The bridge server is a stateless WebSocket relay. It pushes file changes bidirectionally
between VS Code and your app. Compilation happens in your app, and diagnostics are
published back through the bridge to VS Code's Problems panel.

#### Project File System

A `ProjectFileSystem` abstracts the virtual filesystem. The `bridge-app` package provides
`createInMemoryProjectFileSystem` for browser apps:

```typescript
import { createInMemoryProjectFileSystem } from "@wendoo-lang/bridge-app";
import { isCompilerControlledPath } from "@wendoo-lang/ts-compiler";

const filesystem = createInMemoryProjectFileSystem({
  shouldExclude: isCompilerControlledPath,
});
```

The `shouldExclude` filter prevents compiler-controlled files (`wendoo.d.ts`,
`tsconfig.json`) from being stored in the project file system -- these are generated by the compiler
and injected automatically when the project file snapshot is exported to the bridge.

For non-browser apps, implement `ProjectFileSystem` directly with `exportSnapshot()`,
`applyRemoteChange()`, and `onLocalChange()`.

#### App Project

`createBridgeProject` is the recommended high-level API. It creates the project compiler,
wires it to the bridge, and handles virtual filesystem transfer:

```typescript
import { createInMemoryProjectFileSystem } from "@wendoo-lang/bridge-app";
import { createBridgeProject } from "@wendoo-lang/bridge-app/compilation";
import type { WorkspaceCompileResult } from "@wendoo-lang/bridge-app/compilation";

const project = createBridgeProject({
  environment,
  host: { name: "My App", version: "1.0.0" },
  defaults: { name: "my-project" },
  bridgeUrl: "localhost:6464",
  filesystem,
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

The returned `BridgeProjectHandle` exposes:

| Member | Description |
|--------|-------------|
| `compiler` | The underlying `WorkspaceCompiler` instance |
| `bridge` | The `AppBridge` connection (start/stop, state, events) |
| `initialize()` | Loads the project file snapshot into the compiler and runs the first compile |
| `recreateBridge(url)` | Stops the current bridge and creates a new one with a different URL |

#### Binding Tokens

The bridge uses a binding token make the connection between your app and the
VS Code extension durable. When the app first connects to the bridge, a token is generated and passed to
`onBindingTokenChange`. Persist this token (e.g. in `localStorage`) and pass it back as
`bindingToken` on the next session so that the VS Code editor rebinds to the app automatically.

#### Compilation Pipeline

When files change (locally or from VS Code), the compilation feature automatically:

1. Updates the project compiler with the change
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
import { registerVfsServiceWorker } from "@wendoo-lang/bridge-app";

registerVfsServiceWorker({
  swUrl: "/vfs-sw.js",
  getProjectFileSystem: () => filesystem,
  onReady: () => { /* service worker is active */ },
});
```

Your service worker entry point re-exports the handler:

```typescript
// vfs-sw.ts (built as a separate entry point)
import "@wendoo-lang/bridge-app/vfs-service-worker";
```

---

## 7. Troubleshooting

**TypeScript cannot find module `@wendoo-lang/ui`**
-- Verify the `paths` entries in `tsconfig.json` point to the correct
`node_modules/@wendoo-lang/ui/src/index.ts` path. The barrel export must point to the
`.ts` file, not a directory.

**Tailwind classes from ui/docs packages are missing**
-- Add `@source` directives in your globals.css pointing to the package `src/` directories
inside `node_modules`.

**`@wendoo-lang/core` errors during Vite pre-bundling**
-- Add `@wendoo-lang/core` to `optimizeDeps.exclude` in your Vite config.

**Brain editor throws "useBrainEditorConfig must be used within a BrainEditorProvider"**
-- Ensure `BrainEditorProvider` wraps any component that renders brain editor UI. If using
the docs integration pattern, `DocsBrainEditorProvider` must be inside
`DocsSidebarProvider`.

**Vite cannot resolve imports inside `@wendoo-lang/ui` or `@wendoo-lang/docs`**
-- The Vite alias must point to the `src/` directory so relative imports resolve correctly.
If you see errors about missing modules like `../lib/utils`, check that the alias path is
correct.

**Latin Modern Math font fails to load (OTS parsing error or 404)**
-- `uiPlugin()` from `@wendoo-lang/ui/src/vite-plugin.ts` is missing from your Vite
config. The plugin handles URL rewriting, dev-server serving, and production asset emission
for the bundled font.
