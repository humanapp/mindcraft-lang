import { List } from "@wendoo/core";
import type { IBrainTileDef } from "@wendoo/core/brain";
import { RuleSide } from "@wendoo/core/brain";
import type { InsertionContext, TileSuggestion } from "@wendoo/core/brain/language-service";
import {
  buildInsertionContext,
  collectRuleHierarchyCapabilities,
  collectRuleHierarchyOutputKeys,
  suggestTiles as coreSuggestTiles,
  tileSentenceWord,
} from "@wendoo/core/brain/language-service";
import type { BrainRuleDef } from "@wendoo/core/brain/model";
import type { Localizer } from "@wendoo/core/localization";
import type { ToolInput } from "./tool-schemas.js";
import { type AuthoringWorkspace, findRule, tileCatalogsOf, toRuleSide } from "./workspace.js";

/** One tile the legality oracle offers at a position. */
export interface SuggestedTile {
  readonly tileId: string;
  /** The word the tile reads by in the environment's locale. */
  readonly label: string;
}

/** What a position offers: the tiles that may go in, or take the place of, the tile there. */
export interface SuggestionView {
  readonly ruleId: string;
  readonly side: string;
  /** Which question was asked: what may be inserted, or what may replace the tile standing there. */
  readonly mode: "insert" | "replace";
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

/** The tiles of `side` up to `position`, which the insert shape asks over. */
function tilePrefix(rule: BrainRuleDef, side: RuleSide, position: number): List<IBrainTileDef> {
  const tiles = rule.side(side).tiles();
  const prefix = List.empty<IBrainTileDef>();
  for (let i = 0; i < position; i++) prefix.push(tiles.get(i)!);
  return prefix;
}

/**
 * The insertion context for `position` on `side` of `rule`, in the shape `mode`
 * asks in: the insert shape over the tiles preceding the position, the
 * replacement shape over the whole side with `position` marked as the tile
 * being replaced. Both carry the outputs and capabilities the rule hierarchy
 * makes available there.
 */
function insertionContext(
  rule: BrainRuleDef,
  side: RuleSide,
  mode: "insert" | "replace",
  position: number
): InsertionContext {
  const tileSet = side === RuleSide.When ? rule.when() : rule.do();
  const replacing = mode === "replace";
  return buildInsertionContext({
    side,
    expr: replacing ? tileSet.expr() : undefined,
    replaceTileIndex: replacing ? position : undefined,
    availableCapabilities: collectRuleHierarchyCapabilities(rule),
    availableOutputKeys: collectRuleHierarchyOutputKeys(rule),
    ruleDef: rule,
    existingTiles: replacing ? tileSet.tiles() : tilePrefix(rule, side, position),
  });
}

/**
 * Ask the legality oracle what one position offers: in insert mode the tiles
 * that may be placed there, in replace mode the tiles that may take the place
 * of the one standing there. Returns a {@link SuggestionError} when the request
 * names a rule or position the document does not hold.
 */
export function suggestTiles(
  workspace: AuthoringWorkspace,
  input: ToolInput<"suggest_tiles">
): SuggestionView | SuggestionError {
  const located = findRule(workspace.brainDef, input.ruleId);
  if (!located) return { error: "unknown_rule", named: input.ruleId };

  const side = toRuleSide(input.side);
  const tileCount = located.rule.side(side).tiles().size();
  const position = input.mode === "replace" ? input.position : (input.position ?? tileCount);
  const beyond = input.mode === "replace" ? position >= tileCount : position > tileCount;
  if (beyond) return { error: "position_out_of_range", named: String(position) };

  const result = coreSuggestTiles(
    insertionContext(located.rule, side, input.mode, position),
    tileCatalogsOf(workspace.catalogs),
    workspace.environment.brainServices
  );
  const localizer = workspace.environment.appServices.localizer;
  return {
    ruleId: input.ruleId,
    side: input.side,
    mode: input.mode,
    position,
    exact: toSuggestedTiles(result.exact, localizer),
    withConversion: toSuggestedTiles(result.withConversion, localizer),
  };
}
