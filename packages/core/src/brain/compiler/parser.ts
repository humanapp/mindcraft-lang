/**
 * Brain tile parser - converts sequences of brain tiles into an expression AST.
 *
 * This parser implements a Pratt parser (top-down operator precedence) for expressions,
 * combined with a grammar-based parser for sensor/actuator call specifications.
 */

import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List, type ReadonlyList } from "../../platform/list";
import { UniqueSet } from "../../platform/uniqueset";
import {
  type BrainActionCallArgSpec,
  type BrainActionCallSpec,
  type BrainTileKind,
  CoreControlFlowId,
  CoreOpId,
  type IBrainActionTileDef,
  type IBrainTileDef,
  TilePlacement,
} from "../interfaces";
import {
  type BrainTileAccessorDef,
  type BrainTileActuatorDef,
  type BrainTileControlFlowDef,
  type BrainTileLiteralDef,
  type BrainTileModifierDef,
  type BrainTileOperatorDef,
  BrainTilePageDef,
  type BrainTileParameterDef,
  type BrainTileSensorDef,
  type BrainTileVariableDef,
} from "../tiles";
import { ParseDiagCode } from "./diag-codes";
import type { Expr, ParseDiag, ParseResult, SlotExpr } from "./types";

/**
 * Parsing options that control recursive descent behavior.
 * These are threaded through recursive calls to handle context-sensitive parsing.
 */
type ParseOpts = {
  /** Predicate determining when to stop consuming tokens (context-dependent boundary) */
  stop: (nextTok: IBrainTileDef | undefined) => boolean;
  /** Minimum precedence for operators to consume (enables Pratt parsing) */
  minOperatorPrecedence: number;
  /** If true, stop when encountering primary expression starts (modifiers, parameters, etc.) */
  primaryAdjacencyTerminates: boolean;
};

/**
 * NUD (Null Denotation) handler - parses a token in prefix position.
 * Part of Pratt parsing terminology: NUD handles tokens that start expressions,
 * while LED (Left Denotation, not explicitly named here) handles infix operators.
 */
type NudHandler = (tok: IBrainTileDef, startPos: number, opts: ParseOpts) => Expr;

/**
 * Context for parsing action call arguments.
 * Packages all the mutable state needed during call spec parsing.
 */
type ActionCallContext = {
  /** Accumulated anonymous arguments */
  anons: List<SlotExpr>;
  /** Accumulated named parameters */
  parameters: List<SlotExpr>;
  /** Accumulated modifiers */
  modifiers: List<SlotExpr>;
  /** Lookup map from argSpec reference to slot ID */
  argSpecToSlotId: Dict<BrainActionCallArgSpec, number>;
  /** Set of successfully matched named specs */
  matchedNames: UniqueSet<string>;
};

/**
 * Recursive descent parser for brain tile expressions with Pratt-style operator precedence.
 *
 * Architecture:
 * - Token stream is provided externally (brain tiles are already-tokenized by their nature)
 * - Parser owns diagnostic collection (errors don't stop parsing)
 * - Supports bounded parsing (from/to) for incremental parsing scenarios
 * - Combines Pratt parsing (expressions) with grammar-based parsing (action calls)
 */
class BrainParser {
  private i = 0;
  private readonly diags: List<ParseDiag> = List.from([]);
  private readonly nudHandlers: Dict<BrainTileKind, NudHandler>;
  private readonly to: number;
  private readonly from: number;
  private nodeIdCounter: number = 0;

  constructor(
    private readonly src: ReadonlyList<IBrainTileDef>,
    to: number = -1,
    from: number = 0
  ) {
    // Normalize negative 'to' to mean "end of stream" for convenience
    if (to < 0) {
      to = this.src.size();
    }
    this.to = to;
    this.from = from;

    // Validate bounds early to catch configuration errors
    if (this.from < 0 || this.to > this.src.size() || this.from > this.to) {
      throw new Error(`BrainParser: invalid from/to range (${this.from}, ${this.to})`);
    }
    this.i = this.from;

    /**
     * Register NUD handlers for tokens that can start expressions.
     * Using arrow functions instead of method references for Roblox-TS compatibility
     * (Roblox-TS doesn't support this binding with method references in Map constructors).
     *
     * Note: non-inline sensors and actuators are NOT in this map because they're handled
     * separately by parseActionCall, not as general expressions.
     * Inline sensors (TilePlacement.Inline) ARE handled here as expression primaries.
     */
    this.nudHandlers = new Dict<BrainTileKind, NudHandler>([
      ["literal", (tok, startPos, opts) => this.parseNudLiteral(tok, startPos, opts)],
      ["variable", (tok, startPos, opts) => this.parseNudVariable(tok, startPos, opts)],
      ["operator", (tok, startPos, opts) => this.parseNudOperator(tok, startPos, opts)],
      ["controlFlow", (tok, startPos, opts) => this.parseNudControlFlow(tok, startPos, opts)],
      ["sensor", (tok, startPos, opts) => this.parseNudSensor(tok, startPos, opts)],
      ["page", (tok, startPos, opts) => this.parseNudLiteral(tok, startPos, opts)],
    ]);
  }

  private nextNodeId(): number {
    return this.nodeIdCounter++;
  }

  /**
   * Main entry point for parsing - consumes entire token stream.
   * Returns both the parsed expressions and any diagnostics encountered.
   */
  parse(): ParseResult {
    const start = this.peek();
    if (!start) {
      // Empty input is valid and produces an empty expression
      const exprs = new List<Expr>();
      exprs.push({ nodeId: this.nextNodeId(), kind: "empty" });
      return { exprs, diags: this.diags.asReadonly() };
    }

    const exprs = this.parseTop({
      stop: (nextTok: IBrainTileDef | undefined) => {
        return !nextTok;
      },
      minOperatorPrecedence: 0,
      primaryAdjacencyTerminates: false,
    });

    if (!this.atEnd()) {
      this.diags.push({
        code: ParseDiagCode.UnexpectedTokenAfterExpression,
        message: `Unexpected token after when expression`,
        span: { from: this.i, to: this.i + 1 },
      });
    }

    return { exprs, diags: this.diags.asReadonly() };
  }

  /**
   * Parse top-level sequence of expressions/action-calls until hitting stop condition.
   *
   * The first expression is always accepted. Subsequent expressions are considered to be errors,
   * but still parsed and returned (wrapped in an error expression) to preserve as much context as possible.
   */
  private parseTop(opts: {
    stop: (nextTok: IBrainTileDef | undefined) => boolean;
    minOperatorPrecedence: number;
    primaryAdjacencyTerminates: boolean;
  }): ReadonlyList<Expr> {
    const startTok = this.peek();
    if (!startTok || opts.stop(startTok)) {
      const exprs = List.empty<Expr>();
      this.diags.push({
        code: ParseDiagCode.ExpectedExpressionFoundEOF,
        message: `Expected expression, found end of input`,
        span: { from: this.i, to: this.i + 1 },
      });
      exprs.push({
        nodeId: this.nextNodeId(),
        kind: "errorExpr",
        message: "Expected expression, found end of input",
      });
      return exprs.asReadonly();
    }

    const exprs = List.empty<Expr>();
    while (true) {
      const nextTok = this.peek();
      if (!nextTok || opts.stop(nextTok)) {
        break;
      }

      const isActionCall = (nextTok.kind === "sensor" && !this.isInlineTile(nextTok)) || nextTok.kind === "actuator";
      const parser = isActionCall ? () => this.parseActionCall(opts) : () => this.parseExpression(opts);
      const diagCode = isActionCall
        ? ParseDiagCode.UnexpectedActionCallAfterExpression
        : ParseDiagCode.UnexpectedExpressionAfterExpression;
      const errorMessage = isActionCall
        ? `Unexpected action call '${nextTok.tileId}' after expression`
        : `Unexpected expression after previous expression`;

      if (exprs.size() === 0) {
        exprs.push(parser());
      } else {
        const startPos = this.i;
        this.diags.push({
          code: diagCode,
          message: errorMessage,
          span: { from: startPos, to: startPos + 1 },
        });
        exprs.push({
          nodeId: this.nextNodeId(),
          kind: "errorExpr",
          expr: parser(),
          message: errorMessage,
          span: { from: startPos, to: startPos + 1 },
        });
      }
    }
    return exprs.asReadonly();
  }

  /**
   * Parse a sensor or actuator call with its arguments according to its call spec grammar.
   *
   * Unlike expressions, action calls have structured grammars that define:
   * - Which parameters/modifiers are required vs optional
   * - The order and multiplicity of arguments
   * - Anonymous vs named parameters vs modifiers
   */
  private parseActionCall(opts: ParseOpts): Expr {
    const startPos = this.i;
    const actionTok = this.consume()!;
    if (actionTok.kind !== "sensor" && actionTok.kind !== "actuator") {
      this.diags.push({
        code: ParseDiagCode.ExpectedSensorOrActuator,
        message: `Expected sensor or actuator, found '${actionTok.kind}'`,
        span: { from: startPos, to: this.i },
      });
      return {
        nodeId: this.nextNodeId(),
        kind: "errorExpr",
        message: `Expected sensor or actuator, found '${actionTok.kind}'`,
        span: { from: startPos, to: this.i },
      };
    }

    const actionCall = actionTok as unknown as IBrainActionTileDef;
    const callSpec = actionCall.fnEntry.callDef.callSpec;

    // Build lookup map from argSpec to slotId for O(1) access during parsing
    const argSpecToSlotId = new Dict<BrainActionCallArgSpec, number>();
    for (let i = 0; i < actionCall.fnEntry.callDef.argSlots.size(); i++) {
      const slot = actionCall.fnEntry.callDef.argSlots.get(i);
      argSpecToSlotId.set(slot.argSpec, slot.slotId);
    }

    // Create context for parsing action call arguments
    const ctx: ActionCallContext = {
      anons: List.empty<SlotExpr>(),
      parameters: List.empty<SlotExpr>(),
      modifiers: List.empty<SlotExpr>(),
      argSpecToSlotId,
      matchedNames: new UniqueSet<string>(),
    };

    const parseSuccess = this.parseCallSpec(callSpec, opts, ctx);

    // If parsing the call spec failed (e.g., required arguments missing), report an error
    if (!parseSuccess) {
      this.diags.push({
        code: ParseDiagCode.ActionCallParseFailure,
        message: "Failed to parse action call - required arguments missing or invalid",
        span: { from: startPos, to: this.i },
      });
    }

    if (actionTok.kind === "actuator") {
      return {
        nodeId: this.nextNodeId(),
        kind: "actuator",
        tileDef: actionTok as BrainTileActuatorDef,
        anons: ctx.anons,
        parameters: ctx.parameters,
        modifiers: ctx.modifiers,
        span: { from: startPos, to: this.i },
      };
    } else if (actionTok.kind === "sensor") {
      return {
        nodeId: this.nextNodeId(),
        kind: "sensor",
        tileDef: actionTok as BrainTileSensorDef,
        anons: ctx.anons,
        parameters: ctx.parameters,
        modifiers: ctx.modifiers,
        span: { from: startPos, to: this.i },
      };
    } else {
      this.diags.push({
        code: ParseDiagCode.UnexpectedActionCallKind,
        message: `Unexpected action call kind '${actionTok.kind}'`,
        span: { from: startPos, to: this.i },
      });
      return {
        nodeId: this.nextNodeId(),
        kind: "errorExpr",
        message: `Unexpected action call kind '${actionTok.kind}'`,
        span: { from: startPos, to: this.i },
      };
    }
  }

  /**
   * Parse according to a grammar-based variant specification.
   * Returns true if successful, false if no match.
   *
   * The spec system is inspired by parser combinators but adapted for this tile-based language:
   * - arg: Match a specific tile (parameter/modifier) or anonymous expression
   * - seq: Match all items in order (like concatenation)
   * - choice: Match one of several alternatives (like alternation)
   * - optional: Match zero or one occurrence (like ?)
   * - repeat: Match multiple occurrences with bounds (like * or +)
   *
   * Results accumulate in the provided lists rather than returning new structures
   * to avoid excessive allocation in hot parsing paths.
   */
  private parseCallSpec(
    spec: BrainActionCallSpec,
    opts: ParseOpts,
    ctx: ActionCallContext,
    outerCtx?: ActionCallContext
  ): boolean {
    let matched = false;

    switch (spec.type) {
      case "arg":
        matched = this.parseArgSpec(spec, opts, ctx);
        break;
      case "seq":
        matched = this.parseSeqSpec(spec, opts, ctx, outerCtx);
        break;
      case "choice":
        matched = this.parseChoiceSpec(spec, opts, ctx, outerCtx);
        break;
      case "optional":
        matched = this.parseOptionalSpec(spec, opts, ctx, outerCtx);
        break;
      case "repeat":
        matched = this.parseRepeatSpec(spec, opts, ctx, outerCtx);
        break;
      case "bag":
        matched = this.parseBagSpec(spec, opts, ctx);
        break;
      case "conditional":
        matched = this.parseConditionalSpec(spec, opts, ctx, outerCtx);
        break;
      default: {
        const _exhaustive: never = spec;
        break;
      }
    }

    // Register named spec if it matched
    if (matched && spec.name) {
      ctx.matchedNames.add(spec.name);
      if (outerCtx) {
        outerCtx.matchedNames.add(spec.name);
      }
    }

    return matched;
  }

  /**
   * Try to parse a spec with backtracking support.
   * If parsing succeeds, commits the results to the provided lists.
   * If parsing fails, restores the parser position.
   *
   * Backtracking is needed for choice specs where we need to try alternatives.
   * Example: choice([modifier: "quickly", parameter: "speed"]) requires trying
   * the first option, and if it fails, rewinding and trying the second.
   *
   * We use temporary lists to collect results during speculative parsing,
   * only committing them if the parse succeeds.
   *
   * Returns true if the spec matched AND consumed at least one token.
   * This is important for bag specs where we want to know if an optional item
   * actually matched something or just succeeded without consuming tokens.
   *
   * The context lists (contextAnons, contextParams, contextMods) contain already-parsed
   * items from outer scopes (e.g., from previous bag iterations) and are used by
   * conditionals to check if certain arguments have been provided.
   */
  private tryParseWithBacktrack(
    spec: BrainActionCallSpec,
    opts: ParseOpts,
    ctx: ActionCallContext,
    outerCtx?: ActionCallContext
  ): boolean {
    const savePos = this.i;
    const tempCtx: ActionCallContext = {
      anons: List.empty<SlotExpr>(),
      parameters: List.empty<SlotExpr>(),
      modifiers: List.empty<SlotExpr>(),
      argSpecToSlotId: ctx.argSpecToSlotId,
      matchedNames: new UniqueSet<string>(),
    };

    if (this.parseCallSpec(spec, opts, tempCtx, outerCtx)) {
      // Success - check if we consumed any tokens
      const consumedTokens = this.i > savePos;

      if (consumedTokens) {
        // Commit the results only if we actually consumed tokens
        ctx.anons.push(...tempCtx.anons.toArray());
        ctx.parameters.push(...tempCtx.parameters.toArray());
        ctx.modifiers.push(...tempCtx.modifiers.toArray());
        return true;
      } else {
        // Spec matched but didn't consume tokens (e.g., optional that didn't match)
        // Restore position and return false for bag matching purposes
        this.i = savePos;
        return false;
      }
    }

    // Failed - restore position
    this.i = savePos;
    return false;
  }

  /**
   * Parse a single argument (modifier or parameter).
   *
   * Handles three cases:
   * 1. Anonymous expression (spec.anonymous === true) - any value expression
   * 2. Specific modifier tile - exact tileId match required, no value
   * 3. Specific parameter tile - exact tileId match required, followed by value expression
   *
   * Returns false if the argument doesn't match, allowing optional/choice specs to handle it.
   */
  private parseArgSpec(spec: BrainActionCallSpec & { type: "arg" }, opts: ParseOpts, ctx: ActionCallContext): boolean {
    const nextTok = this.peek();
    if (!nextTok || opts.stop(nextTok)) {
      // No token available
      // If explicitly marked as not required (false), that's ok
      // If not specified or true, it's a failure
      return spec.required === false;
    }

    // Check if this is an anonymous parameter
    if (spec.anonymous) {
      // Parse any expression as anonymous input
      if (nextTok.kind === "modifier" || nextTok.kind === "parameter") {
        // Not an expression, this arg is not matched
        return spec.required === false;
      }
      const anonExpr = this.parseExpression({
        stop: (tok) => this.isPrimaryStart(tok) || opts.stop(tok),
        minOperatorPrecedence: 0,
        primaryAdjacencyTerminates: opts.primaryAdjacencyTerminates,
      });
      const slotId = ctx.argSpecToSlotId.get(spec)!;
      ctx.anons.push({ slotId, expr: anonExpr });
      return true;
    }

    // Check for specific tile match
    if (nextTok.kind === "modifier") {
      const modTok = nextTok as BrainTileModifierDef;
      if (modTok.tileId === spec.tileId) {
        const modPos = this.i;
        this.consume();
        const slotId = ctx.argSpecToSlotId.get(spec)!;
        ctx.modifiers.push({
          slotId,
          expr: {
            nodeId: this.nextNodeId(),
            kind: "modifier",
            tileDef: modTok,
            span: { from: modPos, to: this.i },
          },
        });
        return true;
      }
    } else if (nextTok.kind === "parameter") {
      const paramTok = nextTok as BrainTileParameterDef;
      if (paramTok.tileId === spec.tileId) {
        const paramPos = this.i;
        this.consume();
        const paramExpr = this.parseExpression({
          stop: (tok) => this.isPrimaryStart(tok) || opts.stop(tok),
          minOperatorPrecedence: 0,
          primaryAdjacencyTerminates: opts.primaryAdjacencyTerminates,
        });
        const slotId = ctx.argSpecToSlotId.get(spec)!;
        ctx.parameters.push({
          slotId,
          expr: {
            nodeId: this.nextNodeId(),
            kind: "parameter",
            tileDef: paramTok,
            value: paramExpr,
            span: { from: paramPos, to: this.i },
          },
        });
        return true;
      }
    }

    // No match - fail (return false)
    // The wrapping seq/choice/optional will determine if this is acceptable
    return false;
  }

  /**
   * Parse all items in sequence
   */
  private parseSeqSpec(
    spec: BrainActionCallSpec & { type: "seq" },
    opts: ParseOpts,
    ctx: ActionCallContext,
    outerCtx?: ActionCallContext
  ): boolean {
    for (const item of spec.items) {
      if (!this.parseCallSpec(item, opts, ctx, outerCtx)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Parse exactly one of the options
   */
  private parseChoiceSpec(
    spec: BrainActionCallSpec & { type: "choice" },
    opts: ParseOpts,
    ctx: ActionCallContext,
    outerCtx?: ActionCallContext
  ): boolean {
    // Try each option until one succeeds
    for (const option of spec.options) {
      if (this.tryParseWithBacktrack(option, opts, ctx, outerCtx)) {
        return true;
      }
    }

    // None of the options matched
    return false;
  }

  /**
   * Parse zero or one occurrence
   */
  private parseOptionalSpec(
    spec: BrainActionCallSpec & { type: "optional" },
    opts: ParseOpts,
    ctx: ActionCallContext,
    outerCtx?: ActionCallContext
  ): boolean {
    // Try to parse - if it fails, that's ok (optional)
    this.tryParseWithBacktrack(spec.item, opts, ctx, outerCtx);
    return true; // Optional always succeeds
  }

  /**
   * Parse repeated occurrences with min/max bounds
   */
  private parseRepeatSpec(
    spec: BrainActionCallSpec & { type: "repeat" },
    opts: ParseOpts,
    ctx: ActionCallContext,
    outerCtx?: ActionCallContext
  ): boolean {
    const min = spec.min ?? 0;
    const max = spec.max ?? 999999; // Use large number instead of Infinity for cross-platform
    let count = 0;

    while (count < max) {
      if (this.tryParseWithBacktrack(spec.item, opts, ctx, outerCtx)) {
        count++;
      } else {
        break;
      }
    }

    // Check if we met the minimum requirement
    return count >= min;
  }

  /**
   * Parse items in any order (unordered bag).
   *
   * The bag spec allows items to appear in any order. The parser will greedily
   * match items until no more items from the bag can be matched.
   *
   * Algorithm:
   * 1. Keep trying to match any item from the bag
   * 2. Once matched, mark that item as consumed and try again
   * 3. Continue until no items can be matched
   * 4. Check if all required items were matched
   *
   * Items containing `repeat` specs are eligible for re-matching even after
   * a previous successful match. This handles interleaved bag items like
   * [slowly] [priority] [1] [slowly] where both [slowly] tiles belong to
   * the same repeated speed modifier group but are separated by another
   * bag item. Termination is guaranteed because tryParseWithBacktrack only
   * returns true when at least one token is consumed.
   */
  private parseBagSpec(spec: BrainActionCallSpec & { type: "bag" }, opts: ParseOpts, ctx: ActionCallContext): boolean {
    // Track which items have been successfully matched using a Set of indices
    const matched = new Set<number>();
    let anyMatched = true;

    // Pre-compute which items contain repeat specs (eligible for re-matching)
    const retriable = new Set<number>();
    let preIdx = 0;
    for (const item of spec.items) {
      if (specContainsRepeat(item)) {
        retriable.add(preIdx);
      }
      preIdx++;
    }

    // Keep trying to match items until no more can be matched
    while (anyMatched) {
      anyMatched = false;

      // Try each item, passing accumulated items as context for conditionals.
      // Already-matched items with repeat descendants are retried so they can
      // consume tokens that appear after other interleaved bag items.
      let idx = 0;
      for (const item of spec.items) {
        if (!matched.has(idx) || retriable.has(idx)) {
          if (this.tryParseWithBacktrack(item, opts, ctx, ctx)) {
            matched.add(idx);
            anyMatched = true;
            break; // Start over from the first item
          }
        }
        idx++;
      }
    }

    // Check if all required items were matched
    // An item is required if it's an arg with required=true (or required undefined/true by default)
    // or if it's not wrapped in optional
    let idx = 0;
    for (const item of spec.items) {
      if (!matched.has(idx)) {
        // If the item is optional or an arg with required=false, it's ok to not match
        if (item.type === "optional") {
          idx++;
          continue;
        }
        // Conditional items are never required (they may not match if condition isn't met)
        if (item.type === "conditional") {
          idx++;
          continue;
        }
        if (item.type === "arg" && item.required === false) {
          idx++;
          continue;
        }
        // Otherwise, this is a required item that wasn't matched
        // console.log(`DEBUG: Required item ${idx} not matched, type=${item.type}, required=${item.type === "arg" ? (item as any).required : "N/A"}`);
        return false;
      }
      idx++;
    }

    return true;
  }

  /**
   * Parse a conditional spec that checks if a named call spec has been matched.
   * Used in bag specs to make certain items conditionally available.
   */
  private parseConditionalSpec(
    spec: BrainActionCallSpec & { type: "conditional" },
    opts: ParseOpts,
    ctx: ActionCallContext,
    outerCtx?: ActionCallContext
  ): boolean {
    // Check if the named spec has been matched
    // Use outer context if provided (for bag specs checking already-parsed items)
    const checkNames = outerCtx?.matchedNames || ctx.matchedNames;
    const conditionMet = checkNames.has(spec.condition);

    // Parse the appropriate branch
    if (conditionMet) {
      return this.parseCallSpec(spec.then, opts, ctx, outerCtx);
    } else if (spec.else) {
      return this.parseCallSpec(spec.else, opts, ctx, outerCtx);
    } else {
      // No else branch and condition not met - this is ok (like optional)
      return true;
    }
  }

  /**
   * Parse an expression using Pratt parsing (top-down operator precedence).
   *
   * Algorithm:
   * 1. Parse prefix (NUD - null denotation)
   * 2. While next token is an operator with sufficient precedence:
   *    a. Consume operator
   *    b. Recursively parse right side with higher min precedence (for left-associativity)
   *    c. Build binary operation node
   */
  private parseExpression(opts: ParseOpts): Expr {
    const startPos = this.i;
    let left = this.parseNud(opts);

    while (true) {
      const nextTok = this.peek();
      if (!nextTok || opts.stop(nextTok)) {
        break;
      }

      // Stop if we hit a primary expression start and adjacency should terminate
      // (prevents "move forward" from consuming "forward" as a variable)
      if (opts.primaryAdjacencyTerminates && this.isPrimaryStart(nextTok)) {
        break;
      }

      // Field accessor tiles bind at maximum precedence (tighter than any operator).
      // They wrap the left expression in a FieldAccessExpr:
      //   [$pos] [x]  ->  FieldAccess(variable(pos), "x")
      if (nextTok.kind === "accessor") {
        this.consume();
        const accessorTok = nextTok as BrainTileAccessorDef;
        left = {
          nodeId: this.nextNodeId(),
          kind: "fieldAccess",
          object: left,
          accessor: accessorTok,
          span: { from: startPos, to: this.i },
        };
        continue;
      }

      if (nextTok.kind !== "operator") {
        break;
      }

      const opTok = nextTok as BrainTileOperatorDef;
      const op = opTok.op;

      const opPrecedence = op.parse.precedence;
      if (opPrecedence < opts.minOperatorPrecedence) {
        break; // Precedence too low, let parent handle it
      }

      this.consume(); // Consume operator

      // Parse right-hand side with adjusted precedence
      const right = this.parseExpression({
        stop: opts.stop,
        minOperatorPrecedence: op.id === CoreOpId.Assign ? opPrecedence : opPrecedence + 1,
        primaryAdjacencyTerminates: opts.primaryAdjacencyTerminates,
      });

      if (op.id === CoreOpId.Assign) {
        if (left.kind !== "variable" && left.kind !== "fieldAccess") {
          this.diags.push({
            code: ParseDiagCode.InvalidAssignmentTarget,
            message: `Invalid assignment target - expected variable or field access`,
            span: { from: startPos, to: this.i },
          });
          return {
            nodeId: this.nextNodeId(),
            kind: "errorExpr",
            message: `Invalid assignment target - expected variable or field access`,
            span: { from: startPos, to: this.i },
            expr: left,
          };
        }
        if (left.kind === "fieldAccess" && left.accessor.readOnly) {
          const fieldLabel = left.accessor.visual?.label ?? left.accessor.fieldName;
          this.diags.push({
            code: ParseDiagCode.ReadOnlyFieldAssignment,
            message: `Cannot assign to read-only field "${fieldLabel}"`,
            span: { from: startPos, to: this.i },
          });
          return {
            nodeId: this.nextNodeId(),
            kind: "errorExpr",
            message: `Cannot assign to read-only field "${fieldLabel}"`,
            span: { from: startPos, to: this.i },
            expr: left,
          };
        }
        left = {
          nodeId: this.nextNodeId(),
          kind: "assignment",
          target: left,
          value: right,
          span: { from: startPos, to: this.i },
        };
      } else {
        left = {
          nodeId: this.nextNodeId(),
          kind: "binaryOp",
          operator: opTok,
          left,
          right,
          span: { from: startPos, to: this.i },
        };
      }
    }

    return left;
  }

  /**
   * Parse NUD (null denotation) - a token in prefix position.
   *
   * In Pratt terminology:
   * - NUD handles tokens at the start of an expression (prefix operators, literals, variables, etc.)
   * - LED (left denotation) handles infix operators - we handle this inline in parseExpression
   *
   * We dispatch to registered handlers based on token kind.
   */
  private parseNud(opts: ParseOpts): Expr {
    const startPos = this.i;
    const tok = this.consume();
    if (!tok) {
      this.diags.push({
        code: ParseDiagCode.ExpectedExpressionInSubExpr,
        message: `Expected expression, found end of input`,
        span: { from: startPos, to: this.i },
      });
      return {
        nodeId: this.nextNodeId(),
        kind: "errorExpr",
        message: "Expected expression, found end of input",
        span: { from: startPos, to: this.i },
      };
    }

    const handler = this.nudHandlers.get(tok.kind);
    if (handler) {
      return handler(tok, startPos, opts);
    }

    this.diags.push({
      code: ParseDiagCode.UnexpectedTokenKindInExpression,
      message: `Unexpected token of kind '${tok.kind}' in expression`,
      span: { from: startPos, to: this.i },
    });
    return {
      nodeId: this.nextNodeId(),
      kind: "errorExpr",
      message: `Unexpected token of kind '${tok.kind}' in expression`,
      span: { from: startPos, to: this.i },
    };
  }

  private parseNudLiteral(tok: IBrainTileDef, startPos: number, opts: ParseOpts): Expr {
    return {
      nodeId: this.nextNodeId(),
      kind: "literal",
      tileDef: tok as BrainTileLiteralDef,
      span: { from: startPos, to: this.i },
    };
  }

  private parseNudVariable(tok: IBrainTileDef, startPos: number, opts: ParseOpts): Expr {
    return {
      nodeId: this.nextNodeId(),
      kind: "variable",
      tileDef: tok as BrainTileVariableDef,
      span: { from: startPos, to: this.i },
    };
  }

  /**
   * Handle sensors in prefix (NUD) position.
   *
   * **Inline sensors** participate in Pratt expressions like literals -- they produce
   * a SensorExpr with empty argument lists and no call spec parsing.
   *
   * **Non-inline sensors** can also appear in expression positions as operands of
   * prefix operators (e.g., `[not] [see ...]`). When a non-inline sensor appears
   * here, we back up the parser position and delegate to `parseActionCall()`, which
   * consumes the sensor token and parses its arguments according to the call spec.
   */
  private parseNudSensor(tok: IBrainTileDef, startPos: number, opts: ParseOpts): Expr {
    const sensorTok = tok as BrainTileSensorDef;
    if (!this.isInlineTile(tok)) {
      // Non-inline sensor in expression position (e.g., operand of a prefix operator).
      // Back up to re-consume the sensor token and parse as a full action call.
      this.i = startPos;
      return this.parseActionCall(opts);
    }

    return {
      nodeId: this.nextNodeId(),
      kind: "sensor",
      tileDef: sensorTok,
      anons: List.empty<SlotExpr>(),
      parameters: List.empty<SlotExpr>(),
      modifiers: List.empty<SlotExpr>(),
      span: { from: startPos, to: this.i },
    };
  }

  /**
   * Handle operators in prefix position (unary operators).
   */
  private parseNudOperator(tok: IBrainTileDef, startPos: number, opts: ParseOpts): Expr {
    const opTok = tok as BrainTileOperatorDef;
    const op = opTok.op;

    if (op.parse.fixity === "prefix") {
      // Parse operand with same precedence as the operator (right-associative for unary)
      const right = this.parseExpression({
        stop: opts.stop,
        minOperatorPrecedence: op.parse.precedence,
        primaryAdjacencyTerminates: opts.primaryAdjacencyTerminates,
      });
      return {
        nodeId: this.nextNodeId(),
        kind: "unaryOp",
        operator: opTok,
        operand: right,
        span: { from: startPos, to: this.i },
      };
    } else {
      this.diags.push({
        code: ParseDiagCode.UnexpectedOperatorInExpression,
        message: `Unexpected operator '${opTok.op.id}' in expression`,
        span: { from: startPos, to: this.i },
      });
      return {
        nodeId: this.nextNodeId(),
        kind: "errorExpr",
        message: `Unexpected operator '${opTok.op.id}' in expression`,
        span: { from: startPos, to: this.i },
      };
    }
  }

  /**
   * Handle control flow tokens in prefix position.
   * Currently only handles opening parenthesis for grouped expressions.
   */
  private parseNudControlFlow(tok: IBrainTileDef, startPos: number, opts: ParseOpts): Expr {
    const cfTok = tok as BrainTileControlFlowDef;
    if (cfTok.cfId === CoreControlFlowId.OpenParen) {
      // Parse the inner expression with reset precedence (parens override precedence)
      const expr = this.parseExpression({
        stop: (nextTok) => {
          // Stop at closing paren or outer stop condition
          if (
            nextTok &&
            nextTok.kind === "controlFlow" &&
            (nextTok as BrainTileControlFlowDef).cfId === CoreControlFlowId.CloseParen
          ) {
            return true;
          }
          return opts.stop(nextTok);
        },
        minOperatorPrecedence: 0, // Reset precedence inside parens
        primaryAdjacencyTerminates: false,
      });

      // Expect and consume the closing parenthesis
      const closeParen = this.peek();
      if (
        closeParen?.kind === "controlFlow" &&
        (closeParen as BrainTileControlFlowDef).cfId === CoreControlFlowId.CloseParen
      ) {
        this.consume();
        return expr;
      } else {
        // Missing closing paren - report error but return the inner expression for recovery
        this.diags.push({
          code: ParseDiagCode.ExpectedClosingParen,
          message: `Expected closing parenthesis`,
          span: { from: startPos, to: this.i },
        });
        return expr;
      }
    } else {
      this.diags.push({
        code: ParseDiagCode.UnexpectedControlFlowInExpression,
        message: `Unexpected control flow token '${cfTok.cfId}' in expression`,
        span: { from: startPos, to: this.i },
      });
      return {
        nodeId: this.nextNodeId(),
        kind: "errorExpr",
        message: `Unexpected control flow token '${cfTok.cfId}' in expression`,
        span: { from: startPos, to: this.i },
      };
    }
  }

  /**
   * Check if a token can start a "primary" expression (parameter, modifier, or action call).
   *
   * This is used with primaryAdjacencyTerminates to prevent ambiguous parsing.
   * Example: "move forward" should parse as action_call("move") + expression("forward"),
   * not as action_call("move", anon=variable("forward")).
   *
   * When parsing anonymous arguments for an action, we stop if we see another primary,
   * assuming it's the start of the next statement.
   */
  private isPrimaryStart(tok: IBrainTileDef | undefined): boolean {
    if (!tok) {
      return false;
    }
    return (
      tok.kind === "modifier" ||
      tok.kind === "parameter" ||
      (tok.kind === "sensor" && !this.isInlineTile(tok)) ||
      tok.kind === "actuator" ||
      (tok.kind === "controlFlow" && (tok as BrainTileControlFlowDef).cfId === CoreControlFlowId.OpenParen)
    );
  }

  /** Look at current token without consuming it */
  private peek(): IBrainTileDef | undefined {
    if (this.i >= this.to) {
      return undefined; // EOF
    }
    return this.src.get(this.i);
  }

  /** Consume current token and advance position */
  private consume(): IBrainTileDef | undefined {
    const tok = this.peek();
    if (tok) {
      this.i++;
    }
    return tok;
  }

  /** Check if we've reached the end of the token range */
  private atEnd(): boolean {
    return this.i >= this.to;
  }

  /** Check if a tile has the Inline placement flag set */
  private isInlineTile(tok: IBrainTileDef): boolean {
    return tok.placement !== undefined && (tok.placement & TilePlacement.Inline) !== 0;
  }
}

//--------------------------------------------------
// Helpers

/**
 * Checks whether a call spec node contains a `repeat` spec anywhere in its tree.
 * Used by parseBagSpec to determine which items can be retried after an initial
 * match -- only items with repeat descendants may consume additional tokens on
 * later bag iterations.
 */
function specContainsRepeat(spec: BrainActionCallSpec): boolean {
  switch (spec.type) {
    case "arg":
      return false;
    case "repeat":
      return true;
    case "optional":
      return specContainsRepeat(spec.item);
    case "seq":
    case "bag":
      for (const item of spec.items) {
        if (specContainsRepeat(item)) return true;
      }
      return false;
    case "choice":
      for (const option of spec.options) {
        if (specContainsRepeat(option)) return true;
      }
      return false;
    case "conditional":
      if (specContainsRepeat(spec.then)) return true;
      return spec.else !== undefined && specContainsRepeat(spec.else);
    default: {
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
}

//--------------------------------------------------
// Public API

export function parseBrainTiles(src: ReadonlyList<IBrainTileDef>, to: number = -1, from: number = 0): ParseResult {
  const parser = new BrainParser(src, to, from);
  return parser.parse();
}
