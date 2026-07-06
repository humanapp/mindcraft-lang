import { Error } from "../../platform/error";
import type { ReadonlyList } from "../../platform/list";
import type { LinkedBrainProgram } from "../../runtime";

/**
 * Diagnostic codes for brain compiler errors and warnings.
 *
 * Each diagnostic has a unique numeric code (similar to TypeScript's "ts(xxxx)").
 * Codes are organized by subsystem:
 * - 1000-1999: Parser diagnostics
 * - 2000-2999: Type inference diagnostics
 * - 3000-3999: Code-generation diagnostics
 * - 4000-4999: Link diagnostics
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

  /** Invalid assignment target (left-hand side must be a variable or field access) */
  InvalidAssignmentTarget = 1013,

  /** Assignment to a read-only field access */
  ReadOnlyFieldAssignment = 1014,

  /** Assignment to a field of a read-only base value (e.g. a sensor result) */
  ReadOnlyResultFieldAssignment = 1015,

  /** Tile placed on a rule side its placement flags do not allow */
  TilePlacementSideMismatch = 1016,

  /** Output value tile with no sensor providing its output key in the rule hierarchy */
  OutputTileMissingProvider = 1017,

  /** Tile whose required capabilities no tile in the rule hierarchy provides */
  TileRequirementsNotProvided = 1018,

  /** Tile requiring a WHEN result placed where no compatible WHEN result is available */
  TileWhenResultUnavailable = 1019,
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

  /** Field accessor applied to a base expression of a different type */
  AccessorBaseTypeMismatch = 2006,
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
 * Link diagnostic codes (4000-4999).
 *
 * `MissingActionBinding` is also emitted at compile time: the compiler resolves
 * each action's binding to choose its call opcode, so an action with no binding
 * in the environment is reported there rather than at link. The code is shared
 * because the condition is the same regardless of which phase detects it.
 */
export enum LinkDiagCode {
  /** Brain references an action with no descriptor in the catalog */
  MissingActionDescriptor = 4000,

  /**
   * Action has a descriptor but no binding resolves in the environment.
   * Emitted at compile time (binding resolution) and at link time.
   */
  MissingActionBinding = 4001,

  /** A resolved user-tile bytecode artifact is malformed or signature-mismatched */
  InvalidActionArtifact = 4002,
}

/**
 * Union type of all diagnostic codes for type safety
 */
export type DiagCode = ParseDiagCode | TypeDiagCode | CompilationDiagCode | LinkDiagCode;

/** Severity classification for a diagnostic. */
export type DiagnosticSeverity = "error" | "warning" | "info";

/** A diagnostic produced while compiling and linking a brain definition. */
export interface BrainBuildDiagnostic {
  /** Stable diagnostic code. */
  readonly code: DiagCode;

  /** An "error" blocks producing a program; "warning"/"info" do not. */
  readonly severity: DiagnosticSeverity;

  /** Human-readable description of the diagnostic. */
  readonly message: string;
}

/**
 * Result of a brain build step: the produced program and any diagnostics.
 * `program` is present if and only if `diagnostics` contains no "error"-severity
 * entries. `TProgram` is the unlinked program during compilation and the linked
 * program after linking.
 */
export interface BrainBuildResult<TProgram = LinkedBrainProgram> {
  readonly program?: TProgram;
  readonly diagnostics: ReadonlyList<BrainBuildDiagnostic>;
}

/**
 * Thrown by brain runtime construction ({@link MindcraftEnvironment.createBrain})
 * when the brain has error-severity diagnostics.
 */
export class BrainBuildError extends Error {
  constructor(
    message: string,
    readonly diagnostics: ReadonlyList<BrainBuildDiagnostic>
  ) {
    super(message);
    this.name = "BrainBuildError";
  }
}

/** True when `value` is a {@link BrainBuildError}. */
export function isBrainBuildError(value: unknown): value is BrainBuildError {
  return value instanceof BrainBuildError;
}

/** Builds a human-readable summary of the error-severity diagnostics for a {@link BrainBuildError} message. */
export function summarizeBrainBuildDiagnostics(diagnostics: ReadonlyList<BrainBuildDiagnostic>): string {
  let count = 0;
  let firstMessage = "";
  for (let i = 0; i < diagnostics.size(); i++) {
    const diag = diagnostics.get(i)!;
    if (diag.severity === "error") {
      count++;
      if (firstMessage === "") {
        firstMessage = diag.message;
      }
    }
  }
  if (count === 0) {
    return "Brain build failed.";
  }
  if (count === 1) {
    return `Brain build failed: ${firstMessage}`;
  }
  return `Brain build failed (${count} errors): ${firstMessage}`;
}
