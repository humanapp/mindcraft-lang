import type { List } from "../../platform/list";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import type { BrainTileDefCreateOptions, BrainTileLiteralDefOptions, IBrainTileDef, TileId } from "./tiles";
import type { TypeId } from "./type-system";

// ----------------------------------------------------
// Tile Catalog
// ----------------------------------------------------

export interface ITileCatalog {
  has(tileId: string): boolean;
  add(tile: IBrainTileDef): void;
  get(tileId: string): IBrainTileDef | undefined;
  delete(tileId: string): boolean;
  getAll(): List<IBrainTileDef>;
  find(predicate: (tileDef: IBrainTileDef) => boolean): IBrainTileDef | undefined;
  serialize(stream: IWriteStream): void;
  deserialize(stream: IReadStream): void;
  registerTileDef(tile: IBrainTileDef): void;
}

// ----------------------------------------------------
// Tile Definition Builder
// ----------------------------------------------------

export interface IBrainTileDefBuilder {
  // operator tiles
  createOperatorTileDef(opId: string, opts: BrainTileDefCreateOptions): IBrainTileDef;
  deserializeOperatorTileDef(stream: IReadStream, catalog: ITileCatalog): IBrainTileDef;
  // control-flow tiles
  createControlFlowTileDef(cfId: string, opts: BrainTileDefCreateOptions): IBrainTileDef;
  deserializeControlFlowTileDef(stream: IReadStream, catalog: ITileCatalog): IBrainTileDef;
  // variable tiles
  createVariableTileDef(
    tileId: TileId,
    varName: string,
    varType: TypeId,
    uniqueId: string,
    opts: BrainTileDefCreateOptions
  ): IBrainTileDef;
  deserializeVariableTileDef(stream: IReadStream, catalog: ITileCatalog): IBrainTileDef;
  // literal tiles
  createLiteralTileDef(valueType: TypeId, value: unknown, opts: BrainTileLiteralDefOptions): IBrainTileDef;
  deserializeLiteralTileDef(stream: IReadStream, catalog: ITileCatalog): IBrainTileDef;
  // top-level deserialize (delegates to specific tile type deserializers)
  deserializeTileDef(stream: IReadStream, catalog: ITileCatalog): IBrainTileDef;
}
