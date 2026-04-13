import {
  type BrainTileDefCreateOptions,
  CoreParameterId,
  CoreTypeIds,
  mkParameterTileId,
  TilePlacement,
  type TypeId,
} from "../interfaces";
import { BrainTileDefBase } from "../model/tiledef";
import type { BrainServices } from "../services";

export class BrainTileParameterDef extends BrainTileDefBase {
  readonly kind = "parameter";
  readonly parameterId: string;
  readonly dataType: TypeId;

  constructor(parameterId: string, dataType: TypeId, opts: BrainTileDefCreateOptions = {}) {
    if (opts.placement === undefined) opts.placement = TilePlacement.EitherSide;
    super(mkParameterTileId(parameterId), opts);
    this.parameterId = parameterId;
    this.dataType = dataType;
  }
}

function registerParameterTileDef(
  parameterId: string,
  dataType: TypeId,
  opts: BrainTileDefCreateOptions = {},
  services: BrainServices
) {
  const tileDef = new BrainTileParameterDef(parameterId, dataType, opts);
  services.tiles.registerTileDef(tileDef);
}

export function registerCoreParameterTileDefs(services: BrainServices) {
  const tiles = services.tiles;
  const register = (parameterId: string, dataType: TypeId, opts: BrainTileDefCreateOptions = {}) => {
    const tileDef = new BrainTileParameterDef(parameterId, dataType, opts);
    tiles.registerTileDef(tileDef);
  };
  register(CoreParameterId.AnonymousBoolean, CoreTypeIds.Boolean, { hidden: true });
  register(CoreParameterId.AnonymousNumber, CoreTypeIds.Number, { hidden: true });
  register(CoreParameterId.AnonymousString, CoreTypeIds.String, { hidden: true });
}
