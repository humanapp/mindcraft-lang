import type { List } from "../../platform/list";
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
  registerTileDef(tile: IBrainTileDef): void;
}

// ----------------------------------------------------
// Tile Definition Builder
// ----------------------------------------------------

export interface IBrainTileDefBuilder {
  // operator tiles
  createOperatorTileDef(opId: string, opts: BrainTileDefCreateOptions): IBrainTileDef;
  // control-flow tiles
  createControlFlowTileDef(cfId: string, opts: BrainTileDefCreateOptions): IBrainTileDef;
  // variable tiles
  createVariableTileDef(
    tileId: TileId,
    varName: string,
    varType: TypeId,
    uniqueId: string,
    opts: BrainTileDefCreateOptions
  ): IBrainTileDef;
  // literal tiles
  createLiteralTileDef(valueType: TypeId, value: unknown, opts: BrainTileLiteralDefOptions): IBrainTileDef;
}
