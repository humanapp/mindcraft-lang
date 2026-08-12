import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List } from "../../platform/list";
import { MathOps } from "../../platform/math";
import type { ConstantPools } from "../../runtime/bytecode";
import type { ProgramTypeEntry } from "../../runtime/program";
import { type ITypeRegistry, NativeType, type TypeId } from "../../runtime/type-defs";
import type { Value } from "../../runtime/value";
import { ProgramTypeTableBuilder } from "./type-table-builder";

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

  private typeTable?: ProgramTypeTableBuilder;

  /**
   * A pool constructed with a type registry also builds the program's type
   * table: {@link addType} interns typeIds, and {@link addOther} /
   * {@link addValue} intern the typeIds of pooled constant values. Without a
   * registry the pool manages only the constant sub-pools and {@link addType}
   * throws.
   */
  constructor(typeRegistry?: ITypeRegistry) {
    if (typeRegistry) {
      this.typeTable = new ProgramTypeTableBuilder(typeRegistry);
    }
  }

  /** Intern a typeId into the program type table, returning its table index. */
  addType(typeId: TypeId): number {
    if (!this.typeTable) {
      throw new Error(`ConstantPool.addType(${typeId}): pool was constructed without a type registry`);
    }
    return this.typeTable.intern(typeId);
  }

  /** The program type table built so far (empty without a type registry). */
  typeEntries(): List<ProgramTypeEntry> {
    return this.typeTable ? this.typeTable.entriesList() : List.empty<ProgramTypeEntry>();
  }

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
   * Deduplicates primitive-shaped values (`Nil`, `Boolean`, `Number`,
   * `String`, `Enum`); complex shapes (`List`, `Map`, `Struct`, `Function`,
   * ...) are not deduped.
   *
   * Call this only for a value the residual pool must hold whatever its tag,
   * such as a variable's starting value; route a value reached by a
   * `PUSH_CONST*` operand through {@link addValue}.
   */
  addOther(value: Value): number {
    this.typeTable?.internValue(value);
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

  /** Reset every sub-pool and the type table. */
  reset(): void {
    this.numbers = List.empty();
    this.numberIndex = Dict.empty();
    this.strings = List.empty();
    this.stringIndex = Dict.empty();
    this.values = List.empty();
    this.valueIndex = Dict.empty();
    this.typeTable?.reset();
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
      case NativeType.Number:
        return `num:${value.v}`;
      case NativeType.String:
        return `str:${value.v}`;
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
