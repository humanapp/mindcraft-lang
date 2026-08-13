/**
 * Placeholder a tile doc's markdown may use to reference its own tile id, so
 * content such as brain fences need not repeat the id the doc is registered
 * under. Substituted with the entry's tile id when docs are paired. The docs
 * sidebar's registry substitutes the same placeholder at registration.
 */
// biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholder is the literal text doc authors write
export const kTileIdPlaceholder = "${tileId}";

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
 * Pair documentation content with the entries that name it, keyed by tile id.
 * Occurrences of {@link kTileIdPlaceholder} in a doc's markdown are replaced
 * with the entry's tile id. An entry naming a content key `content` does not
 * carry is absent from the result.
 */
export function pairTileDocs(content: TileDocContent, entries: readonly TileDocEntry[]): Map<string, string> {
  const docs = new Map<string, string>();
  for (const entry of entries) {
    const markdown = content[entry.contentKey];
    if (markdown) {
      docs.set(
        entry.tileId,
        markdown.includes(kTileIdPlaceholder) ? markdown.split(kTileIdPlaceholder).join(entry.tileId) : markdown
      );
    }
  }
  return docs;
}
