/**
 * Load-time migration of the deprecated `otherwise` sensor tile onto the
 * `otherwise` trigger mode. Each test loads a document through
 * `BrainDef.fromJson` and asserts the rewritten document, the shapes that stay
 * unchanged, idempotence, and the runtime behavior of a migrated rule.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { createHostActuator, List, type ReadonlyList } from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import { type IBrainRuleDef, type IBrainTileDef, RuleTriggerMode } from "@wendoo/core/brain";
import { __test__appendTile, __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { compileBrain, ParseDiagCode } from "@wendoo/core/brain/compiler";
import { BrainDef, type BrainJson, type BrainPageDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import { type BrainTileActuatorDef, BrainTileLiteralDef, BrainTileOperatorDef } from "@wendoo/core/brain/tiles";
import {
  CoreHostActions,
  CoreOpId,
  CoreTypeIds,
  type ExecutionContext,
  mkCallDef,
  mkSensorTileId,
  type Value,
  VOID_VALUE,
} from "@wendoo/core/runtime";

let services: BrainServices;
let otherwiseTile: IBrainTileDef;
let opAnd: BrainTileOperatorDef;

/** Distinguishes the host ids each test registers; ids must be unique per registry. */
let hostIdCounter = 0;

before(() => {
  services = __test__createBrainServices();
  const tile = services.edit.tiles.get(mkSensorTileId(CoreHostActions.Otherwise.key));
  assert.ok(tile, "the otherwise sensor tile must be registered on the core catalog");
  otherwiseTile = tile;
  opAnd = new BrainTileOperatorDef(CoreOpId.And, {}, services);
});

/** A marker actuator tile plus the list of ticks (1-based) on which it ran. */
interface Marker {
  tile: BrainTileActuatorDef;
  ticks: number[];
}

/** Registers a marker actuator that records the tick it ran on. */
function makeMarker(): Marker {
  hostIdCounter += 1;
  const ticks: number[] = [];
  const def = createHostActuator({
    key: `migration-marker-${hostIdCounter}`,
    actionId: 7900 + hostIdCounter,
    fnId: 8900 + hostIdCounter,
    callDef: mkCallDef({ type: "bag", items: [] }),
    fn: {
      exec: (ctx: ExecutionContext) => {
        ticks.push(ctx.currentTick);
        return VOID_VALUE;
      },
    },
  });
  services.runtime.functions.register(
    def.function.id,
    def.function.name,
    def.function.isAsync,
    def.function.fn as never,
    def.function.callDef as never
  );
  services.runtime.actions.register({
    binding: "host",
    descriptor: def.descriptor,
    id: def.actionId,
    execSync: (def.actionFn as { exec: (ctx: ExecutionContext, args: ReadonlyList<Value>) => Value }).exec,
  });
  // A document round trip re-resolves tile ids against the catalog.
  services.edit.tiles.registerTileDef(def.tile);
  return { tile: def.tile as BrainTileActuatorDef, ticks };
}

/** A boolean literal tile. */
function boolLiteral(b: boolean): BrainTileLiteralDef {
  return new BrainTileLiteralDef(CoreTypeIds.Boolean, b, {}, services);
}

/** A one-page brain whose first page holds only its default rule. */
function newBrain(): { brainDef: BrainDef; page: BrainPageDef } {
  const brainDef = BrainDef.emptyBrainDef(services);
  return { brainDef, page: brainDef.pages().get(0)! as BrainPageDef };
}

/** Fills `rule`'s WHEN and DO sides from tile lists. */
function fillRule(rule: BrainRuleDef, whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]): void {
  for (const tile of whenTiles) __test__appendTile(rule.when(), tile);
  for (const tile of doTiles) __test__appendTile(rule.do(), tile);
}

/** Loads `json` into a fresh brain, running every rule through the load funnel. */
function load(json: BrainJson): BrainDef {
  return BrainDef.fromJson(json, services);
}

/** The rule at `index` among the first page's root rules. */
function rootRule(brainDef: BrainDef, index: number): IBrainRuleDef {
  return brainDef.pages().get(0)!.children().get(index)!;
}

/** The WHEN-side tile ids of `rule`, in order. */
function whenTileIds(rule: IBrainRuleDef): string[] {
  const tiles = rule.when().tiles();
  const ids: string[] = [];
  for (let i = 0; i < tiles.size(); i++) ids.push(tiles.get(i)!.tileId);
  return ids;
}

/** The diagnostic codes `brainDef` compiles with. */
function compileDiagCodes(brainDef: BrainDef): number[] {
  const result = compileBrain(
    brainDef,
    List.from([services.edit.tiles, brainDef.catalog()]),
    services.shared.conversions,
    services.runtime.actions,
    services.runtime.types
  );
  const codes: number[] = [];
  for (let i = 0; i < result.diagnostics.size(); i++) codes.push(result.diagnostics.get(i)!.code);
  return codes;
}

/** Compiles and runs `brainDef` for `ticks` thinks at a 16 ms cadence. */
function runBrain(brainDef: BrainDef, ticks: number): void {
  const brain = brainDef.compile();
  brain.initialize();
  brain.startup();
  for (let i = 0; i < ticks; i++) brain.think((i + 1) * 16);
}

describe("otherwise tile migration -- the migrating shapes", () => {
  test("a WHEN side that is exactly the otherwise tile becomes the otherwise mode with an empty WHEN", () => {
    const { brainDef, page } = newBrain();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], []);

    const loaded = load(brainDef.toJson());

    assert.equal(rootRule(loaded, 1).trigger(), RuleTriggerMode.Otherwise);
    assert.deepEqual(whenTileIds(rootRule(loaded, 1)), []);
    assert.equal(rootRule(loaded, 0).trigger(), RuleTriggerMode.When, "the subject rule is untouched");
  });

  test("a WHEN side of otherwise, AND, and a tail becomes the otherwise mode with the tail as its WHEN", () => {
    const { brainDef, page } = newBrain();
    const tail = boolLiteral(true);
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile, opAnd, tail], []);

    const loaded = load(brainDef.toJson());

    assert.equal(rootRule(loaded, 1).trigger(), RuleTriggerMode.Otherwise);
    assert.deepEqual(whenTileIds(rootRule(loaded, 1)), [tail.tileId]);
  });

  test("a child rule migrates at its own level", () => {
    const { brainDef, page } = newBrain();
    const root = page.children().get(0)! as BrainRuleDef;
    fillRule(root, [boolLiteral(true)], []);
    fillRule(root.appendNewRule(), [boolLiteral(true)], []);
    fillRule(root.appendNewRule(), [otherwiseTile], []);

    const loaded = load(brainDef.toJson());
    const child = rootRule(loaded, 0).children().get(1)!;

    assert.equal(child.trigger(), RuleTriggerMode.Otherwise);
    assert.deepEqual(whenTileIds(child), []);
  });
});

describe("otherwise tile migration -- the shapes that stay", () => {
  test("the tile inside a larger expression keeps its tiles and its when mode", () => {
    const { brainDef, page } = newBrain();
    const head = boolLiteral(true);
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    fillRule(page.appendNewRule() as BrainRuleDef, [head, opAnd, otherwiseTile], [makeMarker().tile]);

    const loaded = load(brainDef.toJson());

    assert.equal(rootRule(loaded, 1).trigger(), RuleTriggerMode.When);
    assert.deepEqual(whenTileIds(rootRule(loaded, 1)), [head.tileId, opAnd.tileId, otherwiseTile.tileId]);
    assert.deepEqual(
      compileDiagCodes(loaded),
      [ParseDiagCode.DeprecatedOtherwiseTile],
      "the surviving tile carries the deprecation warning and nothing else"
    );
  });

  test("a surviving tile still runs with tile semantics", () => {
    const { brainDef, page } = newBrain();
    const subject = makeMarker();
    const composed = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(false)], [subject.tile]);
    fillRule(page.appendNewRule() as BrainRuleDef, [boolLiteral(true), opAnd, otherwiseTile], [composed.tile]);

    runBrain(load(brainDef.toJson()), 2);

    assert.deepEqual(subject.ticks, []);
    assert.deepEqual(composed.ticks, [1, 2], "true AND otherwise fires while the subject does not");
  });

  test("the tile after an AND with no tail keeps its tiles", () => {
    const { brainDef, page } = newBrain();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile, opAnd], []);

    const loaded = load(brainDef.toJson());

    assert.equal(rootRule(loaded, 1).trigger(), RuleTriggerMode.When);
    assert.deepEqual(whenTileIds(rootRule(loaded, 1)), [otherwiseTile.tileId, opAnd.tileId]);
  });

  test("a rule that already carries a mode is left alone", () => {
    const { brainDef, page } = newBrain();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    const rule = page.appendNewRule() as BrainRuleDef;
    rule.setTrigger(RuleTriggerMode.Then);
    fillRule(rule, [otherwiseTile], []);

    const loaded = load(brainDef.toJson());

    assert.equal(rootRule(loaded, 1).trigger(), RuleTriggerMode.Then);
    assert.deepEqual(whenTileIds(rootRule(loaded, 1)), [otherwiseTile.tileId]);
  });
});

describe("otherwise tile migration -- idempotence", () => {
  test("reloading a migrated document changes nothing further", () => {
    const { brainDef, page } = newBrain();
    const tail = boolLiteral(true);
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], []);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile, opAnd, tail], []);

    const once = load(brainDef.toJson());
    const twice = load(once.toJson());

    assert.deepEqual(JSON.stringify(twice.toJson()), JSON.stringify(once.toJson()));
    assert.equal(rootRule(twice, 1).trigger(), RuleTriggerMode.Otherwise);
    assert.deepEqual(whenTileIds(rootRule(twice, 1)), []);
    assert.equal(rootRule(twice, 2).trigger(), RuleTriggerMode.Otherwise);
    assert.deepEqual(whenTileIds(rootRule(twice, 2)), [tail.tileId]);
  });
});

describe("otherwise tile migration -- runtime behavior of a migrated pair", () => {
  test("a migrated bare pair runs as an else branch", () => {
    const { brainDef, page } = newBrain();
    const subject = makeMarker();
    const complement = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(false)], [subject.tile]);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], [complement.tile]);

    const loaded = load(brainDef.toJson());
    assert.deepEqual(compileDiagCodes(loaded), [], "the migrated document carries no deprecation warning");

    runBrain(loaded, 3);

    assert.deepEqual(subject.ticks, []);
    assert.deepEqual(complement.ticks, [1, 2, 3], "the else branch runs on every think its subject does not fire");
  });

  test("a migrated bare pair stays quiet while its subject fires", () => {
    const { brainDef, page } = newBrain();
    const subject = makeMarker();
    const complement = makeMarker();
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], [subject.tile]);
    fillRule(page.appendNewRule() as BrainRuleDef, [otherwiseTile], [complement.tile]);

    runBrain(load(brainDef.toJson()), 3);

    assert.deepEqual(subject.ticks, [1, 2, 3]);
    assert.deepEqual(complement.ticks, []);
  });
});
