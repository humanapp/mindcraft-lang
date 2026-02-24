import { CoreTypeNames } from "../interfaces";
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
import { acceptExprVisitor, type TypeEnv, type TypeInfo } from "./types";

class ExpectedTypeVisitor implements ExprVisitor<void> {
  constructor(private readonly env: TypeEnv) {}

  private ensureTypeInfo(nodeId: number): TypeInfo {
    let typeInfo = this.env.get(nodeId);
    if (!typeInfo) {
      typeInfo = { inferred: CoreTypeNames.Unknown, expected: CoreTypeNames.Unknown };
      this.env.set(nodeId, typeInfo);
    }
    return typeInfo;
  }
  visitBinaryOp(expr: BinaryOpExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    acceptExprVisitor(expr.left, this);
    acceptExprVisitor(expr.right, this);
  }

  visitUnaryOp(expr: UnaryOpExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    acceptExprVisitor(expr.operand, this);
  }
  visitLiteral(expr: LiteralExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    typeInfo.inferred = expr.tileDef.valueType;
  }
  visitVariable(expr: VariableExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    typeInfo.isLVal = true;
    typeInfo.expected = expr.tileDef.varType;
  }
  visitAssignment(expr: AssignmentExpr): void {
    // For assignments, propagate expected type to the value expression
    acceptExprVisitor(expr.target, this);
    acceptExprVisitor(expr.value, this);
  }
  visitParameter(expr: ParameterExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    typeInfo.expected = expr.tileDef.dataType;
    acceptExprVisitor(expr.value, this);
  }
  visitModifier(expr: ModifierExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    typeInfo.expected = CoreTypeNames.Void;
  }
  visitActuator(expr: ActuatorExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    typeInfo.expected = CoreTypeNames.Void;
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
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    typeInfo.expected = expr.tileDef.outputType;
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
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    typeInfo.expected = expr.accessor.fieldTypeId;
    acceptExprVisitor(expr.object, this);
  }
  visitEmpty(expr: EmptyExpr): void {
    this.ensureTypeInfo(expr.nodeId);
  }
  visitError(expr: ErrorExpr): void {
    this.ensureTypeInfo(expr.nodeId);
    if (expr.expr) {
      acceptExprVisitor(expr.expr, this);
    }
  }
}

/**
 * Computes and populates expected type information for all nodes in an expression tree.
 *
 * Traverses the expression tree depth-first, analyzing each node and populating the provided
 * type environment with type information. For each expression node, this function determines
 * the expected type based on the node's context (e.g., variable types, parameter types,
 * sensor output types) and marks l-values as appropriate.
 *
 * @param expr - The root expression node to analyze
 * @param env - The type environment to populate with expected type information for each node
 */
export function computeExpectedTypes(expr: Expr, env: TypeEnv): void {
  const visitor = new ExpectedTypeVisitor(env);
  acceptExprVisitor(expr, visitor);
}
