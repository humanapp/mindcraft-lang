import { stream } from "@mindcraft-lang/core";
import {
  getPageIdFromTileId,
  type IBrainDef,
  type IBrainTileDef,
  type ITileCatalog,
  isPageTileId,
  mkPageTileId,
} from "@mindcraft-lang/core/brain";
import { BrainTileMissingDef, TileCatalog } from "@mindcraft-lang/core/brain/tiles";

/**
 * Serialized clipboard payload for a copied tile.
 * Stored in a module-level variable so it persists across editor open/close
 * within the same browser tab.
 */
interface TileClipboardData {
  /** The tileId of the copied tile. */
  tileId: string;
  /** Direct reference to the copied tile def.
   * For non-persist tiles (operators, sensors, actuators) this is the only
   * way to recover the tile since they are not serialized into the catalog. */
  tileDef: IBrainTileDef;
  /** Serialized single-tile catalog (empty if the tile is non-persist). */
  catalogBytes: Uint8Array;
  /** Human-readable page name, captured at copy time.
   * Only set for page tiles, where the serialized form loses the visual label. */
  pageName?: string;
}

let tileClipboardData: TileClipboardData | undefined;
const tileClipboardListeners = new Set<() => void>();

function notifyTileClipboardChanged(): void {
  for (const listener of tileClipboardListeners) {
    listener();
  }
}

/**
 * Subscribe to tile clipboard changes. Returns an unsubscribe function.
 */
export function onTileClipboardChanged(listener: () => void): () => void {
  tileClipboardListeners.add(listener);
  return () => {
    tileClipboardListeners.delete(listener);
  };
}

/**
 * Copy a tile to the module-level tile clipboard.
 *
 * If the tile has persist=true (literal, variable, page), its catalog entry is
 * serialized so the clipboard is self-contained across brain open/close.
 */
export function copyTileToClipboard(tileDef: IBrainTileDef, brain: IBrainDef | undefined): void {
  const tempCatalog = new TileCatalog();
  let pageName: string | undefined;

  if (brain && tileDef.persist) {
    const brainCatalog = brain.catalog();
    const catalogTileDef = brainCatalog.get(tileDef.tileId);
    if (catalogTileDef) {
      tempCatalog.add(catalogTileDef);
      if (isPageTileId(tileDef.tileId) && catalogTileDef.visual?.label) {
        pageName = catalogTileDef.visual.label;
      }
    }
  }

  const catalogStream = new stream.MemoryStream();
  tempCatalog.serialize(catalogStream);
  const catalogBytes = stream.byteArrayToUint8Array(catalogStream.toBytes());

  tileClipboardData = { tileId: tileDef.tileId, tileDef, catalogBytes, pageName };
  notifyTileClipboardChanged();
}

/**
 * Whether the tile clipboard contains a copied tile.
 */
export function hasTileInClipboard(): boolean {
  return tileClipboardData !== undefined;
}

/**
 * Import the copied tile into the destination brain's catalog and return the
 * resolved tile def ready for insertion into a rule.
 *
 * For page tiles, applies the same cross-brain matching logic as rule paste:
 * same pageId -> same page name -> missing tile placeholder.
 *
 * Returns undefined if the clipboard is empty or the tile cannot be resolved.
 */
export function importTileFromClipboard(destBrain: IBrainDef): IBrainTileDef | undefined {
  if (!tileClipboardData) return undefined;

  const destCatalog = destBrain.catalog();
  const tileId = tileClipboardData.tileId;

  const existing = destCatalog.get(tileId);
  if (existing) return existing;

  const tempCatalog = new TileCatalog();
  const catalogStream = new stream.MemoryStream(stream.byteArrayFromUint8Array(tileClipboardData.catalogBytes));
  tempCatalog.deserialize(catalogStream);

  const tileDef = tempCatalog.get(tileId);
  if (!tileDef) {
    return tileClipboardData.tileDef;
  }

  if (isPageTileId(tileId)) {
    return importPageTile(tileDef, destBrain, destCatalog);
  }

  destCatalog.registerTileDef(tileDef);
  return tileDef;
}

/**
 * Handle cross-brain page tile import with name-based matching.
 */
function importPageTile(tileDef: IBrainTileDef, destBrain: IBrainDef, destCatalog: ITileCatalog): IBrainTileDef {
  const destPageByName = new Map<string, IBrainTileDef>();
  for (const page of destBrain.pages().toArray()) {
    const pageTileId = mkPageTileId(page.pageId());
    const pageTile = destCatalog.get(pageTileId);
    if (pageTile) {
      destPageByName.set(page.name(), pageTile);
    }
  }

  const sourceName = tileClipboardData!.pageName || tileDef.visual?.label || "";
  if (sourceName) {
    const destPageTile = destPageByName.get(sourceName);
    if (destPageTile) {
      return destPageTile;
    }
  }

  const label = tileClipboardData!.pageName || tileDef.visual?.label || "page";
  const missingTile = new BrainTileMissingDef(tileDef.tileId, "page", label);
  destCatalog.registerTileDef(missingTile);
  return missingTile;
}
