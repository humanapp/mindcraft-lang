import { type BrainTileDefCreateOptions, CoreControlFlowId, mkControlFlowTileId, TilePlacement } from "../interfaces";
import { BrainTileDefBase } from "../model/tiledef";
import type { BrainServices } from "../services";

/** Tile definition for a control-flow construct (parens, etc.) identified by `cfId`. */
export class BrainTileControlFlowDef extends BrainTileDefBase {
  readonly kind = "controlFlow";
  readonly cfId: string;

  constructor(cfId: string, opts: BrainTileDefCreateOptions = {}) {
    super(mkControlFlowTileId(cfId), opts);
    this.cfId = cfId;
  }
}

/** Register the built-in control-flow tiles on `services`. */
export function registerCoreControlFlowTileDefs(services: BrainServices) {
  const tiles = services.tiles;
  const register = (cfId: string, opts: BrainTileDefCreateOptions = {}) => {
    const tileDef = new BrainTileControlFlowDef(cfId, opts);
    tiles.registerTileDef(tileDef);
  };
  register(CoreControlFlowId.OpenParen, { placement: TilePlacement.EitherSide });
  register(CoreControlFlowId.CloseParen, { placement: TilePlacement.EitherSide });
  //registerCoreControlFlowTileDef(CoreControlFlowId.Continue, TilePlacement.DoSide | TilePlacement.InsideLoop, false);
  //registerCoreControlFlowTileDef(CoreControlFlowId.Break, TilePlacement.DoSide | TilePlacement.InsideLoop, false);
  //registerCoreControlFlowTileDef(CoreControlFlowId.ForEach, TilePlacement.WhenSide, false);
}
