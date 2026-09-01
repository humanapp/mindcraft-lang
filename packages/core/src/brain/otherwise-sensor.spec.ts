/**
 * Behavioral tests for the `otherwise` host sensor: the zero-argument boolean
 * read the compiler emits as an `otherwise` rule's arming prologue, answering
 * from the firing record of the rule above it at its own nesting level.
 *
 * The registration tests assert the sensor's ABI ids and descriptor. The body
 * test links a real two-rule brain for its rule function ids, then calls the
 * registered action against a firing-record store the test seeds, so each
 * record state is read directly.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { Dict, List } from "@wendoo/core";
import type { BrainServices } from "@wendoo/core/brain";
import { type IBrainTileDef, RuleTriggerMode } from "@wendoo/core/brain";
import { __test__appendTile, __test__createBrainServices } from "@wendoo/core/brain/__test__";
import { runBrainLinkPipeline } from "@wendoo/core/brain/compiler";
import { BrainDef, type BrainPageDef, type BrainRuleDef } from "@wendoo/core/brain/model";
import { BrainTileLiteralDef } from "@wendoo/core/brain/tiles";
import {
  CoreHostActions,
  CoreTypeIds,
  createProgramServices,
  createRuleFiringServices,
  type ExecutionContext,
  FALSE_VALUE,
  mkSensorTileId,
  NIL_VALUE,
  type PageMetadata,
  type Program,
  RuleFiringState,
  type RuleFiringStates,
  TRUE_VALUE,
} from "@wendoo/core/runtime";
import { __test__createPlatformServices } from "@wendoo/core/runtime/__test__";

let services: BrainServices;

before(() => {
  services = __test__createBrainServices();
});

/** A boolean literal tile. */
function boolLiteral(b: boolean): BrainTileLiteralDef {
  return new BrainTileLiteralDef(CoreTypeIds.Boolean, b, {}, services);
}

/** Fills `rule`'s WHEN and DO sides from tile lists. */
function fillRule(rule: BrainRuleDef, whenTiles: readonly IBrainTileDef[], doTiles: readonly IBrainTileDef[]): void {
  for (const tile of whenTiles) __test__appendTile(rule.when(), tile);
  for (const tile of doTiles) __test__appendTile(rule.do(), tile);
}

/** Compiles, links, and treeshakes `brainDef` into the program a runtime loads. */
function linkBrain(brainDef: BrainDef): { program: Program; pages: List<PageMetadata> } {
  const result = runBrainLinkPipeline(
    brainDef,
    {
      catalogs: List.from([services.edit.tiles, brainDef.catalog()]),
      actionResolver: services.runtime.actions,
      typeRegistry: services.runtime.types,
    },
    services.shared.conversions
  );
  assert.ok(result.program, "the brain must compile and link");
  return { program: result.program.program, pages: result.program.pages };
}

describe("otherwise sensor -- registration", () => {
  test("the sensor's ids are the appended core ids", () => {
    assert.equal(CoreHostActions.Otherwise.actionId, 8);
    assert.equal(CoreHostActions.Otherwise.fnId, 106);
  });

  test("the sensor is not offered as a tile", () => {
    const action = services.runtime.actions.getById(CoreHostActions.Otherwise.actionId);
    assert.ok(action, "the action is registered for the compiler to emit");
    assert.equal(
      services.edit.tiles.get(mkSensorTileId(CoreHostActions.Otherwise.key)),
      undefined,
      "the arming read is compiler-emitted surface with no tile"
    );
  });

  test("the sensor produces a boolean and takes no arguments", () => {
    const action = services.runtime.actions.getById(CoreHostActions.Otherwise.actionId);
    assert.ok(action, "the sensor must be registered as a host action");
    assert.equal(action.descriptor.outputType, CoreTypeIds.Boolean);
    assert.equal(action.descriptor.callDef.argSlots.size(), 0);
  });
});

describe("otherwise sensor -- the record it reads", () => {
  test("the sensor answers true only while its subject's record says it did not fire", () => {
    const brainDef = BrainDef.emptyBrainDef(services);
    const page = brainDef.pages().get(0)! as BrainPageDef;
    fillRule(page.children().get(0)! as BrainRuleDef, [boolLiteral(true)], []);
    const complement = page.appendNewRule() as BrainRuleDef;
    complement.setTrigger(RuleTriggerMode.Otherwise);

    const { program, pages } = linkBrain(brainDef);
    const roots = pages.get(0)!.rootRuleFuncIds;
    const subjectFuncId = roots.get(0)!;

    const states: RuleFiringStates = new Dict();
    const context: ExecutionContext = {
      services: __test__createPlatformServices({
        program: createProgramServices(program, pages),
        ruleFiring: createRuleFiringServices(states),
      }),
      getVariableBySlot: () => NIL_VALUE,
      setVariableBySlot: () => {},
      getSystemVarBySlot: () => NIL_VALUE,
      setSystemVarBySlot: () => {},
      time: 0,
      dt: 0,
      currentTick: 0,
      currentRuleFuncId: roots.get(1)!,
    };
    const action = services.runtime.actions.getById(CoreHostActions.Otherwise.actionId);
    assert.ok(action?.binding === "host", "the otherwise sensor must be registered as a host action");
    const execSync = action.execSync;
    assert.ok(execSync, "the otherwise sensor must have a synchronous body");

    states.set(subjectFuncId, RuleFiringState.EVALUATING);
    assert.deepEqual(execSync(context, List.empty()), FALSE_VALUE);

    states.set(subjectFuncId, RuleFiringState.DID_NOT_FIRE);
    assert.deepEqual(execSync(context, List.empty()), TRUE_VALUE);

    states.set(subjectFuncId, RuleFiringState.DID_FIRE);
    assert.deepEqual(execSync(context, List.empty()), FALSE_VALUE);
  });
});
