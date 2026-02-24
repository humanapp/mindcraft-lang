import type { List } from "../../platform/list";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import type { StructFieldGetterFn, StructFieldSetterFn, StructSnapshotNativeFn } from "./vm";

// ----------------------------------------------------
// Type System
// ----------------------------------------------------

export type TypeId = string; // datatype identifier

// These are the "native" brain types. Concrete types are built atop these.
export enum NativeType {
  Unknown = -1,
  Void = 0,
  Nil = 1,
  Boolean = 2,
  Number = 3,
  String = 4,
  Enum = 5,
  List = 6,
  Map = 7,
  Struct = 8,
}

export function nativeTypeToString(coreType: NativeType): string {
  switch (coreType) {
    case NativeType.Unknown:
      return "unknown";
    case NativeType.Void:
      return "void";
    case NativeType.Nil:
      return "nil";
    case NativeType.Boolean:
      return "boolean";
    case NativeType.Number:
      return "number";
    case NativeType.String:
      return "string";
    case NativeType.Enum:
      return "enum";
    case NativeType.List:
      return "list";
    case NativeType.Map:
      return "map";
    case NativeType.Struct:
      return "struct";
    default:
      return "invalid";
  }
}

export interface TypeCodec {
  encode(w: IWriteStream, value: unknown): void;
  decode(r: IReadStream): unknown;
  stringify(value: unknown): string;
}

export interface TypeDef {
  coreType: NativeType;
  typeId: TypeId;
  codec: TypeCodec;
  name: string;
}

export interface EnumTypeShape {
  symbols: List<{ key: string; label: string; deprecated?: boolean }>;
  defaultKey: string;
}

export type EnumTypeDef = TypeDef & EnumTypeShape;

export interface ListTypeShape {
  elementTypeId: TypeId;
}

export type ListTypeDef = TypeDef & ListTypeShape;

export interface MapTypeShape {
  valueTypeId: TypeId;
}

export type MapTypeDef = TypeDef & MapTypeShape;

export interface StructTypeShape {
  fields: List<{
    name: string;
    typeId: TypeId;
  }>;
  /** If provided, GET_FIELD delegates to this instead of Dict lookup. */
  fieldGetter?: StructFieldGetterFn;
  /** If provided, SET_FIELD delegates to this instead of Dict mutation. */
  fieldSetter?: StructFieldSetterFn;
  /**
   * If provided, called during deep-copy (assignment) to materialize the `native` handle.
   * Use this for native structs whose `native` is a lazy resolver (e.g., a function)
   * that must be evaluated and captured at assignment time.
   * Returns the resolved native value to store in the copy.
   */
  snapshotNative?: StructSnapshotNativeFn;
}

export type StructTypeDef = TypeDef & StructTypeShape;

export interface ITypeRegistry {
  get(id: TypeId): TypeDef | undefined;
  addVoidType(name: string): TypeId;
  addNilType(name: string): TypeId;
  addBooleanType(name: string): TypeId;
  addNumberType(name: string): TypeId;
  addStringType(name: string): TypeId;
  addEnumType(name: string, shape: EnumTypeShape): TypeId;
  addListType(name: string, shape: ListTypeShape): TypeId;
  addMapType(name: string, shape: MapTypeShape): TypeId;
  addStructType(name: string, shape: StructTypeShape): TypeId;
}
