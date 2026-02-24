import { Error } from "../../platform/error";
import type { IReadStream } from "../../platform/stream";
import {
  type BrainTileDefCreateOptions,
  type IBrainTileDef,
  type ITileCatalog,
  type TileId,
  TilePlacement,
  type TypeId,
} from "../interfaces";
import { BrainTileDefBase, BrainTileDefBase_deserializeHeader } from "../model/tiledef";

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

export function BrainTileFactoryDef_deserialize(stream: IReadStream, catalog: ITileCatalog): BrainTileFactoryDef {
  const { kind, tileId } = BrainTileDefBase_deserializeHeader(stream);
  if (kind !== "factory") {
    throw new Error(`BrainTileFactoryDef.deserialize: invalid kind ${kind}`);
  }
  const tileDef = catalog.get(tileId);
  if (tileDef && tileDef.kind === "factory") {
    return tileDef as BrainTileFactoryDef;
  }
  throw new Error(`BrainTileFactoryDef.deserialize: unknown tileId ${tileId}`);
}
