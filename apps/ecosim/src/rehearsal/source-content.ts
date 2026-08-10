import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTargetIdentity, readTileDocContent } from "@mindcraft-lang/assistant-bridge/kit";
import type { RehearsalContent, ShippedBrainDefs } from "./content";

/** The app directory, from this module's own location. */
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Directory holding the brain documents the app ships for its archetypes. */
const BRAIN_DEF_DIR = join(APP_DIR, "public", "assets", "brain", "defs");

/** Directory holding the app's English tile documentation. */
const TILE_DOC_DIR = join(APP_DIR, "src", "docs", "content", "en", "tiles");

/** File-name prefix and extension of the brain document the app ships for an archetype. */
const SHIPPED_PREFIX = "default-";
const BRAIN_EXTENSION = ".brain";

/** The brain document the app ships for each archetype, read from the app tree. */
function shippedBrainDefs(): ShippedBrainDefs {
  return Object.fromEntries(
    readdirSync(BRAIN_DEF_DIR)
      .filter((file) => file.startsWith(SHIPPED_PREFIX) && file.endsWith(BRAIN_EXTENSION))
      .map((file) => [
        file.slice(SHIPPED_PREFIX.length, -BRAIN_EXTENSION.length),
        readFileSync(join(BRAIN_DEF_DIR, file)).toString("base64"),
      ])
  );
}

/**
 * The rehearsal content of the app tree this module sits in, read from disk.
 * Throws when the app's manifest, tile documentation, or brain documents cannot
 * be read.
 */
export function sourceRehearsalContent(): RehearsalContent {
  return {
    targetIdentity: readTargetIdentity(APP_DIR),
    tileDocs: readTileDocContent(TILE_DOC_DIR),
    shippedBrains: shippedBrainDefs(),
  };
}

/**
 * The build-time replacements that carry {@link sourceRehearsalContent} into a
 * module graph, ready to hand to a bundler's `define`.
 */
export function rehearsalDefines(): Record<string, string> {
  const content = sourceRehearsalContent();
  return {
    TARGET_IDENTITY: JSON.stringify(content.targetIdentity),
    TILE_DOC_CONTENT: JSON.stringify(content.tileDocs),
    SHIPPED_BRAIN_DEFS: JSON.stringify(content.shippedBrains),
  };
}
