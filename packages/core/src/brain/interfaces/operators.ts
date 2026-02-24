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
  Negate: "neg",
  EqualTo: "eq",
  NotEqualTo: "ne",
  LessThan: "lt",
  LessThanOrEqualTo: "le",
  GreaterThan: "gt",
  GreaterThanOrEqualTo: "ge",
  Assign: "assign",
} as const;

export type OpId = string;

export type OpAssoc = "left" | "right" | "none";
export type OpFixity = "infix" | "prefix" | "postfix";

export interface OpParse {
  fixity: OpFixity;
  precedence: number; // higher binds tighter
  assoc?: OpAssoc; // only meaningful for infix
}

export type OpSpec = {
  id: OpId;
  parse: OpParse;
};

export type OpOverload = {
  argTypes: TypeId[];
  resultType: TypeId;
  fnEntry: BrainFunctionEntry;
};

export interface IReadOnlyRegisteredOperator {
  readonly id: OpId;
  readonly parse: OpParse;
  get(argTypes: TypeId[]): OpOverload | undefined;
  /** Returns all registered overloads for this operator. */
  overloads(): ReadonlyList<OpOverload>;
}

export interface IRegisteredOperator extends IReadOnlyRegisteredOperator {
  add(overload: OpOverload): void;
}

export interface IOperatorTable {
  add(op: OpSpec): IRegisteredOperator;
  get(id: OpId): IRegisteredOperator | undefined;
}

export interface IOperatorOverloads {
  table(): IOperatorTable;
  binary(op: OpId, lhs: TypeId, rhs: TypeId, result: TypeId, fn: HostFn, isAsync: boolean): IRegisteredOperator;
  unary(op: OpId, arg: TypeId, result: TypeId, fn: HostFn, isAsync: boolean): IRegisteredOperator;
  resolve(id: OpId, argTypes: TypeId[]): { overload: OpOverload; parse: OpParse } | undefined;
}
