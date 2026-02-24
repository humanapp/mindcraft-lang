import { Dict } from "../../platform/dict";
import { List } from "../../platform/list";
import { MathOps } from "../../platform/math";
import type { TypeId } from "../interfaces/type-system";
import { NativeType } from "../interfaces/type-system";
import type { Value } from "../interfaces/vm";

/**
 * Helper class for managing a constant pool alongside the emitter.
 */
export class ConstantPool {
  private constants: List<Value> = List.empty();
  private indexMap: Dict<string, number> = Dict.empty(); // serialized value -> index

  /** Add a value to the constant pool. Returns the constant index. Deduplicates identical constants. */
  add(value: Value): number {
    const key = this.serializeValue(value);
    const existing = this.indexMap.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const idx = this.constants.size();
    this.constants.push(value);
    this.indexMap.set(key, idx);
    return idx;
  }

  /** Get the finalized constant pool. */
  getConstants(): List<Value> {
    return this.constants;
  }

  /** Get the current size of the constant pool. */
  size(): number {
    return this.constants.size();
  }

  /** Reset the constant pool. */
  reset(): void {
    this.constants = List.empty();
    this.indexMap = Dict.empty();
  }

  private serializeValue(value: Value): string {
    // Simple serialization for deduplication.
    // For complex types (list, map, struct), we don't deduplicate
    // to avoid deep equality checks. Only primitive values are deduplicated.
    switch (value.t) {
      case NativeType.Unknown:
        return "unknown";
      case NativeType.Void:
        return "void";
      case NativeType.Nil:
        return "nil";
      case NativeType.Boolean:
        return `bool:${(value as { t: NativeType.Boolean; v: boolean }).v}`;
      case NativeType.Number:
        return `num:${(value as { t: NativeType.Number; v: number }).v}`;
      case NativeType.String:
        return `str:${(value as { t: NativeType.String; v: string }).v}`;
      case NativeType.Enum:
        return `enum:${(value as { t: NativeType.Enum; typeId: TypeId; v: string }).typeId}:${(value as { t: NativeType.Enum; typeId: TypeId; v: string }).v}`;
      case NativeType.List:
      case NativeType.Map:
      case NativeType.Struct:
      case "handle":
      case "err":
        // Don't deduplicate complex types - return unique key each time
        return `complex:${MathOps.random()}`;
      default:
        return `unknown:${MathOps.random()}`;
    }
  }
}
