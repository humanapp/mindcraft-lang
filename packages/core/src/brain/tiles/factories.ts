import {
  type BrainTileDefCreateOptions,
  type IBrainTileDef,
  type TileId,
  TilePlacement,
  type TypeId,
} from "../interfaces";
import { BrainTileDefBase } from "../model/tiledef";

/** Tile definition that produces other tile definitions on demand via {@link manufacture}. */
export class BrainTileFactoryDef extends BrainTileDefBase {
  readonly kind = "factory";
  readonly factoryId: string;
  readonly producedDataType: TypeId;
  readonly manufacture: (
    factoryTileDef: BrainTileFactoryDef,
    opts: Record<string, unknown>
  ) => IBrainTileDef | undefined;

  constructor(
    tileId: TileId,
    factoryId: string,
    manufacture: (factoryTileDef: BrainTileFactoryDef, opts: Record<string, unknown>) => IBrainTileDef | undefined,
    producedDataType: TypeId,
    opts: BrainTileDefCreateOptions = {}
  ) {
    if (opts.placement === undefined) opts.placement = TilePlacement.EitherSide;
    super(tileId, opts);
    this.factoryId = factoryId;
    this.manufacture = manufacture;
    this.producedDataType = producedDataType;
  }
}
