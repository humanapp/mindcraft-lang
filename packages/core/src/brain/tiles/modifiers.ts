import { type BrainTileDefCreateOptions, mkModifierTileId, TilePlacement } from "../interfaces";
import { BrainTileDefBase } from "../model/tiledef";

/** Tile definition for a modifier on a sensor or actuator. */
export class BrainTileModifierDef extends BrainTileDefBase {
  readonly kind = "modifier";
  readonly modifierId: string;

  constructor(modifierId: string, opts: BrainTileDefCreateOptions = {}) {
    if (opts.placement === undefined) opts.placement = TilePlacement.EitherSide;
    super(mkModifierTileId(modifierId), opts);
    this.modifierId = modifierId;
  }
}
