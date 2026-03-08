---
applyTo: "packages/docs/**"
---

<!-- Last reviewed: 2026-03-07 -->

# Docs Package -- Architecture & Conventions

`packages/docs` is a **source-only** React component library providing the shared documentation
sidebar, markdown renderer, and standalone docs page for Mindcraft web applications. There is no
build step -- consuming apps resolve the TypeScript source directly via Vite aliases and tsconfig
path mappings (same pattern as `packages/ui`).

## Key Constraints

- **No path aliases** within this package. Use relative imports only (e.g., `./DocsRegistry`,
  `./DocsSidebarContext`). Consuming apps map `@mindcraft-lang/docs` to the source directory;
  internal aliases would not resolve through the host app's toolchain.
- **No app-specific types**. Types like `Archetype`, `Actor`, or other sim-specific concepts
  must not appear here. The package is generic -- apps inject app-specific content via the
  registry and manifest types.
- **Depends on `@mindcraft-lang/ui`** for brain editor types (`TileVisual`), color utilities,
  glass effects, and the rule clipboard. Import these from `@mindcraft-lang/ui` (barrel) or
  deep paths like `@mindcraft-lang/ui/brain-editor/types`.
- **Depends on `@mindcraft-lang/core`** for brain tile definitions, tile catalog, docs manifests,
  and generated doc content.
- Follow the same Biome conventions as the rest of the monorepo (double quotes, semicolons,
  2-space indent, 120-char line width).

## Package Layout

```
src/
  index.ts                Barrel export (all public API)
  DocsRegistry.ts         DocsRegistry class (tiles, patterns, concepts data store)
  DocsSidebarContext.tsx   DocsSidebarProvider, useDocsSidebar(), DocTab type
  DocsSidebar.tsx          Slide-out sidebar (desktop) / fullscreen overlay (mobile)
  DocsPage.tsx             Standalone full-page docs view with URL sync
  DocMarkdown.tsx          Markdown renderer with brain-fence and tile-ref support
  DocsRule.tsx             DocsRuleBlock, DocsRuleRow, DocsTileChip, InlineTileIcon
  BrainCodeBlock.tsx       Renders brain code fences as visual tiles/rules
  DocsPrintView.tsx        Print-friendly documentation layout
  buildDocsRegistry.ts     buildDocsRegistry() factory + shared manifest types
```

## Core Architecture

### DocsRegistry

`DocsRegistry` is a pure data store holding three collections:

| Collection | Entry type         | Keyed by |
| ---------- | ------------------ | -------- |
| tiles      | `DocsTileEntry`    | `tileId` |
| patterns   | `DocsPatternEntry` | `id`     |
| concepts   | `DocsConceptEntry` | `id`     |

Populated once at app startup via `registry.register(entries)`. Additive, last-write-wins per key.
The registry also provides `tileCategories`, `patternCategories`, `tilesByCategory()`, and
`patternsByCategory()` for the sidebar's grouped listing.

### DocsSidebarContext

React context managing sidebar state:

| Field               | Type                                             | Purpose                                      |
| ------------------- | ------------------------------------------------ | -------------------------------------------- |
| `isOpen`            | `boolean`                                        | Whether the sidebar panel is visible         |
| `activeTab`         | `DocTab` (`"tiles" \| "patterns" \| "concepts"`) | Currently selected tab                       |
| `registry`          | `DocsRegistry`                                   | The docs data store                          |
| `navKey`            | `string \| null`                                 | Entry key for detail view (null = list view) |
| `navTab`            | `DocTab \| null`                                 | Tab the detail view belongs to               |
| `open/close/toggle` | `() => void`                                     | Panel visibility controls                    |
| `setTab`            | `(tab: DocTab) => void`                          | Switch tab (resets to list view)             |
| `navigateToEntry`   | `(tab: DocTab, key: string) => void`             | Deep-link to a specific entry                |
| `navigateBack`      | `() => void`                                     | Return to list view                          |
| `openDocsForTile`   | `(tileDef: IBrainTileDef) => void`               | Open sidebar to a tile's doc page            |

`openDocsForTile` handles variable and literal tiles specially -- it redirects to the relevant
concept page ("variables" or "literals") since those tiles are dynamic and don't have individual
doc entries.

### buildDocsRegistry Factory

`buildDocsRegistry(options?)` merges core documentation (imported internally from
`@mindcraft-lang/core/docs` and `@mindcraft-lang/core/docs/en`) with optional app-specific
entries. Apps supply:

```typescript
buildDocsRegistry({
  appTiles: { meta: AppTileDocMeta[], content: Record<string, string> },
  appPatterns: { meta: AppPatternDocMeta[], content: Record<string, string> },
});
```

The `meta` arrays use `AppTileDocMeta` and `AppPatternDocMeta` types exported from this package.
Each entry has a `contentKey` that maps into the `content` record.

### DocsPage (Standalone)

`DocsPage` provides a full-page documentation view with browser URL sync. It renders
`DocsSidebarProvider` + `DocsPanelContent` in a standalone layout (no sidebar overlay mode).

Props:

| Prop        | Type           | Default  | Purpose                              |
| ----------- | -------------- | -------- | ------------------------------------ |
| `registry`  | `DocsRegistry` | required | The docs data store                  |
| `backLabel` | `string`       | `"Home"` | Text for the back link in the header |
| `backHref`  | `string`       | `"/"`    | URL the back link navigates to       |
| `children`  | `ReactNode`    | --       | Extra elements (e.g. Toaster)        |

URL format: `/docs/{tab}/{entryKey}` -- synced via `pushState` and `popstate`.

## Brain Editor Integration

The docs package does NOT import from `packages/ui`'s brain editor context. Instead, the brain
editor imports callbacks from the docs context via dependency inversion through `BrainEditorConfig`
(defined in `packages/ui/src/brain-editor/BrainEditorContext.tsx`):

| Config field      | Type                               | Used by                 | Purpose                                       |
| ----------------- | ---------------------------------- | ----------------------- | --------------------------------------------- |
| `onTileHelp`      | `(tileDef: IBrainTileDef) => void` | `BrainTileEditor.tsx`   | Right-click -> Help menu item on tiles        |
| `docsIntegration` | `{ isOpen, toggle, close }`        | `BrainEditorDialog.tsx` | Docs toggle button in toolbar + close on exit |

The host app wires these up. Example from `apps/sim/src/App.tsx`:

```tsx
function DocsBrainEditorProvider({ children }) {
  const { openDocsForTile, isOpen, toggle, close } = useDocsSidebar();
  const config = {
    ...baseConfig,
    onTileHelp: openDocsForTile,
    docsIntegration: { isOpen, toggle, close },
  };
  return <BrainEditorProvider config={config}>{children}</BrainEditorProvider>;
}
```

When `docsIntegration` is not provided, the brain editor hides the docs toggle button and skips
the close-on-exit effect. When `onTileHelp` is not provided, the Help context menu item is hidden.

## Markdown Syntax Extensions

Doc markdown files support these custom syntaxes inside `DocMarkdown`:

**Brain code fences** -- render visual tile/rule blocks:

    ```brain
    [{ "when": ["tile.sensor->sensor.see"], "do": ["tile.actuator->actuator.move"] }]
    ```

Accepted JSON formats inside brain fences:

| Format            | JSON shape                                                                    | Renders as                                                |
| ----------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| Array of rules    | `[{ when, do, children?, catalog? }]`                                         | Rule rows with WHEN/DO chips                              |
| Clipboard wrapper | `{ ruleJsons: [...], catalog?: [...] }`                                       | Rule rows (supports local catalog for variables/literals) |
| Single tile       | `{ tile: "tileId", catalog?: [...] }` or `{ tileId: "...", catalog?: [...] }` | Standalone tile chip                                      |
| Multiple tiles    | `{ tiles: ["tileId", ...], catalog?: [...] }`                                 | Row of tile chips                                         |

**Fence meta options** -- space-separated tokens after `brain` in the info string:

| Token     | Effect                                                 |
| --------- | ------------------------------------------------------ |
| `noframe` | Removes the border, background, and copy-button footer |
| `do`      | Uses DO-side colors instead of WHEN-side (default)     |

Example: ` ```brain noframe ` renders tiles without the framed container.

**Inline tile references** -- `` `tile:tile.op->add` `` renders as a small colored tile chip
with its icon and label. Clickable to navigate to that tile's doc page if one exists.

**Inline tag pills** -- `` `tag:Operator;color:#FFE500` `` renders as a colored badge pill.
The `color` parameter is optional (defaults to slate).

## Rendering Architecture

`DocMarkdown` uses `react-markdown` (v9+) with `remark-gfm`. The `code` component override
checks for `language-brain` and delegates to `BrainCodeBlock`. The HAST `node` prop
(passed automatically by react-markdown v9 via `passNode: true`) carries the fence meta string
at `node.data.meta`.

`BrainCodeBlock` parses the JSON content, resolves tile IDs via the global tile catalog
(`getBrainServices().tiles`) and optionally a local `TileCatalog` built from `catalog` entries
(for variables/literals not in the global registry). Resolved tiles are rendered through
`DocsTileChip` (standalone) or `DocsRuleBlock` -> `DocsRuleRow` (rule context).

Rule code blocks include a "Copy" button that serializes the rules to the brain editor clipboard
via `setClipboardFromJson` (imported from `@mindcraft-lang/ui/brain-editor/rule-clipboard`),
allowing users to paste examples directly into the brain editor.

`DocsPrintView` is a parallel print-friendly renderer with the same format support but
simplified CSS-class-based styling (no glass effects).

## Doc Content Sources

- **Core docs**: `packages/core/src/docs/content/en/tiles/*.md` and `concepts/*.md`
  - Built into `packages/core/src/docs/_generated/en.ts` by `scripts/build-docs.js`
  - Loaded internally by `buildDocsRegistry()`
- **App-specific docs**: e.g., `apps/sim/src/docs/content/en/tiles/*.md` and `patterns/*.md`
  - Loaded at build time via Vite `import.meta.glob` with `?raw` queries
  - Passed to `buildDocsRegistry()` as `content` records
- **Manifests**: `packages/core/src/docs/manifest.ts` (core tiles/concepts) and app manifest
  files (e.g., `apps/sim/src/docs/manifest.ts`) map tile IDs to content keys, tags, and categories

## Consuming This Package

In a new webapp, add these configurations:

**package.json**: `"@mindcraft-lang/docs": "file:../../packages/docs"`

**Vite config**:

```js
resolve: {
  alias: {
    "@mindcraft-lang/docs": path.resolve(__dirname, "../../packages/docs/src"),
  },
},
```

**tsconfig.json**:

```json
{
  "compilerOptions": {
    "paths": {
      "@mindcraft-lang/docs": ["../../packages/docs/src/index.ts"],
      "@mindcraft-lang/docs/*": ["../../packages/docs/src/*"]
    }
  }
}
```

### Minimal Integration

1. Create a docs manifest (`docs/manifest.ts`) using `AppTileDocMeta` and `AppPatternDocMeta`
2. Write markdown content files in `docs/content/en/tiles/` and `docs/content/en/patterns/`
3. Build a registry using `buildDocsRegistry()` with Vite glob-imported content
4. Wrap the app in `<DocsSidebarProvider registry={registry}>` and render `<DocsSidebar />`
5. Optionally wire `useDocsSidebar()` into `BrainEditorConfig` for brain editor integration
6. Optionally add a `/docs` route using `<DocsPage registry={registry} />`

See `apps/sim/src/App.tsx`, `apps/sim/src/DocsPage.tsx`, and `apps/sim/src/docs/` for a
complete working example.
