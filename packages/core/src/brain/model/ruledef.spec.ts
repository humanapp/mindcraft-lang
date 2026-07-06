import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { List } from "@mindcraft-lang/core";
import { type BrainServices, mkVariableTileId } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { ParseDiagCode, type TypecheckResult } from "@mindcraft-lang/core/brain/compiler";
import { BrainDef, BrainPageDef, type BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import {
  BrainTileActuatorDef,
  BrainTileLiteralDef,
  BrainTileOutputDef,
  BrainTileSensorDef,
  BrainTileVariableDef,
} from "@mindcraft-lang/core/brain/tiles";
import { bag, CoreTypeIds, mkActionDescriptor, mkCallDef, NIL_VALUE } from "@mindcraft-lang/core/runtime";
import { BitSet } from "@mindcraft-lang/core/util";

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
    const globalTile = services.edit.tiles.get("tile.op->add");
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

  describe("typecheck hierarchy providers", () => {
    /** Parse diagnostic codes reported for one side of a rule by typecheck(). */
    function typecheckSideDiags(rule: BrainRuleDef, side: "when" | "do"): number[] {
      const codes: number[] = [];
      const tileSet = side === "when" ? rule.when() : rule.do();
      const unsub = tileSet.events().on("tileSet_typechecked", (data) => {
        const result = data.typecheckResult as TypecheckResult;
        const sideResult = side === "when" ? result.whenParseResult : result.doParseResult;
        sideResult.diags.forEach((diag) => {
          codes.push(diag.code as number);
        });
      });
      rule.typecheck();
      unsub();
      return codes;
    }

    test("an ancestor's providing sensor satisfies a child rule's output tile", () => {
      const out = new BrainTileOutputDef(CoreTypeIds.Number, "tcSignal", { metadata: { label: "tc signal" } });
      const fnEntry = services.runtime.functions.register(
        4401,
        "test-tc-provider",
        false,
        { exec: () => NIL_VALUE },
        mkCallDef(bag())
      );
      const provider = new BrainTileSensorDef(
        "test-tc-provider",
        mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Number),
        { metadata: { label: "tc provider" }, providedOutputs: List.from([out.outputKey]) }
      );

      const brain = BrainDef.emptyBrainDef(services, "tc-provider-brain");
      const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
      rule.when().appendTile(provider);
      const child = rule.appendNewRule();
      child.do().appendTile(out);

      const codes = typecheckSideDiags(child, "do");
      assert.ok(
        !codes.includes(ParseDiagCode.OutputTileMissingProvider),
        "the ancestor's provider must satisfy the child's output tile"
      );
    });

    test("an output tile with no provider anywhere in the hierarchy is diagnosed", () => {
      const out = new BrainTileOutputDef(CoreTypeIds.Number, "tcOrphan", { metadata: { label: "tc orphan" } });
      const brain = BrainDef.emptyBrainDef(services, "tc-orphan-brain");
      const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
      rule.do().appendTile(out);

      const codes = typecheckSideDiags(rule, "do");
      assert.ok(
        codes.includes(ParseDiagCode.OutputTileMissingProvider),
        "an orphan output tile must carry OutputTileMissingProvider"
      );
    });

    test("an ancestor's capability provider satisfies a child rule's gated tile", () => {
      const capabilityBit = 9;
      const fnEntry = services.runtime.functions.register(
        4402,
        "test-tc-cap-provider",
        false,
        { exec: () => NIL_VALUE },
        mkCallDef(bag())
      );
      const provider = new BrainTileSensorDef(
        "test-tc-cap-provider",
        mkActionDescriptor("sensor", fnEntry, CoreTypeIds.Number),
        { metadata: { label: "tc cap provider" }, capabilities: new BitSet().set(capabilityBit) }
      );
      const gated = new BrainTileLiteralDef(
        CoreTypeIds.Number,
        11,
        { metadata: { label: "tc gated" }, persist: false, requirements: new BitSet().set(capabilityBit) },
        services
      );

      const brain = BrainDef.emptyBrainDef(services, "tc-cap-provider-brain");
      const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
      rule.when().appendTile(provider);
      const child = rule.appendNewRule();
      child.do().appendTile(gated);

      const codes = typecheckSideDiags(child, "do");
      assert.ok(
        !codes.includes(ParseDiagCode.TileRequirementsNotProvided),
        "the ancestor's capability provider must satisfy the child's gated tile"
      );
    });

    test("a gated tile with no capability provider anywhere in the hierarchy is diagnosed", () => {
      const gated = new BrainTileLiteralDef(
        CoreTypeIds.Number,
        12,
        { metadata: { label: "tc orphan gated" }, persist: false, requirements: new BitSet().set(10) },
        services
      );
      const brain = BrainDef.emptyBrainDef(services, "tc-cap-orphan-brain");
      const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
      rule.do().appendTile(gated);

      const codes = typecheckSideDiags(rule, "do");
      assert.ok(
        codes.includes(ParseDiagCode.TileRequirementsNotProvided),
        "an orphan gated tile must carry TileRequirementsNotProvided"
      );
    });

    /** A Number-producing WHEN sensor and a DO actuator consuming a Number WHEN result, registered under fresh function ids. */
    function whenResultProbePair(baseFnId: number): { producer: BrainTileSensorDef; consumer: BrainTileActuatorDef } {
      const producerFn = services.runtime.functions.register(
        baseFnId,
        `test-tc-when-producer-${baseFnId}`,
        false,
        { exec: () => NIL_VALUE },
        mkCallDef(bag())
      );
      const producer = new BrainTileSensorDef(
        `test-tc-when-producer-${baseFnId}`,
        mkActionDescriptor("sensor", producerFn, CoreTypeIds.Number),
        { metadata: { label: "tc when producer" } }
      );
      const consumerFn = services.runtime.functions.register(
        baseFnId + 1,
        `test-tc-when-consumer-${baseFnId}`,
        false,
        { exec: () => NIL_VALUE },
        mkCallDef(bag())
      );
      const consumer = new BrainTileActuatorDef(
        `test-tc-when-consumer-${baseFnId}`,
        mkActionDescriptor("actuator", consumerFn),
        { metadata: { label: "tc when consumer" }, consumesWhenResult: CoreTypeIds.Number }
      );
      return { producer, consumer };
    }

    test("an ancestor's WHEN result satisfies a child rule's consumer through the empty-WHEN fall-through", () => {
      const { producer, consumer } = whenResultProbePair(4403);
      const brain = BrainDef.emptyBrainDef(services, "tc-when-result-brain");
      const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
      rule.when().appendTile(producer);
      const child = rule.appendNewRule();
      child.do().appendTile(consumer);

      const codes = typecheckSideDiags(child, "do");
      assert.ok(
        !codes.includes(ParseDiagCode.TileWhenResultUnavailable),
        "the ancestor's WHEN result must satisfy the child's consumer"
      );
    });

    test("a consumer with no compatible WHEN result anywhere in the hierarchy is diagnosed", () => {
      const { consumer } = whenResultProbePair(4405);
      const brain = BrainDef.emptyBrainDef(services, "tc-when-orphan-brain");
      const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
      rule.do().appendTile(consumer);

      const codes = typecheckSideDiags(rule, "do");
      assert.ok(
        codes.includes(ParseDiagCode.TileWhenResultUnavailable),
        "an orphan WHEN-result consumer must carry TileWhenResultUnavailable"
      );
    });
  });

  describe("stored typecheck results", () => {
    /** DO-side diag codes read from the typecheck result stored on the rule's DO tileset. */
    function storedDoDiagCodes(rule: BrainRuleDef): number[] | undefined {
      const result = rule.do().typecheckResult();
      if (!result) return undefined;
      const codes: number[] = [];
      result.doParseResult.diags.forEach((diag) => {
        codes.push(diag.code as number);
      });
      return codes;
    }

    test("typecheck stores a retrievable result on both tilesets", () => {
      const brain = BrainDef.emptyBrainDef(services, "tc-stored-result-brain");
      const rule = brain.pages().get(0).children().get(0) as BrainRuleDef;
      const literal = new BrainTileLiteralDef(CoreTypeIds.Number, 7, {}, services);
      brain.catalog().registerTileDef(literal);
      rule.do().appendTile(literal);

      rule.typecheck();

      const whenResult = rule.when().typecheckResult();
      const doResult = rule.do().typecheckResult();
      assert.ok(whenResult, "the WHEN tileset must retain its typecheck result");
      assert.ok(doResult, "the DO tileset must retain its typecheck result");
      assert.equal(whenResult, doResult, "both sides store the combined rule result");
      assert.equal(rule.isDirty(), false);
    });

    test("a reloaded brain typechecks to the same WHEN-result diagnostics as the live brain", () => {
      // Register the consumer globally so it resolves on deserialization.
      const fnEntry = services.runtime.functions.register(
        4407,
        "test-tc-roundtrip-consumer",
        false,
        { exec: () => NIL_VALUE },
        mkCallDef(bag())
      );
      const consumer = new BrainTileActuatorDef("test-tc-roundtrip-consumer", mkActionDescriptor("actuator", fnEntry), {
        metadata: { label: "tc roundtrip consumer" },
        consumesWhenResult: CoreTypeIds.Number,
      });
      services.edit.tiles.registerTileDef(consumer);

      const liveBrain = BrainDef.emptyBrainDef(services, "tc-roundtrip-when-brain");
      const liveRule = liveBrain.pages().get(0).children().get(0) as BrainRuleDef;
      liveRule.do().appendTile(consumer);
      liveRule.typecheck();

      const liveCodes = storedDoDiagCodes(liveRule);
      assert.ok(liveCodes, "the live rule must store a typecheck result");
      assert.ok(
        liveCodes.includes(ParseDiagCode.TileWhenResultUnavailable),
        "the live rule must carry TileWhenResultUnavailable"
      );

      const loadedBrain = BrainDef.fromJson(liveBrain.toJson(), services);
      const loadedRule = loadedBrain.pages().get(0).children().get(0) as BrainRuleDef;
      loadedBrain.typecheck();

      assert.equal(loadedRule.isDirty(), false, "a loaded rule is not dirty");
      const loadedCodes = storedDoDiagCodes(loadedRule);
      assert.ok(loadedCodes, "the loaded rule must store a typecheck result after the load typecheck");
      assert.deepEqual(loadedCodes, liveCodes, "loaded diagnostics must match the live diagnostics");
    });

    test("a reloaded brain typechecks to the same incomplete-assignment diagnostics as the live brain", () => {
      const liveBrain = BrainDef.emptyBrainDef(services, "tc-roundtrip-assign-brain");
      const liveRule = liveBrain.pages().get(0).children().get(0) as BrainRuleDef;

      const varTile = new BrainTileVariableDef(mkVariableTileId("tcRtVar"), "tcRtVar", CoreTypeIds.Number, "tcRtVar");
      liveBrain.catalog().registerTileDef(varTile);
      const assignTile = services.edit.tiles.get("tile.op->assign");
      assert.ok(assignTile, "the assign operator tile must exist");

      liveRule.do().appendTile(varTile);
      liveRule.do().appendTile(assignTile);
      liveRule.typecheck();

      const liveCodes = storedDoDiagCodes(liveRule);
      assert.ok(liveCodes, "the live rule must store a typecheck result");
      assert.ok(liveCodes.length > 0, "an incomplete assignment must carry a parse diagnostic");

      const loadedBrain = BrainDef.fromJson(liveBrain.toJson(), services);
      const loadedRule = loadedBrain.pages().get(0).children().get(0) as BrainRuleDef;
      loadedBrain.typecheck();

      const loadedCodes = storedDoDiagCodes(loadedRule);
      assert.ok(loadedCodes, "the loaded rule must store a typecheck result after the load typecheck");
      assert.deepEqual(loadedCodes, liveCodes, "loaded diagnostics must match the live diagnostics");
    });
  });
});
