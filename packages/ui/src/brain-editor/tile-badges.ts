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
  ParseResult,
  SensorExpr,
  Span,
  UnaryOpExpr,
  VariableExpr,
} from "@mindcraft-lang/core/brain";
import { acceptExprVisitor } from "@mindcraft-lang/core/brain";
import type { TypeInfoDiag } from "@mindcraft-lang/core/brain/compiler";
import { ParseDiagCode, TypeDiagCode } from "@mindcraft-lang/core/brain/compiler";

export interface TileBadge {
  type: "error" | "warning";
  message: string;
}

const parseDiagMessages: Record<number, string> = {
  [ParseDiagCode.UnexpectedTokenAfterExpression]: "Unexpected token after expression",
  [ParseDiagCode.ExpectedExpressionFoundEOF]: "Expected expression",
  [ParseDiagCode.UnexpectedActionCallAfterExpression]: "Unexpected action after expression",
  [ParseDiagCode.UnexpectedExpressionAfterExpression]: "Unexpected expression",
  [ParseDiagCode.ExpectedSensorOrActuator]: "Expected sensor or actuator",
  [ParseDiagCode.ActionCallParseFailure]: "Missing or invalid action arguments",
  [ParseDiagCode.UnexpectedActionCallKind]: "Unexpected action kind",
  [ParseDiagCode.ExpectedExpressionInSubExpr]: "Expected expression",
  [ParseDiagCode.UnexpectedTokenKindInExpression]: "Unexpected token",
  [ParseDiagCode.UnexpectedOperatorInExpression]: "Unexpected operator",
  [ParseDiagCode.ExpectedClosingParen]: "Missing closing parenthesis",
  [ParseDiagCode.UnexpectedControlFlowInExpression]: "Unexpected control flow",
  [ParseDiagCode.UnknownOperator]: "Unknown operator",
  [ParseDiagCode.InvalidAssignmentTarget]: "Invalid assignment target",
  [ParseDiagCode.ReadOnlyFieldAssignment]: "Cannot assign to read-only field",
};

const typeDiagMessages: Record<number, string> = {
  [TypeDiagCode.NoOverloadForBinaryOp]: "No matching operator for these types",
  [TypeDiagCode.NoOverloadForUnaryOp]: "No matching operator for this type",
  [TypeDiagCode.DataTypeMismatch]: "Type mismatch",
  [TypeDiagCode.TileTypeMismatch]: "Type mismatch",
  [TypeDiagCode.TileNotFound]: "Tile not found",
  [TypeDiagCode.DataTypeConverted]: "Type conversion applied",
};

function diagMessage(code: number): string {
  return parseDiagMessages[code] ?? typeDiagMessages[code] ?? "Parse error";
}

/**
 * Builds a nodeId -> Expr lookup from a per-side parse result's expression list.
 * Used to resolve TypeInfoDiag nodeIds to tile spans.
 */
export function buildNodeMap(parseResult: ParseResult): Map<number, Expr> {
  const map = new Map<number, Expr>();
  const collector = new NodeMapCollector(map);
  for (let i = 0; i < parseResult.exprs.size(); i++) {
    acceptExprVisitor(parseResult.exprs.get(i), collector);
  }
  return map;
}

/**
 * Computes a map of tile index -> badge type from a per-side parse result.
 *
 * Error badges: tiles covered by ErrorExpr nodes -- either the first expression
 * is itself an ErrorExpr, or additional expressions (position > 0) which are
 * always error-recovery artifacts.
 *
 * Warning badges: tiles in the main (first, non-error) expression that belong
 * to incomplete sub-expressions -- a parameter tile with no value supplied, the
 * operator tile in a binary op with no RHS, a prefix operator with no operand,
 * or an assignment with no value.
 */
export function computeTileBadges(
  parseResult: ParseResult,
  typeDiags?: ReadonlyArray<TypeInfoDiag>,
  nodeMap?: Map<number, Expr>
): Map<number, TileBadge> {
  const badges = new Map<number, TileBadge>();
  const exprs = parseResult.exprs;

  if (exprs.size() === 0) return badges;

  const firstExpr = exprs.get(0);

  if (firstExpr.kind === "errorExpr") {
    markSpanWithBadge(badges, firstExpr.span, "error", "Parse error");
  } else {
    acceptExprVisitor(firstExpr, new WarningCollector(badges));
  }

  for (let i = 1; i < exprs.size(); i++) {
    const expr = exprs.get(i);
    markAllTiles(expr, badges, "error", "Unexpected expression");
  }

  const diagSpanWidth = new Map<number, number>();
  const applyDiag = (tileIndex: number, width: number, msg: string): boolean => {
    const prevWidth = diagSpanWidth.get(tileIndex);
    if (prevWidth !== undefined && width >= prevWidth) return false;
    diagSpanWidth.set(tileIndex, width);
    const existing = badges.get(tileIndex);
    if (existing) {
      badges.set(tileIndex, { type: existing.type, message: msg });
    } else {
      badges.set(tileIndex, { type: "warning", message: msg });
    }
    return true;
  };
  parseResult.diags.forEach((diag) => {
    const msg = diagMessage(diag.code);
    const width = diag.span.to - diag.span.from;
    if (width === 0 && diag.span.from > 0) {
      applyDiag(diag.span.from - 1, width, msg);
    } else {
      for (let i = diag.span.from; i < diag.span.to; i++) {
        if (applyDiag(i, width, msg)) break;
      }
    }
  });

  if (typeDiags && nodeMap) {
    for (const diag of typeDiags) {
      if (diag.code === TypeDiagCode.DataTypeConverted) continue;
      const node = nodeMap.get(diag.nodeId);
      if (!node || !("span" in node) || !node.span) continue;
      const span = node.span as Span;
      const msg = diagMessage(diag.code);
      const width = span.to - span.from;
      if (width === 0 && span.from > 0) {
        applyDiag(span.from - 1, width, msg);
      } else {
        for (let i = span.from; i < span.to; i++) {
          if (applyDiag(i, width, msg)) break;
        }
      }
    }
  }

  return badges;
}

/**
 * Marks all tile indices in a span with the given badge, without downgrading
 * an existing error to a warning.
 */
function markSpanWithBadge(
  badges: Map<number, TileBadge>,
  span: Span | undefined,
  type: "error" | "warning",
  message: string
): void {
  if (!span) return;
  for (let i = span.from; i < span.to; i++) {
    setBadge(badges, i, type, message);
  }
}

/**
 * Sets a badge on a tile index, preferring error over warning (never downgrade).
 */
function setBadge(badges: Map<number, TileBadge>, tileIndex: number, type: "error" | "warning", message: string): void {
  const existing = badges.get(tileIndex);
  if (existing?.type === "error") return;
  badges.set(tileIndex, { type, message });
}

/**
 * Recursively marks all tiles covered by an expression and its children with
 * the given badge.
 */
function markAllTiles(expr: Expr, badges: Map<number, TileBadge>, type: "error" | "warning", message: string): void {
  acceptExprVisitor(expr, new MarkAllVisitor(badges, type, message));
}

class MarkAllVisitor implements ExprVisitor<void> {
  constructor(
    private readonly badges: Map<number, TileBadge>,
    private readonly type: "error" | "warning",
    private readonly message: string
  ) {}

  private markAndRecurse(expr: Expr): void {
    if ("span" in expr && expr.span) {
      markSpanWithBadge(this.badges, expr.span as Span, this.type, this.message);
    }
  }

  visitBinaryOp(expr: BinaryOpExpr): void {
    this.markAndRecurse(expr);
    acceptExprVisitor(expr.left, this);
    acceptExprVisitor(expr.right, this);
  }
  visitUnaryOp(expr: UnaryOpExpr): void {
    this.markAndRecurse(expr);
    acceptExprVisitor(expr.operand, this);
  }
  visitLiteral(expr: LiteralExpr): void {
    this.markAndRecurse(expr);
  }
  visitVariable(expr: VariableExpr): void {
    this.markAndRecurse(expr);
  }
  visitAssignment(expr: AssignmentExpr): void {
    this.markAndRecurse(expr);
    acceptExprVisitor(expr.target, this);
    acceptExprVisitor(expr.value, this);
  }
  visitParameter(expr: ParameterExpr): void {
    this.markAndRecurse(expr);
    acceptExprVisitor(expr.value, this);
  }
  visitModifier(expr: ModifierExpr): void {
    this.markAndRecurse(expr);
  }
  visitActuator(expr: ActuatorExpr): void {
    this.markAndRecurse(expr);
    this.visitSlots(expr);
  }
  visitSensor(expr: SensorExpr): void {
    this.markAndRecurse(expr);
    this.visitSlots(expr);
  }
  visitFieldAccess(expr: FieldAccessExpr): void {
    this.markAndRecurse(expr);
    acceptExprVisitor(expr.object, this);
  }
  visitEmpty(_expr: EmptyExpr): void {}
  visitError(expr: ErrorExpr): void {
    if (expr.span) {
      markSpanWithBadge(this.badges, expr.span, this.type, this.message);
    }
    if (expr.expr) acceptExprVisitor(expr.expr, this);
  }

  private visitSlots(expr: ActuatorExpr | SensorExpr): void {
    for (const slotList of [expr.anons, expr.parameters, expr.modifiers]) {
      slotList.forEach((slot) => {
        acceptExprVisitor(slot.expr, this);
      });
    }
  }
}

class WarningCollector implements ExprVisitor<void> {
  constructor(private readonly badges: Map<number, TileBadge>) {}

  visitBinaryOp(expr: BinaryOpExpr): void {
    acceptExprVisitor(expr.left, this);
    if (expr.right.kind === "errorExpr") {
      if (expr.left.kind !== "empty" && expr.left.span) {
        setBadge(this.badges, expr.left.span.to, "warning", "Missing right operand");
      } else if (expr.span) {
        setBadge(this.badges, expr.span.from, "warning", "Missing right operand");
      }
    } else {
      acceptExprVisitor(expr.right, this);
    }
  }

  visitUnaryOp(expr: UnaryOpExpr): void {
    if (expr.operand.kind === "errorExpr") {
      if (expr.span) {
        setBadge(this.badges, expr.span.from, "warning", "Missing operand");
      }
    } else {
      acceptExprVisitor(expr.operand, this);
    }
  }

  visitLiteral(_expr: LiteralExpr): void {}
  visitVariable(_expr: VariableExpr): void {}

  visitAssignment(expr: AssignmentExpr): void {
    acceptExprVisitor(expr.target, this);
    if (expr.value.kind === "errorExpr") {
      if (expr.target.span) {
        setBadge(this.badges, expr.target.span.to, "warning", "Missing value");
      }
    } else {
      acceptExprVisitor(expr.value, this);
    }
  }

  visitParameter(expr: ParameterExpr): void {
    if (expr.value.kind === "errorExpr") {
      if (expr.span) {
        setBadge(this.badges, expr.span.from, "warning", "Missing value");
      }
    } else {
      acceptExprVisitor(expr.value, this);
    }
  }

  visitModifier(_expr: ModifierExpr): void {}

  visitActuator(expr: ActuatorExpr): void {
    this.visitSlots(expr);
  }

  visitSensor(expr: SensorExpr): void {
    this.visitSlots(expr);
  }

  visitFieldAccess(expr: FieldAccessExpr): void {
    acceptExprVisitor(expr.object, this);
  }

  visitEmpty(_expr: EmptyExpr): void {}

  visitError(expr: ErrorExpr): void {
    markSpanWithBadge(this.badges, expr.span, "error", "Parse error");
    if (expr.expr) {
      markAllTiles(expr.expr, this.badges, "error", "Parse error");
    }
  }

  private visitSlots(expr: ActuatorExpr | SensorExpr): void {
    for (const slotList of [expr.anons, expr.parameters, expr.modifiers]) {
      slotList.forEach((slot) => {
        acceptExprVisitor(slot.expr, this);
      });
    }
  }
}

class NodeMapCollector implements ExprVisitor<void> {
  constructor(private readonly map: Map<number, Expr>) {}

  private add(expr: Expr & { nodeId: number }): void {
    this.map.set(expr.nodeId, expr);
  }

  visitBinaryOp(expr: BinaryOpExpr): void {
    this.add(expr);
    acceptExprVisitor(expr.left, this);
    acceptExprVisitor(expr.right, this);
  }
  visitUnaryOp(expr: UnaryOpExpr): void {
    this.add(expr);
    acceptExprVisitor(expr.operand, this);
  }
  visitLiteral(expr: LiteralExpr): void {
    this.add(expr);
  }
  visitVariable(expr: VariableExpr): void {
    this.add(expr);
  }
  visitAssignment(expr: AssignmentExpr): void {
    this.add(expr);
    acceptExprVisitor(expr.target, this);
    acceptExprVisitor(expr.value, this);
  }
  visitParameter(expr: ParameterExpr): void {
    this.add(expr);
    acceptExprVisitor(expr.value, this);
  }
  visitModifier(expr: ModifierExpr): void {
    this.add(expr);
  }
  visitActuator(expr: ActuatorExpr): void {
    this.add(expr);
    this.visitSlots(expr);
  }
  visitSensor(expr: SensorExpr): void {
    this.add(expr);
    this.visitSlots(expr);
  }
  visitFieldAccess(expr: FieldAccessExpr): void {
    this.add(expr);
    acceptExprVisitor(expr.object, this);
  }
  visitEmpty(expr: EmptyExpr): void {
    this.add(expr);
  }
  visitError(expr: ErrorExpr): void {
    this.add(expr);
    if (expr.expr) acceptExprVisitor(expr.expr, this);
  }

  private visitSlots(expr: ActuatorExpr | SensorExpr): void {
    for (const slotList of [expr.anons, expr.parameters, expr.modifiers]) {
      slotList.forEach((slot) => {
        acceptExprVisitor(slot.expr, this);
      });
    }
  }
}
