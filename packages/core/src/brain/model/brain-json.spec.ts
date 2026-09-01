/**
 * Tests for JSON serialization/deserialization of BrainDef.
 *
 * Verifies that toJson/fromJson produce a faithful round-trip:
 * serialize a brain to JSON, deserialize it, and confirm the resulting
 * BrainDef is structurally equivalent to the original.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List } from "@wendoo/core";
import { type BrainServices, mkPageTileId, mkVariableTileId, RuleTriggerMode } from "@wendoo/core/brain";
import { __test__createBrainServices } from "@wendoo/core/brain/__test__";
import {
  BrainDef,
  type BrainJson,
  BrainRuleDef,
  brainJsonFromPlain,
  type PageJson,
  type RuleJson,
} from "@wendoo/core/brain/model";
import { BrainTileLiteralDef, BrainTileVariableDef, type CatalogTileJson } from "@wendoo/core/brain/tiles";
import { CoreTypeIds } from "@wendoo/core/runtime";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

// -- Helpers --

/** Convert one plain rule object -- `JSON.parse` output, with native arrays -- into a `RuleJson`. */
function ruleJsonFromPlain(plain: unknown): RuleJson {
  const brainJson = brainJsonFromPlain({
    version: 1,
    name: "Rule Conversion",
    catalog: [],
    pages: [{ version: 1, pageId: "rule-conversion-page", name: "Page 1", rules: [plain] }],
  });
  return brainJson.pages.get(0).rules.get(0);
}

function mkLiteral(n: number) {
  return new BrainTileLiteralDef(CoreTypeIds.Number, n, {}, services);
}
function mkBoolLiteral(b: boolean) {
  return new BrainTileLiteralDef(CoreTypeIds.Boolean, b, {}, services);
}
function mkStringLiteral(s: string) {
  return new BrainTileLiteralDef(CoreTypeIds.String, s, {}, services);
}

/** A rule of a saved document, as `JSON.parse` returns it. */
interface PlainRuleJson {
  children: PlainRuleJson[];
}

/** A saved document, as `JSON.parse` returns it. */
interface PlainBrainJson {
  pages: { rules: PlainRuleJson[] }[];
}

/** Every plain rule object of `plain`, at any depth, in document order. */
function allPlainRules(plain: PlainBrainJson): PlainRuleJson[] {
  const out: PlainRuleJson[] = [];
  const visit = (rules: PlainRuleJson[]): void => {
    for (const rule of rules) {
      out.push(rule);
      visit(rule.children);
    }
  };
  for (const page of plain.pages) {
    visit(page.rules);
  }
  return out;
}

describe("brain-json", () => {
  test("empty brain round-trips through JSON", () => {
    const original = BrainDef.emptyBrainDef(services, "Test Brain");
    const json = original.toJson();

    assert.equal(json.version, 1);
    assert.equal(json.name, "Test Brain");
    assert.equal(json.pages.size(), 1);

    const restored = BrainDef.fromJson(json, services);
    assert.equal(restored.name(), "Test Brain");
    assert.equal(restored.pages().size(), 1);
  });

  test("brain name is preserved", () => {
    const original = BrainDef.emptyBrainDef(services, "My Custom Brain");
    const json = original.toJson();
    const restored = BrainDef.fromJson(json, services);
    assert.equal(restored.name(), "My Custom Brain");
  });

  test("multiple pages round-trip", () => {
    const original = new BrainDef(services);
    original.appendNewPage();
    original.appendNewPage();
    original.appendNewPage();

    const pages = original.pages();
    pages.get(0)!.setName("Page A");
    pages.get(1)!.setName("Page B");
    pages.get(2)!.setName("Page C");

    const json = original.toJson();
    assert.equal(json.pages.size(), 3);
    assert.equal(json.pages.get(0).name, "Page A");
    assert.equal(json.pages.get(1).name, "Page B");
    assert.equal(json.pages.get(2).name, "Page C");

    const restored = BrainDef.fromJson(json, services);
    assert.equal(restored.pages().size(), 3);
    assert.equal(restored.pages().get(0)!.name(), "Page A");
    assert.equal(restored.pages().get(1)!.name(), "Page B");
    assert.equal(restored.pages().get(2)!.name(), "Page C");
  });

  test("page IDs are preserved", () => {
    const original = BrainDef.emptyBrainDef(services);
    const origPageId = original.pages().get(0)!.pageId();

    const json = original.toJson();
    assert.equal(json.pages.get(0).pageId, origPageId);

    const restored = BrainDef.fromJson(json, services);
    assert.equal(restored.pages().get(0)!.pageId(), origPageId);
  });

  test("rules with literal tiles round-trip", () => {
    const original = new BrainDef(services);
    original.appendNewPage();
    const page = original.pages().get(0)!;
    const rule = page.children().get(0)!;

    const numLit = mkLiteral(42);
    const boolLit = mkBoolLiteral(true);
    const strLit = mkStringLiteral("hello");

    original.catalog().registerTileDef(numLit);
    original.catalog().registerTileDef(boolLit);
    original.catalog().registerTileDef(strLit);

    rule.when().appendTile(numLit);
    rule.do().appendTile(boolLit);
    rule.do().appendTile(strLit);

    const json = original.toJson();

    const litEntries = json.catalog.filter((t: CatalogTileJson) => t.kind === "literal");
    assert.ok(litEntries.size() >= 3);

    const firstRule = json.pages.get(0).rules.get(0);
    assert.equal(firstRule.when.size(), 1);
    assert.equal(firstRule.when.get(0), numLit.tileId);
    assert.equal(firstRule.do.size(), 2);

    const restored = BrainDef.fromJson(json, services);
    const restoredRule = restored.pages().get(0)!.children().get(0)!;
    assert.equal(restoredRule.when().tiles().size(), 1);
    assert.equal(restoredRule.when().tiles().get(0).tileId, numLit.tileId);
    assert.equal(restoredRule.do().tiles().size(), 2);
    assert.equal(restoredRule.do().tiles().get(0).tileId, boolLit.tileId);
    assert.equal(restoredRule.do().tiles().get(1).tileId, strLit.tileId);
  });

  test("literal values are correctly preserved", () => {
    const original = new BrainDef(services);
    original.appendNewPage();

    const numLit = mkLiteral(3.14);
    original.catalog().registerTileDef(numLit);

    const json = original.toJson();
    const litJson = json.catalog.find((t: CatalogTileJson) => t.kind === "literal" && t.tileId === numLit.tileId);
    assert.ok(litJson);
    assert.equal(litJson.kind, "literal");
    if (litJson.kind === "literal") {
      assert.equal(litJson.value, 3.14);
      assert.equal(litJson.valueType, CoreTypeIds.Number);
    }
  });

  test("variable tiles round-trip", () => {
    const original = new BrainDef(services);
    original.appendNewPage();
    const page = original.pages().get(0)!;
    const rule = page.children().get(0)!;

    const varTile = new BrainTileVariableDef(mkVariableTileId("test-var-1"), "myVar", CoreTypeIds.Number, "test-var-1");
    original.catalog().registerTileDef(varTile);
    rule.when().appendTile(varTile);

    const json = original.toJson();

    const varEntry = json.catalog.find((t: CatalogTileJson) => t.kind === "variable");
    assert.ok(varEntry);
    if (varEntry.kind === "variable") {
      assert.equal(varEntry.varName, "myVar");
      assert.equal(varEntry.varType, CoreTypeIds.Number);
      assert.equal(varEntry.uniqueId, "test-var-1");
    }

    const restored = BrainDef.fromJson(json, services);
    const restoredRule = restored.pages().get(0)!.children().get(0)!;
    assert.equal(restoredRule.when().tiles().size(), 1);
    const restoredVar = restoredRule.when().tiles().get(0);
    assert.equal(restoredVar.tileId, varTile.tileId);
    assert.equal(restoredVar.kind, "variable");
  });

  test("operator tiles (non-persistent) round-trip via global catalog", () => {
    const original = new BrainDef(services);
    original.appendNewPage();
    const page = original.pages().get(0)!;
    const rule = page.children().get(0)!;

    const addOp = services.edit.tiles.get("tile.op->add");
    assert.ok(addOp, "add operator should be in global catalog");

    const lit1 = mkLiteral(1);
    const lit2 = mkLiteral(2);
    original.catalog().registerTileDef(lit1);
    original.catalog().registerTileDef(lit2);

    rule.when().appendTile(lit1);
    rule.when().appendTile(addOp);
    rule.when().appendTile(lit2);

    const json = original.toJson();

    const firstRule = json.pages.get(0).rules.get(0);
    assert.equal(firstRule.when.get(1), "tile.op->add");
    const opInCatalog = json.catalog.find((t: CatalogTileJson) => t.tileId === "tile.op->add");
    assert.equal(opInCatalog, undefined);

    const restored = BrainDef.fromJson(json, services);
    const restoredRule = restored.pages().get(0)!.children().get(0)!;
    assert.equal(restoredRule.when().tiles().size(), 3);
    assert.equal(restoredRule.when().tiles().get(1).tileId, "tile.op->add");
  });

  test("child rules round-trip", () => {
    const original = new BrainDef(services);
    original.appendNewPage();
    const page = original.pages().get(0)!;
    const parentRule = page.children().get(0)!;

    const childRule = (parentRule as BrainRuleDef).appendNewRule();
    const lit = mkLiteral(99);
    original.catalog().registerTileDef(lit);
    childRule.when().appendTile(lit);

    const json = original.toJson();
    const firstRule = json.pages.get(0).rules.get(0);
    assert.equal(firstRule.children.size(), 1);
    assert.equal(firstRule.children.get(0).when.get(0), lit.tileId);

    const restored = BrainDef.fromJson(json, services);
    const restoredParent = restored.pages().get(0)!.children().get(0)!;
    assert.equal(restoredParent.children().size(), 1);
    const restoredChild = restoredParent.children().get(0);
    assert.equal(restoredChild.when().tiles().size(), 1);
    assert.equal(restoredChild.when().tiles().get(0).tileId, lit.tileId);
  });

  test("nested child rules round-trip", () => {
    const original = new BrainDef(services);
    original.appendNewPage();
    const page = original.pages().get(0)!;
    const rootRule = page.children().get(0)!;

    const child1 = (rootRule as BrainRuleDef).appendNewRule();
    const grandchild = (child1 as BrainRuleDef).appendNewRule();

    const lit = mkLiteral(7);
    original.catalog().registerTileDef(lit);
    grandchild.do().appendTile(lit);

    const json = original.toJson();
    assert.equal(json.pages.get(0).rules.get(0).children.get(0).children.get(0).do.get(0), lit.tileId);

    const restored = BrainDef.fromJson(json, services);
    const restoredGrandchild = restored.pages().get(0)!.children().get(0)!.children().get(0).children().get(0);
    assert.equal(restoredGrandchild.do().tiles().size(), 1);
    assert.equal(restoredGrandchild.do().tiles().get(0).tileId, lit.tileId);
  });

  test("JSON round-trips through JSON.stringify/parse via brainJsonFromPlain", () => {
    const original = BrainDef.emptyBrainDef(services, "Stringify Test");
    const json = original.toJson();

    // Serialize to a JSON string and parse back to a plain object
    const jsonStr = JSON.stringify(json);
    const plainObj = JSON.parse(jsonStr);

    // Convert plain arrays back to Lists
    const parsed = brainJsonFromPlain(plainObj);
    assert.equal(parsed.version, 1);
    assert.equal(parsed.name, "Stringify Test");
    assert.equal(parsed.pages.size(), 1);

    const restored = BrainDef.fromJson(parsed, services);
    assert.equal(restored.name(), "Stringify Test");
  });

  test("rejects unsupported JSON version", () => {
    const json: BrainJson = {
      version: 999,
      name: "Bad Version",
      catalog: List.empty<CatalogTileJson>(),
      pages: List.empty<PageJson>(),
    };

    assert.throws(() => BrainDef.fromJson(json, services), /unsupported version/);
  });

  test("full round-trip preserves compilability", () => {
    const original = new BrainDef(services);
    original.appendNewPage();
    const page = original.pages().get(0)!;
    const rule = page.children().get(0)!;

    const lit1 = mkLiteral(10);
    const lit2 = mkLiteral(20);
    const addOp = services.edit.tiles.get("tile.op->add")!;
    original.catalog().registerTileDef(lit1);
    original.catalog().registerTileDef(lit2);

    rule.when().appendTile(lit1);
    rule.when().appendTile(addOp);
    rule.when().appendTile(lit2);

    const json = original.toJson();
    const restored = BrainDef.fromJson(json, services);

    const brain = restored.compile();
    assert.ok(brain);
  });

  test("binary and JSON round-trips produce equivalent brains", () => {
    const original = new BrainDef(services);
    original.appendNewPage();
    const page = original.pages().get(0)!;
    const rule = page.children().get(0)!;

    const lit = mkLiteral(42);
    const varTile = new BrainTileVariableDef(mkVariableTileId("eq-test-1"), "x", CoreTypeIds.Number, "eq-test-1");
    original.catalog().registerTileDef(lit);
    original.catalog().registerTileDef(varTile);

    rule.when().appendTile(lit);
    rule.do().appendTile(varTile);

    // JSON round-trip
    const jsonBrain = BrainDef.fromJson(original.toJson(), services);

    // Binary round-trip
    const binaryBrain = original.clone();

    assert.equal(jsonBrain.name(), binaryBrain.name());
    assert.equal(jsonBrain.pages().size(), binaryBrain.pages().size());

    const jsonRule = jsonBrain.pages().get(0)!.children().get(0)!;
    const binRule = binaryBrain.pages().get(0)!.children().get(0)!;

    assert.equal(jsonRule.when().tiles().size(), binRule.when().tiles().size());
    assert.equal(jsonRule.do().tiles().size(), binRule.do().tiles().size());

    assert.equal(jsonRule.when().tiles().get(0).tileId, binRule.when().tiles().get(0).tileId);
    assert.equal(jsonRule.do().tiles().get(0).tileId, binRule.do().tiles().get(0).tileId);
  });

  // -- Rule-level serialization ------------------------------------------------

  test("toJson serializes a single rule", () => {
    const brain = new BrainDef(services);
    brain.appendNewPage();
    const page = brain.pages().get(0)!;
    const rule = page.children().get(0)! as BrainRuleDef;

    const lit = mkLiteral(55);
    brain.catalog().registerTileDef(lit);
    rule.when().appendTile(lit);

    const ruleJson = rule.toJson();
    assert.equal(ruleJson.when.size(), 1);
    assert.equal(ruleJson.when.get(0), lit.tileId);
    assert.equal(ruleJson.do.size(), 0);
    assert.equal(ruleJson.children.size(), 0);
  });

  test("BrainRuleDef.fromJson deserializes a single rule", () => {
    const brain = new BrainDef(services);
    brain.appendNewPage();
    const page = brain.pages().get(0)!;
    const rule = page.children().get(0)! as BrainRuleDef;

    const lit = mkLiteral(77);
    brain.catalog().registerTileDef(lit);
    rule.when().appendTile(lit);

    const ruleJson = rule.toJson();
    const restored = BrainRuleDef.fromJson(ruleJson, page, brain);

    assert.equal(restored.when().tiles().size(), 1);
    assert.equal(restored.when().tiles().get(0).tileId, lit.tileId);
  });

  test("toJson/fromJson round-trips child rules", () => {
    const brain = new BrainDef(services);
    brain.appendNewPage();
    const page = brain.pages().get(0)!;
    const parentRule = page.children().get(0)! as BrainRuleDef;

    const childRule = parentRule.appendNewRule();
    const lit = mkLiteral(33);
    brain.catalog().registerTileDef(lit);
    childRule.do().appendTile(lit);

    const ruleJson = parentRule.toJson();
    assert.equal(ruleJson.children.size(), 1);
    assert.equal(ruleJson.children.get(0).do.get(0), lit.tileId);

    const restored = BrainRuleDef.fromJson(ruleJson, page, brain);
    assert.equal(restored.children().size(), 1);
    assert.equal(restored.children().get(0).do().tiles().get(0).tileId, lit.tileId);
  });

  test("ruleJsonFromPlain converts plain object to RuleJson", () => {
    const plainRule = {
      version: 1,
      when: ["tile.a", "tile.b"],
      do: ["tile.c"],
      children: [{ version: 1, when: ["tile.d"], do: [], children: [] }],
    };

    const ruleJson = ruleJsonFromPlain(plainRule);
    assert.equal(ruleJson.when.size(), 2);
    assert.equal(ruleJson.when.get(0), "tile.a");
    assert.equal(ruleJson.when.get(1), "tile.b");
    assert.equal(ruleJson.do.size(), 1);
    assert.equal(ruleJson.do.get(0), "tile.c");
    assert.equal(ruleJson.children.size(), 1);
    assert.equal(ruleJson.children.get(0).when.get(0), "tile.d");
  });

  test("toJson round-trips through JSON.stringify/parse", () => {
    const brain = new BrainDef(services);
    brain.appendNewPage();
    const page = brain.pages().get(0)!;
    const rule = page.children().get(0)! as BrainRuleDef;

    const lit = mkLiteral(11);
    const addOp = services.edit.tiles.get("tile.op->add")!;
    brain.catalog().registerTileDef(lit);
    rule.when().appendTile(lit);
    rule.when().appendTile(addOp);
    rule.when().appendTile(lit);

    const ruleJson = rule.toJson();
    const jsonStr = JSON.stringify(ruleJson);
    const parsed = ruleJsonFromPlain(JSON.parse(jsonStr));

    const restored = BrainRuleDef.fromJson(parsed, page, brain);
    assert.equal(restored.when().tiles().size(), 3);
    assert.equal(restored.when().tiles().get(1).tileId, "tile.op->add");
  });

  // -- Comment field ----------------------------------------------------------

  test("rule comment round-trips through JSON", () => {
    const brain = new BrainDef(services);
    brain.appendNewPage();
    const page = brain.pages().get(0)!;
    const rule = page.children().get(0)! as BrainRuleDef;
    rule.setComment("This rule handles the main attack logic");

    const json = brain.toJson();
    const restored = BrainDef.fromJson(json, services);
    const restoredRule = restored.pages().get(0)!.children().get(0)!;
    assert.equal(restoredRule.comment(), "This rule handles the main attack logic");
  });

  test("rule with no comment round-trips through JSON with undefined", () => {
    const brain = new BrainDef(services);
    brain.appendNewPage();
    const page = brain.pages().get(0)!;
    const rule = page.children().get(0)! as BrainRuleDef;
    assert.equal(rule.comment(), undefined);

    const json = brain.toJson();
    const restored = BrainDef.fromJson(json, services);
    const restoredRule = restored.pages().get(0)!.children().get(0)!;
    assert.equal(restoredRule.comment(), undefined);
  });

  test("rule comment round-trips through binary (clone)", () => {
    const brain = new BrainDef(services);
    brain.appendNewPage();
    const page = brain.pages().get(0)!;
    const rule = page.children().get(0)! as BrainRuleDef;
    rule.setComment("Binary comment test");

    const cloned = brain.clone();
    const clonedRule = cloned.pages().get(0)!.children().get(0)!;
    assert.equal(clonedRule.comment(), "Binary comment test");
  });

  test("rule comment round-trips through JSON.stringify/parse via brainJsonFromPlain", () => {
    const brain = new BrainDef(services);
    brain.appendNewPage();
    const page = brain.pages().get(0)!;
    const rule = page.children().get(0)! as BrainRuleDef;
    rule.setComment("Stringify comment");

    const jsonStr = JSON.stringify(brain.toJson());
    const parsed = brainJsonFromPlain(JSON.parse(jsonStr));
    const restored = BrainDef.fromJson(parsed, services);
    const restoredRule = restored.pages().get(0)!.children().get(0)!;
    assert.equal(restoredRule.comment(), "Stringify comment");
  });

  // -- Trigger mode field -----------------------------------------------------

  test("a rule given no trigger reads as when and saves the field absent", () => {
    const brain = BrainDef.emptyBrainDef(services, "Trigger Default Brain");
    const rule = brain.pages().get(0)!.children().get(0)! as BrainRuleDef;
    rule.appendNewRule();
    assert.equal(rule.trigger(), RuleTriggerMode.When);

    const plain = JSON.parse(JSON.stringify(brain.toJson())) as PlainBrainJson;
    const saved = allPlainRules(plain);
    assert.equal(saved.length, 2);
    for (const savedRule of saved) {
      assert.equal("trigger" in savedRule, false, "a when rule must save no trigger field");
    }
  });

  test("a document saved before rules carried a trigger loads in when and saves back unchanged", () => {
    const brain = BrainDef.emptyBrainDef(services, "Trigger Legacy Brain");
    (brain.pages().get(0)!.children().get(0)! as BrainRuleDef).appendNewRule();
    const priorToField = JSON.parse(JSON.stringify(brain.toJson()));

    const restored = BrainDef.fromJson(brainJsonFromPlain(priorToField), services);
    const restoredRule = restored.pages().get(0)!.children().get(0)!;
    assert.equal(restoredRule.trigger(), RuleTriggerMode.When);
    assert.equal(restoredRule.children().get(0)!.trigger(), RuleTriggerMode.When);
    assert.deepEqual(JSON.parse(JSON.stringify(restored.toJson())), priorToField);
  });

  test("every trigger mode round-trips through JSON, on a rule and on a child rule", () => {
    const modes = [RuleTriggerMode.When, RuleTriggerMode.Otherwise, RuleTriggerMode.Then];
    for (const mode of modes) {
      const brain = BrainDef.emptyBrainDef(services, "Trigger Round Trip Brain");
      const rule = brain.pages().get(0)!.children().get(0)! as BrainRuleDef;
      const child = rule.appendNewRule();
      rule.setTrigger(mode);
      child.setTrigger(mode);

      const plain = JSON.parse(JSON.stringify(brain.toJson()));
      const restored = BrainDef.fromJson(brainJsonFromPlain(plain), services);
      const restoredRule = restored.pages().get(0)!.children().get(0)!;
      assert.equal(restoredRule.trigger(), mode);
      assert.equal(restoredRule.children().get(0)!.trigger(), mode);
    }
  });

  test("purgeUnusedTiles removes orphaned page tiles from deleted pages", () => {
    const brain = new BrainDef(services);
    brain.appendNewPage();
    brain.appendNewPage();

    const page0Id = brain.pages().get(0)!.pageId();
    const page1Id = brain.pages().get(1)!.pageId();

    // Both page tiles should be in the catalog after adding pages
    assert.ok(brain.catalog().get(mkPageTileId(page0Id)), "page0 tile should exist");
    assert.ok(brain.catalog().get(mkPageTileId(page1Id)), "page1 tile should exist");

    // Remove the second page -- its tile becomes orphaned (hidden)
    brain.removePageAtIndex(1);

    // Before purge: orphaned tile is still in the catalog (just hidden)
    const orphanedTile = brain.catalog().get(mkPageTileId(page1Id));
    assert.ok(orphanedTile, "orphaned page tile should still exist before purge");
    assert.equal(orphanedTile.hidden, true, "orphaned page tile should be hidden");

    brain.purgeUnusedTiles();

    // After purge: orphaned tile should be gone
    assert.equal(
      brain.catalog().get(mkPageTileId(page1Id)),
      undefined,
      "orphaned page tile should be removed after purge"
    );

    // Living page tile should still be present
    assert.ok(brain.catalog().get(mkPageTileId(page0Id)), "living page tile should remain after purge");

    // And the serialized JSON should not contain the orphaned tile
    const json = brain.toJson();
    const orphanInCatalog = json.catalog.find((t: CatalogTileJson) => t.tileId === mkPageTileId(page1Id));
    assert.equal(orphanInCatalog, undefined, "orphaned page tile should not appear in serialized JSON");
  });

  test("setComment truncates to kMaxBrainRuleCommentLength", () => {
    const brain = new BrainDef(services);
    brain.appendNewPage();
    const rule = brain.pages().get(0)!.children().get(0)! as BrainRuleDef;
    const longComment = "x".repeat(600);
    rule.setComment(longComment);
    assert.equal(rule.comment()!.length, 500);
  });

  test("child rule comment round-trips through JSON", () => {
    const brain = new BrainDef(services);
    brain.appendNewPage();
    const parentRule = brain.pages().get(0)!.children().get(0)! as BrainRuleDef;
    const childRule = parentRule.appendNewRule() as BrainRuleDef;
    childRule.setComment("Child rule comment");

    const json = brain.toJson();
    const restored = BrainDef.fromJson(json, services);
    const restoredChild = restored.pages().get(0)!.children().get(0)!.children().get(0);
    assert.equal(restoredChild.comment(), "Child rule comment");
  });

  test("brain id round-trips through JSON", () => {
    const original = new BrainDef(services);
    const json = original.toJson();
    assert.equal(json.id, original.id());

    const restored = BrainDef.fromJson(json, services);
    assert.equal(restored.id(), original.id());
  });

  test("id-less brain JSON mints a fresh id on load", () => {
    const original = new BrainDef(services);
    const idless: BrainJson = { ...original.toJson(), id: undefined };

    const restored = BrainDef.fromJson(idless, services);
    assert.ok(restored.id().length > 0);
  });

  test("clone gets a fresh id distinct from its source", () => {
    const original = new BrainDef(services);
    const cloned = original.clone();
    assert.ok(cloned.id().length > 0);
    assert.notEqual(cloned.id(), original.id());
  });

  test("a working copy saved back unedited keeps the brain id", () => {
    const original = new BrainDef(services);
    original.appendNewPage();

    const working = original.workingCopy();
    assert.equal(working.id(), original.id());

    const saved = BrainDef.fromJson(working.toJson(), services);
    assert.equal(saved.id(), original.id());
  });

  test("a working copy saved back after an edit keeps the brain id", () => {
    const original = new BrainDef(services);
    original.appendNewPage();

    const working = original.workingCopy();
    working.setName("Edited Brain");
    working.appendNewPage();

    const saved = BrainDef.fromJson(working.toJson(), services);
    assert.equal(saved.id(), original.id());
    assert.equal(saved.name(), "Edited Brain");
    assert.equal(saved.pages().size(), original.pages().size() + 1);
  });
});
