import { Error } from "../../platform/error";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import { StringUtils as SU } from "../../platform/string";
import { fourCC } from "../../primitives";
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
import { BrainTileDefBase, BrainTileDefBase_deserializeHeader } from "../model/tiledef";

export interface VariableTileJson {
  version: number;
  kind: "variable";
  tileId: string;
  varName: string;
  varType: string;
  uniqueId: string;
}

import type { BrainServices } from "../services";
import { getBrainServices } from "../services";
import { BrainTileFactoryDef } from "./factories";

// Current serialization version -- shared by both binary and JSON codepaths.
const kVersion = 1;

const STags = {
  BVAR: fourCC("BVAR"), // Brain variable tile chunk
};

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

  // -- JSON serialization (parallel to binary below) -------------------------

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

  static fromJson(json: VariableTileJson, catalog: ITileCatalog): BrainTileVariableDef {
    if (json.version !== kVersion) {
      throw new Error(`BrainTileVariableDef.fromJson: unsupported version ${json.version}`);
    }
    if (catalog.has(json.tileId)) return catalog.get(json.tileId) as BrainTileVariableDef;
    const tileDef = getBrainServices().tileBuilder.createVariableTileDef(
      json.tileId,
      json.varName,
      json.varType as TypeId,
      json.uniqueId,
      {}
    );
    catalog.registerTileDef(tileDef);
    return tileDef as BrainTileVariableDef;
  }

  // -- Binary serialization ---------------------------------------------------

  serialize(stream: IWriteStream): void {
    super.serialize(stream);
    stream.pushChunk(STags.BVAR, kVersion);
    stream.writeString(this.varName);
    stream.writeString(this.varType);
    stream.writeString(this.uniqueId);
    stream.popChunk();
  }
}

export function BrainTileVariableDef_deserialize(stream: IReadStream, catalog: ITileCatalog): BrainTileVariableDef {
  const { kind, tileId } = BrainTileDefBase_deserializeHeader(stream);
  if (kind !== "variable") {
    throw new Error(`BrainTileVariableDef.deserialize: invalid kind ${kind}`);
  }
  const version = stream.enterChunk(STags.BVAR);
  if (version !== kVersion) {
    throw new Error(`BrainTileVariableDef.deserialize: unsupported version ${version}`);
  }
  const varName = stream.readString();
  const varType = stream.readString();
  const uniqueId = stream.readString();
  stream.leaveChunk();
  let tileDef = catalog.get(tileId) as BrainTileVariableDef | undefined;
  if (tileDef && tileDef.kind === "variable") {
    // validate var matches
    if (tileDef.varName !== varName || tileDef.varType !== varType || tileDef.uniqueId !== uniqueId) {
      throw new Error(`BrainTileVariableDef.deserialize: variable definition mismatch for tileId ${tileId}`);
    }
    return tileDef as BrainTileVariableDef;
  }
  tileDef = new BrainTileVariableDef(tileId, varName, varType, uniqueId);
  catalog.registerTileDef(tileDef);
  return tileDef;
}

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

export function registerCoreVariableFactoryTileDefs(services: BrainServices) {
  registerVariableFactoryTileDef(CoreVariableFactoryId.Boolean, CoreTypeIds.Boolean, {}, services);
  registerVariableFactoryTileDef(CoreVariableFactoryId.Number, CoreTypeIds.Number, {}, services);
  registerVariableFactoryTileDef(CoreVariableFactoryId.String, CoreTypeIds.String, {}, services);
}
