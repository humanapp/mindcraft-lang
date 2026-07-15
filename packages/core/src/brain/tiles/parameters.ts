import {
  CoreParameterId,
  CoreTypeIds,
  mkParameterTileId,
  type NamespacedTypeName,
  type TypeId,
  type UserArgIdentity,
} from "../../runtime";
import { type BrainTileDefCreateOptions, TilePlacement } from "../interfaces";
import { BrainTileDefBase } from "../model/tiledef";
import type { BrainServices } from "../services";

/** Identity options for parameter tiles derived from compiled user actions. */
export interface BrainParameterTileIdentityOptions {
  /** Components of a private arg tile id. Absent for anonymous and platform parameters. */
  userArg?: UserArgIdentity;
  /** Type name keying an anonymous parameter tile. Absent for named and platform parameters. */
  anonType?: NamespacedTypeName;
}

/** Tile definition for a named parameter slot of a sensor/actuator, typed by `dataType`. */
export class BrainTileParameterDef extends BrainTileDefBase {
  readonly kind = "parameter";
  readonly parameterId: string;
  readonly dataType: TypeId;

  /** Components of this tile's private arg id. Absent for anonymous and platform parameters. */
  readonly userArg?: UserArgIdentity;

  /** Type name keying this anonymous parameter tile. Absent for named and platform parameters. */
  readonly anonType?: NamespacedTypeName;

  constructor(
    parameterId: string,
    dataType: TypeId,
    opts: BrainTileDefCreateOptions & BrainParameterTileIdentityOptions = {}
  ) {
    if (opts.placement === undefined) opts.placement = TilePlacement.EitherSide;
    super(mkParameterTileId(parameterId), opts);
    this.parameterId = parameterId;
    this.dataType = dataType;
    this.userArg = opts.userArg;
    this.anonType = opts.anonType;
  }
}

function registerParameterTileDef(
  parameterId: string,
  dataType: TypeId,
  opts: BrainTileDefCreateOptions = {},
  services: BrainServices
) {
  const tileDef = new BrainTileParameterDef(parameterId, dataType, opts);
  services.edit.tiles.registerTileDef(tileDef);
}

/** Register the built-in anonymous parameter tiles for boolean/number/string args on `services`. */
export function registerCoreParameterTileDefs(services: BrainServices) {
  const tiles = services.edit.tiles;
  const register = (parameterId: string, dataType: TypeId, opts: BrainTileDefCreateOptions = {}) => {
    const tileDef = new BrainTileParameterDef(parameterId, dataType, opts);
    tiles.registerTileDef(tileDef);
  };
  register(CoreParameterId.AnonymousBoolean, CoreTypeIds.Boolean, { hidden: true });
  register(CoreParameterId.AnonymousNumber, CoreTypeIds.Number, { hidden: true });
  register(CoreParameterId.AnonymousString, CoreTypeIds.String, { hidden: true });
}
