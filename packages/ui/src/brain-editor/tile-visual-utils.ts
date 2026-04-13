import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { LiteralDisplayFormats } from "@mindcraft-lang/core/brain";
import {
  applyDisplayFormat,
  type BrainTileAccessorDef,
  type BrainTileLiteralDef,
  type BrainTileVariableDef,
  getCatalogFallbackLabel,
} from "@mindcraft-lang/core/brain/tiles";
import type { BrainEditorConfig } from "./BrainEditorContext";
import type { TileVisual } from "./types";

function defaultTileLabel(tileDef: IBrainTileDef): string {
  if (tileDef.kind === "literal") {
    const literalDef = tileDef as BrainTileLiteralDef;
    const fmt = literalDef.displayFormat;
    return fmt && fmt !== LiteralDisplayFormats.Default && typeof literalDef.value === "number"
      ? applyDisplayFormat(literalDef.value, fmt)
      : literalDef.valueLabel || String(literalDef.value);
  }

  if (tileDef.kind === "variable") {
    return (tileDef as BrainTileVariableDef).varName;
  }

  if (tileDef.kind === "accessor") {
    return (tileDef as BrainTileAccessorDef).fieldName;
  }

  return getCatalogFallbackLabel(tileDef);
}

export function resolveTileVisual(config: BrainEditorConfig, tileDef: IBrainTileDef): TileVisual {
  const intrinsicVisual = tileDef.metadata as TileVisual | undefined;
  const appVisual = config.resolveTileVisual?.(tileDef);
  const appLabel = appVisual?.label;
  const appResolvedLabel = appLabel && appLabel !== getCatalogFallbackLabel(tileDef) ? appLabel : undefined;
  const intrinsicLabel = intrinsicVisual?.label;
  const intrinsicResolvedLabel =
    intrinsicLabel && intrinsicLabel !== getCatalogFallbackLabel(tileDef) ? intrinsicLabel : undefined;

  return {
    ...(intrinsicVisual ?? {}),
    ...(appVisual ?? {}),
    label: appResolvedLabel ?? intrinsicResolvedLabel ?? defaultTileLabel(tileDef),
  };
}
