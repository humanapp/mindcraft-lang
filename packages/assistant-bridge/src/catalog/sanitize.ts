import type { CatalogTile } from "../tools/read-catalog.js";

/**
 * Longest each field of author text may read, in characters, once neutralized.
 * Text longer than its limit is cut to exactly the limit, ending in
 * {@link TRUNCATION_MARKER}.
 */
export const CATALOG_TEXT_LIMITS = {
  label: 128,
  grammarNote: 1024,
  description: 1024,
} as const;

/** Suffix ending text a limit cut short. */
export const TRUNCATION_MARKER = " [truncated]";

/**
 * Characters the catalog's line rendering reserves: the newline separating one
 * tile's line from the next, and the pipe separating one field from the next.
 * Matched together with surrounding whitespace as a single run.
 */
const RESERVED = /[\s|]+/g;

/**
 * Neutralize one field of author text: collapse every run of whitespace and
 * reserved delimiter to a single space, drop the leading and trailing spaces,
 * then cut the result to `limit` characters, ending it in
 * {@link TRUNCATION_MARKER} when it ran longer. Pure, and applying it to its own
 * result changes nothing.
 *
 * @param limit Characters the result may run to, counting the marker.
 */
export function sanitizeCatalogText(text: string, limit: number): string {
  const flattened = text.replace(RESERVED, " ").trim();
  if (flattened.length <= limit) return flattened;
  return flattened.slice(0, limit - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

/**
 * `tile` with every field an author writes -- its label, its grammar note, and
 * its description -- neutralized by {@link sanitizeCatalogText} under that
 * field's limit, so none of them can close a field or open a line. The fields
 * the catalog generates itself pass through untouched. Applying it to its own
 * result changes nothing.
 */
export function sanitizeCatalogTile(tile: CatalogTile): CatalogTile {
  return {
    ...tile,
    label: sanitizeCatalogText(tile.label, CATALOG_TEXT_LIMITS.label),
    ...(tile.grammarNote === undefined
      ? {}
      : { grammarNote: sanitizeCatalogText(tile.grammarNote, CATALOG_TEXT_LIMITS.grammarNote) }),
    ...(tile.description === undefined
      ? {}
      : { description: sanitizeCatalogText(tile.description, CATALOG_TEXT_LIMITS.description) }),
  };
}
