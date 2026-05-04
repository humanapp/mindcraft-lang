/**
 * Regression tests for {@link createDenseShims} and the test-only ruleVars
 * factory.
 *
 * Background: an early dense-state implementation treated `ruleFuncId === 0`
 * as a "no-rule" sentinel and short-circuited reads/writes. The brain
 * compiler assigns funcIds starting at `0`, so the first compiled rule on
 * page 0 always lands on funcId `0`. The bogus sentinel silently dropped
 * every `setRuleVariable` / `getRuleVariable` call originating from that
 * rule, manifesting as host-side cross-tile data passing (e.g. WHEN sensor
 * stashes targetActor, DO actuator reads it back) failing for the first
 * rule of the first page only. The only sentinel for "no rule" is
 * `undefined`.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { Dict, List } from "@mindcraft-lang/core";
import {
  createDenseShims,
  type IBrain,
  type IBrainPage,
  type IBrainRule,
  mkNumberValue,
  mkStringValue,
  NIL_VALUE,
  type Value,
} from "@mindcraft-lang/core/runtime";
import { __test__createPlatformServices } from "@mindcraft-lang/core/runtime/__test__";

/** Minimal {@link IBrainRule} stub backing variables in an in-memory dict. */
class StubRule implements IBrainRule {
  private readonly vars = new Dict<string, Value>();
  constructor(private readonly parent_: StubRule | undefined = undefined) {}
  getVariable<T extends Value>(name: string): T | undefined {
    const own = this.vars.get(name) as T | undefined;
    if (own !== undefined) {
      return own;
    }
    return this.parent_?.getVariable<T>(name);
  }
  setVariable(name: string, value: Value): void {
    this.vars.set(name, value);
  }
  clearVariable(name: string): void {
    this.vars.delete(name);
  }
  clearVariables(): void {
    this.vars.clear();
  }
  page(): IBrainPage {
    throw new Error("StubRule.page: not implemented");
  }
  ancestor(): IBrainRule | undefined {
    return this.parent_;
  }
  children(): List<IBrainRule> {
    return new List<IBrainRule>();
  }
}

const stubBrain = {} as IBrain;

function buildShimWithRules(funcIds: readonly number[]): {
  rules: Map<number, StubRule>;
  ruleVars: ReturnType<typeof createDenseShims>["ruleVars"];
} {
  const rules = new Map<number, StubRule>();
  for (const id of funcIds) {
    rules.set(id, new StubRule());
  }
  const shims = createDenseShims(stubBrain, (funcId) => rules.get(funcId));
  return { rules, ruleVars: shims.ruleVars };
}

describe("createDenseShims -- ruleVars regression", () => {
  test("setByName then getByName roundtrips for funcId 0 (regression)", () => {
    const { ruleVars } = buildShimWithRules([0]);
    const value = mkNumberValue(42);
    ruleVars.setByName(0, "targetActor", value);
    assert.deepEqual(ruleVars.getByName(0, "targetActor"), value);
  });

  test("setByName mutates the resolved IBrainRule for funcId 0 (regression)", () => {
    const { rules, ruleVars } = buildShimWithRules([0]);
    ruleVars.setByName(0, "x", mkNumberValue(7));
    assert.deepEqual(rules.get(0)!.getVariable("x"), mkNumberValue(7));
  });

  test("clearByName removes the value at funcId 0 (regression)", () => {
    const { ruleVars } = buildShimWithRules([0]);
    ruleVars.setByName(0, "x", mkNumberValue(1));
    ruleVars.clearByName(0, "x");
    assert.deepEqual(ruleVars.getByName(0, "x"), NIL_VALUE);
  });

  test("setByName / getByName roundtrips for funcId 1 and higher", () => {
    const { ruleVars } = buildShimWithRules([1, 2, 5]);
    ruleVars.setByName(1, "a", mkNumberValue(10));
    ruleVars.setByName(2, "a", mkNumberValue(20));
    ruleVars.setByName(5, "a", mkStringValue("five"));
    assert.deepEqual(ruleVars.getByName(1, "a"), mkNumberValue(10));
    assert.deepEqual(ruleVars.getByName(2, "a"), mkNumberValue(20));
    assert.deepEqual(ruleVars.getByName(5, "a"), mkStringValue("five"));
  });

  test("getByName for an unwritten variable returns NIL_VALUE", () => {
    const { ruleVars } = buildShimWithRules([0, 1]);
    assert.deepEqual(ruleVars.getByName(0, "missing"), NIL_VALUE);
    assert.deepEqual(ruleVars.getByName(1, "missing"), NIL_VALUE);
  });

  test("getByName with ruleFuncId === undefined returns NIL_VALUE", () => {
    const { ruleVars } = buildShimWithRules([0]);
    assert.deepEqual(ruleVars.getByName(undefined, "anything"), NIL_VALUE);
  });

  test("setByName with ruleFuncId === undefined is a no-op", () => {
    const { rules, ruleVars } = buildShimWithRules([0]);
    ruleVars.setByName(undefined, "x", mkNumberValue(1));
    assert.equal(rules.get(0)!.getVariable("x"), undefined);
  });

  test("clearByName with ruleFuncId === undefined is a no-op", () => {
    const { rules, ruleVars } = buildShimWithRules([0]);
    rules.get(0)!.setVariable("x", mkNumberValue(9));
    ruleVars.clearByName(undefined, "x");
    assert.deepEqual(rules.get(0)!.getVariable("x"), mkNumberValue(9));
  });

  test("getByName when ruleLookup yields no rule returns NIL_VALUE", () => {
    const { ruleVars } = buildShimWithRules([]);
    assert.deepEqual(ruleVars.getByName(99, "x"), NIL_VALUE);
  });

  test("setByName when ruleLookup yields no rule is a no-op (does not throw)", () => {
    const { ruleVars } = buildShimWithRules([]);
    ruleVars.setByName(99, "x", mkNumberValue(1));
  });

  test("rule var stores are isolated across funcIds (no cross-talk)", () => {
    const { ruleVars } = buildShimWithRules([0, 1]);
    ruleVars.setByName(0, "shared", mkNumberValue(100));
    ruleVars.setByName(1, "shared", mkNumberValue(200));
    assert.deepEqual(ruleVars.getByName(0, "shared"), mkNumberValue(100));
    assert.deepEqual(ruleVars.getByName(1, "shared"), mkNumberValue(200));
  });

  test("child rule reads inherit ancestor's rule variable", () => {
    // Parent rule (funcId 10) sets `inherited`. Child rule (funcId 11) is
    // wired to `parent` via StubRule's ancestor link, mirroring the runtime
    // chain set up by BrainRule.ancestor_. Reading `inherited` on the child
    // funcId must walk up and return the parent's value, since
    // IBrainRule.getVariable<T> climbs the ancestor chain.
    const parent = new StubRule();
    const child = new StubRule(parent);
    const rules = new Map<number, StubRule>([
      [10, parent],
      [11, child],
    ]);
    const { ruleVars } = createDenseShims(stubBrain, (funcId) => rules.get(funcId));

    ruleVars.setByName(10, "inherited", mkNumberValue(123));

    assert.deepEqual(ruleVars.getByName(11, "inherited"), mkNumberValue(123));
  });

  test("child rule write does not leak into the parent's storage", () => {
    const parent = new StubRule();
    const child = new StubRule(parent);
    const rules = new Map<number, StubRule>([
      [10, parent],
      [11, child],
    ]);
    const { ruleVars } = createDenseShims(stubBrain, (funcId) => rules.get(funcId));

    ruleVars.setByName(11, "scoped", mkNumberValue(7));

    assert.deepEqual(ruleVars.getByName(11, "scoped"), mkNumberValue(7));
    assert.deepEqual(ruleVars.getByName(10, "scoped"), NIL_VALUE);
  });

  test("child rule's own value shadows the parent's value of the same name", () => {
    const parent = new StubRule();
    const child = new StubRule(parent);
    const rules = new Map<number, StubRule>([
      [10, parent],
      [11, child],
    ]);
    const { ruleVars } = createDenseShims(stubBrain, (funcId) => rules.get(funcId));

    ruleVars.setByName(10, "x", mkNumberValue(1));
    ruleVars.setByName(11, "x", mkNumberValue(2));

    assert.deepEqual(ruleVars.getByName(10, "x"), mkNumberValue(1));
    assert.deepEqual(ruleVars.getByName(11, "x"), mkNumberValue(2));
  });
});

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
