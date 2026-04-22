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

  test("id() returns stable, unique values", () => {
    const brain = new BrainDef(services);
    const page = new BrainPageDef();
    brain.addPage(page);

    const r1 = page.appendNewRule() as BrainRuleDef;
    const r2 = page.appendNewRule() as BrainRuleDef;

    assert.equal(typeof r1.id(), "number");
    assert.notEqual(r1.id(), r2.id());
    const idBefore = r1.id();
    r1.indent();
    assert.equal(r1.id(), idBefore);
  });

  describe("moveTo", () => {
    test("reorders siblings within page", () => {
      const brain = new BrainDef(services);
      const page = new BrainPageDef();
      brain.addPage(page);
      const a = page.appendNewRule() as BrainRuleDef;
      const b = page.appendNewRule() as BrainRuleDef;
      const c = page.appendNewRule() as BrainRuleDef;

      assert.equal(a.moveTo(undefined, page, 2), true);
      assert.equal(page.children().get(0), b);
      assert.equal(page.children().get(1), c);
      assert.equal(page.children().get(2), a);
    });

    test("moves page-level rule under another rule", () => {
      const brain = new BrainDef(services);
      const page = new BrainPageDef();
      brain.addPage(page);
      const a = page.appendNewRule() as BrainRuleDef;
      const b = page.appendNewRule() as BrainRuleDef;

      assert.equal(b.moveTo(a, undefined, 0), true);
      assert.equal(page.children().size(), 1);
      assert.equal(a.children().size(), 1);
      assert.equal(a.children().get(0), b);
      assert.equal(b.ancestor(), a);
      assert.equal(b.page(), page);
    });

    test("moves child rule back to page level", () => {
      const brain = new BrainDef(services);
      const page = new BrainPageDef();
      brain.addPage(page);
      const a = page.appendNewRule() as BrainRuleDef;
      const b = page.appendNewRule() as BrainRuleDef;
      b.moveTo(a, undefined, 0);

      assert.equal(b.moveTo(undefined, page, 0), true);
      assert.equal(page.children().get(0), b);
      assert.equal(a.children().size(), 0);
      assert.equal(b.ancestor(), undefined);
    });

    test("no-op when moving to current location", () => {
      const brain = new BrainDef(services);
      const page = new BrainPageDef();
      brain.addPage(page);
      const a = page.appendNewRule() as BrainRuleDef;
      const b = page.appendNewRule() as BrainRuleDef;

      assert.equal(b.moveTo(undefined, page, 1), true);
      assert.equal(page.children().get(0), a);
      assert.equal(page.children().get(1), b);
    });

    test("rejects moving rule into its own descendant", () => {
      const brain = new BrainDef(services);
      const page = new BrainPageDef();
      brain.addPage(page);
      const a = page.appendNewRule() as BrainRuleDef;
      const b = page.appendNewRule() as BrainRuleDef;
      b.moveTo(a, undefined, 0);

      assert.equal(a.moveTo(b, undefined, 0), false);
      assert.equal(page.children().get(0), a);
      assert.equal(a.children().get(0), b);
    });

    test("rejects when both or neither destination provided", () => {
      const brain = new BrainDef(services);
      const page = new BrainPageDef();
      brain.addPage(page);
      const a = page.appendNewRule() as BrainRuleDef;

      assert.equal(a.moveTo(undefined, undefined, 0), false);
    });

    test("subtree moves with the rule", () => {
      const brain = new BrainDef(services);
      const page = new BrainPageDef();
      brain.addPage(page);
      const a = page.appendNewRule() as BrainRuleDef;
      const b = page.appendNewRule() as BrainRuleDef;
      const c = page.appendNewRule() as BrainRuleDef;
      const childOfB = b.appendNewRule() as BrainRuleDef;

      assert.equal(b.moveTo(c, undefined, 0), true);
      assert.equal(page.children().size(), 2);
      assert.equal(c.children().get(0), b);
      assert.equal(b.children().get(0), childOfB);
      assert.equal(childOfB.ancestor(), b);
      assert.equal(a.ancestor(), undefined);
    });
  });
});
