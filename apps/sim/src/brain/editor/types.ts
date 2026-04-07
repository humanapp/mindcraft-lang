import type { ITileVisual } from "@mindcraft-lang/core/app";

export type TileColorDef = { when: string; do: string };

export type TileVisual = ITileVisual & {
  //label: string; // from ITileVisual
  colorDef?: TileColorDef;
  iconUrl?: string;
  // TODO: Add icon, etc
};
