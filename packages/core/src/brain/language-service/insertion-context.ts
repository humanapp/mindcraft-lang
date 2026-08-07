import type { ReadonlyList } from "../../platform/list";
import type { UniqueSet } from "../../platform/uniqueset";
import type { TypeId } from "../../runtime";
import type { ReadonlyBitSet } from "../../util/bitset";
import type { Expr } from "../compiler/types";
import type { IBrainRuleDef, IBrainTileDef, RuleSide } from "../interfaces";
import {
  countUnclosedParens,
  type InsertionContext,
  matchedParenAt,
  parseTilesForSuggestions,
} from "./tile-suggestions";

/**
 * Inputs resolved into an {@link InsertionContext}.
 *
 * The three insertion-point shapes map onto these fields as follows:
 * - Append: `existingTiles` is the full tile list of the target side;
 *   `expr` and `replaceTileIndex` are omitted.
 * - Insert-at-index: `existingTiles` is the tile list truncated at the
 *   insertion index; `expr` and `replaceTileIndex` are omitted.
 * - Replace-at-index: `existingTiles` is the full tile list, `expr` is the
 *   side's parsed expression, and `replaceTileIndex` is the index of the
 *   tile being replaced.
 */
export interface InsertionContextInputs {
  side: RuleSide;
  expectedType?: TypeId;
  expr?: Expr;
  replaceTileIndex?: number;
  availableCapabilities?: ReadonlyBitSet;
  availableOutputKeys?: UniqueSet<string>;
  /** The rule being edited; supplies the WHEN-result type that gates WHEN-result-consuming tiles. */
  ruleDef?: IBrainRuleDef;
  existingTiles?: ReadonlyList<IBrainTileDef>;
}

/**
 * Build the {@link InsertionContext} passed to `suggestTiles`. When `expr` is
 * not supplied, it is parsed from `existingTiles`; the unclosed-paren depth is
 * counted over `existingTiles`, excluding `replaceTileIndex` when set. In the
 * replace shape the matched parenthesis at `replaceTileIndex` is resolved over
 * `existingTiles` (see `matchedParenAt`).
 */
export function buildInsertionContext(inputs: InsertionContextInputs): InsertionContext {
  const { side, expectedType, replaceTileIndex, availableCapabilities, availableOutputKeys, ruleDef, existingTiles } =
    inputs;
  const expr = inputs.expr ?? (existingTiles ? parseTilesForSuggestions(existingTiles) : undefined);
  const unclosedParenDepth = existingTiles ? countUnclosedParens(existingTiles, replaceTileIndex) : 0;
  const matchedParen =
    existingTiles && replaceTileIndex !== undefined ? matchedParenAt(existingTiles, replaceTileIndex) : undefined;
  return {
    ruleSide: side,
    expectedType,
    expr,
    replaceTileIndex,
    availableCapabilities,
    availableOutputKeys,
    matchedParen,
    ruleDef,
    unclosedParenDepth,
  };
}
