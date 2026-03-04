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
  NativeType,
  TilePlacement,
  type TypeCodec,
  type TypeDef,
  type TypeId,
} from "../interfaces";
import { BrainTileDefBase, BrainTileDefBase_deserializeHeader } from "../model/tiledef";

export interface LiteralTileJson {
  version: number;
  kind: "literal";
  tileId: string;
  valueType: string;
  value: unknown;
  valueLabel: string;
  displayFormat: string;
}

import { getBrainServices } from "../services";
import { BrainTileFactoryDef } from "./factories";

// Current serialization version -- shared by both binary and JSON codepaths.
// v1: initial binary format
// v2: added displayFormat
const kVersion = 2;

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

  // -- JSON serialization (parallel to binary below) -------------------------

  toJson(): LiteralTileJson {
    const typeDef = getBrainServices().types.get(this.valueType);
    if (!typeDef) {
      throw new Error(`BrainTileLiteralDef.toJson: unknown value type ${this.valueType}`);
    }
    return {
      version: kVersion,
      kind: "literal",
      tileId: this.tileId,
      valueType: this.valueType,
      value: literalValueToJson(typeDef, this.value),
      valueLabel: this.valueLabel,
      displayFormat: this.displayFormat,
    };
  }

  static fromJson(json: LiteralTileJson, catalog: ITileCatalog): BrainTileLiteralDef {
    if (json.version !== kVersion) {
      throw new Error(`BrainTileLiteralDef.fromJson: unsupported version ${json.version}`);
    }
    if (catalog.has(json.tileId)) return catalog.get(json.tileId) as BrainTileLiteralDef;
    const typeDef = getBrainServices().types.get(json.valueType as TypeId);
    if (!typeDef) {
      throw new Error(`BrainTileLiteralDef.fromJson: unknown value type ${json.valueType}`);
    }
    const value = literalValueFromJson(typeDef, json.value);
    const tileDef = getBrainServices().tileBuilder.createLiteralTileDef(json.valueType as TypeId, value, {
      valueLabel: json.valueLabel,
      displayFormat: json.displayFormat,
    });
    catalog.registerTileDef(tileDef);
    return tileDef as BrainTileLiteralDef;
  }

  // -- Binary serialization ---------------------------------------------------

  serialize(stream: IWriteStream): void {
    const typeDef = getBrainServices().types.get(this.valueType);
    if (!typeDef) {
      throw new Error(`BrainTileLiteralDef.serialize: unknown value type ${this.valueType}`);
    }
    super.serialize(stream);
    stream.pushChunk(STags.BLIT, kVersion);
    stream.writeString(this.valueType);
    (typeDef.codec as TypeCodec).encode(stream, this.value);
    stream.writeString(this.valueLabel);
    stream.writeString(this.displayFormat);
    stream.popChunk();
  }
}

// -- Literal value helpers ---------------------------------------------------
// Convert between runtime values and their JSON-safe representations.

function literalValueToJson(typeDef: TypeDef, value: unknown): unknown {
  switch (typeDef.coreType) {
    case NativeType.Void:
    case NativeType.Nil:
      return undefined;
    case NativeType.Boolean:
    case NativeType.Number:
    case NativeType.String:
    case NativeType.Enum:
      return value;
    default:
      throw new Error(`literalValueToJson: unsupported coreType ${typeDef.coreType} (typeId: ${typeDef.typeId})`);
  }
}

function literalValueFromJson(typeDef: TypeDef, json: unknown): unknown {
  switch (typeDef.coreType) {
    case NativeType.Void:
    case NativeType.Nil:
      return undefined;
    case NativeType.Boolean:
    case NativeType.Number:
    case NativeType.String:
    case NativeType.Enum:
      return json;
    default:
      throw new Error(`literalValueFromJson: unsupported coreType ${typeDef.coreType} (typeId: ${typeDef.typeId})`);
  }
}

export function BrainTileLiteralDef_deserialize(stream: IReadStream, catalog: ITileCatalog): BrainTileLiteralDef {
  const { kind, tileId } = BrainTileDefBase_deserializeHeader(stream);
  if (kind !== "literal") {
    throw new Error(`BrainTileLiteralDef.deserialize: invalid kind ${kind}`);
  }
  const version = stream.enterChunk(STags.BLIT);
  if (version < 1 || version > kVersion) {
    throw new Error(`BrainTileLiteralDef.deserialize: unsupported version ${version}`);
  }
  const valueType = stream.readString();
  const typeEntry = getBrainServices().types.get(valueType);
  if (!typeEntry) {
    throw new Error(`BrainTileLiteralDef.deserialize: unknown value type ${valueType}`);
  }
  const value = typeEntry.codec.decode(stream);
  const valueLabel = stream.readString();
  const displayFormat: LiteralDisplayFormat = version >= kVersion ? stream.readString() : LiteralDisplayFormats.Default;
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
