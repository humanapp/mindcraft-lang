import type { List } from "../../platform/list";
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
  Any = 9,
  Union = 10,
  Function = 11,
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
    case NativeType.Any:
      return "any";
    case NativeType.Union:
      return "union";
    case NativeType.Function:
      return "function";
    default:
      return "invalid";
  }
}

export interface TypeCodec {
  stringify(value: unknown): string;
}

export interface TypeDef {
  coreType: NativeType;
  typeId: TypeId;
  codec: TypeCodec;
  name: string;
  nullable?: boolean;
  autoInstantiated?: boolean;
}

export type EnumPrimitiveValue = string | number;

export interface EnumSymbolDef {
  key: string;
  label: string;
  value: EnumPrimitiveValue;
  deprecated?: boolean;
}

export interface EnumTypeShape {
  symbols: List<EnumSymbolDef>;
  defaultKey?: string;
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

export interface StructMethodDecl {
  name: string;
  params: List<{ name: string; typeId: TypeId }>;
  returnTypeId: TypeId;
  isAsync?: boolean;
}

export interface StructTypeShape {
  fields: List<{
    name: string;
    typeId: TypeId;
  }>;
  /** If true, the struct requires exact TypeId match (no structural subtyping). */
  nominal?: boolean;
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
  methods?: List<StructMethodDecl>;
}

export type StructTypeDef = TypeDef & StructTypeShape;

export interface NullableTypeShape {
  baseTypeId: TypeId;
}

export type NullableTypeDef = TypeDef & NullableTypeShape;

export interface UnionTypeShape {
  memberTypeIds: List<TypeId>;
}

export type UnionTypeDef = TypeDef & UnionTypeShape;

export interface FunctionTypeShape {
  paramTypeIds: List<TypeId>;
  returnTypeId: TypeId;
}

export type FunctionTypeDef = TypeDef & FunctionTypeShape;

export interface TypeConstructor {
  name: string;
  arity: number;
  coreType: NativeType;
  construct(registry: ITypeRegistry, args: List<TypeId>): TypeDef;
}

export interface ITypeRegistry {
  get(id: TypeId): TypeDef | undefined;
  getEnumSymbol(typeId: TypeId, key: string): EnumSymbolDef | undefined;
  resolveByName(name: string): TypeId | undefined;
  entries(): Iterable<[TypeId, TypeDef]>;
  addVoidType(name: string): TypeId;
  addNilType(name: string): TypeId;
  addBooleanType(name: string): TypeId;
  addNumberType(name: string): TypeId;
  addStringType(name: string): TypeId;
  addEnumType(name: string, shape: EnumTypeShape): TypeId;
  addListType(name: string, shape: ListTypeShape): TypeId;
  addMapType(name: string, shape: MapTypeShape): TypeId;
  addStructType(name: string, shape: StructTypeShape): TypeId;
  reserveStructType(name: string): TypeId;
  finalizeStructType(typeId: TypeId, shape: StructTypeShape): void;
  addStructMethods(typeId: TypeId, methods: List<StructMethodDecl>): void;
  addAnyType(name: string): TypeId;
  addFunctionType(name: string): TypeId;
  addNullableType(baseTypeId: TypeId): TypeId;
  registerConstructor(ctor: TypeConstructor): void;
  instantiate(constructorName: string, args: List<TypeId>): TypeId;
  getOrCreateUnionType(memberTypeIds: List<TypeId>): TypeId;
  getOrCreateFunctionType(shape: FunctionTypeShape): TypeId;
  isStructurallyCompatible(sourceTypeId: TypeId, targetTypeId: TypeId): boolean;
  removeUserTypes(): void;
}
