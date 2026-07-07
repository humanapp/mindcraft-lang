import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List } from "../../platform/list";
import type { ProgramEnumSymbol, ProgramStructField, ProgramTypeEntry } from "../../runtime/program";
import {
  type EnumTypeDef,
  type FunctionTypeDef,
  type ITypeRegistry,
  type ListTypeDef,
  type MapTypeDef,
  NativeType,
  type NullableTypeDef,
  type StructTypeDef,
  type TypeId,
  type UnionTypeDef,
} from "../../runtime/type-defs";
import { forEachValueTypeId, type Value } from "../../runtime/value";

/**
 * Builds a program's type table during compilation. Each distinct
 * {@link TypeId} interns to exactly one {@link ProgramTypeEntry}; structural
 * types intern their children first, so child references are always table
 * indices strictly below the parent entry's own index.
 *
 * Entry shape is decided from the live registry definition: types carrying an
 * `atomId` become atom refs, structural types (list/map/union/function/
 * nullable) decompose into child references, and program-local structs and
 * enums carry their name (and enum symbols with their values) as data.
 */
export class ProgramTypeTableBuilder {
  private entries: List<ProgramTypeEntry> = List.empty();
  private indexByTypeId: Dict<TypeId, number> = Dict.empty();

  constructor(private readonly registry: ITypeRegistry) {}

  /**
   * Intern `typeId` and (recursively) its structural children, returning the
   * typeId's table index. Idempotent per typeId. Throws if the typeId is not
   * registered or is a non-atom type with no structural decomposition.
   */
  intern(typeId: TypeId): number {
    const existing = this.indexByTypeId.get(typeId);
    if (existing !== undefined) {
      return existing;
    }
    const def = this.registry.get(typeId);
    if (!def) {
      throw new Error(`Cannot build a type-table entry for unregistered type ${typeId}`);
    }
    let entry: ProgramTypeEntry;
    if (def.atomId !== undefined) {
      entry = { tag: "atom", typeId, atomId: def.atomId };
    } else if (def.nullable) {
      const base = this.intern((def as NullableTypeDef).baseTypeId);
      entry = { tag: "nullable", typeId, base };
    } else {
      switch (def.coreType) {
        case NativeType.List: {
          const elem = this.intern((def as ListTypeDef).elementTypeId);
          entry = { tag: "list", typeId, elem };
          break;
        }
        case NativeType.Map: {
          const mapDef = def as MapTypeDef;
          const key = this.intern(mapDef.keyTypeId);
          const value = this.intern(mapDef.valueTypeId);
          entry = { tag: "map", typeId, key, value };
          break;
        }
        case NativeType.Union: {
          const members = List.empty<number>();
          (def as UnionTypeDef).memberTypeIds.forEach((memberTypeId) => {
            members.push(this.intern(memberTypeId));
          });
          entry = { tag: "union", typeId, members };
          break;
        }
        case NativeType.Function: {
          const fnDef = def as FunctionTypeDef;
          if (fnDef.paramTypeIds === undefined || fnDef.returnTypeId === undefined) {
            throw new Error(`Function type ${typeId} has neither an atomId nor a structural shape`);
          }
          const params = List.empty<number>();
          fnDef.paramTypeIds.forEach((paramTypeId) => {
            params.push(this.intern(paramTypeId));
          });
          const result = this.intern(fnDef.returnTypeId);
          entry = { tag: "function", typeId, params, result };
          break;
        }
        case NativeType.Struct: {
          const structDef = def as StructTypeDef;
          let maxFieldId = -1;
          const fields = List.empty<ProgramStructField>();
          structDef.fields.forEach((field) => {
            if (field.fieldIndex > maxFieldId) {
              maxFieldId = field.fieldIndex;
            }
            fields.push({ name: field.name, fieldIndex: field.fieldIndex });
          });
          entry = { tag: "struct", typeId, name: def.name, maxFieldId, fields };
          break;
        }
        case NativeType.Enum: {
          const symbols = List.empty<ProgramEnumSymbol>();
          (def as EnumTypeDef).symbols.forEach((symbol) => {
            symbols.push({ key: symbol.key, value: symbol.value });
          });
          entry = { tag: "enum", typeId, name: def.name, symbols };
          break;
        }
        default:
          throw new Error(`Type ${typeId} is neither an atom nor a structural or program-local type`);
      }
    }
    const idx = this.entries.size();
    this.entries.push(entry);
    this.indexByTypeId.set(typeId, idx);
    return idx;
  }

  /** Intern the typeIds carried by `value` and by every value nested inside it. */
  internValue(value: Value): void {
    forEachValueTypeId(value, (typeId) => {
      this.intern(typeId);
    });
  }

  /** The table built so far, in intern order (children before parents). */
  entriesList(): List<ProgramTypeEntry> {
    return this.entries;
  }

  /** Discard all entries and start over. */
  reset(): void {
    this.entries = List.empty();
    this.indexByTypeId = Dict.empty();
  }
}
