import type { ITileMetadata } from "@mindcraft-lang/core/brain";

/** WHEN/DO color pair for a brain tile, as hex strings. */
export type TileColorDef = { when: string; do: string };

/** Tile metadata extended with optional color and icon URL used by the brain editor visuals. */
export type TileVisual = ITileMetadata & {
  colorDef?: TileColorDef;
  iconUrl?: string;
};
