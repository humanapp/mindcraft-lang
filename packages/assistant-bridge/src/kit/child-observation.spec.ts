/**
 * What a rehearsal records of a child rule: a nested rule's gate and the host
 * actions it dispatches are observed under the child's own durable id, the way
 * a root rule's are.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { IndentRuleCommand, InsertRuleCommand } from "@wendoo-lang/core/brain/model";
import { summarizeRun } from "../simulate/summarizer.js";
import type { SimulationRun } from "../target/adapter.js";
import { FakeActionKeys } from "../testing/fake-module.js";
import { createTargetAdapter, FAKE_INPUT_KIND, FAKE_SUBJECT, ruleIdAt } from "../testing/index.js";
import { proposeEdit } from "../tools/propose-edit.js";
import type { AuthoringWorkspace } from "../tools/workspace.js";
import { createAuthoringWorkspace, findRule } from "../tools/workspace.js";

/** Where the parent rule stands: the one a fresh brain document already holds. */
const kParentRulePath = "0/0";

/** Where the child stands once it is nested under the parent. */
const kChildRulePath = "0/0/0";

/** Thinks every rehearsal in this file runs. */
const kThinks = 4;

/** Place `tileId` at the end of `side` of `ruleId`, asserting the editor accepted it. */
function place(workspace: AuthoringWorkspace, ruleId: string, side: "when" | "do", tileId: string): void {
  const result = proposeEdit(workspace, { op: "placeTile", ruleId, side, tileId });
  assert.equal(result.ok, true, JSON.stringify(result));
}

/**
 * Nest a fresh empty rule under the rule `parentRuleId` names and return its
 * durable id.
 */
function nestChild(workspace: AuthoringWorkspace, parentRuleId: string): string {
  const parent = findRule(workspace.brainDef, parentRuleId);
  assert.ok(parent, "the parent rule stands");
  const insert = new InsertRuleCommand(parent.rule, "after");
  workspace.history.executeCommand(insert);
  const inserted = insert.insertedRule();
  assert.ok(inserted, "the insertion produced a rule");
  workspace.history.executeCommand(new IndentRuleCommand(inserted));
  return inserted.ruleId();
}

/**
 * A parent that senses the signal and emits, carrying one child. The child's
 * WHEN is `when` (empty for a child that runs once per parent fire), and its DO
 * chimes. The signal is scripted on for the whole run, so the parent fires every
 * think.
 */
async function rehearseNestedRule(
  when: readonly string[]
): Promise<{ run: SimulationRun; parentRuleId: string; childRuleId: string }> {
  const workspace = createAuthoringWorkspace(createTargetAdapter(), "child brain");
  const parentRuleId = ruleIdAt(workspace.brainDef, kParentRulePath);
  place(workspace, parentRuleId, "when", `tile.sensor->${FakeActionKeys.Signal}`);
  place(workspace, parentRuleId, "do", `tile.actuator->${FakeActionKeys.Emit}`);

  const childRuleId = nestChild(workspace, parentRuleId);
  assert.equal(ruleIdAt(workspace.brainDef, kChildRulePath), childRuleId, "the new rule nested under the parent");
  for (const tileId of when) place(workspace, childRuleId, "when", tileId);
  place(workspace, childRuleId, "do", `tile.actuator->${FakeActionKeys.Chime}`);

  const run = await workspace.adapter.run({
    brainDef: workspace.brainDef,
    scenario: { seed: 20260810, subject: FAKE_SUBJECT, inputs: [{ kind: FAKE_INPUT_KIND, at: 0, value: true }] },
    thinks: kThinks,
  });
  return { run, parentRuleId, childRuleId };
}

describe("a rehearsal's observations of a child rule", () => {
  test("attributes a child's dispatches to the child's own id", async () => {
    const { run, childRuleId } = await rehearseNestedRule([]);

    const chimes = run.observations.flatMap((think) =>
      think.dispatches.filter((dispatch) => dispatch.action === FakeActionKeys.Chime)
    );
    assert.equal(chimes.length, kThinks, "the child ran on every think its parent fired");
    assert.deepEqual(
      [...new Set(chimes.map((dispatch) => dispatch.ruleId))],
      [childRuleId],
      "every one of the child's dispatches names the child"
    );
  });

  test("accounts for a child that runs on every parent fire, which reaches no gate", async () => {
    const { run, parentRuleId, childRuleId } = await rehearseNestedRule([]);

    const summary = summarizeRun(run);
    const child = summary.rules.find((rule) => rule.ruleId === childRuleId);
    assert.ok(child, `the account names the child: ${JSON.stringify(summary.rules)}`);
    assert.deepEqual(child.dispatched, [`${FakeActionKeys.Chime}()=${kThinks}`]);
    assert.equal(child.evaluated, undefined, "a rule with no WHEN condition reaches no gate");
    assert.equal(child.fired, undefined);

    const parent = summary.rules.find((rule) => rule.ruleId === parentRuleId);
    assert.equal(parent?.fired, kThinks, "the parent's own gate totals still stand");
  });

  test("records a child's own gate under the child's id", async () => {
    const { run, parentRuleId, childRuleId } = await rehearseNestedRule([`tile.sensor->${FakeActionKeys.Signal}`]);

    const gates = run.observations.flatMap((think) => think.gates);
    assert.ok(
      gates.some((gate) => gate.ruleId === parentRuleId),
      "the parent's gate is observed"
    );
    const childGates = gates.filter((gate) => gate.ruleId === childRuleId);
    assert.equal(childGates.length, kThinks, "the child's gate is observed on every think it was reached");
    assert.ok(
      childGates.every((gate) => gate.fired),
      "the child's gate passed while the signal was on"
    );

    const child = summarizeRun(run).rules.find((rule) => rule.ruleId === childRuleId);
    assert.equal(child?.fired, kThinks, "the account carries the child's own gate totals");
    assert.deepEqual(child?.dispatched, [
      `${FakeActionKeys.Chime}()=${kThinks}`,
      `${FakeActionKeys.Signal}()=${kThinks}`,
    ]);
  });
});
