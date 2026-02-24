import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import {
  type BooleanValue,
  BrainFunctionEntry,
  CoreOpId,
  type ExecutionContext,
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
  Value,
} from "../interfaces";
import { CoreTypeIds } from "../interfaces/core-types";
import { getBrainServices } from "../services";

/**
 * Operator precedence and parsing information for core operators.
 * Maps operator IDs to their fixity (prefix/infix), precedence level, and associativity.
 * Higher precedence values bind more tightly.
 */
const Precedence: { [key: string]: OpParse } = {
  // ---------------------------------------------------------------------------
  // Precedence (higher binds tighter), matching the scale:
  //
  // 30: prefix negation / prefix unary
  // 20: * /
  // 10: + -
  //  5: < <= > >=
  //  4: == !=
  //  2: and
  //  1: or
  // ---------------------------------------------------------------------------
  [CoreOpId.Not]: { fixity: "prefix", precedence: 30 },
  [CoreOpId.Negate]: { fixity: "prefix", precedence: 30 },
  [CoreOpId.Multiply]: { fixity: "infix", precedence: 20, assoc: "left" },
  [CoreOpId.Divide]: { fixity: "infix", precedence: 20, assoc: "left" },
  [CoreOpId.Add]: { fixity: "infix", precedence: 10, assoc: "left" },
  [CoreOpId.Subtract]: { fixity: "infix", precedence: 10, assoc: "left" },
  [CoreOpId.LessThan]: { fixity: "infix", precedence: 5, assoc: "none" },
  [CoreOpId.LessThanOrEqualTo]: { fixity: "infix", precedence: 5, assoc: "none" },
  [CoreOpId.GreaterThan]: { fixity: "infix", precedence: 5, assoc: "none" },
  [CoreOpId.GreaterThanOrEqualTo]: { fixity: "infix", precedence: 5, assoc: "none" },
  [CoreOpId.EqualTo]: { fixity: "infix", precedence: 4, assoc: "none" },
  [CoreOpId.NotEqualTo]: { fixity: "infix", precedence: 4, assoc: "none" },
  [CoreOpId.And]: { fixity: "infix", precedence: 2, assoc: "left" },
  [CoreOpId.Or]: { fixity: "infix", precedence: 1, assoc: "left" },
  [CoreOpId.Assign]: { fixity: "infix", precedence: 0, assoc: "right" },
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

/**
 * Registers all core operators with their type-specific overloads.
 * This includes logical (and, or, not), arithmetic (+, -, *, /, negate),
 * comparison (<, <=, >, >=, ==, !=), and assignment operators for Boolean, Number, and String types.
 * Note: Assignment is special-cased in the compiler and is a no-op at runtime. The overload is registered for the type system.
 */
export function registerCoreOperators() {
  const brainServices = getBrainServices();
  const operatorTable = brainServices.operatorTable;
  const operatorOverloads = brainServices.operatorOverloads;

  operatorTable.add({ id: CoreOpId.And, parse: Precedence[CoreOpId.And] });
  operatorTable.add({ id: CoreOpId.Or, parse: Precedence[CoreOpId.Or] });
  operatorTable.add({ id: CoreOpId.Not, parse: Precedence[CoreOpId.Not] });

  operatorTable.add({ id: CoreOpId.Add, parse: Precedence[CoreOpId.Add] });
  operatorTable.add({ id: CoreOpId.Subtract, parse: Precedence[CoreOpId.Subtract] });
  operatorTable.add({ id: CoreOpId.Multiply, parse: Precedence[CoreOpId.Multiply] });
  operatorTable.add({ id: CoreOpId.Divide, parse: Precedence[CoreOpId.Divide] });
  operatorTable.add({ id: CoreOpId.Negate, parse: Precedence[CoreOpId.Negate] });

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
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as NumberValue;
        const b = args.v.get(1) as NumberValue;
        return mkNumberValue(a.v + b.v);
      },
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.Subtract,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as NumberValue;
        const b = args.v.get(1) as NumberValue;
        return mkNumberValue(a.v - b.v);
      },
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.Multiply,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as NumberValue;
        const b = args.v.get(1) as NumberValue;
        return mkNumberValue(a.v * b.v);
      },
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.Divide,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as NumberValue;
        const b = args.v.get(1) as NumberValue;
        if (b.v === 0) {
          throw new Error("Division by zero");
        }
        return mkNumberValue(a.v / b.v);
      },
    },
    false
  );
  operatorOverloads.unary(
    CoreOpId.Negate,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as NumberValue;
        return mkNumberValue(-a.v);
      },
    },
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
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as NumberValue;
        const b = args.v.get(1) as NumberValue;
        return mkBooleanValue(a.v === b.v);
      },
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.NotEqualTo,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Boolean,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as NumberValue;
        const b = args.v.get(1) as NumberValue;
        return mkBooleanValue(a.v !== b.v);
      },
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.LessThan,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Boolean,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as NumberValue;
        const b = args.v.get(1) as NumberValue;
        return mkBooleanValue(a.v < b.v);
      },
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.LessThanOrEqualTo,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Boolean,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as NumberValue;
        const b = args.v.get(1) as NumberValue;
        return mkBooleanValue(a.v <= b.v);
      },
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.GreaterThan,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Boolean,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as NumberValue;
        const b = args.v.get(1) as NumberValue;
        return mkBooleanValue(a.v > b.v);
      },
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.GreaterThanOrEqualTo,
    CoreTypeIds.Number,
    CoreTypeIds.Number,
    CoreTypeIds.Boolean,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as NumberValue;
        const b = args.v.get(1) as NumberValue;
        return mkBooleanValue(a.v >= b.v);
      },
    },
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
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as StringValue;
        const b = args.v.get(1) as StringValue;
        return { t: NativeType.String, v: `${a.v}${b.v}` };
      },
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.EqualTo,
    CoreTypeIds.String,
    CoreTypeIds.String,
    CoreTypeIds.Boolean,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as StringValue;
        const b = args.v.get(1) as StringValue;
        return mkBooleanValue(a.v === b.v);
      },
    },
    false
  );
  operatorOverloads.binary(
    CoreOpId.NotEqualTo,
    CoreTypeIds.String,
    CoreTypeIds.String,
    CoreTypeIds.Boolean,
    {
      exec: (_ctx: ExecutionContext, args: MapValue) => {
        const a = args.v.get(0) as StringValue;
        const b = args.v.get(1) as StringValue;
        return mkBooleanValue(a.v !== b.v);
      },
    },
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
}
