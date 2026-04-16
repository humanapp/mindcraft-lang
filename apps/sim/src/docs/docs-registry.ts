// ---------------------------------------------------------------------------
// Docs registry builder -- thin wrapper that passes sim-specific manifests
// and Vite-globbed content to the shared buildDocsRegistry() factory.
// ---------------------------------------------------------------------------

import type { DocsTileEntry } from "@mindcraft-lang/docs";
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

const appConceptModules = import.meta.glob<string>("./content/en/concepts/*.md", {
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

const APP_CONCEPT_TITLES: Record<string, string> = {
  vscode: "Connect VS Code",
  about: "About this App",
};

const APP_CONCEPT_TAGS: Record<string, string[]> = {
  vscode: ["vscode", "bridge", "typescript"],
  about: [],
};

const APP_CONCEPT_ORDER = ["vscode", "about"];

export function createDocsRegistry(userTileDocEntries: readonly DocsTileEntry[]) {
  const registry = buildDocsRegistry({
    appTiles: {
      meta: appTileDocs,
      content: buildContentMap(appTileModules),
    },
    appPatterns: {
      meta: appPatternDocs,
      content: buildContentMap(appPatternModules),
    },
  });

  const conceptContent = buildContentMap(appConceptModules);
  const orderedConcepts = APP_CONCEPT_ORDER.filter((id) => id in conceptContent).concat(
    Object.keys(conceptContent).filter((id) => !APP_CONCEPT_ORDER.includes(id))
  );
  registry.register({
    concepts: orderedConcepts.map((id) => ({
      id,
      title: APP_CONCEPT_TITLES[id] ?? id,
      tags: APP_CONCEPT_TAGS[id] ?? [],
      content: conceptContent[id],
    })),
  });

  const userTileDocs = userTileDocEntries;
  if (userTileDocs.length > 0) {
    registry.register({ tiles: [...userTileDocs] });
  }

  return registry;
}
