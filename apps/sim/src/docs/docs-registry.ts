// ---------------------------------------------------------------------------
// Docs registry builder -- merges core and app documentation metadata with
// locale-specific content into a single DocsRegistry for the sidebar.
//
// Core docs: manifest + content imported from @mindcraft-lang/core subpaths.
// App docs: manifest from ./manifest.ts, content via Vite glob imports.
// ---------------------------------------------------------------------------

import type { DocsEntries } from "@mindcraft-lang/ui/docs";
import { DocsRegistry } from "@mindcraft-lang/ui/docs";

// -- Core manifest + English content ----------------------------------------

import { coreConceptDocs, coreTileDocs } from "@mindcraft-lang/core/docs";
import { conceptContent as coreConceptContent, tileContent as coreTileContent } from "@mindcraft-lang/core/docs/en";

// -- App manifest -----------------------------------------------------------

import { appPatternDocs, appTileDocs } from "./manifest";

// -- App English content via Vite eager glob --------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the filename stem from a glob path like "./content/en/tiles/see.md". */
function contentKeyFromPath(p: string): string {
  const filename = p.split("/").pop() ?? "";
  return filename.replace(/\.md$/, "");
}

/** Turn a Vite glob result into a simple key -> content map. */
function buildContentMap(modules: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [path, content] of Object.entries(modules)) {
    map[contentKeyFromPath(path)] = content;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Build the registry
// ---------------------------------------------------------------------------

export function createDocsRegistry(): DocsRegistry {
  const registry = new DocsRegistry();

  // -- Core entries ---------------------------------------------------------

  const coreEntries: DocsEntries = {
    tiles: coreTileDocs.map((meta) => ({
      tileId: meta.tileId,
      tags: [...meta.tags],
      category: meta.category,
      content: coreTileContent[meta.contentKey] ?? "",
    })),
    concepts: coreConceptDocs.map((meta) => ({
      id: meta.id,
      title: meta.title,
      tags: [...meta.tags],
      content: coreConceptContent[meta.contentKey] ?? "",
    })),
  };
  registry.register(coreEntries);

  // -- App entries ----------------------------------------------------------

  const appTileContent = buildContentMap(appTileModules);
  const appPatternContent = buildContentMap(appPatternModules);

  const appEntries: DocsEntries = {
    tiles: appTileDocs.map((meta) => ({
      tileId: meta.tileId,
      tags: [...meta.tags],
      category: meta.category,
      content: appTileContent[meta.contentKey] ?? "",
    })),
    patterns: appPatternDocs.map((meta) => ({
      id: meta.id,
      title: meta.title,
      tags: [...meta.tags],
      category: meta.category,
      content: appPatternContent[meta.contentKey] ?? "",
    })),
  };
  registry.register(appEntries);

  return registry;
}
