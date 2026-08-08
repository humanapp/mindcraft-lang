import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One tile's documentation entry: the tile it documents, and the file that documents it. */
export interface TileDocEntry {
  readonly tileId: string;
  /** Base name of the markdown file, without its `.md` extension. */
  readonly contentKey: string;
}

/**
 * A target's tile documentation as raw markdown keyed by content key: the base
 * name, without its `.md` extension, of the file that carries it.
 */
export type TileDocContent = Readonly<Record<string, string>>;

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

/**
 * Pair documentation content with the entries that name it, keyed by tile id.
 * An entry naming a content key `content` does not carry is absent from the
 * result.
 */
export function pairTileDocs(content: TileDocContent, entries: readonly TileDocEntry[]): Map<string, string> {
  const docs = new Map<string, string>();
  for (const entry of entries) {
    const markdown = content[entry.contentKey];
    if (markdown) docs.set(entry.tileId, markdown);
  }
  return docs;
}
