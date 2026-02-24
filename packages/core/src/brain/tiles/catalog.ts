import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import type { List } from "../../platform/list";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import { fourCC } from "../../primitives";
import type { IBrainTileDef, ITileCatalog, ITileVisual } from "../interfaces";
import { getBrainServices } from "../services";

// Serialization tags
const STags = {
  TCAT: fourCC("TCAT"), // Tile catalog
  TCNT: fourCC("TCNT"), // Tile count
};

type FnVisualProvider = (tileDef: IBrainTileDef) => ITileVisual;

let tileVisualProvider: FnVisualProvider = (tileDef: IBrainTileDef) => {
  return { label: tileDef.tileId.split(".").pop() || tileDef.tileId };
};

export function setTileVisualProvider(provider: (tileDef: IBrainTileDef) => ITileVisual) {
  tileVisualProvider = provider;
}

export function getTileVisualProvider(): FnVisualProvider {
  return tileVisualProvider;
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

  serialize(stream: IWriteStream) {
    stream.pushChunk(STags.TCAT, 1);
    const tileList = this.tiles.values().filter((tile) => !!tile.persist);
    stream.writeTaggedU32(STags.TCNT, tileList.size());
    for (let i = 0; i < tileList.size(); i++) {
      const tile = tileList.get(i);
      tile.serialize(stream);
    }
    stream.popChunk();
  }

  deserialize(stream: IReadStream) {
    const version = stream.enterChunk(STags.TCAT);
    if (version !== 1) {
      throw new Error(`TileCatalog.deserialize: unsupported version ${version}`);
    }
    const tileCount = stream.readTaggedU32(STags.TCNT);
    for (let i = 0; i < tileCount; i++) {
      const tileDef = getBrainServices().tileBuilder.deserializeTileDef(stream, this);
      if (!this.has(tileDef.tileId)) {
        this.registerTileDef(tileDef);
      }
    }
    stream.leaveChunk();
  }

  registerTileDef(tile: IBrainTileDef) {
    if (getTileVisualProvider) {
      tile.visual = getTileVisualProvider()(tile);
    }
    this.add(tile);
  }
}
