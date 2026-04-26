import { Error } from "../../platform/error";
import { StringUtils as SU } from "../../platform/string";
import {
  type BrainTileDefCreateOptions,
  CoreTypeIds,
  CoreVariableFactoryId,
  type ITileCatalog,
  mkVariableFactoryTileId,
  mkVariableTileId,
  type TileId,
  TilePlacement,
  type TypeId,
} from "../interfaces";
import { BrainTileDefBase } from "../model/tiledef";

/** Serialized form of a {@link BrainTileVariableDef}. */
export interface VariableTileJson {
  version: number;
  kind: "variable";
  tileId: string;
  varName: string;
  varType: string;
  uniqueId: string;
}

import type { BrainServices } from "../services";
import { BrainTileFactoryDef } from "./factories";

// Current serialization version.
const kVersion = 1;

/** Tile definition representing a named variable read/write. Backs `Variable` tiles in the catalog. */
export class BrainTileVariableDef extends BrainTileDefBase {
  readonly kind = "variable";
  readonly varName: string;
  readonly varType: TypeId;
  readonly uniqueId: string;

  constructor(
    tileId: TileId,
    varName: string,
    varType: TypeId,
    uniqueId: string,
    opts: BrainTileDefCreateOptions = {}
  ) {
    if (opts.placement === undefined) opts.placement = TilePlacement.EitherSide;
    if (opts.persist === undefined) opts.persist = true;
    super(tileId, opts);
    this.varName = varName;
    this.varType = varType;
    this.uniqueId = uniqueId;
  }

  // -- JSON serialization ----------------------------------------------------

  toJson(): VariableTileJson {
    return {
      version: kVersion,
      kind: "variable",
      tileId: this.tileId,
      varName: this.varName,
      varType: this.varType,
      uniqueId: this.uniqueId,
    };
  }

  static fromJson(json: VariableTileJson, catalog: ITileCatalog, _services?: BrainServices): BrainTileVariableDef {
    if (json.version !== kVersion) {
      throw new Error(`BrainTileVariableDef.fromJson: unsupported version ${json.version}`);
    }
    if (catalog.has(json.tileId)) return catalog.get(json.tileId) as BrainTileVariableDef;
    const tileDef = new BrainTileVariableDef(json.tileId, json.varName, json.varType as TypeId, json.uniqueId, {});
    catalog.registerTileDef(tileDef);
    return tileDef as BrainTileVariableDef;
  }
}

/** Build a factory tile that manufactures new {@link BrainTileVariableDef}s of `producedDataType`. */
export function createVariableFactoryTileDef(
  factoryId: string,
  producedDataType: TypeId,
  opts: BrainTileDefCreateOptions = {}
): BrainTileFactoryDef {
  return new BrainTileFactoryDef(
    mkVariableFactoryTileId(factoryId),
    factoryId,
    manufactureVarTileDef,
    producedDataType,
    opts
  );
}

/** Build {@link createVariableFactoryTileDef} and register it with `services`. */
export function registerVariableFactoryTileDef(
  factoryId: string,
  producedDataType: TypeId,
  opts: BrainTileDefCreateOptions = {},
  services: BrainServices
) {
  services.tiles.registerTileDef(createVariableFactoryTileDef(factoryId, producedDataType, opts));
}

function manufactureVarTileDef(
  factoryTileDef: BrainTileFactoryDef,
  opts: { [key: string]: unknown }
): BrainTileVariableDef {
  const uniqueId = SU.mkid();
  const varName: string = (opts.name ? opts.name : uniqueId) as string;
  const varType: TypeId = (factoryTileDef.producedDataType as TypeId) || CoreTypeIds.Unknown;
  const tileDef = new BrainTileVariableDef(mkVariableTileId(uniqueId), varName, varType, uniqueId);
  return tileDef;
}

/** Register the built-in variable factories for `Boolean`, `Number`, and `String` types. */
export function registerCoreVariableFactoryTileDefs(services: BrainServices) {
  registerVariableFactoryTileDef(CoreVariableFactoryId.Boolean, CoreTypeIds.Boolean, {}, services);
  registerVariableFactoryTileDef(CoreVariableFactoryId.Number, CoreTypeIds.Number, {}, services);
  registerVariableFactoryTileDef(CoreVariableFactoryId.String, CoreTypeIds.String, {}, services);
}
