import { assertUnreachable } from "@mindcraft-lang/core";
import type { BrainTileKind, IBrainTileDef } from "@mindcraft-lang/core/brain";
import { LiteralDisplayFormats } from "@mindcraft-lang/core/brain";
import {
  applyDisplayFormat,
  type BrainTileAccessorDef,
  type BrainTileLiteralDef,
  type BrainTileOutputDef,
  type BrainTileVariableDef,
  getCatalogFallbackLabel,
} from "@mindcraft-lang/core/brain/tiles";
import type { BrainEditorConfig } from "./BrainEditorContext";
import type { TileVisual } from "./types";

/**
 * How a tile chip renders, derived from its kind:
 *
 * - "value" -- shows its value in a boxed value field (literal, variable, accessor, output)
 * - "action" -- an icon chip that may carry the async-completion badge (sensor, actuator)
 * - "parameter" -- an icon chip with a data-type badge (parameter)
 * - "factory" -- an icon chip drawn at reduced scale (factory)
 * - "generic" -- a plain icon chip (all other kinds)
 */
export type TileVisualCategory = "value" | "action" | "parameter" | "factory" | "generic";

/** Maps every {@link BrainTileKind} to the {@link TileVisualCategory} its chip renders as. */
export const tileVisualCategoryByKind: Record<BrainTileKind, TileVisualCategory> = {
  undefined: "generic",
  sensor: "action",
  actuator: "action",
  parameter: "parameter",
  operator: "generic",
  variable: "value",
  literal: "value",
  factory: "factory",
  controlFlow: "generic",
  modifier: "generic",
  accessor: "value",
  page: "generic",
  output: "value",
  missing: "generic",
};

/** The {@link TileVisualCategory} of a tile, keyed by its kind. */
export function tileVisualCategory(tileDef: IBrainTileDef): TileVisualCategory {
  return tileVisualCategoryByKind[tileDef.kind];
}

function defaultTileLabel(tileDef: IBrainTileDef): string {
  switch (tileDef.kind) {
    case "literal": {
      const literalDef = tileDef as BrainTileLiteralDef;
      const fmt = literalDef.displayFormat;
      return fmt && fmt !== LiteralDisplayFormats.Default && typeof literalDef.value === "number"
        ? applyDisplayFormat(literalDef.value, fmt)
        : literalDef.valueLabel || String(literalDef.value);
    }
    case "variable":
      return (tileDef as BrainTileVariableDef).varName;
    case "accessor":
      return (tileDef as BrainTileAccessorDef).fieldName;
    case "output":
      return (tileDef as BrainTileOutputDef).outputName;
    case "undefined":
    case "sensor":
    case "actuator":
    case "parameter":
    case "operator":
    case "factory":
    case "controlFlow":
    case "modifier":
    case "page":
    case "missing":
      return getCatalogFallbackLabel(tileDef);
    default:
      return assertUnreachable(tileDef.kind);
  }
}

/**
 * Resolve the visual (label, icon, colors) for a tile by merging the tile's
 * intrinsic metadata with the app-supplied `resolveTileVisual` from `config`.
 * The label falls back to a kind-specific default (literal value, variable
 * name, accessor field name) when neither source provides a meaningful one.
 */
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
