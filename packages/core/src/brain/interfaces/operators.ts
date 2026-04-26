import type { ReadonlyList } from "../../platform/list";
import type { BrainFunctionEntry } from "./functions";
import type { TypeId } from "./type-system";
import type { HostFn } from "./vm";

/**
 * Identifiers for built-in operators.
 */
export const CoreOpId = {
  And: "and",
  Or: "or",
  Not: "not",
  Add: "add",
  Subtract: "sub",
  Multiply: "mul",
  Divide: "div",
  Modulo: "mod",
  Negate: "neg",
  EqualTo: "eq",
  NotEqualTo: "ne",
  LessThan: "lt",
  LessThanOrEqualTo: "le",
  GreaterThan: "gt",
  GreaterThanOrEqualTo: "ge",
  Power: "pow",
  BitwiseAnd: "bitand",
  BitwiseOr: "bitor",
  BitwiseXor: "bitxor",
  BitwiseNot: "bitnot",
  LeftShift: "shl",
  RightShift: "shr",
  Assign: "assign",
} as const;

/** Operator identifier (e.g. `"add"`, `"eq"`). */
export type OpId = string;

/** Operator associativity. `none` disallows chaining. */
export type OpAssoc = "left" | "right" | "none";

/** Operator fixity. */
export type OpFixity = "infix" | "prefix" | "postfix";

/** Pratt-parser metadata for an operator: precedence (higher binds tighter), fixity, and associativity. */
export interface OpParse {
  fixity: OpFixity;
  precedence: number;
  assoc?: OpAssoc;
}

/** Specification of an operator: its id and parser metadata. */
export type OpSpec = {
  id: OpId;
  parse: OpParse;
};

/** A registered operator overload bound to specific arg types and a host function. */
export type OpOverload = {
  argTypes: TypeId[];
  resultType: TypeId;
  fnEntry: BrainFunctionEntry;
};

/** Read-only view of a registered operator and its overloads. */
export interface IReadOnlyRegisteredOperator {
  readonly id: OpId;
  readonly parse: OpParse;
  get(argTypes: TypeId[]): OpOverload | undefined;
  /** Returns all registered overloads for this operator. */
  overloads(): ReadonlyList<OpOverload>;
}

/** Mutable operator: add or remove typed overloads. */
export interface IRegisteredOperator extends IReadOnlyRegisteredOperator {
  add(overload: OpOverload): void;
  remove(argTypes: TypeId[]): boolean;
}

/** Registry of operator specs keyed by `OpId`. */
export interface IOperatorTable {
  add(op: OpSpec): IRegisteredOperator;
  get(id: OpId): IRegisteredOperator | undefined;
}

/** High-level operator/overload registry combining the operator table with type-aware lookup. */
export interface IOperatorOverloads {
  table(): IOperatorTable;
  binary(op: OpId, lhs: TypeId, rhs: TypeId, result: TypeId, fn: HostFn, isAsync: boolean): IRegisteredOperator;
  unary(op: OpId, arg: TypeId, result: TypeId, fn: HostFn, isAsync: boolean): IRegisteredOperator;
  remove(op: OpId, argTypes: TypeId[]): boolean;
  resolve(id: OpId, argTypes: TypeId[]): { overload: OpOverload; parse: OpParse } | undefined;
}
