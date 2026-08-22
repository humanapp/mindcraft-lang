import type { ITileMetadata } from "@wendoo/core/app";

export type TileColorDef = { when: string; do: string };

export type TileVisual = ITileMetadata & {
  colorDef?: TileColorDef;
  iconUrl?: string;
};
