import type { CatalogTile } from "../tools/read-catalog.js";

/**
 * Longest each field of author text may read, in characters. Text longer than
 * its limit is cut to exactly the limit, ending in {@link TRUNCATION_MARKER}.
 */
export const CATALOG_TEXT_LIMITS = {
  label: 128,
  description: 1024,
  /** The tile's model-facing teaching prose, from the assistant section of its documentation. */
  assistant: 1024,
  /** The name an argument slot reads by, inside the rendered args string. */
  argName: 32,
  /** The unit an argument slot's value is measured in, inside the rendered args string. */
  argUnit: 16,
  /** The rendering of an argument slot's declared default, inside the rendered args string. */
  argDefault: 64,
  /** The whole rendered argument grammar of one tile. */
  args: 512,
} as const;

/** Suffix ending text a limit cut short. */
export const TRUNCATION_MARKER = " [truncated]";

/**
 * Suffix ending text a limit cut short inside the rendered args string, which
 * spells a slot's bounds with `[` and `]`. It carries neither, so a cut never
 * reads as a bounds group.
 */
export const ARGS_TRUNCATION_MARKER = "~";

/**
 * `text` cut to `limit` characters for use inside the rendered args string,
 * ending in {@link ARGS_TRUNCATION_MARKER} when it ran longer. Pure, and
 * applying it to its own result changes nothing.
 *
 * @param limit Characters the result may run to, counting the marker.
 */
export function sanitizeArgsText(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - ARGS_TRUNCATION_MARKER.length) + ARGS_TRUNCATION_MARKER;
}

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
 * `tile` with every field an author writes -- its label, its description, its
 * assistant section, and the argument grammar author text is rendered into --
 * cut to that field's limit, the args string by {@link sanitizeArgsText} and
 * the rest by {@link sanitizeCatalogText}.
 * The fields the catalog generates itself pass through untouched. Applying it
 * to its own result changes nothing.
 */
export function sanitizeCatalogTile(tile: CatalogTile): CatalogTile {
  return {
    ...tile,
    label: sanitizeCatalogText(tile.label, CATALOG_TEXT_LIMITS.label),
    ...(tile.args === undefined ? {} : { args: sanitizeArgsText(tile.args, CATALOG_TEXT_LIMITS.args) }),
    ...(tile.description === undefined
      ? {}
      : { description: sanitizeCatalogText(tile.description, CATALOG_TEXT_LIMITS.description) }),
    ...(tile.assistant === undefined
      ? {}
      : { assistant: sanitizeCatalogText(tile.assistant, CATALOG_TEXT_LIMITS.assistant) }),
  };
}
