/**
 * Regression tests for the test-only platform services factory and the
 * dense-state callsite lifecycle implemented in {@link createDenseShims}.
 *
 * Background: an early dense-state implementation treated `ruleFuncId === 0`
 * as a "no-rule" sentinel and short-circuited reads/writes. The brain
 * compiler assigns funcIds starting at `0`, so the first compiled rule on
 * page 0 always lands on funcId `0`. The bogus sentinel silently dropped
 * every `setRuleVariable` / `getRuleVariable` call originating from that
 * rule. The only sentinel for "no rule" is `undefined`. The
 * `__test__createPlatformServices` factory mirrors the production
 * `createRuleVariableServices` semantics and pins this invariant.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createDenseShims, type IBrain, mkNumberValue, NIL_VALUE } from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";

const stubBrain = {} as IBrain;

describe("__test__createPlatformServices -- ruleVars regression", () => {
  test("default ruleVars roundtrips for funcId 0 (regression)", () => {
    const services = __test__createPlatformServices();
    services.ruleVars.setByName(0, "targetActor", mkNumberValue(42));
    assert.deepEqual(services.ruleVars.getByName(0, "targetActor"), mkNumberValue(42));
  });

  test("default ruleVars clearByName works for funcId 0 (regression)", () => {
    const services = __test__createPlatformServices();
    services.ruleVars.setByName(0, "k", mkNumberValue(1));
    services.ruleVars.clearByName(0, "k");
    assert.deepEqual(services.ruleVars.getByName(0, "k"), NIL_VALUE);
  });

  test("default ruleVars treats only `undefined` as the no-rule sentinel", () => {
    const services = __test__createPlatformServices();
    services.ruleVars.setByName(undefined, "ignored", mkNumberValue(1));
    assert.deepEqual(services.ruleVars.getByName(undefined, "ignored"), NIL_VALUE);
  });

  test("default ruleVars isolates funcId 0 from funcId 1", () => {
    const services = __test__createPlatformServices();
    services.ruleVars.setByName(0, "v", mkNumberValue(10));
    services.ruleVars.setByName(1, "v", mkNumberValue(20));
    assert.deepEqual(services.ruleVars.getByName(0, "v"), mkNumberValue(10));
    assert.deepEqual(services.ruleVars.getByName(1, "v"), mkNumberValue(20));
  });
});

describe("createDenseShims -- callsite lifecycle", () => {
  test("ensureCallsite returns true on first call, false on subsequent", () => {
    const shims = createDenseShims(stubBrain);
    assert.equal(shims.action.ensureCallsite(7), true);
    assert.equal(shims.action.ensureCallsite(7), false);
    assert.equal(shims.action.ensureCallsite(7), false);
  });

  test("resetCallsite deallocates so the next ensureCallsite returns true again", () => {
    const shims = createDenseShims(stubBrain);
    shims.action.ensureCallsite(11);
    shims.action.setStateSlot(11, 0, mkNumberValue(99));
    shims.action.resetCallsite(11);
    assert.equal(shims.action.ensureCallsite(11), true);
    assert.deepEqual(shims.action.getStateSlot(11, 0), NIL_VALUE);
  });

  test("clearHostState removes only the host-state cell, leaves slots intact", () => {
    const shims = createDenseShims(stubBrain);
    shims.action.ensureCallsite(13);
    shims.action.setStateSlot(13, 0, mkNumberValue(7));
    shims.callSite.setHostState(13, "payload");
    assert.equal(shims.callSite.getHostState(13), "payload");
    shims.callSite.clearHostState(13);
    assert.equal(shims.callSite.getHostState(13), undefined);
    assert.deepEqual(shims.action.getStateSlot(13, 0), mkNumberValue(7));
    assert.equal(shims.action.ensureCallsite(13), false);
  });

  test("setStateSlot auto-allocates the callsite when none exists", () => {
    const shims = createDenseShims(stubBrain);
    shims.action.setStateSlot(21, 0, mkNumberValue(42));
    assert.deepEqual(shims.action.getStateSlot(21, 0), mkNumberValue(42));
    assert.equal(shims.action.ensureCallsite(21), false);
  });

  test("setStateSlot grows slots on demand to cover the largest written index", () => {
    const shims = createDenseShims(stubBrain);
    shims.action.setStateSlot(31, 4, mkNumberValue(99));
    assert.deepEqual(shims.action.getStateSlot(31, 4), mkNumberValue(99));
    assert.deepEqual(shims.action.getStateSlot(31, 0), NIL_VALUE);
    assert.deepEqual(shims.action.getStateSlot(31, 3), NIL_VALUE);
    assert.deepEqual(shims.action.getStateSlot(31, 99), NIL_VALUE);
  });

  test("getStateSlot on an unallocated callsite returns NIL_VALUE without allocating", () => {
    const shims = createDenseShims(stubBrain);
    assert.deepEqual(shims.action.getStateSlot(41, 0), NIL_VALUE);
    assert.equal(shims.action.ensureCallsite(41), true);
  });
});
