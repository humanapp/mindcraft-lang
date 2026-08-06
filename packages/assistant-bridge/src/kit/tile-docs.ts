import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One tile's documentation entry: the tile it documents, and the file that documents it. */
export interface TileDocEntry {
  readonly tileId: string;
  /** Base name of the markdown file, without its `.md` extension. */
  readonly contentKey: string;
}

/**
 * Read a target's tile documentation as raw markdown keyed by tile id, pairing
 * each entry with `<contentKey>.md` under `directory`. An entry naming a file
 * the directory does not hold is absent from the result.
 *
 * @param directory Absolute path of the directory holding the markdown files.
 */
export function readTileDocs(directory: string, entries: readonly TileDocEntry[]): Map<string, string> {
  const content: Record<string, string> = {};
  for (const file of readdirSync(directory)) {
    if (!file.endsWith(".md")) continue;
    content[file.slice(0, -3)] = readFileSync(join(directory, file), "utf8");
  }

  const docs = new Map<string, string>();
  for (const entry of entries) {
    const markdown = content[entry.contentKey];
    if (markdown) docs.set(entry.tileId, markdown);
  }
  return docs;
}
