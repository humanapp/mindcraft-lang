export { BrainCompiler, compileBrain } from "./brain-compiler";
export { CompilationDiagCode, type DiagCode, ParseDiagCode, TypeDiagCode } from "./diag-codes";
export { parseBrainTiles } from "./parser";
export type { CompilationDiag, CompilationResult } from "./rule-compiler";
export type {
  ActuatorExpr,
  BinaryOpExpr,
  Expr,
  ExprVisitor,
  FieldAccessExpr,
  LiteralExpr,
  ParameterExpr,
  ParseDiag,
  ParseResult,
  SensorExpr,
  SlotExpr,
  Span,
  TypeInfoDiag,
  UnaryOpExpr,
  VariableExpr,
} from "./types";
export { acceptExprVisitor } from "./types";

import { Dict } from "../../platform/dict";
import { List, type ReadonlyList } from "../../platform/list";
import { type IBrainTileDef, Instr, type ITileCatalog, Value } from "../interfaces";
import { computeExpectedTypes } from "./expected-types";
import { mapExprs } from "./expr-mapper";
import { computeInferredTypes } from "./inferred-types";
import { parseBrainTiles } from "./parser";
import type { Expr, ParseResult, TypeEnv, TypeInfo, TypeInfoDiag } from "./types";

export interface TypecheckResult {
  /**
   * Result of compiling brain tiles to CST (concrete syntax tree). May contain multiple expressions
   * if there were parse errors. The first expression is always the main one. The rest are partial
   * expressions for error recovery and maximal information.
   */
  parseResult: ParseResult & {
    /**
     * Mapping of CST node IDs to their expressions.
     */
    nodes: Dict<number, Expr>;
  };
  /** Per-side parse results (before combining). Spans are relative to each side's tile list. */
  whenParseResult: ParseResult;
  doParseResult: ParseResult;
  /**
   * Type annotations and diagnostics generated from CST analysis (main expression only).
   */
  typeInfo: {
    typeEnv: TypeEnv;
    diags: ReadonlyList<TypeInfoDiag>;
  };
}

export function parseRule(
  whenSrc: ReadonlyList<IBrainTileDef>,
  doSrc: ReadonlyList<IBrainTileDef>,
  catalogs: ReadonlyList<ITileCatalog>
): TypecheckResult {
  // Parse WHEN and DO sides separately
  const whenParseResult = parseBrainTiles(whenSrc);
  const doParseResult = parseBrainTiles(doSrc);

  // Combine parse results
  const allExprs = List.from(whenParseResult.exprs.toArray()).concat(List.from(doParseResult.exprs.toArray()));
  const allDiags = List.from(whenParseResult.diags.toArray()).concat(List.from(doParseResult.diags.toArray()));

  // Type checking across both when and do expressions
  const typeEnv: TypeEnv = new Dict<number, TypeInfo>();

  // Type check WHEN expressions
  for (let i = 0; i < whenParseResult.exprs.size(); i++) {
    const expr = whenParseResult.exprs.get(i);
    computeExpectedTypes(expr, typeEnv);
  }

  // Type check DO expressions
  for (let i = 0; i < doParseResult.exprs.size(); i++) {
    const expr = doParseResult.exprs.get(i);
    computeExpectedTypes(expr, typeEnv);
  }

  // Compute inferred types for both sides
  const typeDiags = List.empty<TypeInfoDiag>();
  for (let i = 0; i < whenParseResult.exprs.size(); i++) {
    const expr = whenParseResult.exprs.get(i);
    const diags = computeInferredTypes(expr, catalogs, typeEnv);
    for (let j = 0; j < diags.size(); j++) {
      typeDiags.push(diags.get(j));
    }
  }
  for (let i = 0; i < doParseResult.exprs.size(); i++) {
    const expr = doParseResult.exprs.get(i);
    const diags = computeInferredTypes(expr, catalogs, typeEnv);
    for (let j = 0; j < diags.size(); j++) {
      typeDiags.push(diags.get(j));
    }
  }
  return {
    parseResult: {
      exprs: allExprs,
      diags: allDiags,
      nodes: mapExprs(allExprs),
    },
    whenParseResult,
    doParseResult,
    typeInfo: {
      typeEnv,
      diags: typeDiags,
    },
  };
}
