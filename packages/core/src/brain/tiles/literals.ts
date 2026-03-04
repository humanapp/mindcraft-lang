import { Error } from "../../platform/error";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import { fourCC } from "../../primitives";
import {
  type BrainTileDefCreateOptions,
  type BrainTileLiteralDefOptions,
  CoreLiteralFactoryId,
  CoreTypeIds,
  type ITileCatalog,
  type LiteralDisplayFormat,
  LiteralDisplayFormats,
  mkLiteralFactoryTileId,
  mkLiteralTileId,
  TilePlacement,
  type TypeCodec,
  type TypeId,
} from "../interfaces";
import { BrainTileDefBase, BrainTileDefBase_deserializeHeader } from "../model/tiledef";
import { getBrainServices } from "../services";
import { BrainTileFactoryDef } from "./factories";

const STags = {
  BLIT: fourCC("BLIT"), // Brain literal tile chunk
};

export class BrainTileLiteralDef extends BrainTileDefBase {
  readonly kind = "literal";
  readonly valueLabel: string;
  readonly valueType: TypeId;
  readonly value: unknown;
  readonly displayFormat: LiteralDisplayFormat;

  constructor(valueType: TypeId, value: unknown, opts: BrainTileLiteralDefOptions = {}) {
    if (opts.placement === undefined) opts.placement = TilePlacement.EitherSide;
    if (opts.persist === undefined) opts.persist = true;
    const typeDef = getBrainServices().types.get(valueType);
    if (!typeDef) {
      throw new Error(`BrainTileLiteralDef.deserialize: unknown value type ${valueType}`);
    }
    const valueStr = opts.valueLabel || (typeDef.codec as TypeCodec).stringify(value);
    const fmt = opts.displayFormat || LiteralDisplayFormats.Default;
    const tileId = mkLiteralTileId(valueType, valueStr, fmt);
    super(tileId, opts);
    this.valueType = valueType;
    this.value = value;
    this.valueLabel = valueStr;
    this.displayFormat = fmt;
  }

  serialize(stream: IWriteStream): void {
    const typeDef = getBrainServices().types.get(this.valueType);
    if (!typeDef) {
      throw new Error(`BrainTileLiteralDef.serialize: unknown value type ${this.valueType}`);
    }
    super.serialize(stream);
    stream.pushChunk(STags.BLIT, 2);
    stream.writeString(this.valueType);
    (typeDef.codec as TypeCodec).encode(stream, this.value);
    stream.writeString(this.valueLabel);
    stream.writeString(this.displayFormat);
    stream.popChunk();
  }
}

export function BrainTileLiteralDef_deserialize(stream: IReadStream, catalog: ITileCatalog): BrainTileLiteralDef {
  const { kind, tileId } = BrainTileDefBase_deserializeHeader(stream);
  if (kind !== "literal") {
    throw new Error(`BrainTileLiteralDef.deserialize: invalid kind ${kind}`);
  }
  const version = stream.enterChunk(STags.BLIT);
  if (version !== 1 && version !== 2) {
    throw new Error(`BrainTileLiteralDef.deserialize: unsupported version ${version}`);
  }
  const valueType = stream.readString();
  const typeEntry = getBrainServices().types.get(valueType);
  if (!typeEntry) {
    throw new Error(`BrainTileLiteralDef.deserialize: unknown value type ${valueType}`);
  }
  const value = typeEntry.codec.decode(stream);
  const valueLabel = stream.readString();
  const displayFormat: LiteralDisplayFormat = version >= 2 ? stream.readString() : LiteralDisplayFormats.Default;
  stream.leaveChunk();

  let tileDef = catalog.get(tileId) as BrainTileLiteralDef | undefined;
  if (tileDef && tileDef.kind === "literal") {
    return tileDef as BrainTileLiteralDef;
  }
  tileDef = new BrainTileLiteralDef(valueType, value, { valueLabel, displayFormat });
  catalog.registerTileDef(tileDef);
  return tileDef;
}

export function registerLiteralFactoryTileDef(
  factoryId: string,
  producedDataType: TypeId,
  opts: BrainTileDefCreateOptions = {}
) {
  const tileDef = new BrainTileFactoryDef(
    mkLiteralFactoryTileId(factoryId),
    factoryId,
    manufactureLiteralTileDef,
    producedDataType,
    opts
  );
  getBrainServices().tiles.registerTileDef(tileDef);
}

function manufactureLiteralTileDef(
  factoryTileDef: BrainTileFactoryDef,
  opts: { [key: string]: unknown }
): BrainTileLiteralDef {
  const varValue = opts.value;
  if (varValue === undefined) {
    throw new Error("Literal factory tile definition requires a 'value' option");
  }
  const varType: TypeId = (factoryTileDef.producedDataType as TypeId) || CoreTypeIds.Void;
  const displayFormat = opts.displayFormat as LiteralDisplayFormat | undefined;
  const tileDef = new BrainTileLiteralDef(varType, varValue, { displayFormat });
  return tileDef;
}

export function registerCoreLiteralFactoryTileDefs() {
  const tiles = getBrainServices().tiles;
  // --------------------------------------------------------------
  // Literal Factories
  registerLiteralFactoryTileDef(CoreLiteralFactoryId.Number, CoreTypeIds.Number);
  registerLiteralFactoryTileDef(CoreLiteralFactoryId.String, CoreTypeIds.String);
  // --------------------------------------------------------------
  // Well-known Literals
  const trueTileDef = new BrainTileLiteralDef(CoreTypeIds.Boolean, true, { persist: false });
  const falseTileDef = new BrainTileLiteralDef(CoreTypeIds.Boolean, false, { persist: false });
  const nilTileDef = new BrainTileLiteralDef(CoreTypeIds.Nil, undefined, { persist: false });
  tiles.registerTileDef(trueTileDef);
  tiles.registerTileDef(falseTileDef);
  tiles.registerTileDef(nilTileDef);
}
