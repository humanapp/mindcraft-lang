import { Error } from "../../platform/error";
import { CoreOpId, type IReadOnlyRegisteredOperator } from "../../runtime";
import { type BrainTileDefCreateOptions, mkOperatorTileId, TilePlacement } from "../interfaces";
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
    this.op = services.runtime.operatorTable.get(opId)!;
    if (!this.op) {
      throw new Error(`BrainTileOperatorDef: unknown opId ${opId}. Did you forget to register it?`);
    }
  }
}

/**
 * Registers all core operator tile definitions with the tile catalog, each with
 * its placement restriction, the label its chip displays, and -- where the two
 * differ -- the form it reads as in a projected sentence.
 */
export function registerCoreOperatorTileDefs(services: BrainServices) {
  const tiles = services.edit.tiles;
  const registerCoreOperatorTileDef = (opId: string, opts: BrainTileDefCreateOptions = {}) => {
    const tileDef = new BrainTileOperatorDef(opId, opts, services);
    tiles.registerTileDef(tileDef);
  };

  registerCoreOperatorTileDef(CoreOpId.And, {
    placement: TilePlacement.EitherSide,
    metadata: { label: "AND", language: { form: "and" } },
  });
  registerCoreOperatorTileDef(CoreOpId.Or, {
    placement: TilePlacement.EitherSide,
    metadata: { label: "OR", language: { form: "or" } },
  });
  registerCoreOperatorTileDef(CoreOpId.Not, {
    placement: TilePlacement.EitherSide,
    metadata: { label: "NOT", language: { form: "not" } },
  });
  registerCoreOperatorTileDef(CoreOpId.Add, {
    placement: TilePlacement.EitherSide,
    metadata: { label: "plus" },
  });
  registerCoreOperatorTileDef(CoreOpId.Subtract, {
    placement: TilePlacement.EitherSide,
    metadata: { label: "minus" },
  });
  registerCoreOperatorTileDef(CoreOpId.Multiply, {
    placement: TilePlacement.EitherSide,
    metadata: { label: "multiplied by" },
  });
  registerCoreOperatorTileDef(CoreOpId.Divide, {
    placement: TilePlacement.EitherSide,
    metadata: { label: "divided by" },
  });
  registerCoreOperatorTileDef(CoreOpId.Negate, {
    placement: TilePlacement.EitherSide,
    metadata: { label: "negative" },
  });
  registerCoreOperatorTileDef(CoreOpId.EqualTo, {
    placement: TilePlacement.WhenSide,
    metadata: { label: "equal to", language: { form: "is equal to" } },
  });
  registerCoreOperatorTileDef(CoreOpId.NotEqualTo, {
    placement: TilePlacement.WhenSide,
    metadata: { label: "not equal to", language: { form: "is not equal to" } },
  });
  registerCoreOperatorTileDef(CoreOpId.LessThan, {
    placement: TilePlacement.WhenSide,
    metadata: { label: "less than", language: { form: "is less than" } },
  });
  registerCoreOperatorTileDef(CoreOpId.LessThanOrEqualTo, {
    placement: TilePlacement.WhenSide,
    metadata: { label: "less than or equal to", language: { form: "is less than or equal to" } },
  });
  registerCoreOperatorTileDef(CoreOpId.GreaterThan, {
    placement: TilePlacement.WhenSide,
    metadata: { label: "greater than", language: { form: "is greater than" } },
  });
  registerCoreOperatorTileDef(CoreOpId.GreaterThanOrEqualTo, {
    placement: TilePlacement.WhenSide,
    metadata: { label: "greater than or equal to", language: { form: "is greater than or equal to" } },
  });
  registerCoreOperatorTileDef(CoreOpId.Assign, {
    placement: TilePlacement.DoSide,
    metadata: { label: "gets" },
  });
}
