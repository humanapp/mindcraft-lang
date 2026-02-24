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
import { getBrainServices } from "../services";
import { BrainTileFactoryDef } from "./factories";

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

  serialize(stream: IWriteStream): void {
    super.serialize(stream);
    stream.pushChunk(STags.BVAR, 1);
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
  if (version !== 1) {
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

export function registerVariableFactoryTileDef(
  factoryId: string,
  producedDataType: TypeId,
  opts: BrainTileDefCreateOptions = {}
) {
  const tileDef = new BrainTileFactoryDef(
    mkVariableFactoryTileId(factoryId),
    factoryId,
    manufactureVarTileDef,
    producedDataType,
    opts
  );
  getBrainServices().tiles.registerTileDef(tileDef);
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

export function registerCoreVariableFactoryTileDefs() {
  registerVariableFactoryTileDef(CoreVariableFactoryId.Boolean, CoreTypeIds.Boolean);
  registerVariableFactoryTileDef(CoreVariableFactoryId.Number, CoreTypeIds.Number);
  registerVariableFactoryTileDef(CoreVariableFactoryId.String, CoreTypeIds.String);
}
