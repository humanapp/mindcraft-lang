/**
 * Pins the page's trailing-empty-rule invariant: the page ends with exactly one
 * empty rule, the page editor only ever removes a trailing empty rule it
 * appended itself, and it keeps the earliest rule of a trailing run so the rule
 * composition is armed on survives.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { decideTrailingEmptyRule } from "./trailing-empty-rule";

/** The facts for a page whose rules are described by `[isEmpty, isAppended]` pairs, in page order. */
function facts(...rules: readonly (readonly [boolean, boolean])[]) {
  return {
    isEmpty: rules.map(([isEmpty]) => isEmpty),
    isAppended: rules.map(([, isAppended]) => isAppended),
  };
}

describe("keeping one trailing empty rule", () => {
  test("a page with no rules appends one", () => {
    assert.deepEqual(decideTrailingEmptyRule(facts()), { kind: "append" });
  });

  test("a page whose last rule holds tiles appends one", () => {
    assert.deepEqual(decideTrailingEmptyRule(facts([false, false])), { kind: "append" });
  });

  test("a page ending in one empty rule is settled", () => {
    assert.deepEqual(decideTrailingEmptyRule(facts([false, false], [true, true])), { kind: "none" });
  });

  test("a page of one empty rule is settled", () => {
    assert.deepEqual(decideTrailingEmptyRule(facts([true, false])), { kind: "none" });
  });

  test("a second trailing empty rule the editor appended is removed", () => {
    assert.deepEqual(decideTrailingEmptyRule(facts([true, true], [true, true])), { kind: "remove", index: 1 });
  });

  test("the earliest rule of the trailing run is the one kept", () => {
    const action = decideTrailingEmptyRule(facts([true, true], [true, true], [true, true]));
    assert.deepEqual(action, { kind: "remove", index: 2 });
  });

  test("an empty rule the user authored is never removed", () => {
    assert.deepEqual(decideTrailingEmptyRule(facts([false, false], [true, false], [true, false])), { kind: "none" });
  });

  test("the editor's own rule is removed from behind a user-authored empty one", () => {
    const action = decideTrailingEmptyRule(facts([false, false], [true, false], [true, true]));
    assert.deepEqual(action, { kind: "remove", index: 2 });
  });

  test("an empty rule above a rule with tiles is not part of the trailing run", () => {
    assert.deepEqual(decideTrailingEmptyRule(facts([true, true], [false, false], [true, true])), { kind: "none" });
  });
});
