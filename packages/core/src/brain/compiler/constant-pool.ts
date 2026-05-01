import { Dict } from "../../platform/dict";
import { List } from "../../platform/list";
import { MathOps } from "../../platform/math";
import { NativeType } from "../interfaces/type-system";
import type { ConstantPools, Value } from "../interfaces/vm";

/** Identifies which typed sub-pool a constant entry lives in. */
export type ConstantPoolKind = "number" | "string" | "value";

/** A typed constant-pool reference: which sub-pool to read and the index within it. */
export interface ConstantRef {
  kind: ConstantPoolKind;
  idx: number;
}

/**
 * Helper class for managing typed constant sub-pools alongside the emitter.
 *
 * Plain numbers and strings live in dedicated sub-pools addressed by the
 * `PUSH_CONST_NUM` / `PUSH_CONST_STR` opcodes. Every other `Value` shape
 * (`Nil`, `Boolean`, `Enum`, `List`, `Map`, `Struct`, `Function`, ...)
 * lives in the residual heterogeneous pool addressed by `PUSH_CONST_VAL`.
 *
 * Each sub-pool has its own index space; callers must track which pool an
 * index refers to. Call {@link toPools} to materialize the three sub-pools
 * as a {@link ConstantPools} aggregate suitable for embedding in a `Program`.
 */
export class ConstantPool {
  private numbers: List<number> = List.empty();
  private numberIndex: Dict<number, number> = Dict.empty();

  private strings: List<string> = List.empty();
  private stringIndex: Dict<string, number> = Dict.empty();

  private values: List<Value> = List.empty();
  private valueIndex: Dict<string, number> = Dict.empty();

  /** Add a number to the number sub-pool, returning its index. Deduplicates. */
  addNumber(n: number): number {
    const existing = this.numberIndex.get(n);
    if (existing !== undefined) return existing;
    const idx = this.numbers.size();
    this.numbers.push(n);
    this.numberIndex.set(n, idx);
    return idx;
  }

  /** Add a string to the string sub-pool, returning its index. Deduplicates. */
  addString(s: string): number {
    const existing = this.stringIndex.get(s);
    if (existing !== undefined) return existing;
    const idx = this.strings.size();
    this.strings.push(s);
    this.stringIndex.set(s, idx);
    return idx;
  }

  /**
   * Add a `Value` to the residual sub-pool, returning its index.
   * Deduplicates primitive-shaped residual values (`Nil`, `Boolean`, `Enum`);
   * complex shapes (`List`, `Map`, `Struct`, `Function`, ...) are not deduped
   * because deep equality is impractical at compile time.
   *
   * Callers must not pass plain `NumberValue` or `StringValue` here; route
   * those through {@link addNumber} / {@link addString}, or use {@link addValue}
   * to dispatch automatically.
   */
  addOther(value: Value): number {
    const key = this.serializeOther(value);
    if (key !== undefined) {
      const existing = this.valueIndex.get(key);
      if (existing !== undefined) return existing;
      const idx = this.values.size();
      this.values.push(value);
      this.valueIndex.set(key, idx);
      return idx;
    }
    const idx = this.values.size();
    this.values.push(value);
    return idx;
  }

  /**
   * Add any `Value`, dispatching to the appropriate sub-pool based on its
   * tag. Plain `NumberValue` / `StringValue` route to the typed sub-pools;
   * everything else goes to the residual pool. The returned `ConstantRef`
   * tells the caller which `PUSH_CONST*` opcode to emit.
   */
  addValue(value: Value): ConstantRef {
    if (value.t === NativeType.Number) {
      return { kind: "number", idx: this.addNumber(value.v) };
    }
    if (value.t === NativeType.String) {
      return { kind: "string", idx: this.addString(value.v) };
    }
    return { kind: "value", idx: this.addOther(value) };
  }

  /** Materialize the three sub-pools as a {@link ConstantPools} aggregate. */
  toPools(): ConstantPools {
    return {
      numbers: this.numbers,
      strings: this.strings,
      values: this.values,
    };
  }

  /** Total number of entries across all sub-pools. */
  size(): number {
    return this.numbers.size() + this.strings.size() + this.values.size();
  }

  /** Reset every sub-pool. */
  reset(): void {
    this.numbers = List.empty();
    this.numberIndex = Dict.empty();
    this.strings = List.empty();
    this.stringIndex = Dict.empty();
    this.values = List.empty();
    this.valueIndex = Dict.empty();
  }

  private serializeOther(value: Value): string | undefined {
    switch (value.t) {
      case NativeType.Unknown:
        return "unknown";
      case NativeType.Void:
        return "void";
      case NativeType.Nil:
        return "nil";
      case NativeType.Boolean:
        return `bool:${value.v}`;
      case NativeType.Enum:
        return `enum:${value.typeId}:${value.v}`;
      case NativeType.List:
      case NativeType.Map:
      case NativeType.Struct:
      case NativeType.Function:
      case "handle":
      case "err":
        return undefined;
      default:
        return `unknown:${MathOps.random()}`;
    }
  }
}
