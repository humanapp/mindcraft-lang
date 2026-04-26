import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import { MathOps } from "../../platform/math";
import {
  type BooleanValue,
  BrainFunctionEntry,
  CoreOpId,
  type ExecutionContext,
  FALSE_VALUE,
  HostAsyncFn,
  type HostFn,
  type IFunctionRegistry,
  type IOperatorOverloads,
  type IOperatorTable,
  type IRegisteredOperator,
  type MapValue,
  mkBooleanValue,
  mkCallDef,
  mkNumberValue,
  NativeType,
  NIL_VALUE,
  type NumberValue,
  type OpId,
  type OpOverload,
  type OpParse,
  type OpSpec,
  type StringValue,
  type TypeId,
  type Value,
} from "../interfaces";
import { CoreTypeIds } from "../interfaces/core-types";
import type { BrainServices } from "../services";

/**
 * Operator precedence and parsing information for core operators.
 * Maps operator IDs to their fixity (prefix/infix), precedence level, and associativity.
 * Higher precedence values bind more tightly.
 */
const Precedence: { [key: string]: OpParse } = {
  // ---------------------------------------------------------------------------
  // Precedence (higher binds tighter), matching JS operator precedence.
  //
  // 150: prefix unary (not, neg, bitnot)
  // 140: **
  // 130: * / %
  // 120: + -
  // 110: << >>
  // 100: < <= > >=
  //  90: == !=
  //  80: &
  //  70: ^
  //  60: |
  //  50: &&
  //  40: ||
  //  10: assign
  // ---------------------------------------------------------------------------
  [CoreOpId.Not]: { fixity: "prefix", precedence: 150 },
  [CoreOpId.Negate]: { fixity: "prefix", precedence: 150 },
  [CoreOpId.BitwiseNot]: { fixity: "prefix", precedence: 150 },
  [CoreOpId.Power]: { fixity: "infix", precedence: 140, assoc: "right" },
  [CoreOpId.Multiply]: { fixity: "infix", precedence: 130, assoc: "left" },
  [CoreOpId.Divide]: { fixity: "infix", precedence: 130, assoc: "left" },
  [CoreOpId.Modulo]: { fixity: "infix", precedence: 130, assoc: "left" },
  [CoreOpId.Add]: { fixity: "infix", precedence: 120, assoc: "left" },
  [CoreOpId.Subtract]: { fixity: "infix", precedence: 120, assoc: "left" },
  [CoreOpId.LeftShift]: { fixity: "infix", precedence: 110, assoc: "left" },
  [CoreOpId.RightShift]: { fixity: "infix", precedence: 110, assoc: "left" },
  [CoreOpId.LessThan]: { fixity: "infix", precedence: 100, assoc: "none" },
  [CoreOpId.LessThanOrEqualTo]: { fixity: "infix", precedence: 100, assoc: "none" },
  [CoreOpId.GreaterThan]: { fixity: "infix", precedence: 100, assoc: "none" },
  [CoreOpId.GreaterThanOrEqualTo]: { fixity: "infix", precedence: 100, assoc: "none" },
  [CoreOpId.EqualTo]: { fixity: "infix", precedence: 90, assoc: "none" },
  [CoreOpId.NotEqualTo]: { fixity: "infix", precedence: 90, assoc: "none" },
  [CoreOpId.BitwiseAnd]: { fixity: "infix", precedence: 80, assoc: "left" },
  [CoreOpId.BitwiseXor]: { fixity: "infix", precedence: 70, assoc: "left" },
  [CoreOpId.BitwiseOr]: { fixity: "infix", precedence: 60, assoc: "left" },
  [CoreOpId.And]: { fixity: "infix", precedence: 50, assoc: "left" },
  [CoreOpId.Or]: { fixity: "infix", precedence: 40, assoc: "left" },
  [CoreOpId.Assign]: { fixity: "infix", precedence: 10, assoc: "right" },
} as const;

function argsKey(argTypes: TypeId[]): string {
  return argTypes.join("|");
}

/**
 * Represents a registered operator with multiple type-specific overloads.
 * Manages the collection of overloads for a single operator based on argument types.
 */
export class RegisteredOperator implements IRegisteredOperator {
  readonly id: OpId;
  readonly parse: OpParse;
  private readonly overload: Dict<string, OpOverload>;

  constructor(op: OpSpec) {
    this.id = op.id;
    this.parse = op.parse;
    this.overload = new Dict<string, OpOverload>();
  }
  /**
   * Adds an operator overload for a specific set of argument types.
   * @param overload - The overload definition including argument types and result type
   * @throws {Error} If an overload with the same argument types already exists
   */
  add(overload: OpOverload): void {
    const key = argsKey(overload.argTypes);
    if (this.overload.has(key)) {
      throw new Error(`Duplicate overload for op ${this.id} with args (${key})`);
    }
    this.overload.set(key, overload);
  }

  remove(argTypes: TypeId[]): boolean {
    return this.overload.delete(argsKey(argTypes));
  }

  /**
   * Retrieves the operator overload for a specific set of argument types.
   * @param argTypes - The array of type IDs for the arguments
   * @returns The matching overload, or undefined if not found
   */
  get(argTypes: TypeId[]): OpOverload | undefined {
    const key = argsKey(argTypes);
    return this.overload.get(key);
  }

  /**
   * Returns all registered overloads for this operator.
   */
  overloads(): ReadonlyList<OpOverload> {
    return this.overload.values();
  }
}

/**
 * Central registry table for all operators and their overloads.
 * Manages operator registration and resolution based on operator ID and argument types.
 */
export class OperatorTable implements IOperatorTable {
  private table = new Dict<string, RegisteredOperator>();

  /**
   * Adds or retrieves an operator specification.
   * If the operator already exists, validates that the parsing information matches.
   * @param op - The operator specification including ID and parsing information
   * @returns The registered operator instance
   * @throws {Error} If an operator with conflicting parsing information already exists
   */
  add(op: OpSpec): IRegisteredOperator {
    let reg = this.table.get(op.id);
    if (reg) {
      if (
        reg.parse.fixity !== op.parse.fixity ||
        reg.parse.precedence !== op.parse.precedence ||
        reg.parse.assoc !== op.parse.assoc
      ) {
        throw new Error(`Conflicting op registration for ${op.id}`);
      }
    } else {
      reg = new RegisteredOperator(op);
      this.table.set(op.id, reg);
    }
    return reg;
  }

  /**
   * Retrieves a registered operator by its ID.
   * @param id - The operator identifier
   * @returns The registered operator, or undefined if not found
   */
  get(id: OpId): RegisteredOperator | undefined {
    return this.table.get(id);
  }
}

const binaryCallDef = mkCallDef({
  type: "seq",
  items: [
    { type: "arg", tileId: "", name: "lhs", required: true },
    { type: "arg", tileId: "", name: "rhs", required: true },
  ],
});

const unaryCallDef = mkCallDef({
  type: "seq",
  items: [{ type: "arg", tileId: "", name: "arg", required: true }],
});

/**
 * High-level registry for managing operator definitions and overloads.
 * Provides convenience methods for registering unary and binary operators.
 */
export class OperatorOverloads implements IOperatorOverloads {
  constructor(
    private readonly table_: IOperatorTable,
    private readonly functions: IFunctionRegistry
  ) {}

  public table(): IOperatorTable {
    return this.table_;
  }

  /**
   * Registers a binary operator overload with specific left-hand, right-hand, and result types.
   * @param op - The operator identifier
   * @param lhs - The type ID of the left operand
   * @param rhs - The type ID of the right operand
   * @param result - The type ID of the operation result
   * @returns The registered operator instance
   * @throws {Error} If the operator is not found in the table
   */
  binary(op: OpId, lhs: TypeId, rhs: TypeId, resultType: TypeId, fn: HostFn, isAsync = false): IRegisteredOperator {
    const fnName = `$$op_${op}_${lhs}_${rhs}_to_${resultType}`;
    const fnEntry = this.functions.register(fnName, isAsync, fn, binaryCallDef);

    const reg = this.table_.get(op);
    if (!reg) {
      throw new Error(`No such op ${op}`);
    }
    reg.add({
      argTypes: [lhs, rhs],
      resultType,
      fnEntry,
    });
    return reg;
  }

  /**
   * Registers a unary operator overload with specific argument and result types.
   * @param op - The operator identifier
   * @param arg - The type ID of the operand
   * @param result - The type ID of the operation result
   * @returns The registered operator instance
   * @throws {Error} If the operator is not found in the table
   */
  unary(op: OpId, arg: TypeId, resultType: TypeId, fn: HostFn, isAsync = false): IRegisteredOperator {
    const fnName = `$$op_${op}_${arg}_to_${resultType}`;
    const fnEntry = this.functions.register(fnName, isAsync, fn, unaryCallDef);

    const reg = this.table_.get(op);
    if (!reg) {
      throw new Error(`No such op ${op}`);
    }
    reg.add({
      argTypes: [arg],
      resultType,
      fnEntry,
    });
    return reg;
  }

  remove(op: OpId, argTypes: TypeId[]): boolean {
    const reg = this.table_.get(op);
    if (!reg) {
      return false;
    }

    const overload = reg.get(argTypes);
    if (!overload) {
      return false;
    }

    reg.remove(argTypes);
    this.functions.unregister(overload.fnEntry.name);
    return true;
  }

  /**
   * Resolves an operator to its specific overload and parsing information.
   * @param id - The operator identifier
   * @param argTypes - The array of argument type IDs
   * @returns An object containing the matching overload and parsing info, or undefined if not found
   */
  resolve(id: OpId, argTypes: TypeId[]): { overload: OpOverload; parse: OpParse } | undefined {
    const reg = this.table_.get(id);
    if (!reg) {
      return undefined;
    }
    const overload = reg.get(argTypes);
    return overload ? { overload: overload, parse: reg.parse } : undefined;
  }
}

// Operand validation helpers ensure that math operators reject nil and NaN
// operands. The compiler resolves overloads by static type, but at runtime an
// operand may turn out to be nil (e.g. an unassigned variable) or NaN (e.g. a
// poisoned earlier computation). We return NIL_VALUE for arithmetic and
// FALSE_VALUE for comparisons so a faulty subexpression makes the surrounding
// rule evaluate false rather than faulting the VM or producing NaN-poisoned
// downstream values.

/** Coerce `v` to a finite number, or undefined if `v` is not a non-NaN {@link NumberValue}. */
export function asValidNumber(v: Value | undefined): number | undefined {
  if (v === undefined || v.t !== NativeType.Number) {
    return undefined;
  }
  if (MathOps.isNaN(v.v)) {
    return undefined;
  }
  return v.v;
}

/** Coerce `v` to a string, or undefined if `v` is not a {@link StringValue}. */
export function asValidString(v: Value | undefined): string | undefined {
  if (v === undefined || v.t !== NativeType.String) {
    return undefined;
  }
  return v.v;
}

/** Apply a binary numeric op to slot 0 and slot 1 of `args`. Returns nil on bad operands or NaN result. */
export function safeNumBinary(args: MapValue, op: (a: number, b: number) => number): Value {
  const a = asValidNumber(args.v.get(0));
  const b = asValidNumber(args.v.get(1));
  if (a === undefined || b === undefined) {
    return NIL_VALUE;
  }
  const result = op(a, b);
  if (MathOps.isNaN(result)) {
    return NIL_VALUE;
  }
  return mkNumberValue(result);
}

/** Apply a unary numeric op to slot 0 of `args`. Returns nil on bad operand or NaN result. */
export function safeNumUnary(args: MapValue, op: (a: number) => number): Value {
  const a = asValidNumber(args.v.get(0));
  if (a === undefined) {
    return NIL_VALUE;
  }
  const result = op(a);
  if (MathOps.isNaN(result)) {
    return NIL_VALUE;
  }
  return mkNumberValue(result);
}

/** Apply a numeric comparison to slots 0 and 1 of `args`. Returns false on bad operands. */
export function safeNumCompare(args: MapValue, cmp: (a: number, b: number) => boolean): Value {
  const a = asValidNumber(args.v.get(0));
  const b = asValidNumber(args.v.get(1));
  if (a === undefined || b === undefined) {
    return FALSE_VALUE;
  }
  return mkBooleanValue(cmp(a, b));
}

/** Concatenate slot 0 and slot 1 of `args` as strings. Returns nil on bad operands. */
export function safeStrConcat(args: MapValue): Value {
  const a = asValidString(args.v.get(0));
  const b = asValidString(args.v.get(1));
  if (a === undefined || b === undefined) {
    return NIL_VALUE;
  }
  return { t: NativeType.String, v: `${a}${b}` };
}

/** Apply a string comparison to slots 0 and 1 of `args`. Returns false on bad operands. */
export function safeStrCompare(args: MapValue, cmp: (a: string, b: string) => boolean): Value {
  const a = asValidString(args.v.get(0));
  const b = asValidString(args.v.get(1));
  if (a === undefined || b === undefined) {
    return FALSE_VALUE;
  }
  return mkBooleanValue(cmp(a, b));
}

/**
 * Registers all core operators with their type-specific overloads.
 * This includes logical (and, or, not), arithmetic (+, -, *, /, negate),
 * comparison (<, <=, >, >=, ==, !=), and assignment operators for Boolean, Number, and String types.
 * Note: Assignment is special-cased in the compiler and is a no-op at runtime. The overload is registered for the type system.
 */
export function registerCoreOperators(services: BrainServices) {
  const operatorTable = services.operatorTable;
  const operatorOverloads = services.operatorOverloads;

  operatorTable.add({ id: CoreOpId.And, parse: Precedence[CoreOpId.And] });
  operatorTable.add({ id: CoreOpId.Or, parse: Precedence[CoreOpId.Or] });
  operatorTable.add({ id: CoreOpId.Not, parse: Precedence[CoreOpId.Not] });

  operatorTable.add({ id: CoreOpId.Add, parse: Precedence[CoreOpId.Add] });
  operatorTable.add({ id: CoreOpId.Subtract, parse: Precedence[CoreOpId.Subtract] });
  operatorTable.add({ id: CoreOpId.Multiply, parse: Precedence[CoreOpId.Multiply] });
  operatorTable.add({ id: CoreOpId.Divide, parse: Precedence[CoreOpId.Divide] });
  operatorTable.add({ id: CoreOpId.Modulo, parse: Precedence[CoreOpId.Modulo] });
  operatorTable.add({ id: CoreOpId.Power, parse: Precedence[CoreOpId.Power] });
  operatorTable.add({ id: CoreOpId.Negate, parse: Precedence[CoreOpId.Negate] });

  operatorTable.add({ id: CoreOpId.BitwiseAnd, parse: Precedence[CoreOpId.BitwiseAnd] });
  operatorTable.add({ id: CoreOpId.BitwiseOr, parse: Precedence[CoreOpId.BitwiseOr] });
  operatorTable.add({ id: CoreOpId.BitwiseXor, parse: Precedence[CoreOpId.BitwiseXor] });
  operatorTable.add({ id: CoreOpId.BitwiseNot, parse: Precedence[CoreOpId.BitwiseNot] });
  operatorTable.add({ id: CoreOpId.LeftShift, parse: Precedence[CoreOpId.LeftShift] });
  operatorTable.add({ id: CoreOpId.RightShift, parse: Precedence[CoreOpId.RightShift] });

  operatorTable.add({ id: CoreOpId.EqualTo, parse: Precedence[CoreOpId.EqualTo] });
  operatorTable.add({ id: CoreOpId.NotEqualTo, parse: Precedence[CoreOpId.NotEqualTo] });
  operatorTable.add({ id: CoreOpId.LessThan, parse: Precedence[CoreOpId.LessThan] });
  operatorTable.add({
    id: CoreOpId.LessThanOrEqualTo,
    parse: Precedence[CoreOpId.LessThanOrEqualTo],
  });
  operatorTable.add({ id: CoreOpId.GreaterThan, parse: Precedence[CoreOpId.GreaterThan] });
  operatorTable.add({
    id: CoreOpId.GreaterThanOrEqualTo,
    parse: Precedence[CoreOpId.GreaterThanOrEqualTo],
  });
  operatorTable.add({ id: CoreOpId.Assign, parse: Precedence[CoreOpId.Assign] });

  operatorOverloads.binary(
    CoreOpId.And,
    CoreTypeIds.Boolean,
    CoreTypeIds.Boolean,
    CoreTypeIds.Boolean,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as BooleanValue;
        const b = args.v.get(1) as BooleanValue;
        return mkBooleanValue(a.v && b.v);
      },
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.Or,
    CoreTypeIds.Boolean,
    CoreTypeIds.Boolean,
    CoreTypeIds.Boolean,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as BooleanValue;
        const b = args.v.get(1) as BooleanValue;
        return mkBooleanValue(a.v || b.v);
      },
    },
    false
  );
  operatorOverloads.unary(
    CoreOpId.Not,
    CoreTypeIds.Boolean,
    CoreTypeIds.Boolean,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as BooleanValue;
        return mkBooleanValue(!a.v);
      },
    },
    false
  );

  operatorOverloads.binary(
    CoreOpId.Add,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumBinary(args, (a, b) => a + b) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.Subtract,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumBinary(args, (a, b) => a - b) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.Multiply,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumBinary(args, (a, b) => a * b) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.Divide,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) =>
        safeNumBinary(args, (a, b) => {
          // Division by zero yields NIL_VALUE rather than faulting; safeNumBinary
          // catches both 0/0 (NaN result) and finite/0 (Infinity result is rejected by NaN check on subsequent ops).
          if (b === 0) {
            return 0 / 0;
          }
          return a / b;
        }),
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.Modulo,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) =>
        safeNumBinary(args, (a, b) => {
          if (b === 0) {
            return 0 / 0;
          }
          return a % b;
        }),
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.Power,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumBinary(args, (a, b) => MathOps.pow(a, b)) },
    false
  );
  operatorOverloads.unary(
    CoreOpId.Negate,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumUnary(args, (a) => -a) },
    false
  );

  operatorOverloads.binary(
    CoreOpId.BitwiseAnd,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumBinary(args, (a, b) => MathOps.bitAnd(a, b)) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.BitwiseOr,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumBinary(args, (a, b) => MathOps.bitOr(a, b)) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.BitwiseXor,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumBinary(args, (a, b) => MathOps.bitXor(a, b)) },
    false
  );
  operatorOverloads.unary(
    CoreOpId.BitwiseNot,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumUnary(args, (a) => MathOps.bitNot(a)) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.LeftShift,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumBinary(args, (a, b) => MathOps.leftShift(a, b)) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.RightShift,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumBinary(args, (a, b) => MathOps.rightShift(a, b)) },
    false
  );

  operatorOverloads.binary(
    CoreOpId.EqualTo,
    CoreTypeIds.Boolean,
    CoreTypeIds.Boolean,
    CoreTypeIds.Boolean,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as BooleanValue;
        const b = args.v.get(1) as BooleanValue;
        return mkBooleanValue(a.v === b.v);
      },
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.NotEqualTo,
    CoreTypeIds.Boolean,
    CoreTypeIds.Boolean,
    CoreTypeIds.Boolean,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as BooleanValue;
        const b = args.v.get(1) as BooleanValue;
        return mkBooleanValue(a.v !== b.v);
      },
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.Assign,
    CoreTypeIds.Boolean,
    CoreTypeIds.Boolean,
    CoreTypeIds.Boolean,
    {
      exec: (_ctx: ExecutionContext, _args: MapValue) => {
        return NIL_VALUE; // Assignment is special-cased in the compiler; this is a no-op at runtime.
      },
    },
    false
  );

  operatorOverloads.binary(
    CoreOpId.EqualTo,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Boolean,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumCompare(args, (a, b) => a === b) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.NotEqualTo,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Boolean,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumCompare(args, (a, b) => a !== b) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.LessThan,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Boolean,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumCompare(args, (a, b) => a < b) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.LessThanOrEqualTo,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Boolean,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumCompare(args, (a, b) => a <= b) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.GreaterThan,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Boolean,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumCompare(args, (a, b) => a > b) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.GreaterThanOrEqualTo,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Boolean,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeNumCompare(args, (a, b) => a >= b) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.Assign,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    {
      exec: (_ctx: ExecutionContext, _args: MapValue) => {
        return NIL_VALUE; // Assignment is special-cased in the compiler; this is a no-op at runtime.
      },
    },
    false
  );

  operatorOverloads.binary(
    CoreOpId.Add,
    CoreTypeIds.String,
    CoreTypeIds.String,
    CoreTypeIds.String,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeStrConcat(args) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.EqualTo,
    CoreTypeIds.String,
    CoreTypeIds.String,
    CoreTypeIds.Boolean,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeStrCompare(args, (a, b) => a === b) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.NotEqualTo,
    CoreTypeIds.String,
    CoreTypeIds.String,
    CoreTypeIds.Boolean,
    { exec: (_ctx: ExecutionContext, args: MapValue) => safeStrCompare(args, (a, b) => a !== b) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.Assign,
    CoreTypeIds.String,
    CoreTypeIds.String,
    CoreTypeIds.String,
    {
      exec: (_ctx: ExecutionContext, _args: MapValue) => {
        return NIL_VALUE; // Assignment is special-cased in the compiler; this is a no-op at runtime.
      },
    },
    false
  );

  // -- Nil overloads ----------------------------------------------------------

  operatorOverloads.binary(
    CoreOpId.EqualTo,
    CoreTypeIds.Nil,
    CoreTypeIds.Nil,
    CoreTypeIds.Boolean,
    { exec: () => mkBooleanValue(true) },
    false
  );
  operatorOverloads.binary(
    CoreOpId.NotEqualTo,
    CoreTypeIds.Nil,
    CoreTypeIds.Nil,
    CoreTypeIds.Boolean,
    { exec: () => mkBooleanValue(false) },
    false
  );
  operatorOverloads.unary(
    CoreOpId.Not,
    CoreTypeIds.Nil,
    CoreTypeIds.Boolean,
    { exec: () => mkBooleanValue(true) },
    false
  );

  for (const typeId of [CoreTypeIds.Number, CoreTypeIds.Boolean, CoreTypeIds.String]) {
    operatorOverloads.binary(
      CoreOpId.EqualTo,
      typeId,
      CoreTypeIds.Nil,
      CoreTypeIds.Boolean,
      {
        exec: (_ctx: ExecutionContext, args: MapValue) => {
          const a = args.v.get(0) as Value;
          return mkBooleanValue(a.t === NativeType.Nil);
        },
      },
      false
    );
    operatorOverloads.binary(
      CoreOpId.EqualTo,
      CoreTypeIds.Nil,
      typeId,
      CoreTypeIds.Boolean,
      {
        exec: (_ctx: ExecutionContext, args: MapValue) => {
          const b = args.v.get(1) as Value;
          return mkBooleanValue(b.t === NativeType.Nil);
        },
      },
      false
    );
    operatorOverloads.binary(
      CoreOpId.NotEqualTo,
      typeId,
      CoreTypeIds.Nil,
      CoreTypeIds.Boolean,
      {
        exec: (_ctx: ExecutionContext, args: MapValue) => {
          const a = args.v.get(0) as Value;
          return mkBooleanValue(a.t !== NativeType.Nil);
        },
      },
      false
    );
    operatorOverloads.binary(
      CoreOpId.NotEqualTo,
      CoreTypeIds.Nil,
      typeId,
      CoreTypeIds.Boolean,
      {
        exec: (_ctx: ExecutionContext, args: MapValue) => {
          const b = args.v.get(1) as Value;
          return mkBooleanValue(b.t !== NativeType.Nil);
        },
      },
      false
    );
  }
}
