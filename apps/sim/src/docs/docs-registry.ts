// ---------------------------------------------------------------------------
// Docs registry builder -- thin wrapper that passes sim-specific manifests
// and Vite-globbed content to the shared buildDocsRegistry() factory.
// ---------------------------------------------------------------------------

import { buildDocsRegistry } from "@mindcraft-lang/docs";
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
