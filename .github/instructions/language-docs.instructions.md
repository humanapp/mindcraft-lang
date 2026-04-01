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
- Depends on `@mindcraft-lang/ui` for brain editor types and utilities
- Depends on `@mindcraft-lang/core` for brain tile definitions and docs content

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
  buildDocsRegistry.ts     Factory + shared manifest types
```

## Core Architecture

- **DocsRegistry**: Pure data store with three collections (tiles, patterns, concepts),
  keyed by ID. Populated once at startup via `registry.register(entries)`.
- **DocsSidebarContext**: React context with panel visibility, tab state, navigation,
  and `openDocsForTile` (redirects variable/literal tiles to concept pages).
- **buildDocsRegistry**: Merges core docs (from `@mindcraft-lang/core/docs`) with optional
  app-specific entries. Apps supply `{ meta, content }` for tiles and patterns.
- **DocsPage**: Full-page view with URL sync (`/docs/{tab}/{entryKey}`).

## Brain Editor Integration

The docs package does NOT import from the brain editor context. Integration uses
dependency inversion through `BrainEditorConfig`:

- `onTileHelp` -- right-click Help on tiles (hidden when not provided)
- `docsIntegration` -- `{ isOpen, toggle, close }` for toolbar button (hidden when not provided)

The host app wires these via `useDocsSidebar()` callbacks.

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

- **Core docs**: Built into `packages/core/src/docs/_generated/en.ts` by `scripts/build-docs.js`
- **App docs**: Loaded at build time via Vite `import.meta.glob` with `?raw`, passed to `buildDocsRegistry()`
- **Manifests**: Map tile IDs to content keys, tags, and categories

## Consuming This Package

1. Add to package.json: `"@mindcraft-lang/docs": "file:../../packages/docs"`
2. Add Vite alias: `"@mindcraft-lang/docs": path.resolve(__dirname, "../../packages/docs/src")`
3. Add tsconfig paths for `@mindcraft-lang/docs` and `@mindcraft-lang/docs/*`
4. Create manifest, write markdown content, build registry with `buildDocsRegistry()`
5. Wrap app in `<DocsSidebarProvider>`, render `<DocsSidebar />`
6. Optionally wire `useDocsSidebar()` into `BrainEditorConfig` and add `/docs` route
