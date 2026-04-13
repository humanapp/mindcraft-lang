import type { ITileMetadata } from "@mindcraft-lang/core/brain";

export type TileColorDef = { when: string; do: string };

export type TileVisual = ITileMetadata & {
  colorDef?: TileColorDef;
  iconUrl?: string;
};
