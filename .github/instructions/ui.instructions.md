---
applyTo: "packages/ui/**"
---

<!-- Last reviewed: 2026-02-24 -->
<!-- Sync: rules duplicated in copilot-instructions.md "Shared UI" section -->

# Shared UI Package -- Architecture & Conventions

`packages/ui` is a **source-only** React component library. There is no build step -- consuming
apps resolve the TypeScript source directly via Vite aliases and tsconfig path mappings.

## Key Constraints

- **No path aliases** within this package. Use relative imports only (e.g., `../ui/button`,
  `../lib/utils`). Consuming apps map `@mindcraft-lang/ui` to the source directory; internal
  aliases would not resolve through the host app's toolchain.
- **No app-specific types**. Types like `Archetype`, `Actor`, or other sim-specific concepts
  must not appear here. The brain editor is decoupled from app specifics via
  `BrainEditorProvider` context.
- **All shadcn/ui primitives live here**. Do not duplicate them in app directories.
- Follow the same Biome conventions as the rest of the monorepo (double quotes, semicolons,
  2-space indent, 120-char line width).

## Package Layout

```
src/
  index.ts                  Top-level barrel export
  lib/                      Utility functions
    utils.ts                cn() -- Tailwind class merge (clsx + tailwind-merge)
    color.ts                adjustColor(), saturateColor(), HSL helpers
    glass-effect.ts         CSS glass/glint effect generator
    index.ts                Barrel
  ui/                       shadcn/ui primitives
    button.tsx, card.tsx, dialog.tsx, dropdown-menu.tsx, input.tsx, slider.tsx
    index.ts                Barrel
  brain-editor/             Brain editor components
    index.ts                Barrel
    types.ts                TileVisual, TileColorDef
    BrainEditorContext.tsx   BrainEditorConfig interface, BrainEditorProvider, useBrainEditorConfig
    BrainEditorDialog.tsx    Full editor (page nav, toolbar, undo/redo, save/load)
    BrainPageEditor.tsx      Page rules list with depth flattening
    BrainRuleEditor.tsx      WHEN/DO rule row with glass effects
    BrainTile.tsx            Individual tile button with marquee overflow
    BrainTileEditor.tsx      Tile with dropdown context menu (insert/replace/delete)
    BrainTilePickerDialog.tsx  Available tiles grouped by kind
    TileValue.tsx            Renders literal values or variable names
    CreateVariableDialog.tsx   Dialog for naming a new variable
    CreateLiteralDialog.tsx    Dialog for app-specific custom literal types
    BrainPrintDialog.tsx     Print preview dialog (visual + text modes)
    BrainPrintView.tsx       Visual print layout
    BrainPrintTextView.tsx   Plain-text print layout
    rule-clipboard.ts        Serialize/deserialize rules for clipboard
    tile-clipboard.ts        Serialize/deserialize tiles for clipboard
    tile-badges.ts           Tile badge rendering helpers
    commands/                Command pattern for undo/redo
      BrainCommand.ts        BrainCommand interface + BrainCommandHistory
      PageCommands.ts        Add/Remove/ReplaceLast page commands
      RenameCommands.ts      Rename brain/page commands
      RuleCommands.ts        Add/Delete/Move/Indent/Outdent rule commands
      TileCommands.ts        Add/Insert/Replace/Remove tile commands
    hooks/
      useRuleCapabilities.ts   Rule capability detection
      useTileSelection.ts      Tile selection flow + factory tile handoff
```

## BrainEditorContext

The `BrainEditorProvider` context decouples the brain editor from app-specific concerns.
Host apps supply a `BrainEditorConfig` object with:

| Field                        | Type                          | Purpose                                                 |
| ---------------------------- | ----------------------------- | ------------------------------------------------------- |
| `dataTypeIcons`              | `ReadonlyMap<string, string>` | Type ID -> icon URL                                     |
| `dataTypeNames`              | `ReadonlyMap<string, string>` | Type ID -> display name                                 |
| `isAppVariableFactoryTileId` | `(id: string) => boolean`     | Identifies app-specific variable factory tiles          |
| `customLiteralTypes`         | `CustomLiteralType[]`         | Optional app-defined literal tile types (e.g., Vector2) |
| `getDefaultBrain`            | `() => IBrainDef`             | Optional factory for creating new empty brains          |

### CustomLiteralType

Each entry defines a custom literal that the `CreateLiteralDialog` can create:

| Field          | Type                                                      | Purpose                                                     |
| -------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| `typeId`       | `string`                                                  | The brain type system type ID                               |
| `label`        | `string`                                                  | Display label in the dialog                                 |
| `fields`       | `{ name, label, placeholder }[]`                          | Input fields for the literal value                          |
| `createTileId` | `(values: Record<string, string>) => string \| undefined` | Builds a tile ID from field values, or undefined if invalid |

## Adding UI Primitives

To add a new shadcn/ui component:

1. Create the component file in `src/ui/` following existing patterns
2. Export it from `src/ui/index.ts`
3. It will automatically be available via `import { ... } from "@mindcraft-lang/ui"` in consuming apps

## Documentation System (`src/docs/`)

The `docs/` directory contains the documentation sidebar renderer, including markdown rendering
with brain-fence support and tile references.

### Key Files

```
src/docs/
  DocsSidebarContext.tsx   React context for open/close, tab, navigation, DocsRegistry
  DocsSidebar.tsx          Slide-out sidebar (desktop) / fullscreen overlay (mobile)
  DocsRegistry.ts          Registry of tile, pattern, and concept doc entries
  DocMarkdown.tsx          Markdown renderer with brain-fence and tile-ref support
  BrainCodeBlock.tsx       Renders brain-fenced code blocks as visual tiles/rules
  DocsRule.tsx             Read-only rule row + DocsTileChip (single tile visual)
  DocsPrintView.tsx        Print-friendly parallel renderer
```

### Doc Content Sources

- **Core docs**: `packages/core/src/docs/content/en/tiles/*.md` and `concepts/*.md`
  - Built into `packages/core/src/docs/_generated/en.ts` by `scripts/build-docs.js`
- **App-specific docs**: `apps/sim/src/docs/content/en/tiles/*.md` and `patterns/*.md`
  - Loaded at build time via Vite `import.meta.glob` with `?raw` queries
- **Manifests**: `packages/core/src/docs/manifest.ts` and `apps/sim/src/docs/manifest.ts`
  map tile IDs to content keys, tags, and categories

### Markdown Syntax Extensions

Doc markdown files support these custom syntaxes inside `DocMarkdown`:

**Brain code fences** -- render visual tile rule blocks:

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

### Rendering Architecture

`DocMarkdown` uses `react-markdown` (v9+) with `remark-gfm`. The `code` component override
checks for `language-brain` and delegates to `BrainCodeBlock`. The HAST `node` prop
(passed automatically by react-markdown v9 via `passNode: true`) carries the fence meta string
at `node.data.meta`.

`BrainCodeBlock` parses the JSON content, resolves tile IDs via the global tile catalog
(`getBrainServices().tiles`) and optionally a local `TileCatalog` built from `catalog` entries
(for variables/literals not in the global registry). Resolved tiles are rendered through
`DocsTileChip` (standalone) or `DocsRuleBlock` -> `DocsRuleRow` (rule context).

`DocsPrintView` is a parallel print-friendly renderer with the same format support but
simplified CSS-class-based styling (no glass effects).

## Consuming This Package

In a new webapp, add these configurations:

**package.json**: `"@mindcraft-lang/ui": "file:../../packages/ui"`

**Vite config**:

```js
resolve: {
  alias: {
    "@mindcraft-lang/ui": path.resolve(__dirname, "../../packages/ui/src"),
  },
},
```

**tsconfig.json**:

```json
{
  "compilerOptions": {
    "paths": {
      "@mindcraft-lang/ui": ["../../packages/ui/src/index.ts"],
      "@mindcraft-lang/ui/*": ["../../packages/ui/src/*"]
    }
  }
}
```
