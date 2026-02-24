/**
 * Diagnostic codes for brain compiler errors and warnings.
 *
 * Each diagnostic has a unique numeric code (similar to TypeScript's "ts(xxxx)").
 * Codes are organized by subsystem:
 * - 1000-1999: Parser diagnostics
 * - 2000-2999: Type inference diagnostics
 *
 * These codes enable programmatic handling of diagnostics, such as:
 * - Displaying context-specific suggestions in the UI
 * - Suppressing specific diagnostic types
 * - Analytics and error tracking
 */

/**
 * Parser diagnostic codes (1000-1999)
 */
export enum ParseDiagCode {
  /** Unexpected token found after when expression */
  UnexpectedTokenAfterExpression = 1000,

  /** Expected expression but found end of input */
  ExpectedExpressionFoundEOF = 1001,

  /** Unexpected action call after expression */
  UnexpectedActionCallAfterExpression = 1002,

  /** Unexpected expression after previous expression */
  UnexpectedExpressionAfterExpression = 1003,

  /** Expected sensor or actuator but found different token kind */
  ExpectedSensorOrActuator = 1004,

  /** Failed to parse action call - required arguments missing or invalid */
  ActionCallParseFailure = 1005,

  /** Unexpected action call kind */
  UnexpectedActionCallKind = 1006,

  /** Expected expression but found end of input in sub-expression */
  ExpectedExpressionInSubExpr = 1007,

  /** Unexpected token kind in expression */
  UnexpectedTokenKindInExpression = 1008,

  /** Unexpected operator in expression context */
  UnexpectedOperatorInExpression = 1009,

  /** Expected closing parenthesis */
  ExpectedClosingParen = 1010,

  /** Unexpected control flow token in expression */
  UnexpectedControlFlowInExpression = 1011,

  /** Unknown operator reference */
  UnknownOperator = 1012,

  /** Invalid assignment target (left-hand side must be a variable) */
  InvalidAssignmentTarget = 1013,

  /** Assignment to a read-only field access */
  ReadOnlyFieldAssignment = 1014,
}

/**
 * Type inference diagnostic codes (2000-2999)
 */
export enum TypeDiagCode {
  /** No overload found for binary operator with given argument types */
  NoOverloadForBinaryOp = 2000,

  /** No overload found for unary operator with given argument type */
  NoOverloadForUnaryOp = 2001,

  /** Type mismatch between inferred type and expected type */
  DataTypeMismatch = 2002,

  /** Tile type mismatch for a given tile ID reference */
  TileTypeMismatch = 2003,

  /** Tile not found for a given tile ID reference */
  TileNotFound = 2004,

  /** Data type conversion applied to match expected type */
  DataTypeConverted = 2005,
}

/**
 * Compilation diagnostic codes (3000-3999)
 */
export enum CompilationDiagCode {
  /** Missing type information for node during compilation */
  MissingTypeInfo = 3000,

  /** No overload found for operator during code generation */
  MissingOperatorOverload = 3001,
}

/**
 * Union type of all diagnostic codes for type safety
 */
export type DiagCode = ParseDiagCode | TypeDiagCode | CompilationDiagCode;
