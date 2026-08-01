---
applyTo: "packages/ui/**"
---

<!-- Last reviewed: 2026-03-07 -->
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
    index.ts                Barrel
  ui/                       shadcn/ui primitives
    button.tsx, card.tsx, context-menu.tsx, dialog.tsx, dropdown-menu.tsx, input.tsx, slider.tsx
    index.ts                Barrel
  brain-editor/             Brain editor components
    index.ts                Barrel
    types.ts                TileVisual, TileColorDef
    ArmedTargetContext.tsx   Armed tile-picker target (arm/disarm state + matching predicates)
    BrainEditorContext.tsx   BrainEditorConfig interface, BrainEditorProvider, useBrainEditorConfig
    BrainEditorDialog.tsx    Full editor (page nav, toolbar, undo/redo, save/load)
    BrainPageEditor.tsx      Page rules list with depth flattening
    BrainRuleEditor.tsx      WHEN/DO rule row
    BrainTile.tsx            Individual tile button with marquee overflow
    BrainTileEditor.tsx      Placed tile: tap arms the edit point, right-click/long-press opens its menu
    BrainCandidateStrip.tsx  Candidate offering laid over the rules below the armed one, plus the filter input its sentence line hosts
    edit-point.ts            Edit-point positions around a placed tile and the arming each one takes
    editor-layers.ts         The editor's stacking steps: rule content, card chrome, offering, dialog chrome
    TileValue.tsx            Renders literal values or variable names
    CreateVariableDialog.tsx   Dialog for naming a new variable
    CreateLiteralDialog.tsx    Dialog for app-specific custom literal types
    BrainPrintDialog.tsx     Print preview dialog (visual + text modes)
    BrainPrintView.tsx       Visual print layout
    BrainPrintTextView.tsx   Plain-text print layout
    rule-clipboard.ts        Serialize/deserialize rules for clipboard
    tile-clipboard.ts        Serialize/deserialize tiles for clipboard
    tile-badges.ts           Tile badge rendering helpers
    insertion-context.ts     buildInsertionContext for the armed position
    candidate-strip-model.ts Candidate grouping, filtering, commit keys, ranker seam
    hooks/
      useRuleCapabilities.ts   Rule capability detection
      useTileSelection.ts      Tile selection flow + factory tile handoff
      useCandidateStrip.ts     Oracle query + filter/offering/commit state for the strip
```

The editing command classes and `BrainCommandHistory` (undo/redo) live in
`packages/core/src/brain/model/commands/` and are imported from
`@mindcraft-lang/core/brain/model`; this package re-exports them from its
barrel for consuming apps.

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

| `onTileHelp` | `(tileDef: IBrainTileDef) => void` | Optional callback for tile Help menu item (docs integration) |
| `docsIntegration` | `{ isOpen, toggle, close }` | Optional docs sidebar controls for the editor toolbar |

### CustomLiteralType

Each entry defines a custom literal that the `CreateLiteralDialog` can create:

| Field          | Type                                                      | Purpose                                                     |
| -------------- | --------------------------------------------------------- | ----------------------------------------------------------- |
| `typeId`       | `string`                                                  | The brain type system type ID                               |
| `label`        | `string`                                                  | Display label in the dialog                                 |
| `fields`       | `{ name, label, placeholder }[]`                          | Input fields for the literal value                          |
| `createTileId` | `(values: Record<string, string>) => string \| undefined` | Builds a tile ID from field values, or undefined if invalid |

## Color Token Contract

`src/ui.css` is the home of the shared token contract. Components reference token
NAMES only and never a palette literal for a role the contract covers; each app
supplies the VALUES in its own `globals.css`, which is imported after `ui.css` so
the app values win. The `--color-brain-*` group covers the editor: `desk` and
`rule` (the page canvas and the rule cards), `tile-border` and `armed`, `accent`
/ `accent-ink` / `on-accent`, `ink` and `recess`, `inline-ink` (the label an
inline chip carries in documentation prose), `amber` / `amber-ink` /
`amber-wash`, `warn` / `warn-edge` / `warn-ink` (the badge on a tile whose
reading is incomplete), `timed` / `timed-ink` (the badge on an action that may
take time; the ink draws both the chip's edge and its glyph), `capsule` /
`capsule-edge` / `capsule-ink`, and `pill` / `pill-hover` / `pill-edge` /
`pill-ink`.

Roles the whole design system already names are taken from it, not re-minted
under `--color-brain-*`: the editor's removal control and its badge for a tile
that does not parse read in `--color-destructive` /
`--color-destructive-foreground`, and its save-comment control in
`--color-success` / `--color-success-foreground`.

Rules a theme must hold to:

- Amber is semantic. It marks a change -- a word whose tile just changed, text
  naming no tile that fits -- and is never used as an accent. Its three meanings
  are separately named: `amber` marks a change, `warn` badges an incomplete
  reading. Retuning one must not move the other.
- The accent and the two side hues a tile is filled in must stay mutually
  distinguishable.

Alpha steps stay on the utility (`text-brain-ink/70`), not in the token, so a
theme supplies one ink and the hierarchy of steps follows.

Side hues do NOT come through CSS: they arrive per tile as `TileVisual.colorDef`
from `BrainEditorConfig`.

Tile chrome derived from a tile's own hue lives in
`brain-editor/tile-visual-utils.ts` (`kDefaultTileHue`, `tileEdgeColor`,
`tileBorderColor`); `packages/docs` imports it so a documentation illustration
and a placed tile cannot drift. Custom properties inherit, so `packages/docs`
also picks up whichever host app renders it, with no threading and no config.

## Adding UI Primitives

To add a new shadcn/ui component:

1. Create the component file in `src/ui/` following existing patterns
2. Export it from `src/ui/index.ts`
3. It will automatically be available via `import { ... } from "@mindcraft-lang/ui"` in consuming apps

## Documentation System

The documentation sidebar, registry, markdown renderer, and standalone docs page live in
`packages/docs` (`@mindcraft-lang/docs`). See `language-docs.instructions.md` for full details.

The brain editor integrates with docs via two optional `BrainEditorConfig` fields:

- `onTileHelp` -- callback invoked when a user opens a placed tile's menu (right-click,
  or long-press on touch) and selects Help (used by `BrainTileEditor.tsx`)
- `docsIntegration` -- `{ isOpen, toggle, close }` for the docs toggle button in the
  brain editor toolbar and close-on-exit behavior (used by `BrainEditorDialog.tsx`)

These are wired up by the host app (see `apps/ecosim/src/App.tsx` `DocsBrainEditorProvider`).

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
