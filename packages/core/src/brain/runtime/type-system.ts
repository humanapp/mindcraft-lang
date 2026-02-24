import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List } from "../../platform/list";
import type { IReadStream, IWriteStream } from "../../platform/stream";
import { StringUtils as SU } from "../../platform/string";
import { UniqueSet } from "../../platform/uniqueset";
import {
  CoreTypeNames,
  type EnumTypeDef,
  type EnumTypeShape,
  type ITypeRegistry,
  type ListTypeDef,
  type ListTypeShape,
  type MapTypeDef,
  type MapTypeShape,
  mkTypeId,
  NativeType,
  type StructTypeDef,
  type StructTypeShape,
  type TypeCodec,
  type TypeDef,
  type TypeId,
} from "../interfaces";
import { getBrainServices } from "../services";

export class TypeRegistry implements ITypeRegistry {
  private defs = new Dict<TypeId, TypeDef>();

  private add(def: TypeDef) {
    if (this.defs.has(def.typeId)) {
      throw new Error(`Type with id ${def.typeId} is already registered`);
    }
    this.defs.set(def.typeId, def);
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
    // Verify no duplicate keys
    const keySet = new UniqueSet<string>();
    shape.symbols.forEach((sym) => {
      if (keySet.has(sym.key)) {
        throw new Error(`Enum type ${typeId} has duplicate key: ${sym.key}`);
      }
      keySet.add(sym.key);
    });
    // Verify defaultKey exists
    if (!keySet.has(shape.defaultKey)) {
      throw new Error(`Enum type ${typeId} has invalid defaultKey: ${shape.defaultKey}`);
    }
    // Register
    const enumTypeDef: EnumTypeDef = {
      coreType: NativeType.Enum,
      typeId,
      codec: new EnumCodec(shape),
      name,
      ...shape,
    };
    this.add(enumTypeDef);
    return typeId;
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

  get(id: TypeId): TypeDef | undefined {
    return this.defs.get(id);
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

class EnumCodec implements TypeCodec {
  private shape: EnumTypeShape;
  constructor(shape: EnumTypeShape) {
    this.shape = shape;
  }
  encode(w: IWriteStream, value: string): void {
    w.writeString(value);
  }
  decode(r: IReadStream): string {
    const key = r.readString();
    const symbol = this.shape.symbols.find((s) => s.key === key);
    if (!symbol) {
      throw new Error(`Unknown enum key: ${key}`);
    }
    return key;
  }
  stringify(value: string): string {
    return value;
  }
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
