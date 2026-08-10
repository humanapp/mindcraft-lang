import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RuleSide } from "@mindcraft-lang/core/brain";
import {
  buildInsertionContext,
  collectRuleHierarchyCapabilities,
  collectRuleHierarchyOutputKeys,
  suggestTiles as coreSuggestTiles,
} from "@mindcraft-lang/core/brain/language-service";
import { createTargetAdapter, ruleIdAt } from "../testing/index.js";
import { proposeEdit } from "./propose-edit.js";
import type { SuggestionView } from "./suggest-tiles.js";
import { suggestTiles } from "./suggest-tiles.js";
import type { RuleSideName } from "./tool-schemas.js";
import type { AuthoringWorkspace } from "./workspace.js";
import { createAuthoringWorkspace, findRule, toRuleSide } from "./workspace.js";

/** Tiles the fake target's brains are authored from. */
const tiles = {
  sensor: "tile.sensor->sensor.fake.signal",
  actuator: "tile.actuator->actuator.fake.emit",
  modifier: "tile.modifier->modifier:fake.loudly",
  parameter: "tile.parameter->parameter:fake.strength",
  numberFactory: "tile.lit.factory->number",
} as const;

/** A workspace holding `WHEN the signal is on DO emit loudly at strength 7` in its one rule. */
function authoredWorkspace(): AuthoringWorkspace {
  const ws = createAuthoringWorkspace(createTargetAdapter(), "fake brain");
  const when = proposeEdit(ws, {
    op: "placeTiles",
    ruleId: ruleIdAt(ws.brainDef, "0/0"),
    side: "when",
    tileIds: [tiles.sensor],
  });
  assert.equal(when.ok, true, JSON.stringify(when));
  const doSide = proposeEdit(ws, {
    op: "placeTiles",
    ruleId: ruleIdAt(ws.brainDef, "0/0"),
    side: "do",
    tileIds: [tiles.actuator, tiles.modifier, tiles.parameter, { tileId: tiles.numberFactory, value: 7 }],
  });
  assert.equal(doSide.ok, true, JSON.stringify(doSide));
  return ws;
}

/** How many tiles `side` of the document's one rule holds. */
function tileCount(ws: AuthoringWorkspace, side: RuleSideName): number {
  return findRule(ws.brainDef, ruleIdAt(ws.brainDef, "0/0"))!.rule.side(toRuleSide(side)).tiles().size();
}

/** The offering as two id lists, which is what two paths are compared on. */
interface OfferedIds {
  readonly exact: string[];
  readonly withConversion: string[];
}

/**
 * The offering the editor's tile picker gets for replacing the tile at
 * `tileIndex`: the whole side, the expression it last parsed to, and the
 * capabilities and outputs the rule hierarchy provides.
 */
function editorReplacementOffering(ws: AuthoringWorkspace, side: RuleSideName, tileIndex: number): OfferedIds {
  const rule = findRule(ws.brainDef, ruleIdAt(ws.brainDef, "0/0"))!.rule;
  const ruleSide = toRuleSide(side);
  const tileSet = ruleSide === RuleSide.When ? rule.when() : rule.do();
  const result = coreSuggestTiles(
    buildInsertionContext({
      side: ruleSide,
      expr: tileSet.expr(),
      replaceTileIndex: tileIndex,
      availableCapabilities: collectRuleHierarchyCapabilities(rule),
      availableOutputKeys: collectRuleHierarchyOutputKeys(rule),
      ruleDef: rule,
      existingTiles: tileSet.tiles(),
    }),
    ws.catalogs,
    ws.environment.brainServices
  );
  const ids = (suggestions: typeof result.exact): string[] => {
    const out: string[] = [];
    for (let i = 0; i < suggestions.size(); i++) out.push(suggestions.get(i)!.tileDef.tileId);
    return out;
  };
  return { exact: ids(result.exact), withConversion: ids(result.withConversion) };
}

/** The tool's offering as the same two id lists. */
function toolOffering(view: SuggestionView): OfferedIds {
  return {
    exact: view.exact.map((tile) => tile.tileId),
    withConversion: view.withConversion.map((tile) => tile.tileId),
  };
}

/** The tool's answer at `position`. Fails the test when the request is not answerable. */
function offeringAt(ws: AuthoringWorkspace, side: RuleSideName, mode: "insert" | "replace", position: number) {
  const view = suggestTiles(ws, { mode, ruleId: ruleIdAt(ws.brainDef, "0/0"), side, position });
  assert.ok("exact" in view, JSON.stringify(view));
  return view;
}

describe("suggest_tiles replacement mode", () => {
  test("answers the same offering the editor's picker gets, at every replaceable position", () => {
    const ws = authoredWorkspace();

    for (const side of ["when", "do"] as const) {
      const count = tileCount(ws, side);
      assert.ok(count > 0, side);
      for (let position = 0; position < count; position++) {
        assert.deepEqual(
          toolOffering(offeringAt(ws, side, "replace", position)),
          editorReplacementOffering(ws, side, position),
          `${side}[${position}]`
        );
      }
    }
  });

  test("echoes the mode and the position it answered for", () => {
    const ws = authoredWorkspace();
    const view = offeringAt(ws, "do", "replace", 1);

    assert.equal(view.mode, "replace");
    assert.equal(view.position, 1);
    assert.equal(view.side, "do");
    assert.equal(view.ruleId, ruleIdAt(ws.brainDef, "0/0"));
  });

  test("asks what may stand where a tile already stands, not what may follow it", () => {
    const ws = authoredWorkspace();

    const replacing = offeringAt(ws, "when", "replace", 0).exact.map((tile) => tile.tileId);
    const appending = offeringAt(ws, "when", "insert", tileCount(ws, "when")).exact.map((tile) => tile.tileId);

    assert.ok(replacing.includes(tiles.sensor), "the tile standing there is legal in its own place");
    assert.ok(!appending.includes(tiles.sensor), "nothing may follow a complete sensor but an operator");
  });

  test("offers a tile the editor then accepts in that position", () => {
    const ws = authoredWorkspace();
    const position = tileCount(ws, "do") - 1;
    const standing = findRule(ws.brainDef, ruleIdAt(ws.brainDef, "0/0"))!
      .rule.side(RuleSide.Do)
      .tiles()
      .get(position)!.tileId;
    const offered = offeringAt(ws, "do", "replace", position)
      .exact.map((tile) => tile.tileId)
      .filter((tileId) => tileId !== standing);
    assert.ok(offered.length > 0, "the position offers something other than the tile already there");

    const landed = offered.filter((tileId) => {
      const result = proposeEdit(ws, {
        op: "replaceTile",
        ruleId: ruleIdAt(ws.brainDef, "0/0"),
        side: "do",
        position,
        tileId,
      });
      if (result.ok) ws.history.undo();
      return result.ok;
    });

    assert.ok(landed.length > 0, "no tile offered for the position landed there");
  });

  test("refuses a position holding no tile, and a rule the document does not hold", () => {
    const ws = authoredWorkspace();
    const count = tileCount(ws, "when");

    assert.deepEqual(
      suggestTiles(ws, { mode: "replace", ruleId: ruleIdAt(ws.brainDef, "0/0"), side: "when", position: count }),
      {
        error: "position_out_of_range",
        named: String(count),
      }
    );
    assert.deepEqual(suggestTiles(ws, { mode: "replace", ruleId: "9/9", side: "when", position: 0 }), {
      error: "unknown_rule",
      named: "9/9",
    });
  });
});

describe("suggest_tiles insert mode", () => {
  test("answers over the tiles preceding the position, and defaults to the end of the side", () => {
    const ws = authoredWorkspace();
    const count = tileCount(ws, "do");

    const atEnd = offeringAt(ws, "do", "insert", count);
    const defaulted = suggestTiles(ws, { mode: "insert", ruleId: ruleIdAt(ws.brainDef, "0/0"), side: "do" });

    assert.ok("exact" in defaulted);
    assert.equal(defaulted.position, count);
    assert.deepEqual(toolOffering(defaulted), toolOffering(atEnd));
  });

  test("refuses a position past the end of the side", () => {
    const ws = authoredWorkspace();
    const beyond = tileCount(ws, "when") + 1;

    assert.deepEqual(
      suggestTiles(ws, { mode: "insert", ruleId: ruleIdAt(ws.brainDef, "0/0"), side: "when", position: beyond }),
      {
        error: "position_out_of_range",
        named: String(beyond),
      }
    );
  });
});
