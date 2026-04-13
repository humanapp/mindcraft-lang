import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { type BrainServices, CoreTypeIds } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainDef, BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

describe("BrainRuleDef", () => {
  test("clone resolves both global and brain-local tiles", () => {
    const brain = new BrainDef(services);
    const page = new BrainPageDef();
    brain.addPage(page);

    const rule = page.appendNewRule() as BrainRuleDef;
    const globalTile = services.tiles.get("tile.op->add");
    assert.ok(globalTile);

    const literalTile = new BrainTileLiteralDef(CoreTypeIds.Number, 1, {}, services);
    brain.catalog().registerTileDef(literalTile);

    rule.when().appendTile(globalTile);
    rule.do().appendTile(literalTile);

    const cloned = rule.clone();

    assert.equal(cloned.when().tiles().size(), 1);
    assert.equal(cloned.do().tiles().size(), 1);
    assert.equal(cloned.when().tiles().get(0).tileId, globalTile.tileId);
    assert.equal(cloned.do().tiles().get(0).tileId, literalTile.tileId);
  });
});
