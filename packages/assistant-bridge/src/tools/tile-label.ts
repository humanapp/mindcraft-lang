import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { BrainTileLiteralDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";

/**
 * The name the model reads a tile by: its display label, the natural label a
 * manufactured tile carries (a literal's value text, a variable's name), or the
 * tile id when it has neither.
 */
export function tileLabel(tile: IBrainTileDef): string {
  const label = tile.metadata?.label;
  if (label) return label;
  if (tile.kind === "literal") return (tile as BrainTileLiteralDef).valueLabel || tile.tileId;
  if (tile.kind === "variable") return (tile as BrainTileVariableDef).varName || tile.tileId;
  return tile.tileId;
}
