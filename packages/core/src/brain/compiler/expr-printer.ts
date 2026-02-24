import type { ReadonlyList } from "../../platform/list";
import { StringUtils as SU } from "../../platform/string";
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

/**
 * Printer visitor that outputs a human-readable representation of an Expr tree.
 * Useful for debugging and understanding the structure of parsed expressions.
 */
export class ExprPrinter implements ExprVisitor<string> {
  constructor(private readonly indent: number = 0) {}

  private getIndent(): string {
    return SU.rep("  ", this.indent);
  }

  private child(): ExprPrinter {
    return new ExprPrinter(this.indent + 1);
  }

  visitBinaryOp(expr: BinaryOpExpr): string {
    const leftStr = acceptExprVisitor(expr.left, this.child());
    const rightStr = acceptExprVisitor(expr.right, this.child());
    return `${this.getIndent()}BinaryOp[${expr.operator.op.id}] (${expr.span.from}-${expr.span.to}) #${expr.nodeId}\n${leftStr}\n${rightStr}`;
  }

  visitUnaryOp(expr: UnaryOpExpr): string {
    const operandStr = acceptExprVisitor(expr.operand, this.child());
    return `${this.getIndent()}UnaryOp[${expr.operator.op.id}] (${expr.span.from}-${expr.span.to}) #${expr.nodeId}\n${operandStr}`;
  }

  visitLiteral(expr: LiteralExpr): string {
    return `${this.getIndent()}Literal[${expr.tileDef.valueLabel || expr.tileDef.value}] (${expr.span.from}-${expr.span.to}) #${expr.nodeId}`;
  }

  visitVariable(expr: VariableExpr): string {
    return `${this.getIndent()}Variable[${expr.tileDef.varName}] (${expr.span.from}-${expr.span.to}) #${expr.nodeId}`;
  }

  visitAssignment(expr: AssignmentExpr): string {
    const targetStr = acceptExprVisitor(expr.target, this.child());
    const valueStr = acceptExprVisitor(expr.value, this.child());
    return `${this.getIndent()}Assignment (${expr.span.from}-${expr.span.to}) #${expr.nodeId}\n${targetStr}\n${valueStr}`;
  }

  visitParameter(expr: ParameterExpr): string {
    const valueStr = acceptExprVisitor(expr.value, this.child());
    return `${this.getIndent()}Parameter[${expr.tileDef.parameterId}] (${expr.span.from}-${expr.span.to}) #${expr.nodeId}\n${valueStr}`;
  }

  visitModifier(expr: ModifierExpr): string {
    return `${this.getIndent()}Modifier[${expr.tileDef.modifierId}] (${expr.span.from}-${expr.span.to}) #${expr.nodeId}`;
  }

  visitActuator(expr: ActuatorExpr): string {
    let result = `${this.getIndent()}Actuator[${expr.tileDef.actuatorId}] (${expr.span.from}-${expr.span.to}) #${expr.nodeId}`;

    if (expr.anons.size() > 0) {
      result += `\n${this.getIndent()}  Anons:`;
      for (let i = 0; i < expr.anons.size(); i++) {
        result += `\n${acceptExprVisitor(expr.anons.get(i).expr, this.child().child())}`;
      }
    }

    if (expr.parameters.size() > 0) {
      result += `\n${this.getIndent()}  Parameters:`;
      for (let i = 0; i < expr.parameters.size(); i++) {
        result += `\n${acceptExprVisitor(expr.parameters.get(i).expr, this.child().child())}`;
      }
    }

    if (expr.modifiers.size() > 0) {
      result += `\n${this.getIndent()}  Modifiers:`;
      for (let i = 0; i < expr.modifiers.size(); i++) {
        result += `\n${acceptExprVisitor(expr.modifiers.get(i).expr, this.child().child())}`;
      }
    }

    return result;
  }

  visitSensor(expr: SensorExpr): string {
    let result = `${this.getIndent()}Sensor[${expr.tileDef.sensorId}] (${expr.span.from}-${expr.span.to}) #${expr.nodeId}`;

    if (expr.anons.size() > 0) {
      result += `\n${this.getIndent()}  Anons:`;
      for (let i = 0; i < expr.anons.size(); i++) {
        result += `\n${acceptExprVisitor(expr.anons.get(i).expr, this.child().child())}`;
      }
    }

    if (expr.parameters.size() > 0) {
      result += `\n${this.getIndent()}  Parameters:`;
      for (let i = 0; i < expr.parameters.size(); i++) {
        result += `\n${acceptExprVisitor(expr.parameters.get(i).expr, this.child().child())}`;
      }
    }

    if (expr.modifiers.size() > 0) {
      result += `\n${this.getIndent()}  Modifiers:`;
      for (let i = 0; i < expr.modifiers.size(); i++) {
        result += `\n${acceptExprVisitor(expr.modifiers.get(i).expr, this.child().child())}`;
      }
    }

    return result;
  }

  visitFieldAccess(expr: FieldAccessExpr): string {
    const objectStr = acceptExprVisitor(expr.object, this.child());
    return `${this.getIndent()}FieldAccess[${expr.accessor.fieldName}] (${expr.span.from}-${expr.span.to}) #${expr.nodeId}\n${objectStr}`;
  }

  visitEmpty(expr: EmptyExpr): string {
    return `${this.getIndent()}Empty #${expr.nodeId}`;
  }

  visitError(expr: ErrorExpr): string {
    const spanStr = expr.span ? ` (${expr.span.from}-${expr.span.to})` : "";
    let result = `${this.getIndent()}Error: ${expr.message}${spanStr} #${expr.nodeId}`;
    if (expr.expr) {
      result += `\n${this.getIndent()}  Expr:\n${acceptExprVisitor(expr.expr, this.child().child())}`;
    }
    return result;
  }
}

/**
 * Helper function to print an Expr tree to a string for debugging.
 */
export function printExpr(exprs: ReadonlyList<Expr>): string {
  let result = "";
  for (let i = 0; i < exprs.size(); i++) {
    const expr = exprs.get(i);
    result += acceptExprVisitor(expr, new ExprPrinter());
    if (i < exprs.size() - 1) {
      result += "\n";
    }
  }
  return result;
}
