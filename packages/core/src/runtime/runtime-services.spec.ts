/**
 * Regression tests for the test-only platform services factory and the
 * runtime-services aggregate built by {@link createRuntimeServices}.
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

import {
  createCallsiteStore,
  createRuntimeServices,
  type IBrain,
  mkNumberValue,
  NIL_VALUE,
} from "@wendoo/core/runtime";
import { __test__createPlatformServices } from "@wendoo/core/runtime/__test__";

const stubBrain = {} as IBrain;

describe("__test__createPlatformServices -- ruleVars regression", () => {
  test("default ruleVars roundtrips for funcId 0 (regression)", () => {
    const services = __test__createPlatformServices();
    services.brain.ruleVars.setByName(0, "targetActor", mkNumberValue(42));
    assert.deepEqual(services.brain.ruleVars.getByName(0, "targetActor"), mkNumberValue(42));
  });

  test("default ruleVars clearByName works for funcId 0 (regression)", () => {
    const services = __test__createPlatformServices();
    services.brain.ruleVars.setByName(0, "k", mkNumberValue(1));
    services.brain.ruleVars.clearByName(0, "k");
    assert.deepEqual(services.brain.ruleVars.getByName(0, "k"), NIL_VALUE);
  });

  test("default ruleVars treats only `undefined` as the no-rule sentinel", () => {
    const services = __test__createPlatformServices();
    services.brain.ruleVars.setByName(undefined, "ignored", mkNumberValue(1));
    assert.deepEqual(services.brain.ruleVars.getByName(undefined, "ignored"), NIL_VALUE);
  });

  test("default ruleVars isolates funcId 0 from funcId 1", () => {
    const services = __test__createPlatformServices();
    services.brain.ruleVars.setByName(0, "v", mkNumberValue(10));
    services.brain.ruleVars.setByName(1, "v", mkNumberValue(20));
    assert.deepEqual(services.brain.ruleVars.getByName(0, "v"), mkNumberValue(10));
    assert.deepEqual(services.brain.ruleVars.getByName(1, "v"), mkNumberValue(20));
  });
});

describe("createRuntimeServices -- aggregate shape", () => {
  test("returns exactly { brainVars, brainPages, callsite } and no rng field", () => {
    const services = createRuntimeServices(stubBrain, createCallsiteStore());
    const keys = Object.keys(services).sort();
    assert.deepEqual(keys, ["brainPages", "brainVars", "callsite"]);
    assert.equal((services as { rng?: unknown }).rng, undefined);
  });
});

describe("createRuntimeServices -- callsite lifecycle", () => {
  test("ensure returns true on first call, false on subsequent", () => {
    const services = createRuntimeServices(stubBrain, createCallsiteStore());
    assert.equal(services.callsite.ensure(7), true);
    assert.equal(services.callsite.ensure(7), false);
    assert.equal(services.callsite.ensure(7), false);
  });

  test("reset deallocates so the next ensure returns true again", () => {
    const services = createRuntimeServices(stubBrain, createCallsiteStore());
    services.callsite.ensure(11);
    services.callsite.setSlot(11, 0, mkNumberValue(99));
    services.callsite.reset(11);
    assert.equal(services.callsite.ensure(11), true);
    assert.deepEqual(services.callsite.getSlot(11, 0), NIL_VALUE);
  });

  test("clearHostState removes only the host-state cell, leaves slots intact", () => {
    const services = createRuntimeServices(stubBrain, createCallsiteStore());
    services.callsite.ensure(13);
    services.callsite.setSlot(13, 0, mkNumberValue(7));
    services.callsite.setHostState(13, "payload");
    assert.equal(services.callsite.getHostState(13), "payload");
    services.callsite.clearHostState(13);
    assert.equal(services.callsite.getHostState(13), undefined);
    assert.deepEqual(services.callsite.getSlot(13, 0), mkNumberValue(7));
    assert.equal(services.callsite.ensure(13), false);
  });

  test("setSlot auto-allocates the callsite when none exists", () => {
    const services = createRuntimeServices(stubBrain, createCallsiteStore());
    services.callsite.setSlot(21, 0, mkNumberValue(42));
    assert.deepEqual(services.callsite.getSlot(21, 0), mkNumberValue(42));
    assert.equal(services.callsite.ensure(21), false);
  });

  test("setSlot grows slots on demand to cover the largest written index", () => {
    const services = createRuntimeServices(stubBrain, createCallsiteStore());
    services.callsite.setSlot(31, 4, mkNumberValue(99));
    assert.deepEqual(services.callsite.getSlot(31, 4), mkNumberValue(99));
    assert.deepEqual(services.callsite.getSlot(31, 0), NIL_VALUE);
    assert.deepEqual(services.callsite.getSlot(31, 3), NIL_VALUE);
    assert.deepEqual(services.callsite.getSlot(31, 99), NIL_VALUE);
  });

  test("getSlot on an unallocated callsite returns NIL_VALUE without allocating", () => {
    const services = createRuntimeServices(stubBrain, createCallsiteStore());
    assert.deepEqual(services.callsite.getSlot(41, 0), NIL_VALUE);
    assert.equal(services.callsite.ensure(41), true);
  });
});

describe("createRuntimeServices -- callsite host state", () => {
  test("setHostState / getHostState round-trip preserves the stored reference", () => {
    const services = createRuntimeServices(stubBrain, createCallsiteStore());
    const payload = { foo: 1 };
    services.callsite.setHostState(7, payload);
    assert.equal(services.callsite.getHostState(7), payload);
  });

  test("getHostState on an unwritten callsite returns undefined", () => {
    const services = createRuntimeServices(stubBrain, createCallsiteStore());
    assert.equal(services.callsite.getHostState(8), undefined);
  });

  test("distinct callSiteIds do not alias host state", () => {
    const services = createRuntimeServices(stubBrain, createCallsiteStore());
    const a = { tag: "a" };
    const b = { tag: "b" };
    services.callsite.setHostState(7, a);
    services.callsite.setHostState(8, b);
    assert.equal(services.callsite.getHostState(7), a);
    assert.equal(services.callsite.getHostState(8), b);
  });

  test("reset drops both host state and slot pad together", () => {
    const services = createRuntimeServices(stubBrain, createCallsiteStore());
    services.callsite.setSlot(9, 0, mkNumberValue(1));
    services.callsite.setHostState(9, "payload");
    services.callsite.reset(9);
    assert.equal(services.callsite.getHostState(9), undefined);
    assert.deepEqual(services.callsite.getSlot(9, 0), NIL_VALUE);
  });
});
