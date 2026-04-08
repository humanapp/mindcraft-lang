import { Error } from "../../platform/error";
import { CoreTypeIds, type ITileCatalog, mkPageTileId, TilePlacement } from "../interfaces";
import { BrainTileDefBase } from "../model/tiledef";

export interface PageTileJson {
  version: number;
  kind: "page";
  tileId: string;
  pageId: string;
  /** Non-authoritative display label. When the pageId matches a living page,
   *  the page's current name takes precedence via syncPageTiles_(). */
  label?: string;
}

// Current serialization version.
// v1: initial format (pageId only)
// v2: added non-authoritative label
const kVersion = 2;

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

  // -- JSON serialization ----------------------------------------------------

  toJson(): PageTileJson {
    return {
      version: kVersion,
      kind: "page",
      tileId: this.tileId,
      pageId: this.pageId,
      label: this.visual?.label,
    };
  }

  static fromJson(json: PageTileJson, catalog: ITileCatalog): BrainTilePageDef {
    if (json.version < 1 || json.version > kVersion) {
      throw new Error(`BrainTilePageDef.fromJson: unsupported version ${json.version}`);
    }
    if (catalog.has(json.tileId)) return catalog.get(json.tileId) as BrainTilePageDef;
    const tileDef = new BrainTilePageDef(json.pageId, json.label);
    catalog.registerTileDef(tileDef);
    return tileDef;
  }
}
