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

| `onTileDocs` | `(tileDef: IBrainTileDef) => void` | Optional callback opening a tile's documentation (docs integration) |
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
`--color-destructive-foreground`.

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

## Docs Panel Inset -- `--docs-panel-inset`

`DocsSidebar` in `packages/docs` publishes a custom property on the document
root, `--docs-panel-inset`: the share of the viewport width its open desktop
panel covers, written as a CSS percentage. It reads `0%` whenever the panel
covers nothing a desktop layout has to avoid -- closed, unmounted, or in its
mobile full-screen shape.

`DialogContent` (`src/ui/dialog.tsx`) consumes it. Its `left` and `max-width`
subtract the inset, so a dialog centres itself in the width the panel leaves
free instead of sliding underneath it. `BrainEditorDialog` repeats the same
subtraction in its own `sm:` overrides, because it replaces both properties.

Rules for this contract:

- Read it with a `0%` fallback (`var(--docs-panel-inset,0%)`). Nothing declares
  a default, so a consumer with no docs package installed must still lay out.
- Keep it a percentage. The panel's own width is viewport-relative, so a
  window resize reflows both sides with no listener; a pixel value would go
  stale.
- The panel rewrites the property on every pointer move of its resize
  separator, alongside its inline width, so consumers track a live drag without
  the panel re-rendering per frame. Anything reading it must therefore work
  from CSS, not from a React render.
- Nothing in the type system checks this. A change on either side has to be
  matched by hand; `language-docs.instructions.md` carries the publisher's half.

## Dialogs, Portals and Focus

Two constraints here are not enforced by types and have each cost a bug.

**A controlled Radix `Dialog` with no `DialogTrigger` drops the keyboard on `document.body`
when it closes.** Radix composes an internal `onUnmountAutoFocus` that unconditionally
prevents the default and focuses `context.triggerRef.current`; with no trigger rendered
that ref is null, so focus falls to the body. Every dialog in this package is controlled
and trigger-less, so every one inherits the trap. Pass an explicit `onCloseAutoFocus`, or
make sure some other cleanup takes the keyboard back after the dialog unmounts.

This matters more than it looks: **focus moving to the body fires `focusout` but no
`focusin`**, so any mechanism listening for `focusin` to reclaim a stranded keyboard --
the brain editor's included -- is blind to that landing and cannot recover from it.

**Portaled content cannot be server-rendered, so it cannot be asserted in a spec.**
`packages/ui` has no jsdom and specs render through `react-dom/server` only. Radix's
`Portal` renders `null` until a client layout effect gives it `document.body` as a
container, so `renderToStaticMarkup(<SomeDialog isOpen />)` returns the empty string --
no attribute, no marker, no text inside a dialog, menu, popover or tooltip ever reaches
server markup. Verify those surfaces in a browser; pin the module-level predicates behind
them instead, which is what `keyboard-hold.spec.ts` does.

## Adding UI Primitives

To add a new shadcn/ui component:

1. Create the component file in `src/ui/` following existing patterns
2. Export it from `src/ui/index.ts`
3. It will automatically be available via `import { ... } from "@mindcraft-lang/ui"` in consuming apps

## Documentation System

The documentation sidebar, registry, markdown renderer, and standalone docs page live in
`packages/docs` (`@mindcraft-lang/docs`). See `language-docs.instructions.md` for full details.

The brain editor integrates with docs via two optional `BrainEditorConfig` fields:

- `onTileDocs` -- callback invoked when a user opens a placed tile's documentation, either
  from the docs button the offering's position row stands or by selecting Docs in the
  tile's menu (right-click, or long-press on touch); see `BrainTileMenu.tsx`
- `docsIntegration` -- `{ isOpen, toggle, close }` for the docs toggle button in the
  brain editor toolbar, for Escape closing an open panel instead of the editor, and
  for close-on-exit behavior (used by `BrainEditorDialog.tsx`)

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

**DO NOT ADD `resolve.dedupe: ["react", "react-dom"]`.** `@vitejs/plugin-react` already sets it, so an
explicit copy duplicates a guarantee an existing layer provides. Verified 2026-08-02: with the line
removed, `resolve.dedupe` still resolves to `["react","react-dom"]`, and a production build contains
exactly one React, from the app's own `node_modules`.

**NEVER PUT THIS PACKAGE IN `optimizeDeps.exclude`.** That is the real hazard, and it caused a live
`Invalid hook call` in `apps/microbit-sim`:

- The package is ALIASED TO SOURCE, so Vite never prebundles it and the exclusion buys nothing.
- **IT IS NOT WHAT GIVES YOU HOT RELOAD.** That is the reason someone reaches for it, and it is
  wrong: the ALIAS is what makes Vite treat these files as project source, watched and hot-reloaded
  natively. `optimizeDeps` only governs prebundling of things resolved into `node_modules`.
  Confirmed 2026-08-02 -- HMR on `packages/ui` works with the exclusion removed, and `apps/ecosim`
  has run the whole project with the alias and WITHOUT the exclusion.
- But excluding it stops Vite's dependency SCANNER walking into that source, so the Radix packages it
  imports are missed on the first pass and discovered mid-load on the first page request.
- Vite then runs a SECOND optimize pass and reloads. Modules served inside that window get a second
  React instance -- `Invalid hook call`, naming whichever Radix component was late (it named
  `<DropdownMenu>`), healed by the reload that follows.

That is why the failure was cold-start-only, `--force`-only, and confined to one app: `apps/ecosim`
excludes only `@mindcraft-lang/core` and `zod`, and never saw it.

Two things worth knowing if you are diagnosing something similar:

- **Matching React versions does NOT fix a genuine duplication.** Hook dispatch lives in module-scoped
  state, so two copies of the SAME version are still two instances. Only single-instance resolution
  helps.
- **There is no `vite.config.*` at any package root.** Every script passes `--config vite/config.*.mjs`.
  Running bare `npx vite` therefore uses Vite's built-in defaults -- no aliases, no plugins, and so no
  `plugin-react` dedupe -- which reproduces this error for reasons that have nothing to do with the
  repo's real configuration.

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
