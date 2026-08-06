import { List } from "@mindcraft-lang/core";
import type { IBrainTileDef, RuleSide } from "@mindcraft-lang/core/brain";
import type { InsertionContext, TileSuggestion } from "@mindcraft-lang/core/brain/language-service";
import {
  collectRuleHierarchyCapabilities,
  collectRuleHierarchyOutputKeys,
  suggestTiles as coreSuggestTiles,
  countUnclosedParens,
  parseTilesForSuggestions,
  tileSentenceWord,
} from "@mindcraft-lang/core/brain/language-service";
import type { BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import type { Localizer } from "@mindcraft-lang/core/localization";
import type { ToolInput } from "./tool-schemas.js";
import { type AuthoringWorkspace, findRule, toRuleSide } from "./workspace.js";

/** One tile the legality oracle offers at an insertion point. */
export interface SuggestedTile {
  readonly tileId: string;
  /** The word the tile reads by in the environment's locale. */
  readonly label: string;
}

/** The oracle's offering at one insertion point. */
export interface SuggestionView {
  readonly ruleId: string;
  readonly side: string;
  /** Index the offering was computed for. */
  readonly position: number;
  /** Tiles that fit as they are. */
  readonly exact: readonly SuggestedTile[];
  /** Tiles that fit once the compiler applies a value conversion. */
  readonly withConversion: readonly SuggestedTile[];
}

/** The error a suggestion request returns when it names something the document does not hold. */
export interface SuggestionError {
  readonly error: "unknown_rule" | "position_out_of_range";
  /** The rule id or index the request named. */
  readonly named: string;
}

function toSuggestedTiles(suggestions: List<TileSuggestion>, localizer: Localizer): SuggestedTile[] {
  const tiles: SuggestedTile[] = [];
  for (let i = 0; i < suggestions.size(); i++) {
    const tileDef = suggestions.get(i)!.tileDef;
    tiles.push({ tileId: tileDef.tileId, label: tileSentenceWord(tileDef, localizer) });
  }
  return tiles;
}

/**
 * Build the insertion context for `position` on `side` of `rule`: the tiles
 * before the insertion point, the expression they parse to, and the outputs and
 * capabilities the rule hierarchy makes available there.
 */
function insertionContext(rule: BrainRuleDef, side: RuleSide, position: number): InsertionContext {
  const tiles = rule.side(side).tiles();
  const prefix = List.empty<IBrainTileDef>();
  for (let i = 0; i < position; i++) prefix.push(tiles.get(i)!);
  return {
    ruleSide: side,
    expr: parseTilesForSuggestions(prefix),
    availableCapabilities: collectRuleHierarchyCapabilities(rule),
    availableOutputKeys: collectRuleHierarchyOutputKeys(rule),
    ruleDef: rule,
    unclosedParenDepth: countUnclosedParens(prefix),
  };
}

/**
 * Ask the legality oracle which tiles are valid at one insertion point. Returns
 * a {@link SuggestionError} when the request names a rule or position the
 * document does not hold.
 */
export function suggestTiles(
  workspace: AuthoringWorkspace,
  input: ToolInput<"suggest_tiles">
): SuggestionView | SuggestionError {
  const located = findRule(workspace.brainDef, input.ruleId);
  if (!located) return { error: "unknown_rule", named: input.ruleId };

  const side = toRuleSide(input.side);
  const tileCount = located.rule.side(side).tiles().size();
  const position = input.position ?? tileCount;
  if (position > tileCount) return { error: "position_out_of_range", named: String(position) };

  const result = coreSuggestTiles(
    insertionContext(located.rule, side, position),
    workspace.catalogs,
    workspace.environment.brainServices
  );
  const localizer = workspace.environment.appServices.localizer;
  return {
    ruleId: input.ruleId,
    side: input.side,
    position,
    exact: toSuggestedTiles(result.exact, localizer),
    withConversion: toSuggestedTiles(result.withConversion, localizer),
  };
}
