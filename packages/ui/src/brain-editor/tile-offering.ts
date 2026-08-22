import type { ReadonlyBitSet, ReadonlyList, UniqueSet } from "@wendoo/core";
import type { BrainServices, IBrainTileDef, ITileCatalog } from "@wendoo/core/brain";
import { RuleSide } from "@wendoo/core/brain";
import { buildInsertionContext, suggestTiles, type TileSuggestion } from "@wendoo/core/brain/language-service";
import type { BrainRuleDef } from "@wendoo/core/brain/model";

/** What {@link sideOffersAppendedTile} asks the suggestion oracle about. */
export interface AppendedTileInputs {
  /** The rule whose side is asked about. */
  ruleDef: BrainRuleDef;
  /** Which side of the rule the tile would be appended to. */
  side: RuleSide;
  /** The catalogs the tile would be placed from; an empty list offers nothing. */
  catalogs: ReadonlyList<ITileCatalog>;
  services: BrainServices;
  availableCapabilities?: ReadonlyBitSet;
  availableOutputKeys?: UniqueSet<string>;
}

/**
 * True when the suggestion oracle offers at least one tile at the end of the
 * given side, whether it fits directly or through a conversion.
 *
 * Asks over the side's full tile list and the expression it last parsed to.
 * False means the oracle offered nothing: either the grammar allows nothing
 * further, or `catalogs` holds nothing to offer. A side that does not parse is
 * not a false: the oracle answers an unparsed side with the tiles that can open
 * an expression.
 */
export function sideOffersAppendedTile(inputs: AppendedTileInputs): boolean {
  const { ruleDef, side, catalogs, services, availableCapabilities, availableOutputKeys } = inputs;
  const tileSet = side === RuleSide.When ? ruleDef.when() : ruleDef.do();
  const context = buildInsertionContext({
    side,
    expr: tileSet.expr(),
    availableCapabilities,
    availableOutputKeys,
    ruleDef,
    existingTiles: tileSet.tiles(),
  });
  const result = suggestTiles(context, catalogs, services);
  return !result.exact.isEmpty() || !result.withConversion.isEmpty();
}

/** What {@link positionOffersTile} asks the suggestion oracle about. */
export interface OfferedTileInputs extends AppendedTileInputs {
  /** The tile asked about, which the oracle is asked to offer by id. */
  tileDef: IBrainTileDef;
  /** Where on the side the tile would go; the side's tile count asks about its end. */
  tileIndex: number;
}

/**
 * True when the suggestion oracle offers `tileDef` at `tileIndex` of the given
 * side, whether it fits directly or through a conversion.
 *
 * Asked as if the tile were inserted at `tileIndex`, over the side's tiles up
 * to that index. False means the oracle does not offer the tile there.
 */
export function positionOffersTile(inputs: OfferedTileInputs): boolean {
  const { ruleDef, side, catalogs, services, availableCapabilities, availableOutputKeys, tileDef, tileIndex } = inputs;
  const tileSet = side === RuleSide.When ? ruleDef.when() : ruleDef.do();
  const context = buildInsertionContext({
    side,
    availableCapabilities,
    availableOutputKeys,
    ruleDef,
    existingTiles: tileSet.tiles().slice(0, tileIndex),
  });
  const result = suggestTiles(context, catalogs, services);
  const offers = (suggestions: ReadonlyList<TileSuggestion>) =>
    suggestions.findIndex((suggestion) => suggestion.tileDef.tileId === tileDef.tileId) !== -1;
  return offers(result.exact) || offers(result.withConversion);
}
