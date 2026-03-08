# Mindcraft Packages -- Integration Guide

This guide explains how to integrate `@mindcraft-lang/core`, `@mindcraft-lang/ui`, and
`@mindcraft-lang/docs` into your own Vite + React + Tailwind CSS application. All three
packages are installed from npm -- you do not need to clone the mindcraft-lang monorepo.

## Package Overview

| Package                | Purpose                                                                | Build model     |
| ---------------------- | ---------------------------------------------------------------------- | --------------- |
| `@mindcraft-lang/core` | Tile-based visual programming language: model, compiler, runtime, VM   | Built (ESM/CJS) |
| `@mindcraft-lang/ui`   | Shared React components: shadcn/ui primitives + brain editor           | Source-only     |
| `@mindcraft-lang/docs` | Documentation sidebar, markdown renderer, standalone docs page         | Source-only     |

**Source-only** means `ui` and `docs` ship their TypeScript source on npm rather than
pre-built JavaScript. Your app compiles them at build time using Vite aliases and tsconfig
path mappings that point into the installed `node_modules` source.

`@mindcraft-lang/core` is a conventionally built package with pre-built ESM and CJS output.
It works with standard Node module resolution -- no aliases needed.

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

## 1. Prerequisites

- **Node.js** >= 18
- **Vite** >= 6 with `@vitejs/plugin-react`
- **React** >= 19
- **Tailwind CSS** v4 (with `@tailwindcss/postcss`)

---

## 2. Install Dependencies

### npm install

Install the packages you need:

```bash
# Core only (language runtime, compiler, VM)
npm install @mindcraft-lang/core

# Core + UI (adds brain editor and shadcn/ui components)
npm install @mindcraft-lang/core @mindcraft-lang/ui

# Full stack (adds documentation sidebar and renderer)
npm install @mindcraft-lang/core @mindcraft-lang/ui @mindcraft-lang/docs
```

If you only need the core language runtime (no UI), you only need `@mindcraft-lang/core`.

### Peer dependencies

The `ui` and `docs` packages require React 19+:

```bash
npm install react react-dom
```

---

## 3. Vite Configuration

The source-only packages (`ui` and `docs`) need Vite aliases to resolve their TypeScript
source from `node_modules`. The core package needs to be excluded from Vite's dependency
pre-bundling since it already ships as ESM.

```js
// vite.config.mjs
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Source-only packages: resolve to their src/ directories in node_modules
      "@mindcraft-lang/ui": path.resolve(__dirname, "node_modules/@mindcraft-lang/ui/src"),
      "@mindcraft-lang/docs": path.resolve(__dirname, "node_modules/@mindcraft-lang/docs/src"),
    },
  },
  optimizeDeps: {
    exclude: ["@mindcraft-lang/core"],
  },
});
```

If you are only using `@mindcraft-lang/core`, you can skip the aliases entirely and just
keep the `optimizeDeps.exclude`.

---

## 4. TypeScript Configuration

Add path mappings so the TypeScript compiler can resolve the source-only packages. The core
package uses standard Node module resolution and does not need path mappings.

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@mindcraft-lang/ui": ["./node_modules/@mindcraft-lang/ui/src/index.ts"],
      "@mindcraft-lang/ui/*": ["./node_modules/@mindcraft-lang/ui/src/*"],
      "@mindcraft-lang/docs": ["./node_modules/@mindcraft-lang/docs/src/index.ts"],
      "@mindcraft-lang/docs/*": ["./node_modules/@mindcraft-lang/docs/src/*"]
    }
  }
}
```

---

## 5. Tailwind CSS Setup

### globals.css

Your app's global CSS file must import Tailwind, the shared UI stylesheet, and declare the
`ui` and `docs` source directories as Tailwind content sources so their utility classes are
included in the build.

```css
@import "tailwindcss";
@import "@mindcraft-lang/ui/ui.css";
@source "../node_modules/@mindcraft-lang/ui/src";
@source "../node_modules/@mindcraft-lang/docs/src";
```

### Theme variables

The `ui` package uses shadcn/ui design tokens. Define the theme CSS variables in your
globals.css:

```css
@theme {
  --color-background: oklch(100% 0 0);
  --color-foreground: oklch(9% 0 0);
  --color-card: oklch(100% 0 0);
  --color-card-foreground: oklch(9% 0 0);
  --color-popover: oklch(100% 0 0);
  --color-popover-foreground: oklch(9% 0 0);
  --color-primary: oklch(9% 0 0);
  --color-primary-foreground: oklch(98% 0 0);
  --color-secondary: oklch(96% 0 0);
  --color-secondary-foreground: oklch(9% 0 0);
  --color-muted: oklch(96% 0 0);
  --color-muted-foreground: oklch(45% 0 0);
  --color-accent: oklch(96% 0 0);
  --color-accent-foreground: oklch(9% 0 0);
  --color-destructive: oklch(60% 0.21 29);
  --color-destructive-foreground: oklch(98% 0 0);
  --color-border: oklch(90% 0 0);
  --color-input: oklch(90% 0 0);
  --color-ring: oklch(9% 0 0);
  --radius: 0.5rem;
  --font-mono:
    "Roboto Mono", ui-monospace, "Cascadia Code", "Source Code Pro", Menlo,
    Consolas, "DejaVu Sans Mono", monospace;
}
```

You can provide a dark mode variant in a `@media (prefers-color-scheme: dark)` block. See
the sim app's `globals.css` for a complete example.

---

## 6. Integrating `@mindcraft-lang/core`

The core package provides the brain model, tile catalog, compiler, runtime, and VM. Import
from its sub-path exports:

```typescript
// Brain model types
import type { BrainDef } from "@mindcraft-lang/core/brain/model";

// Tile definitions and catalog
import { getBrainServices } from "@mindcraft-lang/core/brain";

// Compiler
import { compile } from "@mindcraft-lang/core/brain/compiler";

// Runtime / VM
import { BrainRunner } from "@mindcraft-lang/core/brain/runtime";

// Platform utilities
import { Vector2, Vector3, List, Dict } from "@mindcraft-lang/core";
```

### Available sub-path exports

| Import path                                    | Contents                              |
| ---------------------------------------------- | ------------------------------------- |
| `@mindcraft-lang/core`                         | Top-level: platform utils, re-exports |
| `@mindcraft-lang/core/brain`                   | Brain services, tile catalog          |
| `@mindcraft-lang/core/brain/model`             | BrainDef, page/rule/tile interfaces   |
| `@mindcraft-lang/core/brain/tiles`             | Built-in tile definitions             |
| `@mindcraft-lang/core/brain/compiler`          | Compiler and parser                   |
| `@mindcraft-lang/core/brain/runtime`           | Brain runner and VM                   |
| `@mindcraft-lang/core/brain/language-service`  | Language service (tile suggestions)   |
| `@mindcraft-lang/core/platform`                | Platform abstractions                 |
| `@mindcraft-lang/core/docs`                    | Core doc manifests                    |
| `@mindcraft-lang/core/docs/en`                 | Core English doc content              |

---

## 7. Integrating `@mindcraft-lang/ui`

The UI package provides shadcn/ui primitives, the full brain editor, and utility functions.

### Brain Editor Setup

The brain editor is the main component. It requires a `BrainEditorConfig` to decouple it
from app-specific concerns.

#### Step 1: Build a `BrainEditorConfig`

```tsx
import type { BrainEditorConfig } from "@mindcraft-lang/ui";

const brainEditorConfig: BrainEditorConfig = {
  // Required: map data type IDs to icon URLs
  dataTypeIcons: new Map([
    ["core:number", "/assets/icons/number.svg"],
    ["core:string", "/assets/icons/string.svg"],
    ["core:boolean", "/assets/icons/boolean.svg"],
  ]),

  // Required: map data type IDs to display names
  dataTypeNames: new Map([
    ["core:number", "number"],
    ["core:string", "text"],
    ["core:boolean", "true/false"],
  ]),

  // Required: identify app-specific variable factory tiles
  isAppVariableFactoryTileId: (id) => id.startsWith("tile.var.factory->struct:"),

  // Required: custom literal types (empty array if none)
  customLiteralTypes: [],

  // Optional: factory for creating new empty brains
  getDefaultBrain: () => myDefaultBrain,
};
```

#### Step 2: Wrap your app with `BrainEditorProvider`

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

### BrainEditorConfig Reference

| Field                        | Type                               | Required | Purpose                                            |
| ---------------------------- | ---------------------------------- | -------- | -------------------------------------------------- |
| `dataTypeIcons`              | `ReadonlyMap<string, string>`      | Yes      | Type ID -> icon URL                                |
| `dataTypeNames`              | `ReadonlyMap<string, string>`      | Yes      | Type ID -> display name                            |
| `isAppVariableFactoryTileId` | `(id: string) => boolean`          | Yes      | Identifies app variable factory tiles              |
| `customLiteralTypes`         | `ReadonlyArray<CustomLiteralType>` | Yes      | App-defined literal tile types (e.g. Vector2)      |
| `getDefaultBrain`            | `() => BrainDef \| undefined`      | No       | Factory for "Load Default Brain" action            |
| `onTileHelp`                 | `(tileDef) => void`                | No       | Callback for tile right-click -> Help              |
| `docsIntegration`            | `{ isOpen, toggle, close }`        | No       | Docs sidebar controls for the editor toolbar       |

### Using UI Primitives

The package re-exports shadcn/ui primitives. Import them from the barrel:

```tsx
import { Button, Card, Dialog, Input, Slider } from "@mindcraft-lang/ui";
```

### Utility Functions

```tsx
import { cn, adjustColor, saturateColor } from "@mindcraft-lang/ui";
```

---

## 8. Integrating `@mindcraft-lang/docs`

The docs package provides the documentation sidebar, markdown renderer, and a standalone
docs page. It depends on both `@mindcraft-lang/core` and `@mindcraft-lang/ui`.

### Step 1: Create a Docs Manifest

Define metadata for your app-specific tile and pattern documentation. Each entry has a
`contentKey` that maps to a markdown file.

```typescript
// src/docs/manifest.ts
import type { AppTileDocMeta, AppPatternDocMeta } from "@mindcraft-lang/docs";

export const appTileDocs: readonly AppTileDocMeta[] = [
  {
    tileId: "tile.sensor->sensor.see",
    tags: ["vision", "detection"],
    category: "Sensors",
    contentKey: "see",
  },
  {
    tileId: "tile.actuator->actuator.move",
    tags: ["movement", "action"],
    category: "Actuators",
    contentKey: "move",
  },
];

export const appPatternDocs: readonly AppPatternDocMeta[] = [
  {
    id: "hunt-and-eat",
    title: "Hunt and Eat",
    tags: ["hunting", "feeding"],
    category: "Hunting",
    contentKey: "hunt-and-eat",
  },
];
```

### Step 2: Write Markdown Content

Place markdown files alongside your manifest:

```
src/docs/content/en/
  tiles/
    see.md
    move.md
  patterns/
    hunt-and-eat.md
```

### Step 3: Build the Docs Registry

Use Vite's `import.meta.glob` to load markdown content at build time, then pass it to
`buildDocsRegistry()`.

```typescript
// src/docs/docs-registry.ts
import { buildDocsRegistry } from "@mindcraft-lang/docs";
import { appPatternDocs, appTileDocs } from "./manifest";

const appTileModules = import.meta.glob<string>("./content/en/tiles/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

const appPatternModules = import.meta.glob<string>("./content/en/patterns/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});

function contentKeyFromPath(p: string): string {
  const filename = p.split("/").pop() ?? "";
  return filename.replace(/\.md$/, "");
}

function buildContentMap(modules: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [path, content] of Object.entries(modules)) {
    map[contentKeyFromPath(path)] = content;
  }
  return map;
}

export function createDocsRegistry() {
  return buildDocsRegistry({
    appTiles: {
      meta: appTileDocs,
      content: buildContentMap(appTileModules),
    },
    appPatterns: {
      meta: appPatternDocs,
      content: buildContentMap(appPatternModules),
    },
  });
}
```

If you have no app-specific documentation, call `buildDocsRegistry()` with no arguments to
get a registry containing only the core tile and concept docs.

### Step 4: Add the Docs Sidebar

Wrap your app with `DocsSidebarProvider` and render `DocsSidebar`.

```tsx
import { DocsSidebar, DocsSidebarProvider } from "@mindcraft-lang/docs";
import { createDocsRegistry } from "./docs/docs-registry";

function App() {
  const docsRegistry = useMemo(() => createDocsRegistry(), []);

  return (
    <DocsSidebarProvider registry={docsRegistry}>
      {/* Your app content */}
      <DocsSidebar />
    </DocsSidebarProvider>
  );
}
```

### Step 5: Add a Standalone Docs Page (Optional)

For a full-page docs view at a `/docs` route:

```tsx
import { DocsPage } from "@mindcraft-lang/docs";
import { Toaster } from "@mindcraft-lang/ui";
import { createDocsRegistry } from "./docs/docs-registry";

export default function MyDocsPage() {
  const docsRegistry = useMemo(() => createDocsRegistry(), []);

  return (
    <DocsPage registry={docsRegistry} backLabel="Home" backHref="/">
      <Toaster />
    </DocsPage>
  );
}
```

The `DocsPage` component syncs with the browser URL using `pushState`. The URL format is
`/docs/{tab}/{entryKey}`.

### Step 6: Wire Docs into the Brain Editor (Optional)

To connect the docs sidebar to the brain editor (enabling the Help context menu item on
tiles and the docs toggle button in the editor toolbar), bridge the two contexts in a
wrapper component:

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

This wrapper must be rendered inside `DocsSidebarProvider` so `useDocsSidebar()` has access
to the docs context.

When `docsIntegration` is not provided, the brain editor hides the docs toggle button. When
`onTileHelp` is not provided, the Help context menu item is hidden.

---

## 9. Minimal Integration Checklist

### Core only

- [ ] `npm install @mindcraft-lang/core`
- [ ] Add `optimizeDeps.exclude: ["@mindcraft-lang/core"]` to Vite config
- [ ] Import from sub-path exports as needed

### Core + UI (brain editor)

- [ ] `npm install @mindcraft-lang/core @mindcraft-lang/ui`
- [ ] Add Vite alias for `@mindcraft-lang/ui` pointing to `node_modules/.../src`
- [ ] Add tsconfig `paths` for `@mindcraft-lang/ui`
- [ ] Import `@mindcraft-lang/ui/ui.css` and add `@source` directive in globals.css
- [ ] Define shadcn/ui theme variables in globals.css
- [ ] Build a `BrainEditorConfig` and wrap your app with `BrainEditorProvider`

### Core + UI + Docs (full integration)

- [ ] `npm install @mindcraft-lang/core @mindcraft-lang/ui @mindcraft-lang/docs`
- [ ] Add Vite aliases for both `@mindcraft-lang/ui` and `@mindcraft-lang/docs`
- [ ] Add tsconfig `paths` for both source-only packages
- [ ] Add `@source` directives for both packages in globals.css
- [ ] Create a docs manifest with `AppTileDocMeta` and `AppPatternDocMeta`
- [ ] Write markdown content files
- [ ] Build a `DocsRegistry` using `buildDocsRegistry()`
- [ ] Wrap your app with `DocsSidebarProvider` and render `DocsSidebar`
- [ ] Optionally add a `/docs` route using `DocsPage`
- [ ] Optionally wire `useDocsSidebar()` into `BrainEditorConfig`

---

## 10. Reference: Complete App.tsx Example

```tsx
import type { BrainDef } from "@mindcraft-lang/core/brain/model";
import { DocsSidebar, DocsSidebarProvider, useDocsSidebar } from "@mindcraft-lang/docs";
import { BrainEditorDialog, BrainEditorProvider, Toaster } from "@mindcraft-lang/ui";
import { useMemo, useState } from "react";
import { createDocsRegistry } from "./docs/docs-registry";

// -- Build your BrainEditorConfig (app-specific) ----------------------------
const baseBrainEditorConfig = {
  dataTypeIcons: new Map(/* ... */),
  dataTypeNames: new Map(/* ... */),
  isAppVariableFactoryTileId: (id: string) => false,
  customLiteralTypes: [],
};

// -- Wrapper: injects docs integration into the brain editor config ---------
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

// -- Main App ---------------------------------------------------------------
export default function App() {
  const docsRegistry = useMemo(() => createDocsRegistry(), []);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [brainDef, setBrainDef] = useState<BrainDef | undefined>(undefined);

  return (
    <DocsSidebarProvider registry={docsRegistry}>
      <div className="h-screen flex bg-background">
        {/* Your app content */}
      </div>

      <DocsBrainEditorProvider>
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

## 11. Upgrading Packages

Since all three packages are installed from npm, upgrading is standard:

```bash
# Upgrade to the latest versions
npm update @mindcraft-lang/core @mindcraft-lang/ui @mindcraft-lang/docs

# Or install specific versions
npm install @mindcraft-lang/core@0.2.0 @mindcraft-lang/ui@0.2.0 @mindcraft-lang/docs@0.2.0
```

The source-only packages (`ui`, `docs`) ship TypeScript source, so after upgrading you may
need to address any breaking API changes that surface as type errors in your build.

---

## 12. Troubleshooting

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
-- These source-only packages use relative imports internally (e.g., `../ui/button`). The
Vite alias must point to the `src/` directory so relative imports resolve correctly. If you
see errors about missing modules like `../lib/utils`, check that the alias path is correct.
