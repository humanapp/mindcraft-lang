import type { List } from "../../platform/list";
import type { StructFieldGetterFn, StructFieldSetterFn, StructSnapshotNativeFn } from "./vm";

// ----------------------------------------------------
// Type System
// ----------------------------------------------------

/** Datatype identifier (e.g. `"number:<int>"`). Build with {@link mkTypeId}. */
export type TypeId = string;

/** Native runtime types the brain VM understands. Concrete types are built atop these. */
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

/** Stable lower-case name for a {@link NativeType} (e.g. `NativeType.Number` -> `"number"`). */
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

/** String/JSON formatter for runtime values of a registered type. */
export interface TypeCodec {
  stringify(value: unknown): string;
}

/** Common fields shared by every registered type definition. */
export interface TypeDef {
  coreType: NativeType;
  typeId: TypeId;
  codec: TypeCodec;
  name: string;
  nullable?: boolean;
  autoInstantiated?: boolean;
}

/** Primitive value backing an {@link EnumSymbolDef}. */
export type EnumPrimitiveValue = string | number;

/** A single symbol within an enum type. */
export interface EnumSymbolDef {
  key: string;
  label: string;
  value: EnumPrimitiveValue;
  deprecated?: boolean;
}

/** Shape fields specific to enum types. */
export interface EnumTypeShape {
  symbols: List<EnumSymbolDef>;
  defaultKey?: string;
}

/** A registered enum type. */
export type EnumTypeDef = TypeDef & EnumTypeShape;

/** Shape fields specific to list types. */
export interface ListTypeShape {
  elementTypeId: TypeId;
}

/** A registered list type. */
export type ListTypeDef = TypeDef & ListTypeShape;

/** Shape fields specific to map types. */
export interface MapTypeShape {
  keyTypeId: TypeId;
  valueTypeId: TypeId;
}

/** A registered map type. */
export type MapTypeDef = TypeDef & MapTypeShape;

/** Declaration of a method callable on instances of a struct type. */
export interface StructMethodDecl {
  name: string;
  params: List<{ name: string; typeId: TypeId }>;
  returnTypeId: TypeId;
  isAsync?: boolean;
}

/**
 * Field definition supplied at struct registration. The registry assigns
 * a stable {@link StructFieldDef.fieldIndex} when storing it.
 */
export interface StructFieldInput {
  readonly name: string;
  readonly typeId: TypeId;
  readonly readOnly?: boolean;
}

/**
 * Stored field definition on a registered {@link StructTypeDef}. The
 * {@link fieldIndex} is the field's stable, zero-based position in
 * {@link StructTypeDef.fields}; `fields.get(i).fieldIndex === i` for every
 * registered closed struct, and consumers may treat `fieldIndex` as a stable
 * id for indexed access (e.g. the V3.3 `STRUCT_GET_FIELD` opcode).
 */
export interface StructFieldDef extends StructFieldInput {
  readonly fieldIndex: number;
}

/** Shape fields specific to struct types. */
export interface StructTypeShape {
  fields: List<StructFieldInput>;
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
  /** If provided, struct methods callable via HOST_CALL_ARGS on instances of this type. */
  methods?: List<StructMethodDecl>;
}

/**
 * A registered struct type. Differs from {@link StructTypeShape} by storing
 * fields as {@link StructFieldDef} (with assigned {@link StructFieldDef.fieldIndex}).
 */
export interface StructTypeDef extends TypeDef, Omit<StructTypeShape, "fields"> {
  fields: List<StructFieldDef>;
}

/** Shape fields specific to nullable types. */
export interface NullableTypeShape {
  baseTypeId: TypeId;
}

/** A registered nullable wrapper around `baseTypeId`. */
export type NullableTypeDef = TypeDef & NullableTypeShape;

/** Shape fields specific to union types. */
export interface UnionTypeShape {
  memberTypeIds: List<TypeId>;
}

/** A registered union of `memberTypeIds`. */
export type UnionTypeDef = TypeDef & UnionTypeShape;

/** Shape fields specific to function types: parameter and return type ids. */
export interface FunctionTypeShape {
  paramTypeIds: List<TypeId>;
  returnTypeId: TypeId;
}

/** A registered function type. */
export type FunctionTypeDef = TypeDef & FunctionTypeShape;

/** Constructor for parameterized type families (e.g. `List<T>`). Registered via {@link ITypeRegistry.registerConstructor}. */
export interface TypeConstructor {
  name: string;
  arity: number;
  coreType: NativeType;
  construct(registry: ITypeRegistry, args: List<TypeId>): TypeDef;
}

/** Mutable registry of {@link TypeDef}s, keyed by {@link TypeId} and resolvable by name. */
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
  addStructFields(typeId: TypeId, fields: List<StructFieldInput>, fieldGetter?: StructFieldGetterFn): void;
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
