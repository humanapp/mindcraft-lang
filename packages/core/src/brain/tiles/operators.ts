import { Error } from "../../platform/error";
import type { IReadStream } from "../../platform/stream";
import {
  type BrainTileDefCreateOptions,
  CoreOpId,
  type IReadOnlyRegisteredOperator,
  mkOperatorTileId,
  TilePlacement,
} from "../interfaces";
import type { ITileCatalog } from "../interfaces/catalog";
import { BrainTileDefBase, BrainTileDefBase_deserializeHeader } from "../model/tiledef";
import { getBrainServices } from "../services";

/**
 * Tile definition for operator tiles in the brain system.
 * Represents an operator as a placeable tile with an associated operator ID.
 */
export class BrainTileOperatorDef extends BrainTileDefBase {
  readonly kind = "operator";
  readonly op: IReadOnlyRegisteredOperator;

  constructor(opId: string, opts: BrainTileDefCreateOptions = {}) {
    super(mkOperatorTileId(opId), opts);
    this.op = getBrainServices().operatorTable.get(opId)!;
    if (!this.op) {
      throw new Error(`BrainTileOperatorDef: unknown opId ${opId}. Did you forget to register it?`);
    }
  }
}

/**
 * Deserializes an operator tile definition from a stream.
 * @param stream - The stream to read from
 * @param catalog - The tile catalog to look up the tile definition
 * @returns The deserialized operator tile definition
 * @throws {Error} If the kind is invalid or the tile ID is not found in the catalog
 */
export function BrainTileOperatorDef_deserialize(stream: IReadStream, catalog: ITileCatalog): BrainTileOperatorDef {
  const { kind, tileId } = BrainTileDefBase_deserializeHeader(stream);
  if (kind !== "operator") {
    throw new Error(`BrainTileOperatorDef.deserialize: invalid kind ${kind}`);
  }
  const tileDef = catalog.get(tileId);
  if (tileDef && tileDef.kind === "operator") {
    return tileDef as BrainTileOperatorDef;
  }
  throw new Error(`BrainTileOperatorDef.deserialize: unknown tileId ${tileId}`);
}

/**
 * Registers all core operator tile definitions with the tile catalog.
 * Sets appropriate placement restrictions for each operator tile.
 */
export function registerCoreOperatorTileDefs() {
  const tiles = getBrainServices().tiles;
  const registerCoreOperatorTileDef = (opId: string, opts: BrainTileDefCreateOptions = {}) => {
    const tileDef = new BrainTileOperatorDef(opId, opts);
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
