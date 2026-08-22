/**
 * Characterization suite for buildInsertionContext. Pins the three insertion
 * shapes: append (expr parsed from the full tile list), insert-at-index (expr
 * parsed from the truncated tile list), and replace-at-index (expr passed
 * through, replaced tile excluded from the unclosed-paren count).
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";
import { UniqueSet } from "@wendoo-lang/core";
import type { BrainServices, IBrainTileDef } from "@wendoo-lang/core/brain";
import { CoreControlFlowId, mkControlFlowTileId, RuleSide } from "@wendoo-lang/core/brain";
import { __test__createBrainServices } from "@wendoo-lang/core/brain/__test__";
import { buildInsertionContext, parseTilesForSuggestions } from "@wendoo-lang/core/brain/language-service";
import { BrainDef, type BrainRuleDef } from "@wendoo-lang/core/brain/model";
import { BrainTileLiteralDef } from "@wendoo-lang/core/brain/tiles";
import { CoreTypeIds } from "@wendoo-lang/core/runtime";
import { BitSet } from "@wendoo-lang/core/util";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

function coreTile(tileId: string): IBrainTileDef {
  const tileDef = services.edit.tiles.get(tileId);
  assert.ok(tileDef, `core tile not registered: ${tileId}`);
  return tileDef;
}

function openParenTile(): IBrainTileDef {
  return coreTile(mkControlFlowTileId(CoreControlFlowId.OpenParen));
}

function closeParenTile(): IBrainTileDef {
  return coreTile(mkControlFlowTileId(CoreControlFlowId.CloseParen));
}

/** A rule whose WHEN side holds the given tiles, built through the real model API. */
function ruleWithWhenTiles(brain: BrainDef, tiles: readonly IBrainTileDef[]): BrainRuleDef {
  const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
  for (const tileDef of tiles) {
    rule.when().appendTile(tileDef);
  }
  return rule;
}

function numberLiteralTile(brain: BrainDef, value: number): IBrainTileDef {
  const tileDef = new BrainTileLiteralDef(CoreTypeIds.Number, value, {}, services);
  const existing = brain.catalog().get(tileDef.tileId);
  if (existing) return existing;
  brain.catalog().registerTileDef(tileDef);
  return tileDef;
}

describe("buildInsertionContext -- append shape", () => {
  test("parses the expression from the full existing tile list", () => {
    const brain = BrainDef.emptyBrainDef(services);
    const rule = ruleWithWhenTiles(brain, [numberLiteralTile(brain, 5)]);
    const tiles = rule.when().tiles();

    const context = buildInsertionContext({ side: RuleSide.When, existingTiles: tiles });

    assert.equal(context.ruleSide, RuleSide.When);
    assert.equal(context.replaceTileIndex, undefined);
    assert.equal(context.expr?.kind, parseTilesForSuggestions(tiles).kind);
    assert.equal(context.expr?.kind, "literal");
    assert.equal(context.unclosedParenDepth, 0);
  });

  test("an empty tile list parses to an empty expression with zero paren depth", () => {
    const brain = BrainDef.emptyBrainDef(services);
    const rule = ruleWithWhenTiles(brain, []);

    const context = buildInsertionContext({ side: RuleSide.Do, existingTiles: rule.do().tiles() });

    assert.equal(context.ruleSide, RuleSide.Do);
    assert.equal(context.expr?.kind, "empty");
    assert.equal(context.unclosedParenDepth, 0);
  });

  test("counts unclosed parens across the existing tiles", () => {
    const brain = BrainDef.emptyBrainDef(services);
    const rule = ruleWithWhenTiles(brain, [openParenTile(), openParenTile(), numberLiteralTile(brain, 1)]);

    const context = buildInsertionContext({ side: RuleSide.When, existingTiles: rule.when().tiles() });

    assert.equal(context.unclosedParenDepth, 2);
  });

  test("passes capability, output-key, rule, and expected-type inputs through unchanged", () => {
    const brain = BrainDef.emptyBrainDef(services);
    const rule = ruleWithWhenTiles(brain, []);
    const capabilities = new BitSet();
    const outputKeys = new UniqueSet<string>();

    const context = buildInsertionContext({
      side: RuleSide.When,
      expectedType: CoreTypeIds.Number,
      availableCapabilities: capabilities,
      availableOutputKeys: outputKeys,
      ruleDef: rule,
      existingTiles: rule.when().tiles(),
    });

    assert.equal(context.expectedType, CoreTypeIds.Number);
    assert.equal(context.availableCapabilities, capabilities);
    assert.equal(context.availableOutputKeys, outputKeys);
    assert.equal(context.ruleDef, rule);
  });

  test("no existing tiles yields no expression and zero paren depth", () => {
    const context = buildInsertionContext({ side: RuleSide.When });
    assert.equal(context.expr, undefined);
    assert.equal(context.unclosedParenDepth, 0);
  });
});

describe("buildInsertionContext -- insert-at-index shape", () => {
  test("parses the expression from the truncated tile list the insert flow supplies", () => {
    const brain = BrainDef.emptyBrainDef(services);
    const rule = ruleWithWhenTiles(brain, [openParenTile(), numberLiteralTile(brain, 3)]);
    // The insert flow passes tiles.slice(0, insertIndex): the context sees
    // only tiles preceding the insertion point.
    const truncated = rule.when().tiles().slice(0, 1);

    const context = buildInsertionContext({ side: RuleSide.When, existingTiles: truncated });

    assert.equal(context.replaceTileIndex, undefined);
    assert.equal(context.expr?.kind, parseTilesForSuggestions(truncated).kind);
    assert.equal(context.unclosedParenDepth, 1, "only the truncated prefix contributes parens");
  });
});

describe("buildInsertionContext -- replace-at-index shape", () => {
  test("passes the supplied expression through and sets the replace index", () => {
    const brain = BrainDef.emptyBrainDef(services);
    const rule = ruleWithWhenTiles(brain, [numberLiteralTile(brain, 5)]);
    rule.typecheck();
    const expr = rule.when().expr();
    assert.ok(expr, "a typechecked side exposes its parsed expression");

    const context = buildInsertionContext({
      side: RuleSide.When,
      expr,
      replaceTileIndex: 0,
      existingTiles: rule.when().tiles(),
    });

    assert.equal(context.expr, expr, "a supplied expression is used verbatim, not re-parsed");
    assert.equal(context.replaceTileIndex, 0);
  });

  test("excludes the replaced tile from the unclosed-paren count", () => {
    const brain = BrainDef.emptyBrainDef(services);
    const rule = ruleWithWhenTiles(brain, [openParenTile(), numberLiteralTile(brain, 1)]);
    const tiles = rule.when().tiles();

    const replacingParen = buildInsertionContext({ side: RuleSide.When, replaceTileIndex: 0, existingTiles: tiles });
    assert.equal(replacingParen.unclosedParenDepth, 0, "the replaced open paren is not counted");

    const replacingLiteral = buildInsertionContext({ side: RuleSide.When, replaceTileIndex: 1, existingTiles: tiles });
    assert.equal(replacingLiteral.unclosedParenDepth, 1);
  });

  test("resolves the matched parenthesis at the replaced index, and only there", () => {
    const brain = BrainDef.emptyBrainDef(services);
    const rule = ruleWithWhenTiles(brain, [openParenTile(), numberLiteralTile(brain, 1), closeParenTile()]);
    const tiles = rule.when().tiles();

    const index = (replaceTileIndex: number) =>
      buildInsertionContext({ side: RuleSide.When, replaceTileIndex, existingTiles: tiles }).matchedParen;

    assert.equal(index(0), openParenTile());
    assert.equal(index(2), closeParenTile());
    assert.equal(index(1), undefined, "the value between the parens is no parenthesis");
  });

  test("leaves the matched parenthesis unset for an unmatched paren and for the append shape", () => {
    const brain = BrainDef.emptyBrainDef(services);
    const rule = ruleWithWhenTiles(brain, [openParenTile(), numberLiteralTile(brain, 1)]);
    const tiles = rule.when().tiles();

    assert.equal(
      buildInsertionContext({ side: RuleSide.When, replaceTileIndex: 0, existingTiles: tiles }).matchedParen,
      undefined
    );
    assert.equal(buildInsertionContext({ side: RuleSide.When, existingTiles: tiles }).matchedParen, undefined);
  });
});
