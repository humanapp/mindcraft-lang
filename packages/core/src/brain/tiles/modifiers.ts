import type { UserArgIdentity } from "../../runtime";
import { type BrainTileDefCreateOptions, mkModifierTileId, TilePlacement } from "../interfaces";
import { BrainTileDefBase } from "../model/tiledef";

/** Tile definition for a modifier on a sensor or actuator. */
export class BrainTileModifierDef extends BrainTileDefBase {
  readonly kind = "modifier";
  readonly modifierId: string;

  /** Components of this tile's private arg id. Absent for shared and platform modifiers. */
  readonly userArg?: UserArgIdentity;

  constructor(modifierId: string, opts: BrainTileDefCreateOptions & { userArg?: UserArgIdentity } = {}) {
    if (opts.placement === undefined) opts.placement = TilePlacement.EitherSide;
    super(mkModifierTileId(modifierId), opts);
    this.modifierId = modifierId;
    this.userArg = opts.userArg;
  }
}
