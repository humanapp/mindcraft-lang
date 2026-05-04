/**
 * Synthetic-actuator regression tests pinning the carry-over of host state
 * stored via `services.callsite.{getHostState, setHostState, clearHostState}`
 * across page round-trips. The three actuators below mirror the shapes of
 * sim's `move` (cooldown), `eat` (consumption window), and `shoot`
 * (recharge), without depending on sim.
 */

import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import type { BrainServices } from "@mindcraft-lang/core/brain";
import { mkVariableTileId, TilePlacement } from "@mindcraft-lang/core/brain";
import { __test__createBrainServices } from "@mindcraft-lang/core/brain/__test__";
import { BrainDef } from "@mindcraft-lang/core/brain/model";
import { BrainTileOperatorDef, BrainTileSensorDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import {
  type ActionDescriptor,
  CoreTypeIds,
  type ExecutionContext,
  extractNumberValue,
  getCallSiteState,
  mkCallDef,
  mkNumberValue,
  setCallSiteState,
} from "@mindcraft-lang/core/runtime";

let services: BrainServices;
let opAssign: BrainTileOperatorDef;

before(() => {
  services = __test__createBrainServices();
  opAssign = new BrainTileOperatorDef("assign", {}, services);
});

function mkVar(name: string) {
  const uniqueId = `synth-${name}`;
  return new BrainTileVariableDef(mkVariableTileId(uniqueId), name, CoreTypeIds.Number, uniqueId);
}

/**
 * Build a two-page brain whose page-0 rule writes `varName` from the result
 * of a single inline sync sensor. Page 1 is empty so a `requestPageChange(1)`
 * deactivates page 0 and a subsequent `requestPageChange(0)` reactivates it.
 */
function buildSingleSensorBrain(
  descriptor: ActionDescriptor,
  exec: (ctx: ExecutionContext) => { t: number; v: number },
  varName: string
) {
  services.actions.register({
    binding: "host",
    descriptor,
    execSync: exec,
  });
  const sensor = new BrainTileSensorDef(descriptor.key, descriptor, {
    placement: TilePlacement.EitherSide | TilePlacement.Inline,
  });
  const v = mkVar(varName);
  const brainDef = new BrainDef(services);
  const p0 = brainDef.appendNewPage();
  assert.ok(p0.success);
  const r = p0.value!.page.children().get(0)!;
  r.do().appendTile(v as never);
  r.do().appendTile(opAssign as never);
  r.do().appendTile(sensor as never);
  const p1 = brainDef.appendNewPage();
  assert.ok(p1.success);
  return { brainDef, varName: v.varName };
}

describe("Brain behavioral -- callsite host-state lifetime", () => {
  test("cooldown actuator's readyAt carries across page round-trip", () => {
    const COOLDOWN = 1000;
    const descriptor: ActionDescriptor = {
      key: "synth-cooldown",
      kind: "sensor",
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
      outputType: CoreTypeIds.Number,
    };
    let actCount = 0;
    const { brainDef, varName } = buildSingleSensorBrain(
      descriptor,
      (ctx) => {
        const state = getCallSiteState<{ readyAt: number }>(ctx);
        if (state && ctx.time < state.readyAt) {
          return mkNumberValue(0);
        }
        actCount += 1;
        setCallSiteState(ctx, { readyAt: ctx.time + COOLDOWN });
        return mkNumberValue(actCount);
      },
      "cooldown-v"
    );

    const brain = brainDef.compile();
    brain.initialize();
    brain.startup();
    // t=16: first fire, sets readyAt=1016
    brain.think(16);
    assert.equal(extractNumberValue(brain.getVariable(varName)), 1);
    // Round-trip the page; total elapsed time still less than COOLDOWN.
    brain.requestPageChange(1);
    brain.think(64);
    brain.requestPageChange(0);
    brain.think(96);
    // t=96 + earlier deltas keeps cumulative time below 1016. Sensor must
    // observe the carried-over readyAt and decline to act.
    assert.equal(extractNumberValue(brain.getVariable(varName)), 0, "cooldown carried across round-trip");
    assert.equal(actCount, 1, "actuator did not fire a second time within the cooldown window");
  });

  test("consumption-window actuator's remainingUses carries across page round-trip", () => {
    const descriptor: ActionDescriptor = {
      key: "synth-consumption",
      kind: "sensor",
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
      outputType: CoreTypeIds.Number,
    };
    const { brainDef, varName } = buildSingleSensorBrain(
      descriptor,
      (ctx) => {
        let state = getCallSiteState<{ remainingUses: number }>(ctx);
        if (!state) {
          state = { remainingUses: 3 };
          setCallSiteState(ctx, state);
        }
        if (state.remainingUses === 0) {
          return mkNumberValue(0);
        }
        state.remainingUses -= 1;
        return mkNumberValue(state.remainingUses + 1);
      },
      "consumption-v"
    );

    const brain = brainDef.compile();
    brain.initialize();
    brain.startup();
    // Consume two of three uses (returns 3 then 2).
    brain.think(16);
    assert.equal(extractNumberValue(brain.getVariable(varName)), 3);
    brain.think(32);
    assert.equal(extractNumberValue(brain.getVariable(varName)), 2);

    brain.requestPageChange(1);
    brain.think(48);
    brain.requestPageChange(0);

    // Third use returns 1, leaves 0 remaining.
    brain.think(64);
    assert.equal(extractNumberValue(brain.getVariable(varName)), 1);
    // Fourth use observes remainingUses === 0 and returns 0.
    brain.think(80);
    assert.equal(extractNumberValue(brain.getVariable(varName)), 0);
  });

  test("recharge actuator's chargeLevel and lastFireTime carry across page round-trip", () => {
    const RECHARGE_PER_MS = 0.001;
    const FIRE_COST = 1;
    const descriptor: ActionDescriptor = {
      key: "synth-recharge",
      kind: "sensor",
      callDef: mkCallDef({ type: "bag", items: [] }),
      isAsync: false,
      outputType: CoreTypeIds.Number,
    };
    const { brainDef, varName } = buildSingleSensorBrain(
      descriptor,
      (ctx) => {
        let state = getCallSiteState<{ chargeLevel: number; lastFireTime: number }>(ctx);
        if (!state) {
          state = { chargeLevel: 1, lastFireTime: ctx.time };
          setCallSiteState(ctx, state);
        } else {
          const elapsed = ctx.time - state.lastFireTime;
          state.chargeLevel = Math.min(1, state.chargeLevel + elapsed * RECHARGE_PER_MS);
        }
        if (state.chargeLevel < FIRE_COST) {
          // Return charge level scaled to thousandths so it survives integer extraction.
          return mkNumberValue(Math.round(state.chargeLevel * 1000));
        }
        state.chargeLevel -= FIRE_COST;
        state.lastFireTime = ctx.time;
        return mkNumberValue(1000);
      },
      "recharge-v"
    );

    const brain = brainDef.compile();
    brain.initialize();
    brain.startup();
    // First fire at t=16: full charge -> 1000, leaves chargeLevel=0, lastFireTime=16.
    brain.think(16);
    assert.equal(extractNumberValue(brain.getVariable(varName)), 1000);

    // Round-trip the page, advancing total ctx.time by 500ms.
    brain.requestPageChange(1);
    brain.think(266); // dt 250
    brain.requestPageChange(0);
    brain.think(516); // dt 250 -> total elapsed since lastFireTime=16 is 500ms

    // 500ms * 0.001/ms = 0.5 chargeLevel -> 500 reported.
    assert.equal(
      extractNumberValue(brain.getVariable(varName)),
      500,
      "chargeLevel and lastFireTime carried across round-trip"
    );
  });
});
