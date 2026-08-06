// ---------------------------------------------------------------------------
// buildDocsRegistry -- generic factory that merges core documentation with
// app-specific documentation into a single DocsRegistry.
//
// Apps call this once at startup, passing their manifest metadata and
// pre-loaded content maps. Core docs are loaded internally.
// ---------------------------------------------------------------------------

import { coreConceptDocs, coreTileDocs } from "@mindcraft-lang/core/docs";
import { conceptContent as coreConceptContent, tileContent as coreTileContent } from "@mindcraft-lang/core/docs/en";
import type { DocsEntries } from "./DocsRegistry";
import { DocsRegistry } from "./DocsRegistry";

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
