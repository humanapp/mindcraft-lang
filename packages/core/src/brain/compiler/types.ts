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
  /** Next available node ID after parsing (for chaining multiple parse passes with unique IDs). */
  nextNodeId: number;
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

/** A single arg slot bound to an expression, used by sensors/actuators/parameters. */
export type SlotExpr = {
  slotId: number;
  expr: Expr;
};

/** AST node for a binary operator expression (e.g. `a + b`). */
export type BinaryOpExpr = {
  nodeId: number;
  kind: "binaryOp";
  operator: BrainTileOperatorDef;
  left: Expr;
  right: Expr;
  span: Span;
};
/** AST node for a prefix/postfix unary operator expression (e.g. `-x`). */
export type UnaryOpExpr = {
  nodeId: number;
  kind: "unaryOp";
  operator: BrainTileOperatorDef;
  operand: Expr;
  span: Span;
};
/** AST node for a literal value tile. */
export type LiteralExpr = {
  nodeId: number;
  kind: "literal";
  tileDef: BrainTileLiteralDef;
  span: Span;
};
/** AST node for a variable read tile. */
export type VariableExpr = {
  nodeId: number;
  kind: "variable";
  tileDef: BrainTileVariableDef;
  span: Span;
};
/** AST node for an assignment to a variable or struct field. */
export type AssignmentExpr = {
  nodeId: number;
  kind: "assignment";
  target: VariableExpr | FieldAccessExpr;
  value: Expr;
  span: Span;
};
/** AST node for a named parameter passed to a sensor/actuator. */
export type ParameterExpr = {
  nodeId: number;
  kind: "parameter";
  tileDef: BrainTileParameterDef;
  value: Expr;
  span: Span;
};
/** AST node for a modifier (flag/option) tile. */
export type ModifierExpr = {
  nodeId: number;
  kind: "modifier";
  tileDef: BrainTileModifierDef;
  span: Span;
};
/** AST node for an actuator call: anonymous args, named parameters, and modifier flags. */
export type ActuatorExpr = {
  nodeId: number;
  kind: "actuator";
  tileDef: BrainTileActuatorDef;
  anons: List<SlotExpr>;
  parameters: List<SlotExpr>;
  modifiers: List<SlotExpr>;
  span: Span;
};
/** AST node for a sensor call: anonymous args, named parameters, and modifier flags. */
export type SensorExpr = {
  nodeId: number;
  kind: "sensor";
  tileDef: BrainTileSensorDef;
  anons: List<SlotExpr>;
  parameters: List<SlotExpr>;
  modifiers: List<SlotExpr>;
  span: Span;
};
/** AST node for a field access on a struct expression (e.g. `obj.field`). */
export type FieldAccessExpr = {
  nodeId: number;
  kind: "fieldAccess";
  object: Expr;
  accessor: BrainTileAccessorDef;
  span: Span;
};
/** AST node representing an intentionally empty input slot. */
export type EmptyExpr = { nodeId: number; kind: "empty" };
/** AST node representing a parse error, optionally wrapping a partial expression. */
export type ErrorExpr = {
  nodeId: number;
  kind: "errorExpr";
  expr?: Expr;
  message: string;
  span?: Span;
};

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

/** Per-node type information: inferred type, expected type, and optional overload/conversion bindings. */
export type TypeInfo = {
  inferred: TypeId;
  expected: TypeId;
  isLVal?: boolean;
  overload?: OpOverload;
  conversion?: Conversion;
};

/** Type-checking diagnostic attached to a specific AST node. */
export type TypeInfoDiag = {
  code: DiagCode;
  nodeId: number;
  message: string;
};

/** Map from AST `nodeId` to its {@link TypeInfo}. */
export type TypeEnv = Dict<number, TypeInfo>;
