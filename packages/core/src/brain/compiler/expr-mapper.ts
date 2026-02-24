import { Dict } from "../../platform/dict";
import type { ReadonlyList } from "../../platform/list";
import type {
  ActuatorExpr,
  AssignmentExpr,
  BinaryOpExpr,
  EmptyExpr,
  ErrorExpr,
  Expr,
  ExprVisitor,
  FieldAccessExpr,
  LiteralExpr,
  ModifierExpr,
  ParameterExpr,
  SensorExpr,
  UnaryOpExpr,
  VariableExpr,
} from "./types";
import { acceptExprVisitor } from "./types";

class ExprMapperVisitor implements ExprVisitor<void> {
  nodes = new Dict<number, Expr>();

  visitBinaryOp(expr: BinaryOpExpr): void {
    this.nodes.set(expr.nodeId, expr);
    acceptExprVisitor(expr.left, this);
    acceptExprVisitor(expr.right, this);
  }

  visitUnaryOp(expr: UnaryOpExpr): void {
    this.nodes.set(expr.nodeId, expr);
    acceptExprVisitor(expr.operand, this);
  }
  visitLiteral(expr: LiteralExpr): void {
    this.nodes.set(expr.nodeId, expr);
  }
  visitVariable(expr: VariableExpr): void {
    this.nodes.set(expr.nodeId, expr);
  }
  visitAssignment(expr: AssignmentExpr): void {
    this.nodes.set(expr.nodeId, expr);
    acceptExprVisitor(expr.target, this);
    acceptExprVisitor(expr.value, this);
  }
  visitParameter(expr: ParameterExpr): void {
    this.nodes.set(expr.nodeId, expr);
    acceptExprVisitor(expr.value, this);
  }
  visitModifier(expr: ModifierExpr): void {
    this.nodes.set(expr.nodeId, expr);
  }
  visitActuator(expr: ActuatorExpr): void {
    this.nodes.set(expr.nodeId, expr);
    expr.anons.forEach((e) => {
      acceptExprVisitor(e.expr, this);
    });
    expr.parameters.forEach((e) => {
      acceptExprVisitor(e.expr, this);
    });
    expr.modifiers.forEach((e) => {
      acceptExprVisitor(e.expr, this);
    });
  }
  visitSensor(expr: SensorExpr): void {
    this.nodes.set(expr.nodeId, expr);
    expr.anons.forEach((e) => {
      acceptExprVisitor(e.expr, this);
    });
    expr.parameters.forEach((e) => {
      acceptExprVisitor(e.expr, this);
    });
    expr.modifiers.forEach((e) => {
      acceptExprVisitor(e.expr, this);
    });
  }
  visitFieldAccess(expr: FieldAccessExpr): void {
    this.nodes.set(expr.nodeId, expr);
    acceptExprVisitor(expr.object, this);
  }
  visitEmpty(expr: EmptyExpr): void {
    this.nodes.set(expr.nodeId, expr);
  }
  visitError(expr: ErrorExpr): void {
    this.nodes.set(expr.nodeId, expr);
    if (expr.expr) {
      acceptExprVisitor(expr.expr, this);
    }
  }
}

/**
 * Creates a dictionary mapping node IDs to expression nodes by traversing an expression tree.
 *
 * Performs a depth-first traversal of all expressions in the provided list, visiting each
 * expression node and its children recursively. Returns a dictionary where keys are node IDs
 * and values are the corresponding expression objects.
 *
 * @param exprs - A list of root expression nodes to traverse
 * @returns A dictionary mapping each expression's `nodeId` to the expression object itself
 */
export function mapExprs(exprs: ReadonlyList<Expr>): Dict<number, Expr> {
  const visitor = new ExprMapperVisitor();
  exprs.forEach((expr) => {
    acceptExprVisitor(expr, visitor);
  });
  return visitor.nodes;
}
