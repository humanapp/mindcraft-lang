import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import type { IBrainTileDef, ITileCatalog } from "../interfaces";
import type { BrainServices } from "../services";
import { BrainTileLiteralDef, type LiteralTileJson } from "./literals";
import { BrainTileMissingDef, type MissingTileJson } from "./missing";
import { BrainTilePageDef, type PageTileJson } from "./pagetiles";
import { BrainTileVariableDef, type VariableTileJson } from "./variables";

/** Discriminated union of every persistent tile JSON shape supported by {@link TileCatalog.toJson}. */
export type CatalogTileJson = LiteralTileJson | VariableTileJson | PageTileJson | MissingTileJson;

/** Display label fallback for a tile when no metadata label is set: the trailing dotted segment of its tile id. */
export function getCatalogFallbackLabel(tileDef: IBrainTileDef): string {
  return tileDef.tileId.split(".").pop() || tileDef.tileId;
}

/** In-memory {@link ITileCatalog}: stores {@link IBrainTileDef}s keyed by tile id, with JSON round-tripping. */
export class TileCatalog implements ITileCatalog {
  private readonly tiles = new Dict<string, IBrainTileDef>();

  has(tileId: string): boolean {
    return this.tiles.has(tileId);
  }

  add(tile: IBrainTileDef) {
    if (!this.tiles.has(tile.tileId)) {
      this.tiles.set(tile.tileId, tile);
    }
  }

  get(tileId: string): IBrainTileDef | undefined {
    return this.tiles.get(tileId);
  }

  delete(tileId: string): boolean {
    return this.tiles.delete(tileId);
  }

  clear(): void {
    this.tiles.clear();
  }

  getAll(): List<IBrainTileDef> {
    return this.tiles.values();
  }

  find(predicate: (tileDef: IBrainTileDef) => boolean): IBrainTileDef | undefined {
    const tileList = this.tiles.values();
    for (let i = 0; i < tileList.size(); i++) {
      const tile = tileList.get(i);
      if (predicate(tile)) {
        return tile;
      }
    }
    return undefined;
  }

  // -- JSON serialization ----------------------------------------------------

  toJson(): List<CatalogTileJson> {
    const result = new List<CatalogTileJson>();
    const tileList = this.tiles.values().filter((tile) => !!tile.persist);
    for (let i = 0; i < tileList.size(); i++) {
      const tile = tileList.get(i);
      switch (tile.kind) {
        case "literal":
          result.push((tile as BrainTileLiteralDef).toJson());
          break;
        case "variable":
          result.push((tile as BrainTileVariableDef).toJson());
          break;
        case "page":
          result.push((tile as BrainTilePageDef).toJson());
          break;
        case "missing":
          result.push((tile as BrainTileMissingDef).toJson());
          break;
        default:
          throw new Error(`TileCatalog.toJson: unsupported persistent tile kind '${tile.kind}'`);
      }
    }
    return result;
  }

  deserializeJson(json: ReadonlyList<CatalogTileJson>, services: BrainServices): void {
    for (let i = 0; i < json.size(); i++) {
      const entry = json.get(i);
      switch (entry.kind) {
        case "literal":
          BrainTileLiteralDef.fromJson(entry, this, services);
          break;
        case "variable":
          BrainTileVariableDef.fromJson(entry, this, services);
          break;
        case "page":
          BrainTilePageDef.fromJson(entry, this);
          break;
        case "missing":
          BrainTileMissingDef.fromJson(entry, this);
          break;
        default:
          throw new Error(`TileCatalog.deserializeJson: unsupported tile kind '${(entry as CatalogTileJson).kind}'`);
      }
    }
  }

  registerTileDef(tile: IBrainTileDef) {
    this.add(tile);
  }
}
