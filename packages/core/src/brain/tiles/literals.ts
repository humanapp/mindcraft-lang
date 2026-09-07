import { Error } from "../../platform/error";
import {
  type BrainProgramValueJson,
  brainValueFromJson,
  brainValueToJson,
  CoreTypeIds,
  NativeType,
  type TypeCodec,
  type TypeDef,
  type TypeId,
  type Value,
} from "../../runtime";
import {
  type BrainTileDefCreateOptions,
  type BrainTileLiteralDefOptions,
  CoreLiteralFactoryId,
  type ITileCatalog,
  type ITileMetadata,
  type LiteralDisplayFormat,
  LiteralDisplayFormats,
  mkLiteralFactoryTileId,
  mkLiteralTileId,
  mkUniqueLiteralTileId,
  TilePlacement,
} from "../interfaces";
import { BrainTileDefBase } from "../model/tiledef";

/** Serialized form of a {@link BrainTileLiteralDef}. */
export interface LiteralTileJson {
  version: number;
  kind: "literal";
  tileId: string;
  valueType: string;
  value: unknown;
  valueLabel: string;
  displayFormat: string;
  /** The word the literal reads by; left out entirely by a literal carrying none. */
  displayName?: string;
  /** The literal's own identity; left out entirely by a literal whose id follows its content. */
  uniqueId?: string;
}

/**
 * The fields an edit of a unique-identity literal may change. A field left
 * undefined is carried over unchanged from the literal being edited.
 */
export interface BrainTileLiteralEdit {
  /** The runtime value the edited literal holds. */
  value?: unknown;
  /** The word the edited literal reads by. */
  displayName?: string;
}

import type { BrainServices } from "../services";
import { BrainTileFactoryDef } from "./factories";

// Current serialization version.
// v1: initial binary format
// v2: added displayFormat
const kVersion = 2;

/** The metadata a literal named `displayName` carries: the name as the tile's label and as its sentence form, over the fields `base` already holds. */
function namedLiteralMetadata(base: ITileMetadata | undefined, displayName: string): ITileMetadata {
  const metadata: ITileMetadata = base ? { ...base, label: displayName } : { label: displayName };
  metadata.language = base?.language ? { ...base.language, form: displayName } : { form: displayName };
  return metadata;
}

/** Tile definition for an immutable literal value of `valueType`, optionally formatted by {@link LiteralDisplayFormat}. */
export class BrainTileLiteralDef extends BrainTileDefBase {
  readonly kind = "literal";
  readonly valueLabel: string;
  readonly valueType: TypeId;
  readonly value: unknown;
  readonly displayFormat: LiteralDisplayFormat;
  /** The word this literal reads by, and undefined for one carrying no name. Set it with {@link BrainTileLiteralDef.setDisplayName}. */
  displayName?: string;
  /**
   * This literal's own identity, and undefined for one whose tile id follows
   * its content. Where it is set, the tile id derives from it alone.
   */
  readonly uniqueId?: string;
  private readonly services_: BrainServices;

  constructor(valueType: TypeId, value: unknown, opts: BrainTileLiteralDefOptions = {}, services: BrainServices) {
    if (opts.placement === undefined) opts.placement = TilePlacement.EitherSide;
    if (opts.persist === undefined) opts.persist = true;
    const typeDef = services.runtime.types.get(valueType);
    if (!typeDef) {
      throw new Error(`BrainTileLiteralDef: unknown value type ${valueType}`);
    }
    const valueStr = opts.valueLabel || opts.uniqueId || (typeDef.codec as TypeCodec).stringify(value);
    const fmt = opts.displayFormat || LiteralDisplayFormats.Default;
    const tileId =
      opts.uniqueId === undefined ? mkLiteralTileId(valueType, valueStr, fmt) : mkUniqueLiteralTileId(opts.uniqueId);
    if (opts.displayName !== undefined) {
      opts.metadata = namedLiteralMetadata(opts.metadata, opts.displayName);
    }
    super(tileId, opts);
    this.valueType = valueType;
    this.value = value;
    this.valueLabel = valueStr;
    this.displayFormat = fmt;
    this.displayName = opts.displayName;
    this.uniqueId = opts.uniqueId;
    this.services_ = services;
  }

  /**
   * A literal holding `edit`'s value and name under this literal's tile id,
   * value type, value label, and display format. A field `edit` leaves
   * undefined is carried over from this literal.
   *
   * Throws when this literal carries no unique identity.
   */
  edited(edit: BrainTileLiteralEdit): BrainTileLiteralDef {
    const uniqueId = this.uniqueId;
    if (uniqueId === undefined) {
      throw new Error(`BrainTileLiteralDef.edited: literal ${this.tileId} carries no unique identity`);
    }
    return new BrainTileLiteralDef(
      this.valueType,
      edit.value === undefined ? this.value : edit.value,
      {
        uniqueId,
        valueLabel: this.valueLabel,
        displayFormat: this.displayFormat,
        displayName: edit.displayName === undefined ? this.displayName : edit.displayName,
      },
      this.services_
    );
  }

  /**
   * Names this literal `displayName`, which becomes the word it reads by on
   * every surface: its `metadata.label` and its `metadata.language.form`. The
   * tile id is unchanged.
   */
  setDisplayName(displayName: string): void {
    this.displayName = displayName;
    this.metadata = namedLiteralMetadata(this.metadata, displayName);
  }

  // -- JSON serialization ----------------------------------------------------

  toJson(): LiteralTileJson {
    const typeDef = this.services_.runtime.types.get(this.valueType);
    if (!typeDef) {
      throw new Error(`BrainTileLiteralDef.toJson: unknown value type ${this.valueType}`);
    }
    const json: LiteralTileJson = {
      version: kVersion,
      kind: "literal",
      tileId: this.tileId,
      valueType: this.valueType,
      value: literalValueToJson(typeDef, this.value),
      valueLabel: this.valueLabel,
      displayFormat: this.displayFormat,
    };
    if (this.displayName !== undefined) json.displayName = this.displayName;
    if (this.uniqueId !== undefined) json.uniqueId = this.uniqueId;
    return json;
  }

  static fromJson(json: LiteralTileJson, catalog: ITileCatalog, services: BrainServices): BrainTileLiteralDef {
    if (json.version !== kVersion) {
      throw new Error(`BrainTileLiteralDef.fromJson: unsupported version ${json.version}`);
    }
    if (catalog.has(json.tileId)) return catalog.get(json.tileId) as BrainTileLiteralDef;
    const typeDef = services.runtime.types.get(json.valueType as TypeId);
    if (!typeDef) {
      throw new Error(`BrainTileLiteralDef.fromJson: unknown value type ${json.valueType}`);
    }
    const value = literalValueFromJson(typeDef, json.value);
    const tileDef = new BrainTileLiteralDef(
      json.valueType as TypeId,
      value,
      {
        valueLabel: json.valueLabel,
        displayFormat: json.displayFormat,
        displayName: json.displayName,
        uniqueId: json.uniqueId,
      },
      services
    );
    catalog.registerTileDef(tileDef);
    return tileDef as BrainTileLiteralDef;
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
    case NativeType.Struct:
    case NativeType.Buffer:
      return brainValueToJson(value as Value);
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
    case NativeType.Struct:
    case NativeType.Buffer:
      return brainValueFromJson(json as BrainProgramValueJson);
    default:
      throw new Error(`literalValueFromJson: unsupported coreType ${typeDef.coreType} (typeId: ${typeDef.typeId})`);
  }
}

/** Register a literal-value factory tile of `producedDataType` with `services`. */
export function registerLiteralFactoryTileDef(
  factoryId: string,
  producedDataType: TypeId,
  opts: BrainTileDefCreateOptions = {},
  services: BrainServices
) {
  const tileDef = new BrainTileFactoryDef(
    mkLiteralFactoryTileId(factoryId),
    factoryId,
    (factoryTileDef, opts) => manufactureLiteralTileDef(factoryTileDef, opts, services),
    producedDataType,
    opts
  );
  services.edit.tiles.registerTileDef(tileDef);
}

function manufactureLiteralTileDef(
  factoryTileDef: BrainTileFactoryDef,
  opts: { [key: string]: unknown },
  services: BrainServices
): BrainTileLiteralDef {
  const varValue = opts.value;
  if (varValue === undefined) {
    throw new Error("Literal factory tile definition requires a 'value' option");
  }
  const varType: TypeId = (factoryTileDef.producedDataType as TypeId) || CoreTypeIds.Void;
  const displayFormat = opts.displayFormat as LiteralDisplayFormat | undefined;
  const displayName = opts.displayName as string | undefined;
  const tileDef = new BrainTileLiteralDef(varType, varValue, { displayFormat, displayName }, services);
  return tileDef;
}

/** Register the built-in literal factories (`Number`, `String`) and well-known `true`/`false`/`nil` tiles. */
export function registerCoreLiteralFactoryTileDefs(services: BrainServices) {
  const tiles = services.edit.tiles;
  // --------------------------------------------------------------
  // Literal Factories
  registerLiteralFactoryTileDef(
    CoreLiteralFactoryId.Number,
    CoreTypeIds.Number,
    { metadata: { label: "create a number tile" } },
    services
  );
  registerLiteralFactoryTileDef(
    CoreLiteralFactoryId.String,
    CoreTypeIds.String,
    { metadata: { label: "create a text tile" } },
    services
  );
  // --------------------------------------------------------------
  // Well-known Literals
  const trueTileDef = new BrainTileLiteralDef(CoreTypeIds.Boolean, true, { persist: false }, services);
  const falseTileDef = new BrainTileLiteralDef(CoreTypeIds.Boolean, false, { persist: false }, services);
  const nilTileDef = new BrainTileLiteralDef(CoreTypeIds.Nil, undefined, { persist: false }, services);
  tiles.registerTileDef(trueTileDef);
  tiles.registerTileDef(falseTileDef);
  tiles.registerTileDef(nilTileDef);
}
