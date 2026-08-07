import type { List } from "../../platform/list";
import type { TypeId } from "../../runtime/type-defs";
import type { BrainTileDefCreateOptions, BrainTileLiteralDefOptions, IBrainTileDef, TileId } from "./tiles";

// ----------------------------------------------------
// Tile Catalog
// ----------------------------------------------------

/** Mutable catalog of {@link IBrainTileDef}s keyed by `tileId`. Brains consult catalogs to enumerate available tiles. */
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

/** Factory for built-in tileDef shapes (operators, control flow, variables, literals). */
export interface IBrainTileDefBuilder {
  // operator tiles
  createOperatorTileDef(opId: string, opts: BrainTileDefCreateOptions): IBrainTileDef;
  // control-flow tiles
  createControlFlowTileDef(cfId: string, opts: BrainTileDefCreateOptions): IBrainTileDef;
  /**
   * Mint the variable tile named `varName` into `catalog` and return the
   * registered def, ready to place in a rule. An equivalent variable `catalog`
   * already holds is reused; otherwise the new tile is registered.
   */
  createVariableTileDef(
    catalog: ITileCatalog,
    tileId: TileId,
    varName: string,
    varType: TypeId,
    uniqueId: string,
    opts: BrainTileDefCreateOptions
  ): IBrainTileDef;
  /**
   * Mint the literal tile for `value` of `valueType` into `catalog` and return
   * the registered def, ready to place in a rule. An equivalent literal
   * `catalog` already holds is reused; otherwise the new tile is registered.
   */
  createLiteralTileDef(
    catalog: ITileCatalog,
    valueType: TypeId,
    value: unknown,
    opts: BrainTileLiteralDefOptions
  ): IBrainTileDef;
}
