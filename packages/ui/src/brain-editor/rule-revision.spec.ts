/**
 * Pins which rules must recompute when one rule changes. A rule's revision
 * stands for its sentence, the capabilities and output keys in scope at it, and
 * the tiles the suggestion oracle offers on either side; each of those reads the
 * rule's own tiles, its trigger mode, the tiles of the rules it is nested under,
 * and whether it has a rule above it at its own level, and nothing else.
 *
 * The cases below fix that reach in both directions: an edit inside a rule
 * reaches the rules nested under it and no further, and never reaches a sibling
 * or an ancestor.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RuleTriggerMode } from "@wendoo/core/brain";
import { type RevisionRuleNode, ruleRevisions } from "./rule-revision";

/**
 * A rule holding `whenTileIds` and `doTileIds` with `children` nested under it,
 * in the `when` trigger mode.
 */
function rule(
  whenTileIds: readonly string[],
  doTileIds: readonly string[],
  children: readonly RevisionRuleNode[] = []
): RevisionRuleNode {
  return { trigger: RuleTriggerMode.When, whenTileIds, doTileIds, children };
}

/**
 * The page every case starts from. Its rules, in the pre-order `ruleRevisions`
 * reads them, are `a` (0), `a1` (1), `a2` (2), `b` (3), `b1` (4).
 */
function page(): RevisionRuleNode[] {
  return [
    rule(["when.a"], ["do.a"], [rule(["when.a1"], ["do.a1"]), rule(["when.a2"], ["do.a2"])]),
    rule(["when.b"], ["do.b"], [rule(["when.b1"], ["do.b1"])]),
  ];
}

/** The indices of the rules whose revision differs between `before` and `after`. */
function changedRules(before: readonly RevisionRuleNode[], after: readonly RevisionRuleNode[]): number[] {
  const from = ruleRevisions(before);
  const to = ruleRevisions(after);
  const changed: number[] = [];
  for (let index = 0; index < Math.max(from.length, to.length); index++) {
    if (from[index] !== to[index]) changed.push(index);
  }
  return changed;
}

describe("ruleRevisions", () => {
  test("reads one revision per rule, in depth-first pre-order", () => {
    assert.equal(ruleRevisions(page()).length, 5);
  });

  test("spells the same revisions for equal pages", () => {
    assert.deepEqual(ruleRevisions(page()), ruleRevisions(page()));
  });

  test("an edit to a rule reaches that rule and the rules nested under it", () => {
    const after = page();
    after[0] = rule(["when.a", "when.a.extra"], ["do.a"], after[0].children);
    assert.deepEqual(changedRules(page(), after), [0, 1, 2]);
  });

  test("an edit to a rule's DO side reaches the rules nested under it too", () => {
    const after = page();
    after[0] = rule(["when.a"], [], after[0].children);
    assert.deepEqual(changedRules(page(), after), [0, 1, 2]);
  });

  test("an edit to a nested rule reaches neither its ancestor nor its siblings", () => {
    const after = page();
    after[0] = rule(["when.a"], ["do.a"], [rule(["when.a1", "when.a1.extra"], ["do.a1"]), after[0].children[1]]);
    assert.deepEqual(changedRules(page(), after), [1]);
  });

  test("an edit in one tree does not reach another tree", () => {
    const after = page();
    after[1] = rule(["when.b"], ["do.b", "do.b.extra"], after[1].children);
    assert.deepEqual(changedRules(page(), after), [3, 4]);
  });

  test("gaining a rule above it at its own level reaches the rule and its nested rules", () => {
    const before = page();
    const after = [rule(["when.new"], ["do.new"]), ...page()];
    // The inserted rule takes index 0; `a` and its nested rules follow it and
    // now have a rule above them, and `b` had one already.
    const from = ruleRevisions(before);
    const to = ruleRevisions(after);
    assert.equal(to.length, 6);
    assert.notEqual(to[1], from[0]);
    assert.notEqual(to[2], from[1]);
    assert.notEqual(to[3], from[2]);
    assert.equal(to[4], from[3]);
    assert.equal(to[5], from[4]);
  });

  test("swapping two nested rules changes both of their revisions", () => {
    const after = page();
    after[0] = rule(["when.a"], ["do.a"], [after[0].children[1], after[0].children[0]]);
    assert.deepEqual(changedRules(page(), after), [1, 2]);
  });

  test("tile ids carrying the separators cannot spell another rule's revision", () => {
    const split = ruleRevisions([rule(["a", "b"], [])]);
    const joined = ruleRevisions([rule(["a,b"], [])]);
    assert.notEqual(split[0], joined[0]);
  });

  test("a tile id spanning the side separator cannot spell a tile on the other side", () => {
    const twoSides = ruleRevisions([rule(["a"], ["b"])]);
    const oneSide = ruleRevisions([rule(["a>b"], [])]);
    assert.notEqual(twoSides[0], oneSide[0]);
  });
});
