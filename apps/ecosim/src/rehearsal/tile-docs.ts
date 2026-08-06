import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appTileDocs } from "@/docs/manifest";

/** The app directory this module was loaded from, resolved from the module's own location. */
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Directory holding the app's English tile documentation. */
const TILE_DOC_DIR = join(APP_DIR, "src", "docs", "content", "en", "tiles");

/**
 * The English documentation the app ships for each of its own tiles, as raw
 * markdown keyed by tile id. A tile whose manifest entry names a content file
 * the app does not ship is absent.
 */
export function ecosimTileDocs(): Map<string, string> {
  const content: Record<string, string> = {};
  for (const file of readdirSync(TILE_DOC_DIR)) {
    if (!file.endsWith(".md")) continue;
    content[file.slice(0, -3)] = readFileSync(join(TILE_DOC_DIR, file), "utf8");
  }

  const docs = new Map<string, string>();
  for (const entry of appTileDocs) {
    const markdown = content[entry.contentKey];
    if (markdown) docs.set(entry.tileId, markdown);
  }
  return docs;
}
