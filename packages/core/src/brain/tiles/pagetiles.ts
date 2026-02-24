import { Error } from "../../platform/error";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import { fourCC } from "../../primitives";
import { CoreTypeIds, type ITileCatalog, mkPageTileId, TilePlacement } from "../interfaces";
import { BrainTileDefBase, BrainTileDefBase_deserializeHeader } from "../model/tiledef";

const STags = {
  BPAG: fourCC("BPAG"), // Brain page tile chunk
};

/**
 * A tile definition representing a reference to a brain page.
 *
 * The value is a stable page ID (UUID) that never changes, even when the page
 * is renamed. The display name is maintained via the mutable `visual.label`
 * property by BrainDef.syncPageTiles_().
 *
 * When placed in a switch-page actuator's anonymous string slot, the runtime
 * resolves the pageId to a page index. If the referenced page has been deleted,
 * the tile is marked `hidden` so it no longer appears in the tile picker, but
 * it remains serializable and resolves to page index -1 at runtime.
 */
export class BrainTilePageDef extends BrainTileDefBase {
  readonly kind = "page";
  readonly pageId: string;

  /**
   * The output type of this tile when used in expressions.
   * Page tiles produce a String value (the pageId) at runtime.
   */
  readonly valueType = CoreTypeIds.String;

  /**
   * The runtime value of this tile: the stable pageId string.
   * This property parallels BrainTileLiteralDef.value so the compiler's
   * visitLiteral can process page tiles without modification.
   */
  readonly value: string;

  constructor(pageId: string, pageName?: string) {
    super(mkPageTileId(pageId), {
      placement: TilePlacement.EitherSide,
      persist: true,
      visual: { label: pageName || pageId },
    });
    this.pageId = pageId;
    this.value = pageId;
  }

  serialize(stream: IWriteStream): void {
    super.serialize(stream);
    stream.pushChunk(STags.BPAG, 1);
    stream.writeString(this.pageId);
    stream.popChunk();
  }
}

export function BrainTilePageDef_deserialize(stream: IReadStream, catalog: ITileCatalog): BrainTilePageDef {
  const { kind, tileId } = BrainTileDefBase_deserializeHeader(stream);
  if (kind !== "page") {
    throw new Error(`BrainTilePageDef.deserialize: invalid kind ${kind}`);
  }
  const version = stream.enterChunk(STags.BPAG);
  if (version !== 1) {
    throw new Error(`BrainTilePageDef.deserialize: unsupported version ${version}`);
  }
  const pageId = stream.readString();
  stream.leaveChunk();

  // Check if already in catalog (e.g., from a previous deserialization pass)
  const existing = catalog.get(tileId) as BrainTilePageDef | undefined;
  if (existing && existing.kind === "page") {
    return existing;
  }

  const tileDef = new BrainTilePageDef(pageId);
  return tileDef;
}
