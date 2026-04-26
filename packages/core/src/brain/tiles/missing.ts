import { Error } from "../../platform/error";
import type { BrainTileKind, ITileCatalog, TileId } from "../interfaces";
import { TilePlacement } from "../interfaces";
import { BrainTileDefBase } from "../model/tiledef";

/** Serialized form of a {@link BrainTileMissingDef}. */
export interface MissingTileJson {
  version: number;
  kind: "missing";
  tileId: string;
  originalKind: string;
  label: string;
}

// Current serialization version.
const kVersion = 1;

/**
 * A placeholder tile representing a reference that could not be resolved.
 *
 * Created during paste operations when a rule references a tile (e.g., a page
 * tile) that does not exist in the destination brain. The tile preserves the
 * original tileId so that rule serialization is stable, and stores enough
 * metadata to display a meaningful label to the user.
 *
 * The parser produces an error for this tile kind, signaling that the user
 * should replace it with a valid tile.
 */
export class BrainTileMissingDef extends BrainTileDefBase {
  readonly kind: BrainTileKind = "missing";
  readonly originalKind: string;
  readonly label: string;

  constructor(tileId: TileId, originalKind: string, label: string) {
    super(tileId, {
      placement: TilePlacement.EitherSide,
      persist: true,
      metadata: { label: `? ${label}` },
    });
    this.originalKind = originalKind;
    this.label = label;
  }

  // -- JSON serialization ----------------------------------------------------

  toJson(): MissingTileJson {
    return {
      version: kVersion,
      kind: "missing",
      tileId: this.tileId,
      originalKind: this.originalKind,
      label: this.label,
    };
  }

  static fromJson(json: MissingTileJson, catalog: ITileCatalog): BrainTileMissingDef {
    if (json.version !== kVersion) {
      throw new Error(`BrainTileMissingDef.fromJson: unsupported version ${json.version}`);
    }
    if (catalog.has(json.tileId)) return catalog.get(json.tileId) as BrainTileMissingDef;
    return new BrainTileMissingDef(json.tileId, json.originalKind, json.label);
  }
}
