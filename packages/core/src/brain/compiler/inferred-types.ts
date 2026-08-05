import { List, type ReadonlyList } from "../../platform/list";
import {
  type BrainActionArgSlot,
  CoreTypeIds,
  CoreTypeNames,
  type IConversionRegistry,
  type ITypeRegistry,
  NativeType,
  type StructTypeDef,
  type TypeId,
} from "../../runtime";
import type { IBrainTileDef, ITileCatalog } from "../interfaces";
import type { BrainTileParameterDef } from "../tiles";
import { TypeDiagCode } from "./diagnostics";
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
  OutputExpr,
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
    private readonly env: TypeEnv,
    private readonly conversions: IConversionRegistry,
    private readonly typeRegistry: ITypeRegistry
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
        params: { tileId },
      });
      return;
    }

    if (tileDef.kind !== "parameter") {
      this.diags.push({
        code: TypeDiagCode.TileTypeMismatch,
        nodeId: slotEntry.expr.nodeId,
        message: `${context} ${slotType} slot references non-parameter tileId ${tileId}`,
        params: { tileId, tileKind: tileDef.kind },
      });
      return;
    }

    const parmTileDef = tileDef as BrainTileParameterDef;
    const slotTileType = parmTileDef.dataType;

    // An anonymous slot in a choice group settles against the whole option
    // set: an exact option match wins, otherwise the first option (in
    // declaration order) reachable via a registered conversion takes the
    // value with that conversion, otherwise the fill is a type mismatch.
    if (slotDef.choiceGroup !== undefined && slotDef.argSpec.anonymous) {
      // The group's anonymous options, in declaration order, with their types.
      const options: { slot: BrainActionArgSlot; dataType: TypeId }[] = [];
      argSlots.forEach((s) => {
        if (s.choiceGroup !== slotDef.choiceGroup || !s.argSpec.anonymous) return;
        const td = this.findTileDefById(s.argSpec.tileId);
        if (td && td.kind === "parameter") {
          options.push({ slot: s, dataType: (td as BrainTileParameterDef).dataType });
        }
      });

      // Exact option match wins; the value moves to that option's slot.
      for (const option of options) {
        if (typeInfo.inferred === option.dataType) {
          slotEntry.slotId = option.slot.slotId;
          return;
        }
      }

      // First conversion-reachable option in declaration order.
      for (const option of options) {
        const convPath = this.conversions.findBestPath(typeInfo.inferred, option.dataType, 1);
        if (convPath && convPath.size() > 0) {
          const conversion = convPath.get(0);
          slotEntry.slotId = option.slot.slotId;
          typeInfo.conversion = conversion;
          this.diags.push({
            code: TypeDiagCode.DataTypeConverted,
            nodeId: slotEntry.expr.nodeId,
            message: `Applied conversion from ${typeInfo.inferred} to ${option.dataType} for ${context} ${slotType} slot (cost: ${conversion.cost})`,
            params: {
              actualTypeIds: List.from([typeInfo.inferred]),
              expectedTypeIds: List.from([option.dataType]),
              conversionCost: conversion.cost,
            },
          });
          return;
        }
      }

      // No option matches exactly or via conversion.
      const expectedTypes: string[] = [];
      argSlots.forEach((s) => {
        if (s.choiceGroup !== slotDef.choiceGroup) return;
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
        params: {
          expectedTypeIds: List.from(expectedTypes),
          actualTypeIds: List.from([typeInfo.inferred]),
        },
      });
    } else if (typeInfo.inferred !== slotTileType) {
      // Non-choice slot: try conversion before reporting mismatch
      const convPath = this.conversions.findBestPath(typeInfo.inferred, slotTileType, 1);
      if (convPath && convPath.size() > 0) {
        const conversion = convPath.get(0);
        typeInfo.conversion = conversion;
        this.diags.push({
          code: TypeDiagCode.DataTypeConverted,
          nodeId: slotEntry.expr.nodeId,
          message: `Applied conversion from ${typeInfo.inferred} to ${slotTileType} for ${context} ${slotType} slot (cost: ${conversion.cost})`,
          params: {
            actualTypeIds: List.from([typeInfo.inferred]),
            expectedTypeIds: List.from([slotTileType]),
            conversionCost: conversion.cost,
          },
        });
      } else {
        this.diags.push({
          code: TypeDiagCode.DataTypeMismatch,
          nodeId: slotEntry.expr.nodeId,
          message: `${context} ${slotType} slot type mismatch: expected ${slotTileType}, got ${typeInfo.inferred}`,
          params: {
            expectedTypeIds: List.from([slotTileType]),
            actualTypeIds: List.from([typeInfo.inferred]),
          },
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
      const rightToLeftConv = this.conversions.findBestPath(rightType, leftType, 1);
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
            params: {
              operatorId: expr.operator.op.id,
              actualTypeIds: List.from([rightType]),
              expectedTypeIds: List.from([leftType]),
              conversionCost: conversion.cost,
            },
          });
          return;
        }
      }

      // Try converting left operand to match right
      const leftToRightConv = this.conversions.findBestPath(leftType, rightType, 1);
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
            params: {
              operatorId: expr.operator.op.id,
              actualTypeIds: List.from([leftType]),
              expectedTypeIds: List.from([rightType]),
              conversionCost: conversion.cost,
            },
          });
          return;
        }
      }

      // No viable conversion found
      this.diags.push({
        code: TypeDiagCode.NoOverloadForBinaryOp,
        nodeId: expr.nodeId,
        message: `No overload found for operator ${expr.operator.op.id} with argument types [${leftType}, ${rightType}]`,
        params: { operatorId: expr.operator.op.id, actualTypeIds: List.from([leftType, rightType]) },
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
      const commonTypes = [CoreTypeIds.Number, CoreTypeIds.Boolean, CoreTypeIds.String];

      for (const targetType of commonTypes) {
        if (targetType === operandType) continue; // Already tried

        const conversionPath = this.conversions.findBestPath(operandType, targetType, 1);
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
              params: {
                operatorId: expr.operator.op.id,
                actualTypeIds: List.from([operandType]),
                expectedTypeIds: List.from([targetType]),
                conversionCost: conversion.cost,
              },
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
        params: { operatorId: expr.operator.op.id, actualTypeIds: List.from([operandType]) },
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

  visitOutput(expr: OutputExpr): void {
    const typeInfo = this.ensureTypeInfo(expr.nodeId);
    typeInfo.inferred = expr.tileDef.outputType;
  }

  visitAssignment(expr: AssignmentExpr): void {
    // Visit the target variable (l-value)
    acceptExprVisitor(expr.target, this);
    const targetTypeInfo = this.ensureTypeInfo(expr.target.nodeId);
    targetTypeInfo.isLVal = true;

    // Visit the value expression (r-value)
    acceptExprVisitor(expr.value, this);
    const valueTypeInfo = this.env.get(expr.value.nodeId);

    const assignmentTypeInfo = this.ensureTypeInfo(expr.nodeId);

    // The type the assignment stores: the value's type, or the target's type
    // when a conversion bridges a mismatch.
    let storedType = valueTypeInfo?.inferred || CoreTypeNames.Unknown;

    // Check type compatibility: target should accept the value type
    if (
      valueTypeInfo &&
      targetTypeInfo.inferred !== CoreTypeNames.Unknown &&
      valueTypeInfo.inferred !== CoreTypeNames.Unknown &&
      targetTypeInfo.inferred !== valueTypeInfo.inferred
    ) {
      // Try conversion before reporting mismatch
      const convPath = this.conversions.findBestPath(valueTypeInfo.inferred, targetTypeInfo.inferred, 1);
      if (convPath && convPath.size() > 0) {
        const conversion = convPath.get(0);
        valueTypeInfo.conversion = conversion;
        storedType = targetTypeInfo.inferred;
        this.diags.push({
          code: TypeDiagCode.DataTypeConverted,
          nodeId: expr.value.nodeId,
          message: `Applied conversion from ${valueTypeInfo.inferred} to ${targetTypeInfo.inferred} for assignment (cost: ${conversion.cost})`,
          params: {
            actualTypeIds: List.from([valueTypeInfo.inferred]),
            expectedTypeIds: List.from([targetTypeInfo.inferred]),
            conversionCost: conversion.cost,
          },
        });
      } else {
        this.diags.push({
          code: TypeDiagCode.DataTypeMismatch,
          nodeId: expr.nodeId,
          message: `Cannot assign value of type '${valueTypeInfo.inferred}' to variable of type '${targetTypeInfo.inferred}'`,
          params: {
            actualTypeIds: List.from([valueTypeInfo.inferred]),
            expectedTypeIds: List.from([targetTypeInfo.inferred]),
          },
        });
      }
    }

    // The assignment expression produces the stored value, and the target's
    // type tracks it.
    assignmentTypeInfo.inferred = storedType;
    targetTypeInfo.inferred = storedType;
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
    const callDef = expr.tileDef.action.callDef;
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
    typeInfo.inferred = expr.tileDef.action.outputType ?? CoreTypeNames.Unknown;
    const callDef = expr.tileDef.action.callDef;
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

    // The accessor must be applied to a base of its own struct type. A base
    // whose type cannot be determined (an unfinished or error expression) is
    // not judged here; its own diagnostics cover it.
    const objectTypeId = this.env.get(expr.object.nodeId)?.inferred;
    const baseIsDeterminate =
      objectTypeId !== undefined && objectTypeId !== CoreTypeNames.Unknown && objectTypeId !== CoreTypeIds.Unknown;
    if (baseIsDeterminate && objectTypeId !== expr.accessor.structTypeId) {
      const fieldLabel = expr.accessor.metadata?.label ?? expr.accessor.fieldName;
      const structTypeName = this.typeRegistry.get(expr.accessor.structTypeId)?.name ?? expr.accessor.structTypeId;
      const baseTypeName = this.typeRegistry.get(objectTypeId)?.name ?? objectTypeId;
      this.diags.push({
        code: TypeDiagCode.AccessorBaseTypeMismatch,
        nodeId: expr.nodeId,
        message: `Field "${fieldLabel}" belongs to ${structTypeName} and cannot be read from a value of type ${baseTypeName}`,
        params: {
          fieldName: expr.accessor.fieldName,
          fieldLabel,
          expectedTypeIds: List.from([expr.accessor.structTypeId]),
          actualTypeIds: List.from([objectTypeId]),
        },
      });
      typeInfo.inferred = expr.accessor.fieldTypeId;
      return;
    }

    // Resolve the field against the OBJECT's concrete struct type. Look the
    // field up by name so a sparse/author-assigned field id space is handled
    // correctly, and set this node's type from the object's actual field so a
    // nested chain stays reliable.
    const objectDef = objectTypeId !== undefined ? this.typeRegistry.get(objectTypeId) : undefined;
    if (objectDef !== undefined && objectDef.coreType === NativeType.Struct) {
      const fields = (objectDef as StructTypeDef).fields;
      for (let i = 0; i < fields.size(); i++) {
        const field = fields.get(i);
        if (field.name === expr.accessor.fieldName) {
          typeInfo.fieldId = field.fieldIndex;
          typeInfo.inferred = field.typeId;
          return;
        }
      }
    }

    // Object is not a concrete struct with this field: leave fieldId undefined (the
    // emitter falls back to the name-keyed path) and best-effort the result type.
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
 * @param conversions - Conversion registry used to resolve operator/slot type conversions
 * @param typeRegistry - Type registry used to resolve a field access to the numeric field
 *   id of the accessed field on its object's concrete struct type
 * @returns A list of type diagnostics for any type errors or mismatches encountered during analysis
 */
export function computeInferredTypes(
  expr: Expr,
  catalogs: ReadonlyList<ITileCatalog>,
  env: TypeEnv,
  conversions: IConversionRegistry,
  typeRegistry: ITypeRegistry
): List<TypeInfoDiag> {
  const visitor = new InferredTypeVisitor(catalogs, env, conversions, typeRegistry);
  acceptExprVisitor(expr, visitor);
  return visitor.diags;
}
