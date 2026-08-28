import type { IBrainTileDef, ITileCatalog } from "@wendoo/core/brain";
import { isActionTileDef } from "@wendoo/core/brain";
import type { BrainEditorConfig } from "@wendoo/ui/brain-editor/BrainEditorContext";
import { kDefaultTileHue, resolveTileVisualFrom } from "@wendoo/ui/brain-editor/tile-visual-utils";
import type { TileVisual } from "@wendoo/ui/brain-editor/types";
import { createContext, type ReactNode, useCallback, useContext } from "react";
import type { EditSide } from "./edit-story";

/**
 * What the host tells the panel about the brain on screen, so the panel can draw
 * the tiles the entity names as the things they are. Build one with
 * {@link brainSurfaceOf}.
 */
export interface BrainSurface {
  /** The catalogs a tile of the document is looked up in, in the order they are searched. */
  readonly tileCatalogs: readonly ITileCatalog[];
  /** The host's own reading of a tile's word, icon and colours; absent where the host has none. */
  readonly resolveTileVisual?: ((tileDef: IBrainTileDef) => TileVisual | undefined) | undefined;
}

/**
 * The surface `config` and `ownCatalog` describe together: the host's catalogs,
 * then `ownCatalog`, which holds the tiles minted into the standing document.
 * Answers `undefined` where the host stands no editor config.
 */
export function brainSurfaceOf(
  config: BrainEditorConfig | undefined,
  ownCatalog: ITileCatalog | undefined
): BrainSurface | undefined {
  if (config === undefined) return undefined;
  const tileCatalogs = [...(config.tileCatalogs ?? [])];
  if (ownCatalog) tileCatalogs.push(ownCatalog);
  return { tileCatalogs, resolveTileVisual: config.resolveTileVisual };
}

/** How one tile of the document reads on screen. */
export interface TileLook {
  /** The word the tile reads by. */
  readonly label: string;
  /** The tile's icon; absent where the host resolves none for it. */
  readonly iconUrl?: string;
  /** The hue the tile is filled in; {@link kDefaultTileHue} where its definition names none. */
  readonly hue: string;
}

/**
 * How the tile `tileId` reads, on `side` of a rule and in prose when given no
 * side. Answers `undefined` where no definition stands for the tile, which
 * {@link unresolvedTileLook} gives the caller's own word for.
 */
export type ReadTileLook = (tileId: string, side?: EditSide) => TileLook | undefined;

/** How a tile with no definition standing for it reads: its own word, no icon, and the default hue. */
export function unresolvedTileLook(label: string): TileLook {
  return { label, hue: kDefaultTileHue };
}

/** How `tileDef` reads on `side` of a rule, and in prose when given no side, against `surface`. */
function lookOf(surface: BrainSurface | undefined, tileDef: IBrainTileDef, side: EditSide | undefined): TileLook {
  const visual = resolveTileVisualFrom(surface?.resolveTileVisual, tileDef);
  const colorDef = visual.colorDef;
  // A tile on a side reads in that side's hue alone; one standing in prose
  // reads in the WHEN hue, falling to the DO hue where it names only that.
  const sided = side === undefined ? colorDef?.when || colorDef?.do : side === "when" ? colorDef?.when : colorDef?.do;
  return {
    label: visual.label || tileDef.tileId,
    ...(visual.iconUrl === undefined ? {} : { iconUrl: visual.iconUrl }),
    hue: sided || kDefaultTileHue,
  };
}

const BrainSurfaceContext = createContext<BrainSurface | undefined>(undefined);

/** Stands `value` as the brain the transcript draws tiles against over the tree it wraps. */
export function BrainSurfaceProvider({ value, children }: { value: BrainSurface | undefined; children?: ReactNode }) {
  return <BrainSurfaceContext.Provider value={value}>{children}</BrainSurfaceContext.Provider>;
}

/**
 * Reads how the document's tiles look, against the brain the host stands. Where
 * the host stands none, every tile answers `undefined`.
 */
export function useTileLooks(): ReadTileLook {
  const surface = useContext(BrainSurfaceContext);

  return useCallback<ReadTileLook>(
    (tileId, side) => {
      for (const catalog of surface?.tileCatalogs ?? []) {
        const tileDef = catalog.get(tileId);
        if (tileDef === undefined) continue;
        return lookOf(surface, tileDef, side);
      }
      return undefined;
    },
    [surface]
  );
}

/** How one host call reads on screen, and what the call does. */
export interface CallLook extends TileLook {
  /** `true` where the call reaches out to the world, `false` where it only reads it. */
  readonly acts: boolean;
}

/**
 * How the tile a host call is made by reads, looked up by the stable action key
 * the call reports. Answers `undefined` where no tile of the brain declares that
 * action, which {@link unresolvedTileLook} gives the caller's own word for.
 */
export type ReadCallLook = (action: string) => CallLook | undefined;

/**
 * Reads how the tile behind a host call looks, against the brain the host
 * stands. Where the host stands none, every call answers `undefined`.
 */
export function useCallLooks(): ReadCallLook {
  const surface = useContext(BrainSurfaceContext);

  return useCallback<ReadCallLook>(
    (action) => {
      for (const catalog of surface?.tileCatalogs ?? []) {
        const tileDef = catalog.find((held) => isActionTileDef(held) && held.action.key === action);
        if (tileDef === undefined) continue;
        const kind = isActionTileDef(tileDef) ? tileDef.action.kind : undefined;
        return { ...lookOf(surface, tileDef, undefined), acts: kind === "actuator" };
      }
      return undefined;
    },
    [surface]
  );
}
