import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TileDocContent } from "./tile-docs.js";

/**
 * Read every `.md` file in `directory` as raw markdown keyed by content key.
 * Throws when `directory` cannot be read.
 *
 * @param directory Absolute path of the directory holding the markdown files.
 */
export function readTileDocContent(directory: string): TileDocContent {
  const content: Record<string, string> = {};
  for (const file of readdirSync(directory)) {
    if (!file.endsWith(".md")) continue;
    content[file.slice(0, -3)] = readFileSync(join(directory, file), "utf8");
  }
  return content;
}
