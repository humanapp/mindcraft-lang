import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List } from "../../platform/list";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import { StringUtils as SU } from "../../platform/string";
import { TypeUtils } from "../../platform/types";
import { UniqueSet } from "../../platform/uniqueset";
import {
  CoreOpId,
  CoreTypeIds,
  CoreTypeNames,
  type EnumPrimitiveValue,
  type EnumSymbolDef,
  type EnumTypeDef,
  type EnumTypeShape,
  type EnumValue,
  type ExecutionContext,
  type FunctionTypeDef,
  type FunctionTypeShape,
  type ITypeRegistry,
  type ListTypeDef,
  type ListTypeShape,
  type MapTypeDef,
  type MapTypeShape,
  type MapValue,
  mkBooleanValue,
  mkTypeId,
  NativeType,
  type NullableTypeDef,
  type StructMethodDecl,
  type StructTypeDef,
  type StructTypeShape,
  type TypeCodec,
  type TypeConstructor,
  type TypeDef,
  type TypeId,
  type UnionTypeDef,
} from "../interfaces";
import { getBrainServices, hasBrainServices } from "../services";

export class TypeRegistry implements ITypeRegistry {
  private defs = new Dict<TypeId, TypeDef>();
  private nameToId = new Dict<string, TypeId>();
  private constructors = new Dict<string, TypeConstructor>();
  private compatCache = new Dict<string, boolean>();

  private add(def: TypeDef) {
    if (this.defs.has(def.typeId)) {
      throw new Error(`Type with id ${def.typeId} is already registered`);
    }
    this.defs.set(def.typeId, def);
    this.nameToId.set(def.name, def.typeId);
  }

  private validateTypeName(name: string) {
    if (!name || SU.length(SU.trim(name)) === 0) {
      throw new Error(`Type name must be a non-empty string`);
    }
  }

  private validateTypeNotRegistered(typeId: TypeId) {
    if (this.defs.has(typeId)) {
      throw new Error(`Type with id ${typeId} is already registered`);
    }
  }

  getEnumSymbol(typeId: TypeId, key: string): EnumSymbolDef | undefined {
    const def = this.defs.get(typeId);
    if (!def || def.coreType !== NativeType.Enum) {
      return undefined;
    }
    return (def as EnumTypeDef).symbols.find((symbol) => symbol.key === key);
  }

  addVoidType(name: string): TypeId {
    this.validateTypeName(name);
    const typeId = mkTypeId(NativeType.Void, name);
    this.validateTypeNotRegistered(typeId);
    this.add({
      coreType: NativeType.Void,
      typeId,
      codec: new VoidCodec(),
      name,
    });
    return typeId;
  }

  addNilType(name: string): TypeId {
    this.validateTypeName(name);
    const typeId = mkTypeId(NativeType.Nil, name);
    this.validateTypeNotRegistered(typeId);
    this.add({
      coreType: NativeType.Nil,
      typeId,
      codec: new NilCodec(),
      name,
    });
    return typeId;
  }

  addBooleanType(name: string): TypeId {
    this.validateTypeName(name);
    const typeId = mkTypeId(NativeType.Boolean, name);
    this.validateTypeNotRegistered(typeId);
    this.add({
      coreType: NativeType.Boolean,
      typeId,
      codec: new BooleanCodec(),
      name,
    });
    return typeId;
  }

  addNumberType(name: string): TypeId {
    this.validateTypeName(name);
    const typeId = mkTypeId(NativeType.Number, name);
    this.validateTypeNotRegistered(typeId);
    this.add({
      coreType: NativeType.Number,
      typeId,
      codec: new NumberCodec(),
      name,
    });
    return typeId;
  }

  addStringType(name: string): TypeId {
    this.validateTypeName(name);
    const typeId = mkTypeId(NativeType.String, name);
    this.validateTypeNotRegistered(typeId);
    this.add({
      coreType: NativeType.String,
      typeId,
      codec: new StringCodec(),
      name,
    });
    return typeId;
  }

  addEnumType(name: string, shape: EnumTypeShape): TypeId {
    this.validateTypeName(name);
    const typeId = mkTypeId(NativeType.Enum, name);
    this.validateTypeNotRegistered(typeId);
    const symbols = normalizeEnumSymbols(typeId, shape.symbols);
    // Verify defaultKey exists
    if (!symbols.find((symbol) => symbol.key === shape.defaultKey)) {
      throw new Error(`Enum type ${typeId} has invalid defaultKey: ${shape.defaultKey}`);
    }
    // Register
    const enumTypeDef: EnumTypeDef = {
      coreType: NativeType.Enum,
      typeId,
      codec: new EnumCodec(symbols),
      name,
      symbols,
      defaultKey: shape.defaultKey,
    };
    this.add(enumTypeDef);
    this.registerEnumOperators(typeId);
    return typeId;
  }

  private registerEnumOperators(typeId: TypeId): void {
    if (!hasBrainServices()) return;
    const overloads = getBrainServices().operatorOverloads;
    overloads.binary(
      CoreOpId.EqualTo,
      typeId,
      typeId,
      CoreTypeIds.Boolean,
      {
        exec: (_ctx: ExecutionContext, args: MapValue) => {
          const a = args.v.get(0) as EnumValue;
          const b = args.v.get(1) as EnumValue;
          if (a.typeId !== typeId || b.typeId !== typeId) {
            return mkBooleanValue(false);
          }
          const lhs = this.getEnumSymbol(typeId, a.v);
          const rhs = this.getEnumSymbol(typeId, b.v);
          if (!lhs || !rhs) {
            return mkBooleanValue(false);
          }
          return mkBooleanValue(lhs.value === rhs.value);
        },
      },
      false
    );
    overloads.binary(
      CoreOpId.NotEqualTo,
      typeId,
      typeId,
      CoreTypeIds.Boolean,
      {
        exec: (_ctx: ExecutionContext, args: MapValue) => {
          const a = args.v.get(0) as EnumValue;
          const b = args.v.get(1) as EnumValue;
          if (a.typeId !== typeId || b.typeId !== typeId) {
            return mkBooleanValue(false);
          }
          const lhs = this.getEnumSymbol(typeId, a.v);
          const rhs = this.getEnumSymbol(typeId, b.v);
          if (!lhs || !rhs) {
            return mkBooleanValue(false);
          }
          return mkBooleanValue(lhs.value !== rhs.value);
        },
      },
      false
    );
  }

  addListType(name: string, shape: ListTypeShape): TypeId {
    this.validateTypeName(name);
    const typeId = mkTypeId(NativeType.List, name);
    this.validateTypeNotRegistered(typeId);
    const { elementTypeId } = shape;
    // Ensure element type exists
    if (!this.defs.has(elementTypeId)) {
      throw new Error(`${elementTypeId} is not a registered type`);
    }
    const elementTypeDef = this.get(elementTypeId);
    if (!elementTypeDef) {
      throw new Error(`${elementTypeId} is not a registered type`);
    }
    const listTypeDef: ListTypeDef = {
      coreType: NativeType.List,
      typeId,
      codec: new ListCodec(elementTypeDef.codec),
      name,
      ...shape,
    };
    this.add(listTypeDef);
    return typeId;
  }

  addMapType(name: string, shape: MapTypeShape): TypeId {
    this.validateTypeName(name);
    const typeId = mkTypeId(NativeType.Map, name);
    this.validateTypeNotRegistered(typeId);
    const { valueTypeId } = shape;
    const valueTypeDef = this.get(valueTypeId);
    // Ensure value type exists
    if (!valueTypeDef) {
      throw new Error(`${valueTypeId} is not a registered type`);
    }
    const mapTypeDef: MapTypeDef = {
      coreType: NativeType.Map,
      typeId,
      codec: new MapCodec(valueTypeDef.codec),
      name,
      ...shape,
    };
    this.add(mapTypeDef);
    return typeId;
  }

  addStructType(name: string, shape: StructTypeShape): TypeId {
    this.validateTypeName(name);
    const typeId = mkTypeId(NativeType.Struct, name);
    this.validateTypeNotRegistered(typeId);
    // Ensure no duplicate field names
    const fieldNames = new UniqueSet<string>();
    shape.fields.forEach((field) => {
      if (fieldNames.has(field.name)) {
        throw new Error(`Struct type ${typeId} has duplicate field name: ${field.name}`);
      }
      fieldNames.add(field.name);
    });
    // Ensure field types exist, and gather codecs
    const fieldCodecs = new Dict<string, TypeCodec>();
    shape.fields.forEach((field) => {
      const fieldTypeDef = this.get(field.typeId);
      if (!fieldTypeDef) {
        throw new Error(`Struct type ${typeId} has field ${field.name} with unknown type: ${field.typeId}`);
      }
      fieldCodecs.set(field.name, fieldTypeDef.codec);
    });

    const structTypeDef: StructTypeDef = {
      coreType: NativeType.Struct,
      typeId,
      codec: new StructCodec(fieldCodecs),
      name,
      ...shape,
    };
    this.add(structTypeDef);
    return typeId;
  }

  addStructMethods(typeId: TypeId, methods: List<StructMethodDecl>): void {
    const typeDef = this.get(typeId);
    if (!typeDef) {
      throw new Error(`Type ${typeId} not found`);
    }
    if (typeDef.coreType !== NativeType.Struct) {
      throw new Error(`Type ${typeId} is not a struct type`);
    }
    const structDef = typeDef as StructTypeDef;
    const existing = structDef.methods ?? List.empty<StructMethodDecl>();
    structDef.methods = existing.concat(methods);
  }

  addAnyType(name: string): TypeId {
    this.validateTypeName(name);
    const typeId = mkTypeId(NativeType.Any, name);
    this.validateTypeNotRegistered(typeId);
    this.add({
      coreType: NativeType.Any,
      typeId,
      codec: new AnyCodec(),
      name,
    });
    return typeId;
  }

  addFunctionType(name: string): TypeId {
    this.validateTypeName(name);
    const typeId = mkTypeId(NativeType.Function, name);
    this.validateTypeNotRegistered(typeId);
    this.add({
      coreType: NativeType.Function,
      typeId,
      codec: new FunctionCodec(),
      name,
    });
    return typeId;
  }

  addNullableType(baseTypeId: TypeId): TypeId {
    const baseDef = this.get(baseTypeId);
    if (!baseDef) {
      throw new Error(`${baseTypeId} is not a registered type`);
    }
    if (baseDef.nullable) {
      return baseTypeId;
    }
    const nullableName = `${baseDef.name}?`;
    const typeId = mkTypeId(baseDef.coreType, nullableName);
    if (this.defs.has(typeId)) {
      return typeId;
    }
    const nullableDef: NullableTypeDef = {
      coreType: baseDef.coreType,
      typeId,
      codec: new NullableCodec(baseDef.codec),
      name: nullableName,
      nullable: true,
      baseTypeId,
    };
    this.add(nullableDef);
    return typeId;
  }

  registerConstructor(ctor: TypeConstructor): void {
    if (this.constructors.has(ctor.name)) {
      throw new Error(`Type constructor '${ctor.name}' is already registered`);
    }
    this.constructors.set(ctor.name, ctor);
  }

  instantiate(constructorName: string, args: List<TypeId>): TypeId {
    const ctor = this.constructors.get(constructorName);
    if (!ctor) {
      throw new Error(`Unknown type constructor: ${constructorName}`);
    }
    if (args.size() !== ctor.arity) {
      throw new Error(
        `Type constructor '${constructorName}' expects ${SU.toString(ctor.arity)} argument(s), got ${SU.toString(args.size())}`
      );
    }
    const parts: string[] = [];
    args.forEach((a) => {
      parts.push(a);
    });
    const argsStr = parts.join(",");
    const constructedName = `${constructorName}<${argsStr}>`;
    const typeId = mkTypeId(ctor.coreType, constructedName);
    if (this.defs.has(typeId)) {
      return typeId;
    }
    const def = ctor.construct(this, args);
    def.typeId = typeId;
    def.name = constructedName;
    def.autoInstantiated = true;
    this.add(def);
    return typeId;
  }

  getOrCreateFunctionType(shape: FunctionTypeShape): TypeId {
    const parts: string[] = [];
    shape.paramTypeIds.forEach((pid) => {
      parts.push(pid);
    });
    const paramsStr = parts.join(",");
    const canonicalName = `Function<(${paramsStr})=>${shape.returnTypeId}>`;
    const typeId = mkTypeId(NativeType.Function, canonicalName);
    if (this.defs.has(typeId)) {
      return typeId;
    }
    const fnDef: FunctionTypeDef = {
      coreType: NativeType.Function,
      typeId,
      codec: new FunctionCodec(),
      name: canonicalName,
      autoInstantiated: true,
      paramTypeIds: shape.paramTypeIds,
      returnTypeId: shape.returnTypeId,
    };
    this.add(fnDef);
    return typeId;
  }

  getOrCreateUnionType(memberTypeIds: List<TypeId>): TypeId {
    const expanded = new List<string>();
    memberTypeIds.forEach((mid) => {
      const def = this.get(mid);
      if (!def) {
        throw new Error(`${mid} is not a registered type`);
      }
      if (def.coreType === NativeType.Union) {
        (def as UnionTypeDef).memberTypeIds.forEach((inner) => {
          expanded.push(inner);
        });
      } else if (def.nullable) {
        expanded.push((def as NullableTypeDef).baseTypeId);
        expanded.push(CoreTypeIds.Nil);
      } else {
        expanded.push(mid);
      }
    });

    const deduped = new UniqueSet<string>();
    expanded.forEach((id) => {
      deduped.add(id);
    });
    const sorted = List.from(deduped.toArray().sort());

    if (sorted.size() === 0) {
      throw new Error("Cannot create union type with zero members");
    }
    if (sorted.size() === 1) {
      return sorted.get(0)! as TypeId;
    }

    let hasNil = false;
    sorted.forEach((id) => {
      if (id === CoreTypeIds.Nil) {
        hasNil = true;
      }
    });
    // A two-member union where one member is Nil is canonicalized as a nullable
    // type (T?) rather than a full Union.
    if (sorted.size() === 2 && hasNil) {
      const first = sorted.get(0)!;
      const second = sorted.get(1)!;
      const otherTypeId = first === CoreTypeIds.Nil ? second : first;
      return this.addNullableType(otherTypeId as TypeId);
    }

    const nameParts: string[] = [];
    sorted.forEach((id) => {
      nameParts.push(id);
    });
    const name = nameParts.join(",");
    const typeId = mkTypeId(NativeType.Union, name);
    if (this.defs.has(typeId)) {
      return typeId;
    }

    const memberDefsList = new List<TypeDef>();
    const memberCodecsList = new List<TypeCodec>();
    const sortedTypeIds = new List<TypeId>();
    sorted.forEach((id) => {
      const def = this.get(id as TypeId);
      if (!def) {
        throw new Error(`${id} is not a registered type`);
      }
      memberDefsList.push(def);
      memberCodecsList.push(def.codec);
      sortedTypeIds.push(id as TypeId);
    });

    const unionDef: UnionTypeDef = {
      coreType: NativeType.Union,
      typeId,
      codec: new UnionCodec(sortedTypeIds, memberDefsList, memberCodecsList),
      name,
      autoInstantiated: true,
      memberTypeIds: sortedTypeIds,
    };
    this.add(unionDef);
    return typeId;
  }

  get(id: TypeId): TypeDef | undefined {
    return this.defs.get(id);
  }

  resolveByName(name: string): TypeId | undefined {
    return this.nameToId.get(name);
  }

  entries(): Iterable<[TypeId, TypeDef]> {
    return this.defs.entries().toArray();
  }

  removeUserTypes(): void {
    const toRemove = new List<TypeId>();
    this.defs.forEach((def) => {
      if (def.coreType !== NativeType.Struct) return;
      if (SU.indexOf(def.name, "::") < 0) return;
      toRemove.push(def.typeId);
    });
    toRemove.forEach((typeId) => {
      const def = this.defs.get(typeId);
      if (def) {
        this.nameToId.delete(def.name);
      }
      this.defs.delete(typeId);
    });
    if (toRemove.size() > 0) {
      this.compatCache = new Dict<string, boolean>();
    }
  }

  isStructurallyCompatible(sourceTypeId: TypeId, targetTypeId: TypeId): boolean {
    if (sourceTypeId === targetTypeId) return true;

    const cacheKey = `${sourceTypeId}|${targetTypeId}`;
    const cached = this.compatCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const result = this.checkStructurallyCompatible(sourceTypeId, targetTypeId);
    this.compatCache.set(cacheKey, result);
    return result;
  }

  private checkStructurallyCompatible(sourceTypeId: TypeId, targetTypeId: TypeId): boolean {
    const sourceDef = this.get(sourceTypeId);
    const targetDef = this.get(targetTypeId);
    if (!sourceDef || !targetDef) return false;
    if (sourceDef.coreType !== NativeType.Struct || targetDef.coreType !== NativeType.Struct) return false;

    const sourceStruct = sourceDef as StructTypeDef;
    const targetStruct = targetDef as StructTypeDef;

    if (sourceStruct.nominal || targetStruct.nominal) return false;

    // Target-subset rule: every field the target declares must exist in the source
    // with a compatible type. The source may have additional fields; that is allowed.
    let compatible = true;
    targetStruct.fields.forEach((targetField) => {
      if (!compatible) return;
      let found = false;
      sourceStruct.fields.forEach((sourceField) => {
        if (sourceField.name === targetField.name) {
          found = true;
          if (sourceField.typeId !== targetField.typeId) {
            if (!this.isStructurallyCompatible(sourceField.typeId, targetField.typeId)) {
              compatible = false;
            }
          }
        }
      });
      if (!found) {
        compatible = false;
      }
    });

    return compatible;
  }
}

// ----------------------------------------------------
// Register core types

export function registerCoreTypes() {
  const typeRegistry = getBrainServices().types;
  typeRegistry.addVoidType(CoreTypeNames.Void);
  typeRegistry.addNilType(CoreTypeNames.Nil);
  typeRegistry.addBooleanType(CoreTypeNames.Boolean);
  typeRegistry.addNumberType(CoreTypeNames.Number);
  typeRegistry.addStringType(CoreTypeNames.String);
  typeRegistry.addAnyType(CoreTypeNames.Any);
  typeRegistry.addFunctionType(CoreTypeNames.Function);
  typeRegistry.addListType("AnyList", { elementTypeId: mkTypeId(NativeType.Any, CoreTypeNames.Any) });
  typeRegistry.registerConstructor(new ListConstructor());
  typeRegistry.registerConstructor(new MapConstructor());
}

// ----------------------------------------------------
// Codecs

class VoidCodec implements TypeCodec {
  encode(w: IWriteStream, value: undefined): void {
    // No-op
  }
  decode(r: IReadStream): void {
    return;
  }
  stringify(value: undefined): string {
    return "void";
  }
}

class NilCodec implements TypeCodec {
  encode(w: IWriteStream, value: undefined): void {
    // No-op
  }
  decode(r: IReadStream): undefined {
    return undefined;
  }
  stringify(value: undefined): string {
    return "nil";
  }
}

class BooleanCodec implements TypeCodec {
  encode(w: IWriteStream, value: boolean): void {
    w.writeBool(value);
  }
  decode(r: IReadStream): boolean {
    return r.readBool();
  }
  stringify(value: boolean): string {
    return SU.toString(value);
  }
}

class NumberCodec implements TypeCodec {
  encode(w: IWriteStream, value: number): void {
    w.writeF64(value);
  }
  decode(r: IReadStream): number {
    return r.readF64();
  }
  stringify(value: number): string {
    return SU.toString(value);
  }
}

class StringCodec implements TypeCodec {
  encode(w: IWriteStream, value: string): void {
    w.writeString(value);
  }
  decode(r: IReadStream): string {
    return r.readString();
  }
  stringify(value: string): string {
    return value;
  }
}

class AnyCodec implements TypeCodec {
  encode(w: IWriteStream, value: unknown): void {
    if (value === undefined) {
      w.writeU8(NativeType.Nil);
      return;
    }
    if (TypeUtils.isBoolean(value)) {
      w.writeU8(NativeType.Boolean);
      w.writeBool(value);
      return;
    }
    if (TypeUtils.isNumber(value)) {
      w.writeU8(NativeType.Number);
      w.writeF64(value);
      return;
    }
    if (TypeUtils.isString(value)) {
      w.writeU8(NativeType.String);
      w.writeString(value);
      return;
    }
    throw new Error("AnyCodec: unsupported value type");
  }
  decode(r: IReadStream): unknown {
    const tag = r.readU8();
    switch (tag) {
      case NativeType.Nil:
        return undefined;
      case NativeType.Boolean:
        return r.readBool();
      case NativeType.Number:
        return r.readF64();
      case NativeType.String:
        return r.readString();
      default:
        throw new Error(`AnyCodec: unsupported type tag ${SU.toString(tag)}`);
    }
  }
  stringify(value: unknown): string {
    if (value === undefined) {
      return "nil";
    }
    if (TypeUtils.isBoolean(value)) {
      return SU.toString(value);
    }
    if (TypeUtils.isNumber(value)) {
      return SU.toString(value);
    }
    if (TypeUtils.isString(value)) {
      return value;
    }
    return "unknown";
  }
}

class FunctionCodec implements TypeCodec {
  encode(_w: IWriteStream, _value: unknown): void {
    throw new Error("Function values cannot be serialized");
  }
  decode(_r: IReadStream): unknown {
    throw new Error("Function values cannot be deserialized");
  }
  stringify(value: unknown): string {
    if (value !== undefined) {
      const v = value as { funcId?: number };
      if (v.funcId !== undefined) {
        return `<function:${SU.toString(v.funcId)}>`;
      }
    }
    return "<function>";
  }
}

class EnumCodec implements TypeCodec {
  constructor(private readonly symbols: List<EnumSymbolDef>) {}
  encode(w: IWriteStream, value: string): void {
    w.writeString(value);
  }
  decode(r: IReadStream): string {
    const key = r.readString();
    const symbol = findEnumSymbol(this.symbols, key);
    if (!symbol) {
      throw new Error(`Unknown enum key: ${key}`);
    }
    return key;
  }
  stringify(value: string): string {
    const symbol = findEnumSymbol(this.symbols, value);
    if (!symbol) {
      return value;
    }
    return stringifyEnumPrimitiveValue(symbol.value);
  }
}

function normalizeEnumSymbols(typeId: TypeId, rawSymbols: List<EnumSymbolDef>): List<EnumSymbolDef> {
  const keySet = new UniqueSet<string>();
  const symbols = new List<EnumSymbolDef>();
  let expectedValueType: NativeType.String | NativeType.Number | undefined;

  rawSymbols.forEach((rawSymbol) => {
    if (keySet.has(rawSymbol.key)) {
      throw new Error(`Enum type ${typeId} has duplicate key: ${rawSymbol.key}`);
    }
    keySet.add(rawSymbol.key);

    const valueType = enumPrimitiveType(typeId, rawSymbol.key, rawSymbol.value);
    if (expectedValueType === undefined) {
      expectedValueType = valueType;
    } else if (expectedValueType !== valueType) {
      throw new Error(`Enum type ${typeId} mixes string and number values`);
    }

    symbols.push({
      key: rawSymbol.key,
      label: rawSymbol.label,
      value: rawSymbol.value,
      deprecated: rawSymbol.deprecated,
    });
  });

  return symbols;
}

function enumPrimitiveType(typeId: TypeId, key: string, value: unknown): NativeType.String | NativeType.Number {
  if (TypeUtils.isString(value)) {
    return NativeType.String;
  }
  if (TypeUtils.isNumber(value)) {
    return NativeType.Number;
  }
  throw new Error(`Enum type ${typeId} has unsupported value for key ${key}`);
}

function findEnumSymbol(symbols: List<EnumSymbolDef>, key: string): EnumSymbolDef | undefined {
  return symbols.find((symbol) => symbol.key === key);
}

function stringifyEnumPrimitiveValue(value: EnumPrimitiveValue): string {
  if (TypeUtils.isString(value)) {
    return value;
  }
  return SU.toString(value);
}

class ListCodec implements TypeCodec {
  constructor(private elementCodec: TypeCodec) {}
  encode(w: IWriteStream, value: List<unknown>): void {
    const elementCodec = this.elementCodec;
    w.writeU32(value.size());
    value.forEach((item) => {
      elementCodec.encode(w, item);
    });
  }
  decode(r: IReadStream): List<unknown> {
    const elementCodec = this.elementCodec;
    const size = r.readU32();
    const list = new List<unknown>();
    for (let i = 0; i < size; i++) {
      const item = elementCodec.decode(r);
      list.push(item);
    }
    return list;
  }
  stringify(value: List<unknown>): string {
    const elementCodec = this.elementCodec;
    const items: string[] = [];
    value.forEach((item) => {
      items.push(elementCodec.stringify(item));
    });
    return `[${items.join(", ")}]`;
  }
}

class MapCodec implements TypeCodec {
  constructor(private valueCodec: TypeCodec) {}
  encode(w: IWriteStream, value: Dict<string, unknown>): void {
    const valueCodec = this.valueCodec;
    const keys = value.keys().sort();
    w.writeU32(keys.size());
    keys.forEach((key) => {
      w.writeString(key);
      const v = value.get(key);
      valueCodec.encode(w, v);
    });
  }
  decode(r: IReadStream): Dict<string, unknown> {
    const valueCodec = this.valueCodec;
    const size = r.readU32();
    const dict = new Dict<string, unknown>();
    for (let i = 0; i < size; i++) {
      const key = r.readString();
      const v = valueCodec.decode(r);
      dict.set(key, v);
    }
    return dict;
  }
  stringify(value: Dict<string, unknown>): string {
    const valueCodec = this.valueCodec;
    const items: string[] = [];
    const keys = value.keys().sort();
    keys.forEach((key) => {
      const v = value.get(key);
      items.push(`{"${key}": "${valueCodec.stringify(v)}"}`);
    });
    return `{${items.join(", ")}}`;
  }
}

class StructCodec implements TypeCodec {
  constructor(private fieldCodecs: Dict<string, TypeCodec>) {}
  encode(w: IWriteStream, value: Dict<string, unknown>): void {
    const fieldCodecs = this.fieldCodecs;
    const fieldNames = fieldCodecs.keys().sort();
    w.writeU32(fieldNames.size());
    fieldNames.forEach((fieldName) => {
      w.writeString(fieldName);
      const codec = fieldCodecs.get(fieldName)!;
      const v = value.get(fieldName);
      codec.encode(w, v);
    });
  }
  decode(r: IReadStream): Dict<string, unknown> {
    const fieldCodecs = this.fieldCodecs;
    const size = r.readU32();
    const dict = new Dict<string, unknown>();
    for (let i = 0; i < size; i++) {
      const fieldName = r.readString();
      const codec = fieldCodecs.get(fieldName);
      if (!codec) {
        throw new Error(`Unknown field name ${fieldName} in struct decoding`);
      }
      const v = codec.decode(r);
      dict.set(fieldName, v);
    }
    return dict;
  }
  stringify(value: Dict<string, unknown>): string {
    const fieldCodecs = this.fieldCodecs;
    const items: string[] = [];
    const fieldNames = fieldCodecs.keys().sort();
    fieldNames.forEach((fieldName) => {
      const codec = fieldCodecs.get(fieldName)!;
      const v = value.get(fieldName);
      items.push(`{"${fieldName}": "${codec.stringify(v)}"}`);
    });
    return `{${items.join(", ")}}`;
  }
}

class NullableCodec implements TypeCodec {
  constructor(private baseCodec: TypeCodec) {}
  encode(w: IWriteStream, value: unknown): void {
    if (value === undefined) {
      w.writeU8(0);
    } else {
      w.writeU8(1);
      this.baseCodec.encode(w, value);
    }
  }
  decode(r: IReadStream): unknown {
    const flag = r.readU8();
    if (flag === 0) {
      return undefined;
    }
    return this.baseCodec.decode(r);
  }
  stringify(value: unknown): string {
    if (value === undefined) {
      return "nil";
    }
    return this.baseCodec.stringify(value);
  }
}

class UnionCodec implements TypeCodec {
  private memberDefs: List<TypeDef>;
  private memberCodecs: List<TypeCodec>;

  constructor(_memberTypeIds: List<TypeId>, memberDefs: List<TypeDef>, memberCodecs: List<TypeCodec>) {
    this.memberDefs = memberDefs;
    this.memberCodecs = memberCodecs;
  }

  private findMemberIndex(value: unknown): number {
    if (value === undefined) {
      for (let i = 0; i < this.memberDefs.size(); i++) {
        if (this.memberDefs.get(i)!.coreType === NativeType.Nil) {
          return i;
        }
      }
      return -1;
    }
    if (TypeUtils.isBoolean(value)) {
      for (let i = 0; i < this.memberDefs.size(); i++) {
        if (this.memberDefs.get(i)!.coreType === NativeType.Boolean) {
          return i;
        }
      }
      return -1;
    }
    if (TypeUtils.isNumber(value)) {
      for (let i = 0; i < this.memberDefs.size(); i++) {
        if (this.memberDefs.get(i)!.coreType === NativeType.Number) {
          return i;
        }
      }
      return -1;
    }
    if (TypeUtils.isString(value)) {
      for (let i = 0; i < this.memberDefs.size(); i++) {
        if (this.memberDefs.get(i)!.coreType === NativeType.String) {
          return i;
        }
      }
      return -1;
    }
    return -1;
  }

  encode(w: IWriteStream, value: unknown): void {
    const idx = this.findMemberIndex(value);
    if (idx < 0) {
      throw new Error("UnionCodec: value does not match any union member");
    }
    w.writeU8(idx);
    this.memberCodecs.get(idx)!.encode(w, value);
  }

  decode(r: IReadStream): unknown {
    const idx = r.readU8();
    if (idx >= this.memberCodecs.size()) {
      throw new Error(`UnionCodec: invalid discriminant ${SU.toString(idx)}`);
    }
    return this.memberCodecs.get(idx)!.decode(r);
  }

  stringify(value: unknown): string {
    const idx = this.findMemberIndex(value);
    if (idx < 0) {
      return "unknown";
    }
    return this.memberCodecs.get(idx)!.stringify(value);
  }
}

// ----------------------------------------------------
// Type constructors

class ListConstructor implements TypeConstructor {
  name = "List";
  arity = 1;
  coreType = NativeType.List;
  construct(registry: ITypeRegistry, args: List<TypeId>): TypeDef {
    const elementTypeId = args.get(0)!;
    const elementDef = registry.get(elementTypeId);
    if (!elementDef) {
      throw new Error(`${elementTypeId} is not a registered type`);
    }
    const def: ListTypeDef = {
      coreType: NativeType.List,
      typeId: "" as TypeId,
      codec: new ListCodec(elementDef.codec),
      name: "",
      elementTypeId,
    };
    return def;
  }
}

class MapConstructor implements TypeConstructor {
  name = "Map";
  arity = 1;
  coreType = NativeType.Map;
  construct(registry: ITypeRegistry, args: List<TypeId>): TypeDef {
    const valueTypeId = args.get(0)!;
    const valueDef = registry.get(valueTypeId);
    if (!valueDef) {
      throw new Error(`${valueTypeId} is not a registered type`);
    }
    const def: MapTypeDef = {
      coreType: NativeType.Map,
      typeId: "" as TypeId,
      codec: new MapCodec(valueDef.codec),
      name: "",
      valueTypeId,
    };
    return def;
  }
}
