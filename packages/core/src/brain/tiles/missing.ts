import { Error } from "../../platform/error";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import { fourCC } from "../../primitives";
import type { BrainTileKind, ITileCatalog, TileId } from "../interfaces";
import { TilePlacement } from "../interfaces";
import { BrainTileDefBase, BrainTileDefBase_deserializeHeader } from "../model/tiledef";

const STags = {
  BMIS: fourCC("BMIS"), // Brain missing tile chunk
};

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
      visual: { label: `? ${label}` },
    });
    this.originalKind = originalKind;
    this.label = label;
  }

  serialize(stream: IWriteStream): void {
    super.serialize(stream);
    stream.pushChunk(STags.BMIS, 1);
    stream.writeString(this.originalKind);
    stream.writeString(this.label);
    stream.popChunk();
  }
}

export function BrainTileMissingDef_deserialize(stream: IReadStream, catalog: ITileCatalog): BrainTileMissingDef {
  const { kind, tileId } = BrainTileDefBase_deserializeHeader(stream);
  if (kind !== "missing") {
    throw new Error(`BrainTileMissingDef.deserialize: invalid kind ${kind}`);
  }
  const version = stream.enterChunk(STags.BMIS);
  if (version !== 1) {
    throw new Error(`BrainTileMissingDef.deserialize: unsupported version ${version}`);
  }
  const originalKind = stream.readString();
  const label = stream.readString();
  stream.leaveChunk();

  // Return existing if already in catalog
  const existing = catalog.get(tileId) as BrainTileMissingDef | undefined;
  if (existing && existing.kind === "missing") {
    return existing;
  }

  return new BrainTileMissingDef(tileId, originalKind, label);
}
