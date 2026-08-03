export { BrainCompiler, compileBrain } from "./brain-compiler";
export { ConstantPool } from "./constant-pool";
export {
  type BrainBuildDiagnostic,
  BrainBuildError,
  type BrainBuildResult,
  CompilationDiagCode,
  type DiagCode,
  type DiagnosticSeverity,
  isBrainBuildError,
  LinkDiagCode,
  ParseDiagCode,
  summarizeBrainBuildDiagnostics,
  TypeDiagCode,
} from "./diagnostics";
export { BytecodeEmitter } from "./emitter";
export { runBrainLinkPipeline } from "./link-brain";
export { linkBrainProgram } from "./linker";
export {
  collectProvidedCapabilities,
  collectProvidedOutputKeys,
  parseBrainTiles,
  validateCapabilityRequirements,
  validateOutputProviders,
  validatePrecedingSiblingConsumers,
  validateWhenResultConsumers,
  whenResultConsumerEligible,
} from "./parser";
export type { CompilationDiag } from "./rule-compiler";
export { treeshakeProgram } from "./tree-shaker";
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
import { UniqueSet } from "../../platform/uniqueset";
import type { IConversionRegistry, IOperatorOverloads, ITypeRegistry, TypeId } from "../../runtime";
import type { Instr } from "../../runtime/bytecode";
import type { Value } from "../../runtime/value";
import { BitSet, type ReadonlyBitSet } from "../../util/bitset";
import { type IBrainTileDef, type ITileCatalog, RuleSide } from "../interfaces";
import { whenExprResultType } from "../language-service/tile-suggestions";
import { computeExpectedTypes } from "./expected-types";
import { mapExprs } from "./expr-mapper";
import { computeInferredTypes } from "./inferred-types";
import {
  collectProvidedCapabilities,
  collectProvidedOutputKeys,
  parseBrainTiles,
  validateCapabilityRequirements,
  validateOutputProviders,
  validatePrecedingSiblingConsumers,
  validateTilePlacement,
  validateWhenResultConsumers,
} from "./parser";
import type { Expr, ParseDiag, ParseResult, TypeEnv, TypeInfo, TypeInfoDiag } from "./types";

/** Combined parse + type-check result for a single rule's `when` and `do` sides. */
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

/** Returns `result` with `extra` appended to its diagnostics (or `result` unchanged when `extra` is empty). */
function appendParseDiags(result: ParseResult, extra: ReadonlyList<ParseDiag>): ParseResult {
  if (extra.size() === 0) {
    return result;
  }
  return { ...result, diags: List.from(result.diags.toArray()).concat(List.from(extra.toArray())) };
}

/**
 * Parse and type-check a rule's `when` and `do` tile lists, returning combined
 * and per-side results. `inheritedOutputKeys` carries the output identity keys
 * provided by the rule's ancestor rules; an output tile whose key is provided
 * neither there nor by the rule's own sides gets an
 * {@link ParseDiagCode.OutputTileMissingProvider} diagnostic.
 * `inheritedCapabilities` carries the OR'd capability bits provided by the
 * rule's ancestor rules; a tile whose `requirements()` bits are covered
 * neither there nor by the rule's own sides gets a
 * {@link ParseDiagCode.TileRequirementsNotProvided} diagnostic.
 * `inheritedWhenResultType` carries the WHEN-result type produced by the
 * nearest enclosing rule (see `getRuleWhenResultType`); it is what a WHEN-side
 * tile may consume, and what a DO-side tile may consume when `whenSrc` is
 * empty (a non-empty `whenSrc` produces the DO side's WHEN result itself,
 * typed with `operatorOverloads`). A tile declaring `consumesWhenResult(T)`
 * with no compatible WHEN result available on its side gets a
 * {@link ParseDiagCode.TileWhenResultUnavailable} diagnostic.
 * `hasPrecedingSiblingRule` states whether the rule has a rule above it at its
 * own nesting level; when it is `false`, a tile declaring
 * {@link CoreCapabilityBits.RequiresPrecedingSiblingRule} gets a
 * {@link ParseDiagCode.NoPrecedingSiblingRule} diagnostic.
 * It defaults to `true`, which reports nothing.
 */
export function parseRule(
  whenSrc: ReadonlyList<IBrainTileDef>,
  doSrc: ReadonlyList<IBrainTileDef>,
  catalogs: ReadonlyList<ITileCatalog>,
  conversions: IConversionRegistry,
  typeRegistry: ITypeRegistry,
  inheritedOutputKeys?: UniqueSet<string>,
  inheritedCapabilities?: ReadonlyBitSet,
  inheritedWhenResultType?: TypeId,
  operatorOverloads?: IOperatorOverloads,
  hasPrecedingSiblingRule: boolean = true
): TypecheckResult {
  // Output and capability providers are visible across the whole rule (both
  // sides) and its ancestors; placement is validated per side.
  const providedOutputKeys = new UniqueSet<string>();
  inheritedOutputKeys?.forEach((key) => {
    providedOutputKeys.add(key);
  });
  collectProvidedOutputKeys(whenSrc, providedOutputKeys);
  collectProvidedOutputKeys(doSrc, providedOutputKeys);

  let availableCapabilities = inheritedCapabilities ? new BitSet(inheritedCapabilities as BitSet) : new BitSet();
  availableCapabilities = collectProvidedCapabilities(whenSrc, availableCapabilities);
  availableCapabilities = collectProvidedCapabilities(doSrc, availableCapabilities);

  const whenParsed = parseBrainTiles(whenSrc);
  const doParsed = parseBrainTiles(doSrc, -1, 0, whenParsed.nextNodeId);

  // The WHEN result available per side: WHEN-side tiles read the enclosing
  // rule's result; DO-side tiles read this rule's own (its WHEN expression's
  // type), falling through to the enclosing rule's when the WHEN is empty.
  const whenSideWhenResult = inheritedWhenResultType;
  const doSideWhenResult =
    whenSrc.size() > 0
      ? whenExprResultType(whenParsed.exprs.get(0), operatorOverloads, conversions)
      : inheritedWhenResultType;

  // Each side also carries the placement, output-provider,
  // capability-requirement, WHEN-result, and preceding-sibling diagnostics for
  // its own tiles.
  const whenParseResult = appendParseDiags(
    appendParseDiags(
      appendParseDiags(
        appendParseDiags(
          appendParseDiags(whenParsed, validateTilePlacement(whenSrc, RuleSide.When)),
          validateOutputProviders(whenSrc, providedOutputKeys)
        ),
        validateCapabilityRequirements(whenSrc, availableCapabilities, catalogs)
      ),
      validateWhenResultConsumers(whenSrc, whenSideWhenResult, conversions, typeRegistry)
    ),
    validatePrecedingSiblingConsumers(whenSrc, hasPrecedingSiblingRule)
  );
  const doParseResult = appendParseDiags(
    appendParseDiags(
      appendParseDiags(
        appendParseDiags(
          appendParseDiags(doParsed, validateTilePlacement(doSrc, RuleSide.Do)),
          validateOutputProviders(doSrc, providedOutputKeys)
        ),
        validateCapabilityRequirements(doSrc, availableCapabilities, catalogs)
      ),
      validateWhenResultConsumers(doSrc, doSideWhenResult, conversions, typeRegistry)
    ),
    validatePrecedingSiblingConsumers(doSrc, hasPrecedingSiblingRule)
  );

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
    const diags = computeInferredTypes(expr, catalogs, typeEnv, conversions, typeRegistry);
    for (let j = 0; j < diags.size(); j++) {
      typeDiags.push(diags.get(j));
    }
  }
  for (let i = 0; i < doParseResult.exprs.size(); i++) {
    const expr = doParseResult.exprs.get(i);
    const diags = computeInferredTypes(expr, catalogs, typeEnv, conversions, typeRegistry);
    for (let j = 0; j < diags.size(); j++) {
      typeDiags.push(diags.get(j));
    }
  }
  return {
    parseResult: {
      exprs: allExprs,
      diags: allDiags,
      nextNodeId: doParseResult.nextNodeId,
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
