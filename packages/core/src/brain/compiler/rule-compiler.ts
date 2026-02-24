import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import { logger } from "../../platform/logger";
import { StringUtils as SU } from "../../platform/string";
import { TypeUtils } from "../../platform/types";
import type { Instr, Value } from "../interfaces";
import { type BrainActionArgSlot, CoreOpId, NativeType, NIL_VALUE, TRUE_VALUE } from "../interfaces";
import type { IBytecodeEmitter } from "../interfaces/emitter";
import type { ConstantPool } from "./constant-pool";
import { CompilationDiagCode } from "./diag-codes";
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
  SlotExpr,
  TypeEnv,
  TypeInfo,
  UnaryOpExpr,
  VariableExpr,
} from "./types";
import { acceptExprVisitor } from "./types";

/**
 * Compilation context for the bytecode emitter. Manages variable scope,
 * constant pool, and other state needed during compilation.
 */
interface CompilationContext {
  /** Maps variable names to their index in the variableNames list */
  variableIndices: Dict<string, number>;
  /** List of variable names, in order of first occurrence */
  variableNames: List<string>;
  /** Type information for each node */
  typeEnv: TypeEnv;
  /** Constant pool for managing literal values */
  constantPool: ConstantPool;
  /** Counter for assigning unique call-site IDs to HOST_CALL instructions */
  nextCallSiteId: { value: number };
  /** Diagnostics collected during compilation */
  diags: List<CompilationDiag>;
}

export interface CompilationResult {
  instrs: ReadonlyList<Instr>;
  /** Variable names used in this compilation, for LOAD_VAR/STORE_VAR instructions */
  variableNames: ReadonlyList<string>;
  /** Diagnostics collected during compilation */
  diags: ReadonlyList<CompilationDiag>;
}

/**
 * Compilation diagnostic (error or warning) with node reference.
 */
export interface CompilationDiag {
  code: CompilationDiagCode;
  message: string;
  nodeId: number;
}

/**
 * Bytecode emitter that walks an expression AST and generates VM instructions.
 */
export class ExprCompiler implements ExprVisitor<void> {
  constructor(
    private readonly emitter: IBytecodeEmitter,
    private readonly context: CompilationContext
  ) {}

  /**
   * Get the next unique call-site ID for a HOST_CALL instruction.
   * This ID is used by host functions to persist per-call-site state.
   */
  private nextCallSiteId(): number {
    return this.context.nextCallSiteId.value++;
  }

  // ==========================================
  // Binary Operators
  // ==========================================

  visitBinaryOp(expr: BinaryOpExpr): void {
    const typeInfo = this.context.typeEnv.get(expr.nodeId);
    if (!typeInfo) {
      this.context.diags.push({
        code: CompilationDiagCode.MissingTypeInfo,
        message: `Missing type information for binary operator`,
        nodeId: expr.nodeId,
      });
      // Emit nil placeholder to maintain stack consistency
      const nilIdx = this.context.constantPool.add(NIL_VALUE);
      this.emitter.pushConst(nilIdx);
      return;
    }

    const opId = expr.operator.op.id;
    if (opId === CoreOpId.And) {
      // Special case: logical AND uses short-circuit evaluation with conditional jumps
      this.emitShortCircuitAnd(expr);
      return;
    }

    if (opId === CoreOpId.Or) {
      // Special case: logical OR uses short-circuit evaluation with conditional jumps
      this.emitShortCircuitOr(expr);
      return;
    }

    // Push left, convert if needed, push right, convert if needed,
    // then HOST_CALL_ARGS pops both and auto-wraps into a MapValue.
    acceptExprVisitor(expr.left, this);
    this.emitConversionIfNeeded(expr.left.nodeId);
    acceptExprVisitor(expr.right, this);
    this.emitConversionIfNeeded(expr.right.nodeId);
    this.emitBinaryOp(typeInfo);
  }

  /**
   * Emit type conversion HOST_CALL_ARGS if the node's TypeInfo has a
   * conversion. The value to convert must already be on top of the stack.
   *
   * For conversions, HOST_CALL_ARGS pops 1 raw value and auto-wraps it into a
   * MapValue with key 0.
   *
   * Stack effect: [value] -> [converted_value]
   */
  private emitConversionIfNeeded(nodeId: number): void {
    const typeInfo = this.context.typeEnv.get(nodeId);
    if (!typeInfo || !typeInfo.conversion) {
      return;
    }

    const conversion = typeInfo.conversion;
    this.emitter.hostCallArgs(conversion.id, 1, this.nextCallSiteId());
  }

  private emitShortCircuitAnd(expr: BinaryOpExpr): void {
    // Short-circuit AND: if left is false, skip right and return left's value
    // Semantics: left && right returns left if falsy, otherwise right Note: No
    // type conversions applied - boolean operators work on any truthy/falsy
    // value
    acceptExprVisitor(expr.left, this);
    this.emitter.dup(); // Keep a copy for the result

    const endLabel = this.emitter.label();
    this.emitter.jmpIfFalse(endLabel); // If left is false, skip right

    // Left was true, evaluate right
    this.emitter.pop(); // Pop the duplicate
    acceptExprVisitor(expr.right, this);

    this.emitter.mark(endLabel);
    // Stack now contains the result (either false from left, or right's value)
  }

  private emitShortCircuitOr(expr: BinaryOpExpr): void {
    // Short-circuit OR: if left is true, skip right and return left's value
    // Semantics: left || right returns left if truthy, otherwise right Note: No
    // type conversions applied - boolean operators work on any truthy/falsy
    // value
    acceptExprVisitor(expr.left, this);
    this.emitter.dup(); // Keep a copy for the result

    const endLabel = this.emitter.label();
    this.emitter.jmpIfTrue(endLabel); // If left is true, skip right

    // Left was false, evaluate right
    this.emitter.pop(); // Pop the duplicate
    acceptExprVisitor(expr.right, this);

    this.emitter.mark(endLabel);
    // Stack now contains the result (either true from left, or right's value)
  }

  private emitBinaryOp(typeInfo: TypeInfo): void {
    // Call the operator's host function implementation via HOST_CALL_ARGS. The
    // VM pops 2 raw values and wraps them into a MapValue with keys 0, 1.
    if (typeInfo.overload) {
      if (typeInfo.overload.fnEntry.isAsync) {
        this.emitter.hostCallArgsAsync(typeInfo.overload.fnEntry.id, 2, this.nextCallSiteId());
        // Automatically await async operators so their result can be used by
        // subsequent operations This makes async operators work correctly in
        // multi-step operator chains
        this.emitter.await();
        return;
      }
      this.emitter.hostCallArgs(typeInfo.overload.fnEntry.id, 2, this.nextCallSiteId());
    } else {
      // This should have been caught during type inference, but handle
      // gracefully The diagnostic is tracked against the operator's nodeId,
      // which we don't have here So we emit a nil placeholder to maintain stack
      // balance
      const nilIdx = this.context.constantPool.add(NIL_VALUE);
      this.emitter.pushConst(nilIdx);
    }
  }

  // ==========================================
  // Unary Operators
  // ==========================================

  visitUnaryOp(expr: UnaryOpExpr): void {
    const typeInfo = this.context.typeEnv.get(expr.nodeId);
    if (!typeInfo) {
      this.context.diags.push({
        code: CompilationDiagCode.MissingTypeInfo,
        message: `Missing type information for unary operator`,
        nodeId: expr.nodeId,
      });
      // Emit nil placeholder to maintain stack consistency
      const nilIdx = this.context.constantPool.add(NIL_VALUE);
      this.emitter.pushConst(nilIdx);
      return;
    }

    // Push operand, convert if needed, then HOST_CALL_ARGS auto-wraps.
    acceptExprVisitor(expr.operand, this);
    this.emitConversionIfNeeded(expr.operand.nodeId);
    this.emitUnaryOp(typeInfo);
  }

  private emitUnaryOp(typeInfo: TypeInfo): void {
    const overload = typeInfo.overload;
    if (overload) {
      if (overload.fnEntry.isAsync) {
        this.emitter.hostCallArgsAsync(overload.fnEntry.id, 1, this.nextCallSiteId());
        // Automatically await async operators so their result can be used by
        // subsequent operations This makes async operators work correctly in
        // multi-step operator chains
        this.emitter.await();
        return;
      }
      this.emitter.hostCallArgs(overload.fnEntry.id, 1, this.nextCallSiteId());
    } else {
      // This should have been caught during type inference, but handle
      // gracefully The diagnostic is tracked against the operator's nodeId,
      // which we don't have here So we emit a nil placeholder to maintain stack
      // balance
      const nilIdx = this.context.constantPool.add(NIL_VALUE);
      this.emitter.pushConst(nilIdx);
    }
  }

  // ==========================================
  // Literals
  // ==========================================

  visitLiteral(expr: LiteralExpr): void {
    // Convert literal value to a VM Value object and add to constant pool
    const value = expr.tileDef.value;
    const constIdx = this.createConstant(value);
    this.emitter.pushConst(constIdx);
  }

  private createConstant(value: unknown): number {
    const valueObj: Value = this.valueFromLiteral(value);
    return this.context.constantPool.add(valueObj);
  }

  private valueFromLiteral(value: unknown): Value {
    // Helper to convert a literal value to a VM Value
    if (value === undefined) {
      return { t: NativeType.Nil };
    }
    if (TypeUtils.isBoolean(value)) {
      return { t: NativeType.Boolean, v: value };
    }
    if (TypeUtils.isNumber(value)) {
      return { t: NativeType.Number, v: value };
    }
    if (TypeUtils.isString(value)) {
      return { t: NativeType.String, v: value };
    }
    // If the value is already a Value object (e.g. a StructValue from a native-struct literal),
    // pass it through directly. Value objects always have a `.t` discriminant.
    if (TypeUtils.isObject(value) && (value as Value).t !== undefined) {
      return value as Value;
    }
    // Unknown type
    return { t: NativeType.Unknown };
  }

  // ==========================================
  // Variables
  // ==========================================

  visitVariable(expr: VariableExpr): void {
    // Variables are always r-values in this context (loads)
    // For l-values, see visitAssignment which handles stores
    const varName = expr.tileDef.varName;
    const varNameIdx = this.getOrCreateVariableIndex(varName);
    this.emitter.loadVar(varNameIdx);
  }

  /**
   * Get the index for a variable name, creating a new entry if needed.
   * Variables are stored in the execution context by name.
   */
  private getOrCreateVariableIndex(varName: string): number {
    const existingIdx = this.context.variableIndices.get(varName);
    if (existingIdx !== undefined) {
      return existingIdx;
    }

    // Variable not yet seen - add to variable names list
    const newIdx = this.context.variableNames.size();
    this.context.variableIndices.set(varName, newIdx);
    this.context.variableNames.push(varName);
    return newIdx;
  }

  // ==========================================
  // Assignment
  // ==========================================

  visitAssignment(expr: AssignmentExpr): void {
    // Assignment: target = value
    // Strategy depends on whether target is a variable or field access.

    if (expr.target.kind === "fieldAccess") {
      // Field assignment: object.field = value
      // 1. Emit the object expression (pushes source onto stack)
      // 2. Push field name constant
      // 3. Emit the value expression
      // 4. Call emitter.setField() -- uses SET_FIELD which supports native-backed structs
      acceptExprVisitor(expr.target.object, this);
      const fieldNameIdx = this.createConstant(expr.target.accessor.fieldName);
      this.emitter.pushConst(fieldNameIdx);
      acceptExprVisitor(expr.value, this);
      this.emitter.setField();
    } else {
      // Variable assignment: var = value
      // 1. Emit the value expression (pushes result to stack)
      // 2. Duplicate it (so assignment can also return a value)
      // 3. Store to the target variable
      // Result: value remains on stack (assignment is an expression)
      const varName = expr.target.tileDef.varName;
      const varNameIdx = this.getOrCreateVariableIndex(varName);

      // Emit value expression (pushes result onto stack)
      acceptExprVisitor(expr.value, this);

      // Duplicate the value so assignment returns it
      this.emitter.dup();

      // Store the top value to the variable in execution context
      this.emitter.storeVar(varNameIdx);

      // Stack now contains the assigned value (assignment as expression)
    }
  }

  // ==========================================
  // Parameters
  // ==========================================

  visitParameter(expr: ParameterExpr): void {
    // Parameters wrap a value expression
    // The value should be emitted to the stack
    acceptExprVisitor(expr.value, this);
  }

  // ==========================================
  // Modifiers
  // ==========================================

  visitModifier(expr: ModifierExpr): void {
    // Do nothing - modifiers are emitted as boolean flags in visitActuator and visitSensor
  }

  // ==========================================
  // Actuators
  // ==========================================

  visitActuator(expr: ActuatorExpr): void {
    const actuatorId = expr.tileDef.actuatorId;
    const actuatorFn = expr.tileDef.fnEntry;
    const argSlots = actuatorFn.callDef.argSlots;

    // Emit arguments as a single Map value
    // Map contains: { "slotId": value } for args, { "slotId": true } for modifiers
    const argCount = this.emitActionArguments(argSlots, expr.anons, expr.parameters, expr.modifiers);

    // Use the host function ID from the tile definition's function entry The
    // FunctionRegistry assigns this ID when the function is registered Host
    // function receives: fn(args: List<Value>) where args[0] is the Map
    if (actuatorFn.isAsync) {
      this.emitter.hostCallAsync(actuatorFn.id, argCount, this.nextCallSiteId());
      // Await the actuator call to ensure it completes before DO finishes This allows async actuators to work correctly in multi-step action sequences
      this.emitter.await();
    } else {
      this.emitter.hostCall(actuatorFn.id, argCount, this.nextCallSiteId());
    }

    // Actuator return value is now on the stack, but it is ignored, currently.
  }

  // ==========================================
  // Sensors (Queries/Readings)
  // ==========================================

  visitSensor(expr: SensorExpr): void {
    const sensorId = expr.tileDef.sensorId;
    const sensorFn = expr.tileDef.fnEntry;
    const argSlots = sensorFn.callDef.argSlots;

    // Emit arguments as a single Map value
    // Map contains: { "slotId": value } for args, { "slotId": true } for modifiers
    const argCount = this.emitActionArguments(argSlots, expr.anons, expr.parameters, expr.modifiers);

    // Use the host function ID from the tile definition's function entry The
    // FunctionRegistry assigns this ID when the function is registered Host
    // function receives: fn(args: List<Value>) where args[0] is the Map
    if (sensorFn.isAsync) {
      this.emitter.hostCallAsync(sensorFn.id, argCount, this.nextCallSiteId());
      // Await the sensor call to ensure it completes before DO finishes This allows async sensors to work correctly in multi-step action sequences
      this.emitter.await();
    } else {
      this.emitter.hostCall(sensorFn.id, argCount, this.nextCallSiteId());
    }

    // Result is now on the stack
  }

  /**
   * Emit action arguments as a Map value keyed by slotId. This allows the host
   * function to receive a single Map argument containing all provided
   * arguments, making optional arguments natural to handle.
   *
   * Stack effect: [] -> [Map<string, Value>]
   *
   * The map contains:
   * - Anonymous args: { "slotId": value }
   * - Named parameters: { "slotId": value }
   * - Modifiers: { "slotId": true }
   *
   * Missing slots are simply absent from the map (not present as keys).
   */
  private emitActionArguments(
    argSlots: ReadonlyList<BrainActionArgSlot>,
    anons: ReadonlyList<SlotExpr>,
    parameters: ReadonlyList<SlotExpr>,
    modifiers: ReadonlyList<SlotExpr>
  ): number {
    // Create a new empty map to hold all arguments
    // MISSING: Need to determine proper typeId for argument maps
    // For now, use 0 as a placeholder for a generic map type
    const mapTypeId = 0;
    this.emitter.mapNew(mapTypeId);

    // Helper to emit a key-value pair into the map
    // Stack effect: [map] -> [map] (mapSet pops map/key/value, pushes modified map)
    const emitMapEntry = (slotId: number, emitValue: () => void) => {
      // Stack: [map]

      // Push the key (slotId as string)
      const keyConst = this.createConstant(slotId);
      this.emitter.pushConst(keyConst); // Stack: [map, key]

      // Push the value
      emitValue(); // Stack: [map, key, value]

      // Set the entry: pops value, key, map; pushes modified map
      this.emitter.mapSet(); // Stack: [map]
    };

    // Emit anonymous arguments
    for (let i = 0; i < anons.size(); i++) {
      const slot = anons.get(i);
      emitMapEntry(slot.slotId, () => {
        acceptExprVisitor(slot.expr, this);
        this.emitConversionIfNeeded(slot.expr.nodeId);
      });
    }

    // Emit named parameters
    for (let i = 0; i < parameters.size(); i++) {
      const slot = parameters.get(i);
      emitMapEntry(slot.slotId, () => {
        acceptExprVisitor(slot.expr, this);
        // The conversion is stored on the ParameterExpr node (same node
        // that validateActionCallSlot checks), not on the inner value node.
        this.emitConversionIfNeeded(slot.expr.nodeId);
      });
    }

    // Emit modifiers -- count occurrences per slotId so repeated modifiers
    // produce a numeric count value instead of a boolean flag.
    // Single-occurrence modifiers emit 1, which is truthy and backward
    // compatible with `args.v.has(slotId)` presence checks.
    const modCounts = new Dict<number, number>();
    for (let i = 0; i < modifiers.size(); i++) {
      const sid = modifiers.get(i).slotId;
      modCounts.set(sid, (modCounts.get(sid) ?? 0) + 1);
    }
    modCounts.forEach((count, slotId) => {
      emitMapEntry(slotId, () => {
        const countConst = this.createConstant(count);
        this.emitter.pushConst(countConst);
      });
    });

    // Map is now on the stack with all arguments
    // Return 1 because we push a single Map value as the argument
    return 1;
  }

  // ==========================================
  // Field Access
  // ==========================================

  visitFieldAccess(expr: FieldAccessExpr): void {
    // TODO: Emit field access bytecode
    // 1. Compile the object expression (pushes struct value onto stack)
    // 2. Push the field name constant
    // 3. Call emitter.getField()
    acceptExprVisitor(expr.object, this);
    const fieldNameIdx = this.createConstant(expr.accessor.fieldName);
    this.emitter.pushConst(fieldNameIdx);
    this.emitter.getField();
  }

  // ==========================================
  // Empty Expression
  // ==========================================

  visitEmpty(expr: EmptyExpr): void {
    // Do nothing - empty expressions produce no value and have no effect
  }

  // ==========================================
  // Error Expression
  // ==========================================

  visitError(expr: ErrorExpr): void {
    // We should never hit this in practice because we don't compile rules
    // containing errors, but it is theoretically possible.
    logger.error(`Encountered ErrorExpr during compilation: ${expr.message}`);
  }
}

/**
 * Compile a list of WHEN expressions and DO expressions into a bytecode
 * instruction stream.
 *
 * @param whenExprs - List of WHEN expressions to compile
 * @param doExprs - List of DO expressions to compile
 * @param emitter - Bytecode emitter instance
 * @param typeEnv - Type information for all nodes (from type inference pass)
 * @returns The finalized list of VM instructions
 */
export function compileRule(
  whenExprs: ReadonlyList<Expr>,
  doExprs: ReadonlyList<Expr>,
  emitter: IBytecodeEmitter,
  typeEnv: TypeEnv,
  constantPool: ConstantPool
): CompilationResult {
  // Initialize compilation context
  const context: CompilationContext = {
    variableIndices: Dict.empty(),
    variableNames: List.empty(),
    typeEnv,
    constantPool,
    nextCallSiteId: { value: 0 },
    diags: List.empty(),
  };

  // Create compiler visitor
  const compiler = new ExprCompiler(emitter, context);

  // Create label for end of bytecode stream (after DO section)
  // This is the jump target if WHEN evaluates to false
  const endLabel = emitter.label();

  emitter.whenStart();
  // Visit the first when expression (the executable one; the rest are errors or warnings)
  if (whenExprs.size() > 0) {
    acceptExprVisitor(whenExprs.get(0), compiler);
  }

  // If there were no expressions, push TRUE (empty WHEN always executes DO)
  if (whenExprs.size() === 0) {
    const trueIdx = constantPool.add(TRUE_VALUE);
    emitter.pushConst(trueIdx);
  }

  // WHEN may or may not leave a value on the stack:
  // - If WHEN leaves a truthy value: DO executes and can use that value
  // - If WHEN leaves a falsy value: DO is skipped
  // Stack: [when_result] - value from WHEN for DO to use
  emitter.whenEnd(endLabel);
  // WHEN_END checks if stack height increased from WHEN_START
  // If no value on stack, jumps to endLabel (skips DO)
  // If value on stack, continues to DO section (value remains for DO to use)

  emitter.doStart();
  // Visit the first do expression (the executable one; the rest are errors or warnings)
  if (doExprs.size() > 0) {
    acceptExprVisitor(doExprs.get(0), compiler);
  }

  emitter.doEnd();

  // Mark the end label (jumped to if WHEN was false)
  emitter.mark(endLabel);

  // Add final return instruction
  emitter.ret();

  // Finalize and return instructions with metadata
  return {
    instrs: emitter.finalize(),
    variableNames: context.variableNames,
    diags: context.diags.asReadonly(),
  };
}
