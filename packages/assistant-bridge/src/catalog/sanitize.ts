import type { CatalogTile } from "../tools/read-catalog.js";

/**
 * Longest each field of author text may read, in characters. Text longer than
 * its limit is cut to exactly the limit, ending in {@link TRUNCATION_MARKER}.
 */
export const CATALOG_TEXT_LIMITS = {
  label: 128,
  grammarNote: 1024,
  description: 1024,
} as const;

/** Suffix ending text a limit cut short. */
export const TRUNCATION_MARKER = " [truncated]";

/**
 * `text` cut to `limit` characters, ending in {@link TRUNCATION_MARKER} when it
 * ran longer, and returned as it arrived when it did not. Every character it
 * keeps it keeps as written. Pure, and applying it to its own result changes
 * nothing.
 *
 * @param limit Characters the result may run to, counting the marker.
 */
export function sanitizeCatalogText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

/**
 * `tile` with every field an author writes -- its label, its grammar note, and
 * its description -- cut to that field's limit by {@link sanitizeCatalogText}.
 * The fields the catalog generates itself pass through untouched. Applying it
 * to its own result changes nothing.
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
