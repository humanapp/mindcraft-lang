import { assertUnreachable } from "@wendoo-lang/core";
import type {
  BrainTileAccessorDef,
  BrainTileKind,
  BrainTileLiteralDef,
  BrainTileVariableDef,
  IBrainTileDef,
} from "@wendoo-lang/core/app";
import { getCatalogFallbackLabel } from "@wendoo-lang/core/app";
import { ICON_BASE } from "../icon-base";
import { dataTypeIconMap } from "./data-type-icons";
import { tileVisuals } from "./tile-visuals";
import type { TileColorDef, TileVisual } from "./types";

const defaultTileColor: TileColorDef = { when: "#AA94EB", do: "#93A6EB" };

const tileColorMap: Record<BrainTileKind, TileColorDef | undefined> = {
  undefined: undefined,
  operator: defaultTileColor,
  controlFlow: defaultTileColor,
  variable: defaultTileColor,
  literal: defaultTileColor,
  sensor: defaultTileColor,
  actuator: defaultTileColor,
  parameter: defaultTileColor,
  modifier: defaultTileColor,
  factory: defaultTileColor,
  accessor: defaultTileColor,
  page: defaultTileColor,
  output: defaultTileColor,
  missing: { when: "#E57373", do: "#E57373" },
};

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

const warnedMissingIcons = new Set<string>();

/**
 * Builds a tile visual resolver that generates each tile's visual via
 * {@link genVisualForTile} and passes its icon URL through
 * `resolveVfsAssetUrl`, replacing compiler-minted `/vfs/<path>` references
 * with loadable asset URLs.
 */
export function createVfsAwareVisualProvider(
  resolveVfsAssetUrl: (url: string) => string
): (tileDef: IBrainTileDef) => TileVisual {
  return (tileDef) => {
    const visual = genVisualForTile(tileDef);
    if (visual.iconUrl) {
      const iconUrl = resolveVfsAssetUrl(visual.iconUrl);
      if (iconUrl !== visual.iconUrl) {
        return { ...visual, iconUrl };
      }
    }
    return visual;
  };
}

export function genVisualForTile(tileDef: IBrainTileDef): TileVisual {
  const intrinsicVisual = stripGenericCatalogLabel(tileDef, tileDef.metadata as TileVisual | undefined);
  const mappedVisual = tileVisuals.get(tileDef.tileId);
  const vis: Partial<TileVisual> = {
    ...(intrinsicVisual ?? {}),
    ...(mappedVisual ?? {}),
  };

  if (!vis.colorDef) {
    vis.colorDef = tileColorMap[tileDef.kind];
  }

  switch (tileDef.kind) {
    case "variable": {
      const varTileDef = tileDef as BrainTileVariableDef;
      if (!vis.iconUrl) {
        vis.iconUrl = dataTypeIconMap.get(varTileDef.varType);
      }
      break;
    }
    case "accessor": {
      const accTileDef = tileDef as BrainTileAccessorDef;
      if (!vis.iconUrl) {
        vis.iconUrl = dataTypeIconMap.get(accTileDef.fieldTypeId);
      }
      break;
    }
    case "literal": {
      const litTileDef = tileDef as BrainTileLiteralDef;
      if (!vis.iconUrl) {
        vis.iconUrl = dataTypeIconMap.get(litTileDef.valueType);
      }
      break;
    }
    case "page":
      if (!vis.iconUrl) {
        vis.iconUrl = `${ICON_BASE}/page3.svg`;
      }
      break;
    case "undefined":
    case "sensor":
    case "actuator":
    case "parameter":
    case "operator":
    case "factory":
    case "controlFlow":
    case "modifier":
    case "output":
    case "missing":
      break;
    default:
      assertUnreachable(tileDef.kind);
  }

  if (!vis.iconUrl) {
    if (!warnedMissingIcons.has(tileDef.tileId)) {
      warnedMissingIcons.add(tileDef.tileId);
      console.warn(`No icon found for tile ${tileDef.tileId}`);
    }
    vis.iconUrl = `${ICON_BASE}/question_mark.svg`;
  }

  return vis as TileVisual;
}
