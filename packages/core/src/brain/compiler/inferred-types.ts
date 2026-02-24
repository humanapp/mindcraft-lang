import { List, type ReadonlyList } from "../../platform/list";
import { type BrainActionArgSlot, CoreTypeNames, type IBrainTileDef, type ITileCatalog } from "../interfaces";
import { getBrainServices } from "../services";
import type { BrainTileParameterDef } from "../tiles";
import { TypeDiagCode } from "./diag-codes";
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
import { acceptExprVisitor, type TypeEnv, type TypeInfo, type TypeInfoDiag } from "./types";

class InferredTypeVisitor implements ExprVisitor<void> {
  diags = List.empty<TypeInfoDiag>();

  constructor(
    private readonly catalogs: ReadonlyList<ITileCatalog>,
    private readonly env: TypeEnv
  ) {}

  private ensureTypeInfo(nodeId: number): TypeInfo {
    let typeInfo = this.env.get(nodeId);
    if (!typeInfo) {
      typeInfo = { inferred: CoreTypeNames.Unknown, expected: CoreTypeNames.Unknown };
      this.env.set(nodeId, typeInfo);
    }
    return typeInfo;
  }

  private findTileDefById(tileId: string): IBrainTileDef | undefined {
    for (let i = 0; i < this.catalogs.size(); i++) {
      const catalog = this.catalogs.get(i);
      const tileDef = catalog.get(tileId);
      if (tileDef) {
        return tileDef;
      }
    }
    return undefined;
  }

  private validateActionCallSlot(
    slotEntry: { slotId: number; expr: Expr },
    argSlots: ReadonlyList<BrainActionArgSlot>,
    context: string,
    slotType: "anonymous" | "parameter"
  ): void {
    const typeInfo = this.env.get(slotEntry.expr.nodeId);
    if (!typeInfo) return;

    const slotDef = argSlots.get(slotEntry.slotId);
    const tileId = slotDef.argSpec.tileId;
    const tileDef = this.findTileDefById(tileId);

    if (!tileDef) {
      this.diags.push({
        code: TypeDiagCode.TileNotFound,
        nodeId: slotEntry.expr.nodeId,
        message: `${context} ${slotType} slot references unknown tileId ${tileId}`,
      });
      return;
    }

    if (tileDef.kind !== "parameter") {
      this.diags.push({
        code: TypeDiagCode.TileTypeMismatch,
        nodeId: slotEntry.expr.nodeId,
        message: `${context} ${slotType} slot references non-parameter tileId ${tileId}`,
      });
      return;
    }

    const parmTileDef = tileDef as BrainTileParameterDef;
    const slotTileType = parmTileDef.dataType;

    // If this slot is part of a choice group, check if the type matches any option in the choice
    if (slotDef.choiceGroup !== undefined) {
      // Find all slots in this choice group
      const choiceSlots = argSlots.filter((s) => s.choiceGroup === slotDef.choiceGroup);

      // Check if any choice option accepts this type
      let matchFound = false;
      choiceSlots.forEach((choiceSlot) => {
        const choiceTileDef = this.findTileDefById(choiceSlot.argSpec.tileId);
        if (choiceTileDef && choiceTileDef.kind === "parameter") {
          const choiceParmTileDef = choiceTileDef as BrainTileParameterDef;
          if (typeInfo.inferred === choiceParmTileDef.dataType) {
            matchFound = true;
          }
        }
      });

      if (!matchFound) {
        const expectedTypes: string[] = [];
        choiceSlots.forEach((s) => {
          const td = this.findTileDefById(s.argSpec.tileId);
          if (td && td.kind === "parameter") {
            expectedTypes.push((td as BrainTileParameterDef).dataType);
          } else {
            expectedTypes.push("invalid choice option"); // to indicate an invalid choice option
          }
        });
        this.diags.push({
          code: TypeDiagCode.DataTypeMismatch,
          nodeId: slotEntry.expr.nodeId,
          message: `${context} ${slotType} slot type mismatch: expected ${expectedTypes.join(" or ")}, got ${typeInfo.inferred}`,
        });
      }
    } else if (typeInfo.inferred !== slotTileType) {
      // Non-choice slot: try conversion before reporting mismatch
      const convPath = getBrainServices().conversions.findBestPath(typeInfo.inferred, slotTileType, 1);
      if (convPath && convPath.size() > 0) {
        const conversion = convPath.get(0);
        typeInfo.conversion = conversion;
        this.diags.push({
          code: TypeDiagCode.DataTypeConverted,
          nodeId: slotEntry.expr.nodeId,
          message: `Applied conversion from ${typeInfo.inferred} to ${slotTileType} for ${context} ${slotType} slot (cost: ${conversion.cost})`,
        });
      } else {
        this.diags.push({
          code: TypeDiagCode.DataTypeMismatch,
          nodeId: slotEntry.expr.nodeId,
          message: `${context} ${slotType} slot type mismatch: expected ${slotTileType}, got ${typeInfo.inferred}`,
        });
      }
    }
  }

  visitBinaryOp(expr: BinaryOpExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    acceptExprVisitor(expr.left, this);
    acceptExprVisitor(expr.right, this);
    const leftTypeInfo = this.env.get(expr.left.nodeId);
    const rightTypeInfo = this.env.get(expr.right.nodeId);

    if (expr.operator.op && leftTypeInfo && rightTypeInfo) {
      const leftType = leftTypeInfo.inferred !== CoreTypeNames.Unknown ? leftTypeInfo.inferred : leftTypeInfo.expected;
      const rightType =
        rightTypeInfo.inferred !== CoreTypeNames.Unknown ? rightTypeInfo.inferred : rightTypeInfo.expected;

      // Try direct overload match
      typeInfo.overload = expr.operator.op.get([leftType, rightType]);
      if (typeInfo.overload) {
        typeInfo.inferred = typeInfo.overload.resultType;
        return;
      }

      // Try converting right operand to match left
      const rightToLeftConv = getBrainServices().conversions.findBestPath(rightType, leftType, 1);
      if (rightToLeftConv?.size()) {
        const conversion = rightToLeftConv.get(0);
        typeInfo.overload = expr.operator.op.get([leftType, leftType]);
        if (typeInfo.overload) {
          // Store conversion on the RIGHT operand node
          rightTypeInfo.conversion = conversion;
          typeInfo.inferred = typeInfo.overload.resultType;
          this.diags.push({
            code: TypeDiagCode.DataTypeConverted,
            nodeId: expr.right.nodeId,
            message: `Applied conversion from ${rightType} to ${leftType} for operator ${expr.operator.op.id} (cost: ${conversion.cost})`,
          });
          return;
        }
      }

      // Try converting left operand to match right
      const leftToRightConv = getBrainServices().conversions.findBestPath(leftType, rightType, 1);
      if (leftToRightConv?.size()) {
        const conversion = leftToRightConv.get(0);
        typeInfo.overload = expr.operator.op.get([rightType, rightType]);
        if (typeInfo.overload) {
          // Store conversion on the LEFT operand node
          leftTypeInfo.conversion = conversion;
          typeInfo.inferred = typeInfo.overload.resultType;
          this.diags.push({
            code: TypeDiagCode.DataTypeConverted,
            nodeId: expr.left.nodeId,
            message: `Applied conversion from ${leftType} to ${rightType} for operator ${expr.operator.op.id} (cost: ${conversion.cost})`,
          });
          return;
        }
      }

      // No viable conversion found
      this.diags.push({
        code: TypeDiagCode.NoOverloadForBinaryOp,
        nodeId: expr.nodeId,
        message: `No overload found for operator ${expr.operator.op.id} with argument types [${leftType}, ${rightType}]`,
      });
    }
  }

  visitUnaryOp(expr: UnaryOpExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    acceptExprVisitor(expr.operand, this);
    const operandTypeInfo = this.env.get(expr.operand.nodeId);

    if (expr.operator.op && operandTypeInfo) {
      const operandType =
        operandTypeInfo.inferred !== CoreTypeNames.Unknown ? operandTypeInfo.inferred : operandTypeInfo.expected;

      // Try direct overload match
      typeInfo.overload = expr.operator.op.get([operandType]);
      if (typeInfo.overload) {
        typeInfo.inferred = typeInfo.overload.resultType;
        return;
      }

      // Since we can't enumerate all overloads, try converting to common types
      const commonTypes = [CoreTypeNames.Number, CoreTypeNames.Boolean, CoreTypeNames.String];

      for (const targetType of commonTypes) {
        if (targetType === operandType) continue; // Already tried

        const conversionPath = getBrainServices().conversions.findBestPath(operandType, targetType, 1);
        if (conversionPath?.size()) {
          const conversion = conversionPath.get(0);
          typeInfo.overload = expr.operator.op.get([targetType]);
          if (typeInfo.overload) {
            // Store conversion on the operand node
            operandTypeInfo.conversion = conversion;
            typeInfo.inferred = typeInfo.overload.resultType;
            this.diags.push({
              code: TypeDiagCode.DataTypeConverted,
              nodeId: expr.operand.nodeId,
              message: `Applied conversion from ${operandType} to ${targetType} for operator ${expr.operator.op.id} (cost: ${conversion.cost})`,
            });
            return;
          }
        }
      }

      // No viable conversion found
      this.diags.push({
        code: TypeDiagCode.NoOverloadForUnaryOp,
        nodeId: expr.nodeId,
        message: `No overload found for operator ${expr.operator.op.id} with argument type [${operandType}]`,
      });
    }
  }

  visitLiteral(expr: LiteralExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    typeInfo.inferred = expr.tileDef.valueType;
  }

  visitVariable(expr: VariableExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    typeInfo.inferred = expr.tileDef.varType;
  }

  visitAssignment(expr: AssignmentExpr): void {
    // Visit the target variable (l-value)
    acceptExprVisitor(expr.target, this);
    const targetTypeInfo = this.ensureTypeInfo(expr.target.nodeId);
    targetTypeInfo.isLVal = true;

    // Visit the value expression (r-value)
    acceptExprVisitor(expr.value, this);
    const valueTypeInfo = this.env.get(expr.value.nodeId);

    // The assignment expression itself has the same type as the value
    const assignmentTypeInfo = this.ensureTypeInfo(expr.nodeId);
    assignmentTypeInfo.inferred = valueTypeInfo?.inferred || CoreTypeNames.Unknown;

    // Check type compatibility: target should accept the value type
    if (
      valueTypeInfo &&
      targetTypeInfo.inferred !== CoreTypeNames.Unknown &&
      valueTypeInfo.inferred !== CoreTypeNames.Unknown
    ) {
      if (targetTypeInfo.inferred !== valueTypeInfo.inferred) {
        this.diags.push({
          code: TypeDiagCode.DataTypeMismatch,
          nodeId: expr.nodeId,
          message: `Cannot assign value of type '${valueTypeInfo.inferred}' to variable of type '${targetTypeInfo.inferred}'`,
        });
      }
    }

    // Update the target variable's type based on the assigned value
    targetTypeInfo.inferred = valueTypeInfo?.inferred || CoreTypeNames.Unknown;
  }

  visitParameter(expr: ParameterExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    acceptExprVisitor(expr.value, this);
    const valueTypeInfo = this.env.get(expr.value.nodeId);
    if (valueTypeInfo) {
      typeInfo.inferred = valueTypeInfo.inferred;
    }
  }

  visitModifier(expr: ModifierExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    typeInfo.inferred = CoreTypeNames.Void;
  }

  visitActuator(expr: ActuatorExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    typeInfo.inferred = CoreTypeNames.Void;
    const fnEntry = expr.tileDef.fnEntry;
    const callDef = fnEntry.callDef;
    const argSlots = callDef.argSlots;
    expr.anons.forEach((e) => {
      acceptExprVisitor(e.expr, this);
    });
    expr.modifiers.forEach((e) => {
      acceptExprVisitor(e.expr, this);
    });
    expr.parameters.forEach((e) => {
      acceptExprVisitor(e.expr, this);
    });
    expr.anons.forEach((e) => {
      this.validateActionCallSlot(e, argSlots, "Actuator", "anonymous");
    });
    expr.parameters.forEach((e) => {
      this.validateActionCallSlot(e, argSlots, "Actuator", "parameter");
    });
  }

  visitSensor(expr: SensorExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    typeInfo.inferred = expr.tileDef.outputType;
    const fnEntry = expr.tileDef.fnEntry;
    const callDef = fnEntry.callDef;
    const argSlots = callDef.argSlots;
    expr.anons.forEach((e) => {
      acceptExprVisitor(e.expr, this);
    });
    expr.parameters.forEach((e) => {
      acceptExprVisitor(e.expr, this);
    });
    expr.modifiers.forEach((e) => {
      acceptExprVisitor(e.expr, this);
    });
    expr.anons.forEach((e) => {
      this.validateActionCallSlot(e, argSlots, "Sensor", "anonymous");
    });
    expr.parameters.forEach((e) => {
      this.validateActionCallSlot(e, argSlots, "Sensor", "parameter");
    });
  }

  visitFieldAccess(expr: FieldAccessExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    acceptExprVisitor(expr.object, this);
    typeInfo.inferred = expr.accessor.fieldTypeId;
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
 * Computes inferred type information for all nodes in an expression tree and validates type correctness.
 *
 * Traverses the expression tree depth-first, inferring types for each node based on operator overloads,
 * tile definitions, and expression context. Validates that:
 * - Binary and unary operators have valid overloads for their operand types
 * - Action call slots (actuators/sensors) reference valid tile definitions
 * - Parameter and anonymous argument types match their expected slot types
 * - Choice group slots match at least one option in the choice
 *
 * @param expr - The root expression node to analyze
 * @param catalogs - Array of tile catalogs used to resolve tile definitions
 * @param env - The type environment to populate with inferred type information
 * @returns A list of type diagnostics for any type errors or mismatches encountered during analysis
 */
export function computeInferredTypes(
  expr: Expr,
  catalogs: ReadonlyList<ITileCatalog>,
  env: TypeEnv
): List<TypeInfoDiag> {
  const visitor = new InferredTypeVisitor(catalogs, env);
  acceptExprVisitor(expr, visitor);
  return visitor.diags;
}
