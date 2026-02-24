/**
 * Core type definitions for the brain parser and AST.
 *
 * This module contains pure type definitions with no circular dependencies.
 * It forms the foundation layer that both ifaces.ts and implementation files can import.
 */

import type { Dict } from "../../platform/dict";
import type { List, ReadonlyList } from "../../platform/list";
import type { Conversion } from "../interfaces";
import type { OpOverload } from "../interfaces/operators";
import type { TypeId } from "../interfaces/type-system";
import type {
  BrainTileAccessorDef,
  BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileModifierDef,
  BrainTileOperatorDef,
  BrainTileParameterDef,
  BrainTileSensorDef,
  BrainTileVariableDef,
} from "../tiles";
import type { DiagCode } from "./diag-codes";

/**
 * Parse diagnostic (error or warning) with source location.
 */
export interface ParseDiag {
  code: DiagCode;
  message: string;
  span: Span;
}

/**
 * Complete parse result including both AST and diagnostics.
 *
 * Philosophy: We always return a result, even on errors. This allows:
 * - IDE features (autocomplete, hover) to work on partially-valid input
 * - Multiple errors to be reported in a single parse pass
 * - Incremental parsing where some regions have errors but others are valid
 */
export interface ParseResult {
  exprs: ReadonlyList<Expr>;
  diags: ReadonlyList<ParseDiag>;
}

/**
 * Source location span using half-open interval [from, to).
 * This convention (inclusive start, exclusive end) simplifies span arithmetic:
 * - Empty spans are valid (from === to)
 * - Adjacent spans naturally compose (span1.to === span2.from)
 * - Span length is simply (to - from)
 */
export type Span = {
  from: number; // inclusive
  to: number; // exclusive
};

export type SlotExpr = {
  slotId: number;
  expr: Expr;
};

/**
 * Individual Expr variant types for strong typing in visitor callbacks.
 * Each type represents a specific kind of expression node in the AST.
 */
export type BinaryOpExpr = {
  nodeId: number;
  kind: "binaryOp";
  operator: BrainTileOperatorDef;
  left: Expr;
  right: Expr;
  span: Span;
};
export type UnaryOpExpr = {
  nodeId: number;
  kind: "unaryOp";
  operator: BrainTileOperatorDef;
  operand: Expr;
  span: Span;
};
export type LiteralExpr = {
  nodeId: number;
  kind: "literal";
  tileDef: BrainTileLiteralDef;
  span: Span;
};
export type VariableExpr = {
  nodeId: number;
  kind: "variable";
  tileDef: BrainTileVariableDef;
  span: Span;
};
export type AssignmentExpr = {
  nodeId: number;
  kind: "assignment";
  target: VariableExpr | FieldAccessExpr;
  value: Expr;
  span: Span;
};
export type ParameterExpr = {
  nodeId: number;
  kind: "parameter";
  tileDef: BrainTileParameterDef;
  value: Expr;
  span: Span;
};
export type ModifierExpr = {
  nodeId: number;
  kind: "modifier";
  tileDef: BrainTileModifierDef;
  span: Span;
};
export type ActuatorExpr = {
  nodeId: number;
  kind: "actuator";
  tileDef: BrainTileActuatorDef;
  anons: List<SlotExpr>; // anonymous value inputs (plain args)
  parameters: List<SlotExpr>; // named value inputs (parameter: value)
  modifiers: List<SlotExpr>; // modifier inputs (flags/options)
  span: Span;
};
export type SensorExpr = {
  nodeId: number;
  kind: "sensor";
  tileDef: BrainTileSensorDef;
  anons: List<SlotExpr>; // anonymous value inputs (plain args)
  parameters: List<SlotExpr>; // named value inputs (parameter: value)
  modifiers: List<SlotExpr>; // modifier inputs (flags/options)
  span: Span;
};
export type FieldAccessExpr = {
  nodeId: number;
  kind: "fieldAccess";
  object: Expr;
  accessor: BrainTileAccessorDef;
  span: Span;
};
export type EmptyExpr = { nodeId: number; kind: "empty" }; // Represents intentionally empty input
export type ErrorExpr = {
  nodeId: number;
  kind: "errorExpr";
  expr?: Expr;
  message: string;
  span?: Span;
}; // Parse error with optional partial result

/**
 * Expression AST discriminated union representing all parseable brain tile constructs.
 *
 * Design notes:
 * - Uses discriminated union (not classes) for cross-platform serialization and pattern matching
 * - Every variant except 'empty' and 'errorExpr' includes a span for precise source mapping
 * - Sensors and actuators share structure but are kept distinct for type safety
 * - Anonymous args vs named parameters vs modifiers are segregated to enforce grammar rules
 * - 'errorExpr' can wrap a partial expression, allowing recovery and continued parsing
 */
export type Expr =
  | BinaryOpExpr
  | UnaryOpExpr
  | LiteralExpr
  | VariableExpr
  | AssignmentExpr
  | ParameterExpr
  | ModifierExpr
  | ActuatorExpr
  | SensorExpr
  | FieldAccessExpr
  | EmptyExpr
  | ErrorExpr;

/**
 * Visitor interface for traversing and transforming Expr trees.
 * Each method corresponds to a specific Expr variant and receives a strongly-typed Expr object.
 *
 * The visitor pattern decouples AST traversal from AST structure, enabling:
 * - Multiple backends (VM interpreter, code generator, optimizer) without modifying AST
 * - Type-safe exhaustive handling of all Expr variants via acceptExprVisitor
 * - Composable transformations (e.g., visitors that wrap other visitors)
 * - Strong typing ensures all fields are accessible in each visitor method
 */
export interface ExprVisitor<T> {
  visitBinaryOp(expr: BinaryOpExpr): T;
  visitUnaryOp(expr: UnaryOpExpr): T;
  visitLiteral(expr: LiteralExpr): T;
  visitVariable(expr: VariableExpr): T;
  visitAssignment(expr: AssignmentExpr): T;
  visitParameter(expr: ParameterExpr): T;
  visitModifier(expr: ModifierExpr): T;
  visitActuator(expr: ActuatorExpr): T;
  visitSensor(expr: SensorExpr): T;
  visitFieldAccess(expr: FieldAccessExpr): T;
  visitEmpty(expr: EmptyExpr): T;
  visitError(expr: ErrorExpr): T;
}

/**
 * Accept a visitor and dispatch to the appropriate visit method based on the Expr kind.
 *
 * This function centralizes the type discrimination logic, ensuring:
 * - Exhaustive handling (TypeScript enforces all cases)
 * - Consistent visitor invocation across all consumers
 * - Single point of modification if Expr variants change
 */
export function acceptExprVisitor<T>(expr: Expr, visitor: ExprVisitor<T>): T {
  switch (expr.kind) {
    case "binaryOp":
      return visitor.visitBinaryOp(expr);
    case "unaryOp":
      return visitor.visitUnaryOp(expr);
    case "literal":
      return visitor.visitLiteral(expr);
    case "variable":
      return visitor.visitVariable(expr);
    case "assignment":
      return visitor.visitAssignment(expr);
    case "parameter":
      return visitor.visitParameter(expr);
    case "modifier":
      return visitor.visitModifier(expr);
    case "actuator":
      return visitor.visitActuator(expr);
    case "sensor":
      return visitor.visitSensor(expr);
    case "fieldAccess":
      return visitor.visitFieldAccess(expr);
    case "empty":
      return visitor.visitEmpty(expr);
    case "errorExpr":
      return visitor.visitError(expr);
  }
}

export type TypeInfo = {
  inferred: TypeId;
  expected: TypeId;
  isLVal?: boolean;
  overload?: OpOverload;
  conversion?: Conversion;
};

export type TypeInfoDiag = {
  code: DiagCode;
  nodeId: number;
  message: string;
};

export type TypeEnv = Dict<number, TypeInfo>;
