import type { ITileVisual } from "@mindcraft-lang/core/brain";

export type TileColorDef = { when: string; do: string };

export type TileVisual = ITileVisual & {
  colorDef?: TileColorDef;
  iconUrl?: string;
};
