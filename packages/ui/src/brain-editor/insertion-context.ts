import type { ReadonlyBitSet, ReadonlyList, UniqueSet } from "@mindcraft-lang/core";
import type { IBrainRuleDef, IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import type { Expr } from "@mindcraft-lang/core/brain/compiler";
import {
  countUnclosedParens,
  type InsertionContext,
  parseTilesForSuggestions,
} from "@mindcraft-lang/core/brain/language-service";
import type { TypeId } from "@mindcraft-lang/core/runtime";

/**
 * Inputs the tile picker resolves into an {@link InsertionContext}.
 *
 * The three picker shapes map onto these fields as follows:
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
 * Build the {@link InsertionContext} passed to `suggestTiles` from the tile
 * picker's inputs. When `expr` is not supplied, it is parsed from
 * `existingTiles`; the unclosed-paren depth is counted over `existingTiles`,
 * excluding `replaceTileIndex` when set.
 */
export function buildInsertionContext(inputs: InsertionContextInputs): InsertionContext {
  const { side, expectedType, replaceTileIndex, availableCapabilities, availableOutputKeys, ruleDef, existingTiles } =
    inputs;
  const expr = inputs.expr ?? (existingTiles ? parseTilesForSuggestions(existingTiles) : undefined);
  const unclosedParenDepth = existingTiles ? countUnclosedParens(existingTiles, replaceTileIndex) : 0;
  return {
    ruleSide: side,
    expectedType,
    expr,
    replaceTileIndex,
    availableCapabilities,
    availableOutputKeys,
    ruleDef,
    unclosedParenDepth,
  };
}
