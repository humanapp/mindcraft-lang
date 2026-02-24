import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { BrainTileAccessorDef, BrainTileLiteralDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import { dataTypeIconMap } from "./data-type-icons";
import { tileColorMap } from "./tile-colors";
import { tileVisuals } from "./tile-visuals";
import type { TileVisual } from "./types";

export function genVisualForTile(tileDef: IBrainTileDef): TileVisual {
  const vis: TileVisual = (tileDef.visual as TileVisual) || tileVisuals.get(tileDef.tileId) || {};

  if (!vis.colorDef) {
    vis.colorDef = tileColorMap.get(tileDef.kind);
  }

  if (tileDef.kind === "variable") {
    const varTileDef = tileDef as BrainTileVariableDef;
    if (!vis.label) {
      vis.label = varTileDef.varName;
    }
    if (!vis.iconUrl) {
      const dataTypeIcon = dataTypeIconMap.get(varTileDef.varType);
      vis.iconUrl = dataTypeIcon;
    }
  } else if (tileDef.kind === "accessor") {
    const accTileDef = tileDef as BrainTileAccessorDef;
    if (!vis.label) {
      vis.label = accTileDef.fieldName;
    }
    if (!vis.iconUrl) {
      const dataTypeIcon = dataTypeIconMap.get(accTileDef.fieldTypeId);
      vis.iconUrl = dataTypeIcon;
    }
  } else if (tileDef.kind === "literal") {
    const litTileDef = tileDef as BrainTileLiteralDef;
    if (!vis.label) {
      vis.label = litTileDef.valueLabel;
    }
    if (!vis.iconUrl) {
      const dataTypeIcon = dataTypeIconMap.get(litTileDef.valueType);
      vis.iconUrl = dataTypeIcon;
    }
  } else if (tileDef.kind === "page") {
    if (!vis.iconUrl) {
      vis.iconUrl = "/assets/brain/icons/page.svg";
    }
  }

  if (!vis.label) {
    console.warn(`No label found for tile ${tileDef.tileId}`);
    const label = tileDef.tileId.split(".").pop() || tileDef.tileId || "??";
    vis.label = label;
  }

  if (!vis.iconUrl) {
    console.warn(`No icon found for tile ${tileDef.tileId}`);
    vis.iconUrl = "/assets/brain/icons/question_mark.svg";
  }

  return vis;
}
