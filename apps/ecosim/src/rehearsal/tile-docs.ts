import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TileDocContent } from "@mindcraft-lang/assistant-bridge/kit";
import { pairTileDocs, readTileDocContent } from "@mindcraft-lang/assistant-bridge/kit";
import { appTileDocs } from "@/docs/manifest";

/** Directory holding the app's English tile documentation, relative to this module's own location. */
const TILE_DOC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "content", "en", "tiles");

/** The documentation content the artifact carries, or the app tree's own in a source run. */
function tileDocContent(): TileDocContent {
  return typeof TILE_DOC_CONTENT === "object" ? TILE_DOC_CONTENT : readTileDocContent(TILE_DOC_DIR);
}

/**
 * The English documentation the app ships for each of its own tiles, as raw
 * markdown keyed by tile id. A tile whose manifest entry names a content file
 * the app does not ship is absent.
 */
export function ecosimTileDocs(): Map<string, string> {
  return pairTileDocs(tileDocContent(), appTileDocs);
}
