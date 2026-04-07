import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import { fourCC } from "../../primitives";
import type { IBrainTileDef, ITileCatalog } from "../interfaces";
import type { BrainServices } from "../services";
import { BrainTileLiteralDef, type LiteralTileJson } from "./literals";
import { BrainTileMissingDef, type MissingTileJson } from "./missing";
import { BrainTilePageDef, type PageTileJson } from "./pagetiles";
import { BrainTileVariableDef, type VariableTileJson } from "./variables";

export type CatalogTileJson = LiteralTileJson | VariableTileJson | PageTileJson | MissingTileJson;

// Current serialization version (binary only -- JSON catalog is unversioned).
const kVersion = 1;

// Serialization tags
const STags = {
  TCAT: fourCC("TCAT"), // Tile catalog
  TCNT: fourCC("TCNT"), // Tile count
};

export function getCatalogFallbackLabel(tileDef: IBrainTileDef): string {
  return tileDef.tileId.split(".").pop() || tileDef.tileId;
}

export class TileCatalog implements ITileCatalog {
  private readonly tiles = new Dict<string, IBrainTileDef>();

  has(tileId: string): boolean {
    return this.tiles.has(tileId);
  }

  add(tile: IBrainTileDef) {
    if (this.tiles.has(tile.tileId)) {
      throw new Error(`Tile with id ${tile.tileId} is already registered`);
    }
    this.tiles.set(tile.tileId, tile);
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

  // -- JSON serialization (parallel to binary below) -------------------------

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

  // -- Binary serialization ---------------------------------------------------

  serialize(stream: IWriteStream) {
    stream.pushChunk(STags.TCAT, kVersion);
    const tileList = this.tiles.values().filter((tile) => !!tile.persist);
    stream.writeTaggedU32(STags.TCNT, tileList.size());
    for (let i = 0; i < tileList.size(); i++) {
      const tile = tileList.get(i);
      tile.serialize(stream);
    }
    stream.popChunk();
  }

  deserialize(stream: IReadStream, services: BrainServices) {
    const version = stream.enterChunk(STags.TCAT);
    if (version !== kVersion) {
      throw new Error(`TileCatalog.deserialize: unsupported version ${version}`);
    }
    const tileCount = stream.readTaggedU32(STags.TCNT);
    for (let i = 0; i < tileCount; i++) {
      const tileDef = services.tileBuilder.deserializeTileDef(stream, this);
      if (!this.has(tileDef.tileId)) {
        this.registerTileDef(tileDef);
      }
    }
    stream.leaveChunk();
  }

  registerTileDef(tile: IBrainTileDef) {
    this.add(tile);
  }
}
