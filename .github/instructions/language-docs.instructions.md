---
applyTo: "packages/docs/**"
---

<!-- Last reviewed: 2026-03-12 -->

# Docs Package -- Rules & Patterns

`packages/docs` is a **source-only** React component library providing the shared documentation
sidebar, markdown renderer, and standalone docs page. No build step -- consuming apps resolve
TypeScript source directly via Vite aliases and tsconfig path mappings.

## Key Constraints

- **No path aliases** within this package -- use relative imports only
- **No app-specific types** (Archetype, Actor, etc.)
- Depends on `@wendoo-lang/ui` for brain editor types and utilities
- Depends on `@wendoo-lang/core` for brain tile definitions and docs content

## Package Layout

```
src/
  index.ts                Barrel export
  DocsRegistry.ts         Data store: tiles, patterns, concepts collections
  DocsSidebarContext.tsx   Provider, useDocsSidebar(), state management
  DocsSidebar.tsx          Slide-out sidebar (desktop) / fullscreen overlay (mobile)
  DocsPage.tsx             Standalone full-page docs view with URL sync
  DocMarkdown.tsx          Markdown renderer with brain-fence and tile-ref support
  DocsRule.tsx             Rule/tile chip rendering components
  BrainCodeBlock.tsx       Renders brain code fences as visual tiles/rules
  DocsPrintView.tsx        Print-friendly documentation layout
  AcceleratorHelp.tsx      The Keyboard category: live section plus full key reference
  buildDocsRegistry.ts     Factory + shared manifest types
```

## Core Architecture

- **DocsRegistry**: Pure data store with three collections (tiles, patterns, concepts),
  keyed by ID. Populated once at startup via `registry.register(entries)`.
- **DocsSidebarContext**: React context with panel visibility, tab state, navigation,
  and `openDocsForTile` (redirects variable/literal tiles to concept pages).
- **buildDocsRegistry**: Merges core docs (from `@wendoo-lang/core/docs`) with optional
  app-specific entries. Apps supply `{ meta, content }` for tiles and patterns.
- **DocsPage**: Full-page view with URL sync (`/docs/{tab}/{entryKey}`).
- **Tile chrome**: `DocsRule.tsx` draws its own read-only tile and rule chrome, but
  from the same source as the editor -- the `--color-brain-*` tokens, which it picks
  up by inheritance from whichever host app renders it, and the shared derivation in
  `@wendoo-lang/ui/brain-editor/tile-visual-utils`. See the color token contract
  in `ui.instructions.md`.

## Tab Taxonomy -- Three Collections and the Keyboard Category

`DocTab` has four members. `tiles`, `patterns` and `concepts` are registry
collections a reader navigates into, each with a list view and a detail view
keyed by entry id. `keyboard` is a fourth TOP-LEVEL category and holds no
registry entries: it renders `AcceleratorHelp` directly in place of a list, has
no detail view, and never sets `navKey`.

Four places carry the taxonomy and must stay in step:

- `DocTab` in `DocsSidebarContext.tsx`;
- `TABS` in `DocsSidebar.tsx`, which draws the tab bar, and the `activeTab`
  branch below it that renders each tab's body;
- the search live region in `DocsSidebar.tsx`, which counts registry entries and
  therefore says nothing for `keyboard`;
- `VALID_TABS` in `DocsPage.tsx`, which is what makes `/docs/keyboard` a real
  standalone route rather than a fallback to Tiles.

The keyboard category's content comes from `kAcceleratorContributions` in
`@wendoo-lang/ui/brain-editor/accelerators`, not from the registry. A
contribution carries structured keys -- `bindings`, each a chord of modifiers
plus the keys any one of which completes it, or a named gesture -- so the page
can draw one bordered chip per key. Modifiers are drawn as glyphs on macOS and
spelled out everywhere else by `acceleratorChips`. Contributions carry no
markdown; long-form prose belongs in a concept page.

`accelerators.spec.ts` in `packages/ui` runs the drift checks that keep the
category honest: every claimed press acts in every mode it is claimed for, every
press left to the browser reaches no decision, every press a mode acts on is
claimed, and every claimed press is drawn by one of that contribution's
bindings. A binding may draw a key no claim covers, which is how a press live
only at some moments still gets documented.

## The Live Section Needs an Editor

`AcceleratorHelp` shows a "Right now" section only while `editorMode` in
`DocsSidebarContext` names a mode. The mode arrives through
`docsIntegration.reportMode`, which `BrainEditorDialog` calls on every change
and calls with `undefined` when it closes or unmounts. With no editor -- closed,
or the standalone `/docs` route, which wires no editor at all -- the section is
absent entirely and only the full reference renders. A 250 ms trailing debounce
holds the previous mode's rows through fast transitions.

`docsIntegration` is optional on `BrainEditorConfig` and so is `reportMode`.
The brain editor must keep working in a host that installs no docs provider;
such a host simply gets no keyboard reference.

## Brain Editor Integration

The docs package does not import from the brain editor context. Integration uses
dependency inversion through `BrainEditorConfig`:

- `onTileDocs` -- opens a tile's documentation from the editor (hidden when not provided)
- `docsIntegration` -- `{ isOpen, toggle, close }` for toolbar button (hidden when not provided)

The host app wires these via `useDocsSidebar()` callbacks.

## Panel Footprint -- `--docs-panel-inset`

`DocsSidebar` publishes its footprint through the inset seam `packages/ui`
owns, `publishInset(kDocsPanelInsetVar, value)` from
`@wendoo-lang/ui/ui/surface-insets`: the share of the viewport width the
open desktop panel covers, written as a CSS percentage, and `0%` whenever it
covers nothing a desktop layout has to avoid -- closed, unmounted, or in the
mobile full-screen shape. The seam writes the value onto the elements that read
it, and only onto those.

**Never write this property onto `document.documentElement`.** Custom
properties inherit, so a write on the root invalidates style recalculation for
every element in the document -- with the brain editor open on a large brain
that is ~336ms per write, and the resize separator writes per pointer event.
`DocsSidebar.spec.ts` pins that the panel names `documentElement` nowhere.

Three places write it and all must stay in step:

- the effect keyed on the open flag, the mobile flag, and the settled width,
  which also withdraws the footprint when the sidebar unmounts;
- the resize separator's pointer-move handler, which republishes beside the
  inline width it applies to the `aside`, so consumers follow a live drag
  without a React render per pointer event;
- its drag-end handler, which writes the settled width and footprint together
  before handing the width back to React. It leaves the inline width standing:
  clearing it reverts the panel to the last committed width until React's
  commit lands, which on a slow machine paints as a jump opposite to the drag.

The drag-end handler runs on `pointerup`, on `pointercancel` and on
`lostpointercapture`, and the first of the three to arrive settles the width
while the rest find no drag recorded. A drag ends no other way, so the
pointer-move handler carries the last resort: `separatorMoveAction` in
`DocsSidebar.tsx` reads a move carrying no held button while a drag is recorded
as a drag that ended out of the separator's hearing, and ends it without moving
the panel edge. Without that reading the panel follows a bare hover -- the
separator behaves as though grabbed, and closing and reopening the panel does
not clear it, because the drag record is a ref on a component the desktop panel
never unmounts. `DocsSidebar.spec.ts` pins both halves.

Keep the value a percentage: the panel's own width is viewport-relative, so a
window resize reflows consumers with no listener.

`packages/ui`'s `DialogContent` is the consumer -- every dialog centres itself
in the width this leaves free rather than sliding under the panel. Nothing in
the type system checks the pairing; `ui.instructions.md` carries the consumer's
half.

## Markdown Syntax Extensions

**Brain code fences** render visual tile/rule blocks:

    ```brain
    [{ "when": ["tile.sensor->sensor.see"], "do": ["tile.actuator->actuator.move"] }]
    ```

Accepted JSON formats: array of rules, clipboard wrapper (`{ ruleJsons }`), single tile
(`{ tile }` or `{ tileId }`), multiple tiles (`{ tiles }`). All support optional `catalog`
for local variables/literals. Fence meta tokens: `noframe`, `do`.

**Inline tile refs**: `` `tile:tile.op->add` `` renders as a colored tile chip.

**Inline tag pills**: `` `tag:Operator;color:#FFE500` `` renders as a colored badge.

## Doc Content Sources

- **Core docs**: `packages/core/scripts/build-docs.js` reads the markdown under
  `packages/core/src/docs/content/{locale}/` and writes one module per locale straight into
  core's build output, at `dist/{node,esm}/docs/_generated/{locale}.js`, reached as
  `@wendoo-lang/core/docs/{locale}`. Nothing under core's `src/` imports it, so a docs
  edit needs only `npm run build:docs` -- no compiler pass.
- **App docs**: Loaded at build time via Vite `import.meta.glob` with `?raw`, passed to `buildDocsRegistry()`
- **Manifests**: Map tile IDs to content keys, tags, and categories

## Consuming This Package

1. Add to package.json: `"@wendoo-lang/docs": "file:../../packages/docs"`
2. Add Vite alias: `"@wendoo-lang/docs": path.resolve(__dirname, "../../packages/docs/src")`
3. Add tsconfig paths for `@wendoo-lang/docs` and `@wendoo-lang/docs/*`
4. Create manifest, write markdown content, build registry with `buildDocsRegistry()`
5. Wrap app in `<DocsSidebarProvider>`, render `<DocsSidebar />`
6. Optionally wire `useDocsSidebar()` into `BrainEditorConfig` and add `/docs` route
