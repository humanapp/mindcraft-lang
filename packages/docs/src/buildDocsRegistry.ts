// ---------------------------------------------------------------------------
// buildDocsRegistry -- generic factory that merges core documentation with
// app-specific documentation into a single DocsRegistry.
//
// Apps call this once at startup, passing their manifest metadata and
// pre-loaded content maps. Core docs are loaded internally.
// ---------------------------------------------------------------------------

import { coreConceptDocs, coreTileDocs } from "@mindcraft-lang/core/docs";
import { conceptContent as coreConceptContent, tileContent as coreTileContent } from "@mindcraft-lang/core/docs/en";
import { kAcceleratorHelpConceptId } from "./AcceleratorHelp";
import type { DocsConceptEntry, DocsEntries } from "./DocsRegistry";
import { DocsRegistry } from "./DocsRegistry";

/**
 * The keyboard help concept, built but not registered. `AcceleratorHelp` renders
 * a live "right now" section, which is only meaningful while the editor is open
 * and focused; a browsable docs page can be reached with the editor closed and
 * from the standalone docs route, where that section states nothing true.
 *
 * Register this entry to make the page reachable again.
 */
const keyboardConcept: DocsConceptEntry = {
  id: kAcceleratorHelpConceptId,
  title: "Keyboard",
  tags: ["keyboard", "shortcuts", "accelerators", "keys"],
  content: [
    "# Keyboard",
    "",
    "The whole editor can be driven from the keyboard. What the keys do depends on where you are:",
    "moving between rules, holding a rule, picking a tile, or writing a rule out as a sentence.",
    "",
    "Leave this page open while you work and the top of it will follow you.",
  ].join("\n"),
};

// ---------------------------------------------------------------------------
// Shared manifest types -- apps define their manifests using these shapes.
// ---------------------------------------------------------------------------

/** Per-tile metadata an app supplies to register an app-specific tile doc page. */
export interface AppTileDocMeta {
  tileId: string;
  tags: string[];
  category: string;
  /** Key into the app's `content` map identifying the markdown body for this tile. */
  contentKey: string;
}

/** Per-pattern metadata an app supplies to register an app-specific pattern doc page. */
export interface AppPatternDocMeta {
  id: string;
  title: string;
  tags: string[];
  category: string;
  /** Key into the app's `content` map identifying the markdown body for this pattern. */
  contentKey: string;
}

// ---------------------------------------------------------------------------
// Builder options
// ---------------------------------------------------------------------------

export interface BuildDocsRegistryOptions {
  /** App-specific tile documentation metadata and content. */
  appTiles?: {
    meta: readonly AppTileDocMeta[];
    content: Record<string, string>;
  };
  /** App-specific pattern documentation metadata and content. */
  appPatterns?: {
    meta: readonly AppPatternDocMeta[];
    content: Record<string, string>;
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a {@link DocsRegistry} that contains the core docs and any
 * app-specific tile and pattern entries supplied in `options`.
 */
export function buildDocsRegistry(options?: BuildDocsRegistryOptions): DocsRegistry {
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

  if (options) {
    const appEntries: DocsEntries = {};

    if (options.appTiles) {
      appEntries.tiles = options.appTiles.meta.map((meta) => ({
        tileId: meta.tileId,
        tags: [...meta.tags],
        category: meta.category,
        content: options.appTiles!.content[meta.contentKey] ?? "",
      }));
    }

    if (options.appPatterns) {
      appEntries.patterns = options.appPatterns.meta.map((meta) => ({
        id: meta.id,
        title: meta.title,
        tags: [...meta.tags],
        category: meta.category,
        content: options.appPatterns!.content[meta.contentKey] ?? "",
      }));
    }

    registry.register(appEntries);
  }

  return registry;
}
