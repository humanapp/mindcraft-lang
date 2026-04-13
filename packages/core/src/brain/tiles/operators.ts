import { Error } from "../../platform/error";
import {
  type BrainTileDefCreateOptions,
  CoreOpId,
  type IReadOnlyRegisteredOperator,
  mkOperatorTileId,
  TilePlacement,
} from "../interfaces";
import { BrainTileDefBase } from "../model/tiledef";
import type { BrainServices } from "../services";

/**
 * Tile definition for operator tiles in the brain system.
 * Represents an operator as a placeable tile with an associated operator ID.
 */
export class BrainTileOperatorDef extends BrainTileDefBase {
  readonly kind = "operator";
  readonly op: IReadOnlyRegisteredOperator;

  constructor(opId: string, opts: BrainTileDefCreateOptions = {}, services: BrainServices) {
    super(mkOperatorTileId(opId), opts);
    this.op = services.operatorTable.get(opId)!;
    if (!this.op) {
      throw new Error(`BrainTileOperatorDef: unknown opId ${opId}. Did you forget to register it?`);
    }
  }
}

/**
 * Registers all core operator tile definitions with the tile catalog.
 * Sets appropriate placement restrictions for each operator tile.
 */
export function registerCoreOperatorTileDefs(services: BrainServices) {
  const tiles = services.tiles;
  const registerCoreOperatorTileDef = (opId: string, opts: BrainTileDefCreateOptions = {}) => {
    const tileDef = new BrainTileOperatorDef(opId, opts, services);
    tiles.registerTileDef(tileDef);
  };

  registerCoreOperatorTileDef(CoreOpId.And, { placement: TilePlacement.EitherSide });
  registerCoreOperatorTileDef(CoreOpId.Or, { placement: TilePlacement.EitherSide });
  registerCoreOperatorTileDef(CoreOpId.Not, { placement: TilePlacement.EitherSide });
  registerCoreOperatorTileDef(CoreOpId.Add, { placement: TilePlacement.EitherSide });
  registerCoreOperatorTileDef(CoreOpId.Subtract, { placement: TilePlacement.EitherSide });
  registerCoreOperatorTileDef(CoreOpId.Multiply, { placement: TilePlacement.EitherSide });
  registerCoreOperatorTileDef(CoreOpId.Divide, { placement: TilePlacement.EitherSide });
  registerCoreOperatorTileDef(CoreOpId.Negate, { placement: TilePlacement.EitherSide });
  registerCoreOperatorTileDef(CoreOpId.EqualTo, { placement: TilePlacement.WhenSide });
  registerCoreOperatorTileDef(CoreOpId.NotEqualTo, { placement: TilePlacement.WhenSide });
  registerCoreOperatorTileDef(CoreOpId.LessThan, { placement: TilePlacement.WhenSide });
  registerCoreOperatorTileDef(CoreOpId.LessThanOrEqualTo, { placement: TilePlacement.WhenSide });
  registerCoreOperatorTileDef(CoreOpId.GreaterThan, { placement: TilePlacement.WhenSide });
  registerCoreOperatorTileDef(CoreOpId.GreaterThanOrEqualTo, {
    placement: TilePlacement.WhenSide,
  });
  registerCoreOperatorTileDef(CoreOpId.Assign, { placement: TilePlacement.DoSide });
}
