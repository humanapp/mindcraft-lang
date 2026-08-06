import type { CatalogTile } from "../tools/read-catalog.js";

/** The catalog serialized for a model's context. */
export interface CatalogDigest {
  /** One line per tile, tiles in ascending tile-id order. */
  readonly text: string;
  /** Tiles the text carries a line for. */
  readonly tileCount: number;
}

/** Collapse a description to one line of digest text. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Render one tile as a single digest line. */
function digestLine(tile: CatalogTile): string {
  const fields: string[] = [tile.tileId, tile.label, tile.kind];
  if (tile.outputType) fields.push(`out=${tile.outputType}`);
  if (tile.placement.length > 0) fields.push(`place=${tile.placement.join("+")}`);
  if (tile.args) fields.push(`args=${tile.args}`);
  if (tile.requires.length > 0) fields.push(`needs=${tile.requires.join("+")}`);
  if (tile.provides.length > 0) fields.push(`gives=${tile.provides.join("+")}`);
  if (tile.outputs.length > 0) fields.push(`outputs=${tile.outputs.join("+")}`);
  if (tile.consumesWhenResult) fields.push(`whenResult=${tile.consumesWhenResult}`);
  if (tile.deprecated) fields.push("deprecated");
  if (tile.description) fields.push(oneLine(tile.description));
  return fields.join(" | ");
}

/**
 * Serialize the catalog deterministically for the prompt prefix. Tiles the
 * editor hides from its pickers are omitted; the rest are sorted by tile id, so
 * the same catalog always produces the same bytes.
 */
export function catalogDigest(tiles: readonly CatalogTile[]): CatalogDigest {
  const listed = tiles
    .filter((tile) => !tile.hidden)
    .slice()
    .sort((a, b) => (a.tileId < b.tileId ? -1 : a.tileId > b.tileId ? 1 : 0));
  return { text: listed.map(digestLine).join("\n"), tileCount: listed.length };
}
