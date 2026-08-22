/**
 * Where the catalog says a tile may go and where the editor actually takes it
 * are the same statement: every rule side `read_catalog` names accepts the tile,
 * every side it leaves out refuses it for its placement, and nesting changes
 * neither.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { TilePlacement } from "@wendoo/core/brain";
import { ParseDiagCode } from "@wendoo/core/brain/compiler";
import { FakeActionKeys, FakeTileIds } from "../testing/fake-module.js";
import { createTargetAdapter, ruleIdAt } from "../testing/index.js";
import { proposeEdit } from "./propose-edit.js";
import { readCatalog } from "./read-catalog.js";
import type { RuleSideName } from "./tool-schemas.js";
import type { AuthoringWorkspace } from "./workspace.js";
import { createAuthoringWorkspace, findTile } from "./workspace.js";

/** Where the rule a fresh brain document already holds stands. */
const kFirstRulePath = "0/0";

/** The rule sides `read_catalog` names. */
const kSides: readonly RuleSideName[] = ["when", "do"];

/** A workspace over the fake target. */
function workspace(): AuthoringWorkspace {
  return createAuthoringWorkspace(createTargetAdapter(), "placement brain");
}

/** The id of a fresh empty rule appended to the document's first page. */
function emptyRuleId(session: AuthoringWorkspace): string {
  const result = proposeEdit(session, { op: "addRule", pageIndex: 0 });
  assert.equal(result.ok, true, JSON.stringify(result));
  return (result as { rule: { ruleId: string } }).rule.ruleId;
}

/** The id of a fresh empty rule nested under the document's first rule. */
function nestedRuleId(session: AuthoringWorkspace): string {
  const result = proposeEdit(session, {
    op: "addChildRule",
    parentRuleId: ruleIdAt(session.brainDef, kFirstRulePath),
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  return (result as { rule: { ruleId: string } }).rule.ruleId;
}

/**
 * True when the editor refuses `tileId` on `side` of `ruleId` for its placement.
 * A tile refused for any other reason -- an unfinished expression, a missing
 * provider -- is not refused for its placement.
 */
function refusedForPlacement(session: AuthoringWorkspace, ruleId: string, side: RuleSideName, tileId: string): boolean {
  const result = proposeEdit(session, { op: "placeTile", ruleId, side, tileId });
  return (result as { code?: number }).code === ParseDiagCode.TilePlacementSideMismatch;
}

/**
 * Check every tile of the fake target's catalog against the editor, placing each
 * on a rule `freshRule` produces, and assert the catalog's `placement` names
 * exactly the sides the editor does not refuse it on.
 */
function assertCatalogAgrees(session: AuthoringWorkspace, freshRule: () => string): void {
  const tiles = readCatalog(session, {}).tiles;
  assert.ok(tiles.length > 0, "the world offers tiles");
  for (const entry of tiles) {
    for (const side of kSides) {
      assert.equal(
        entry.placement.includes(side),
        !refusedForPlacement(session, freshRule(), side, entry.tileId),
        `${entry.tileId} on ${side}`
      );
    }
  }
}

describe("what read_catalog says about placement", () => {
  test("names exactly the sides of a root rule the editor accepts each tile on", () => {
    const session = workspace();

    assertCatalogAgrees(session, () => emptyRuleId(session));
  });

  test("names nothing beyond the placements the editor enforces", () => {
    const session = workspace();

    const named = new Set(readCatalog(session, {}).tiles.flatMap((entry) => entry.placement));

    assert.deepEqual([...named].sort(), ["do", "inline", "when"]);
  });

  test("leaves a tile's unenforced placement bits unnamed", () => {
    const session = workspace();
    const tileId = `tile.modifier->${FakeTileIds.Loudly}`;
    const tile = findTile(session.catalogs, tileId);
    assert.ok(tile, "the fake target offers a modifier");
    const before = readCatalog(session, { filter: tileId }).tiles[0]?.placement;

    tile.placement = (tile.placement ?? 0) | TilePlacement.ChildRule | TilePlacement.InsideLoop;

    assert.deepEqual(readCatalog(session, { filter: tileId }).tiles[0]?.placement, before);
  });
});

describe("what a nested rule accepts", () => {
  test("names exactly the sides of a child rule the editor accepts each tile on", () => {
    const session = workspace();

    assertCatalogAgrees(session, () => nestedRuleId(session));
  });

  test("refuses on a child's WHEN side the actuator a root rule's WHEN side refuses", () => {
    const session = workspace();

    const atRoot = refusedForPlacement(session, emptyRuleId(session), "when", `tile.actuator->${FakeActionKeys.Emit}`);
    const atChild = refusedForPlacement(
      session,
      nestedRuleId(session),
      "when",
      `tile.actuator->${FakeActionKeys.Emit}`
    );

    assert.equal(atRoot, true);
    assert.equal(atChild, true);
  });

  test("takes on a child's DO side the actuator a root rule's DO side takes", () => {
    const session = workspace();

    const result = proposeEdit(session, {
      op: "placeTile",
      ruleId: nestedRuleId(session),
      side: "do",
      tileId: `tile.actuator->${FakeActionKeys.Emit}`,
    });

    assert.equal(result.ok, true, JSON.stringify(result));
  });
});
