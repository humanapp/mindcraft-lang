import type {
  BrainTileAccessorDef,
  BrainTileLiteralDef,
  BrainTileVariableDef,
  IBrainTileDef,
} from "@mindcraft-lang/core/app";
import { getCatalogFallbackLabel } from "@mindcraft-lang/core/app";
import { dataTypeIconMap } from "./data-type-icons";
import { tileColorMap } from "./tile-colors";
import { tileVisuals } from "./tile-visuals";
import type { TileVisual } from "./types";

function stripGenericCatalogLabel(tileDef: IBrainTileDef, visual: TileVisual | undefined): Partial<TileVisual> {
  if (!visual) {
    return {};
  }

  if (visual.label !== getCatalogFallbackLabel(tileDef)) {
    return visual;
  }

  const { label: _label, ...rest } = visual;
  return rest;
}

export function genVisualForTile(tileDef: IBrainTileDef): TileVisual {
  const intrinsicVisual = stripGenericCatalogLabel(tileDef, tileDef.visual as TileVisual | undefined);
  const mappedVisual = tileVisuals.get(tileDef.tileId);
  const vis: Partial<TileVisual> = {
    ...(intrinsicVisual ?? {}),
    ...(mappedVisual ?? {}),
  };

  if (!vis.colorDef) {
    vis.colorDef = tileColorMap.get(tileDef.kind);
  }

  if (tileDef.kind === "variable") {
    const varTileDef = tileDef as BrainTileVariableDef;
    if (!vis.iconUrl) {
      const dataTypeIcon = dataTypeIconMap.get(varTileDef.varType);
      vis.iconUrl = dataTypeIcon;
    }
  } else if (tileDef.kind === "accessor") {
    const accTileDef = tileDef as BrainTileAccessorDef;
    if (!vis.iconUrl) {
      const dataTypeIcon = dataTypeIconMap.get(accTileDef.fieldTypeId);
      vis.iconUrl = dataTypeIcon;
    }
  } else if (tileDef.kind === "literal") {
    const litTileDef = tileDef as BrainTileLiteralDef;
    if (!vis.iconUrl) {
      const dataTypeIcon = dataTypeIconMap.get(litTileDef.valueType);
      vis.iconUrl = dataTypeIcon;
    }
  } else if (tileDef.kind === "page") {
    if (!vis.iconUrl) {
      vis.iconUrl = "/assets/brain/icons/page3.svg";
    }
  }

  if (!vis.iconUrl) {
    console.warn(`No icon found for tile ${tileDef.tileId}`);
    vis.iconUrl = "/assets/brain/icons/question_mark.svg";
  }

  return vis as TileVisual;
}
