/**
 * What a rehearsal records of a call that outlives the think it was made on:
 * the rule parked on it, the thinks it took to end, how it ended, the root rule
 * held while a rule below it waits, the value a call reports back, and the page
 * changes the brain makes.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AddPageCommand } from "@wendoo/core/brain/model";
import { summarizeRun } from "../simulate/summarizer.js";
import type { DispatchObservation, SimulationRun } from "../target/adapter.js";
import { DispatchOutcome } from "../target/adapter.js";
import {
  createTargetAdapter,
  FAKE_EMIT_OUTPUT,
  FAKE_INPUT_KIND,
  FAKE_RING_THINKS,
  FAKE_SUBJECT,
  FakeActionKeys,
  ruleIdAt,
} from "../testing/index.js";
import { proposeEdit } from "../tools/propose-edit.js";
import type { TileRunEntry } from "../tools/tool-schemas.js";
import type { AuthoringWorkspace } from "../tools/workspace.js";
import { createAuthoringWorkspace } from "../tools/workspace.js";

/** Where the rule a fresh brain document already holds stands. */
const kFirstRulePath = "0/0";

/** Where a rule added beside the first stands. */
const kSecondRulePath = "0/1";

/** Where the rule nested under the first stands. */
const kChildRulePath = "0/0/0";

/** Action key of core's page switch. */
const kSwitchPage = "switch-page";

/** Place `tileIds` at the end of `side` of `ruleId`, asserting the editor accepted the run. */
function place(workspace: AuthoringWorkspace, ruleId: string, side: "when" | "do", tileIds: TileRunEntry[]): void {
  const result = proposeEdit(workspace, { op: "placeTiles", ruleId, side, tileIds });
  assert.equal(result.ok, true, JSON.stringify(result));
}

/** Rehearse `workspace` with the signal held on for the whole run. */
function rehearse(workspace: AuthoringWorkspace, thinks: number): Promise<SimulationRun> {
  return workspace.adapter.run({
    brainDef: workspace.brainDef,
    scenario: { seed: 20260810, subject: FAKE_SUBJECT, inputs: [{ kind: FAKE_INPUT_KIND, at: 0, value: true }] },
    thinks,
  });
}

/** Every dispatch of `action` the run recorded, in order. */
function dispatchesOf(run: SimulationRun, action: string): DispatchObservation[] {
  return run.observations.flatMap((think) => think.dispatches.filter((dispatch) => dispatch.action === action));
}

/**
 * One rule that senses the signal and rings, which the fake world settles
 * {@link FAKE_RING_THINKS} thinks later.
 */
async function rehearseRinging(thinks: number): Promise<{ run: SimulationRun; ruleId: string }> {
  const workspace = createAuthoringWorkspace(createTargetAdapter(), "ringing brain");
  const ruleId = ruleIdAt(workspace.brainDef, kFirstRulePath);
  place(workspace, ruleId, "when", [`tile.sensor->${FakeActionKeys.Signal}`]);
  place(workspace, ruleId, "do", [`tile.actuator->${FakeActionKeys.Ring}`]);
  return { run: await rehearse(workspace, thinks), ruleId };
}

describe("a call that outlives the think it was made on", () => {
  test("reports the rule parked on it for every think it is parked", async () => {
    const { run, ruleId } = await rehearseRinging(4);

    assert.deepEqual(run.observations[0]?.waiting, [ruleId], "the rule parks on the think it rang");
    assert.deepEqual(run.observations[1]?.waiting, [ruleId], "and stays parked while the ring is in flight");
  });

  test("reports how it ended and how long it took", async () => {
    const { run } = await rehearseRinging(6);

    const first = dispatchesOf(run, FakeActionKeys.Ring)[0];
    assert.equal(first?.outcome, DispatchOutcome.Resolved);
    assert.equal(first?.settledAfter, FAKE_RING_THINKS);
  });

  test("reports a call still in flight when the run ends as unended", async () => {
    const { run } = await rehearseRinging(2);

    const rings = dispatchesOf(run, FakeActionKeys.Ring);
    assert.equal(rings.length, 1);
    assert.equal(rings[0]?.outcome, DispatchOutcome.Pending);
    assert.equal(rings[0]?.settledAfter, undefined, "a call that never ended took no measurable time");
  });

  test("leaves the rule out of the waiting list once its call ends", async () => {
    const { run, ruleId } = await rehearseRinging(6);

    const parked = run.observations.map((think) => (think.waiting ?? []).includes(ruleId));
    assert.ok(
      parked.some((waiting) => !waiting),
      `the rule ran again after its call ended: ${JSON.stringify(parked)}`
    );
  });

  test("renders the wait and the ending in the run's own account", async () => {
    const { run, ruleId } = await rehearseRinging(6);

    const summary = summarizeRun(run);
    assert.ok(
      summary.spans.some((span) => (span.think.waiting ?? []).includes(ruleId)),
      "some span of the account shows the rule waiting"
    );
    assert.ok(
      summary.dispatchTotals.some((entry) =>
        entry.startsWith(`${FakeActionKeys.Ring}()[resolved,+${FAKE_RING_THINKS}]`)
      ),
      `the totals carry the call's ending: ${summary.dispatchTotals.join(" ")}`
    );
  });
});

describe("a call that ends where it was made", () => {
  test("carries no ending at all", async () => {
    const workspace = createAuthoringWorkspace(createTargetAdapter(), "prompt brain");
    const ruleId = ruleIdAt(workspace.brainDef, kFirstRulePath);
    place(workspace, ruleId, "when", [`tile.sensor->${FakeActionKeys.Signal}`]);
    place(workspace, ruleId, "do", [`tile.actuator->${FakeActionKeys.Chime}`]);

    const run = await rehearse(workspace, 3);

    const chime = dispatchesOf(run, FakeActionKeys.Chime)[0];
    assert.ok(chime, "the asynchronous call was recorded");
    assert.equal(chime.outcome, undefined, "an asynchronous call that resolved at once reports no outcome");
    assert.equal(chime.settledAfter, undefined);
    assert.deepEqual(run.observations[0]?.waiting, undefined, "no rule parked");
    assert.deepEqual(
      summarizeRun(run).dispatchTotals.filter((entry) => entry.startsWith(FakeActionKeys.Chime)),
      [`${FakeActionKeys.Chime}()=3`],
      "it counts exactly as a synchronous call does"
    );
  });
});

describe("what a call reports back", () => {
  test("renders a declared output's value on the call that produced it", async () => {
    const workspace = createAuthoringWorkspace(createTargetAdapter(), "emitting brain");
    const ruleId = ruleIdAt(workspace.brainDef, kFirstRulePath);
    place(workspace, ruleId, "when", [`tile.sensor->${FakeActionKeys.Signal}`]);
    place(workspace, ruleId, "do", [`tile.actuator->${FakeActionKeys.Emit}`]);

    const run = await rehearse(workspace, 2);

    assert.equal(dispatchesOf(run, FakeActionKeys.Emit)[0]?.output, `${FAKE_EMIT_OUTPUT}=true`);
  });

  test("invents nothing for an action that declares no output", async () => {
    const workspace = createAuthoringWorkspace(createTargetAdapter(), "sensing brain");
    const ruleId = ruleIdAt(workspace.brainDef, kFirstRulePath);
    place(workspace, ruleId, "when", [`tile.sensor->${FakeActionKeys.Signal}`]);
    place(workspace, ruleId, "do", [`tile.actuator->${FakeActionKeys.Chime}`]);

    const run = await rehearse(workspace, 2);

    assert.equal(dispatchesOf(run, FakeActionKeys.Signal)[0]?.output, undefined);
    assert.equal(dispatchesOf(run, FakeActionKeys.Chime)[0]?.output, undefined);
  });
});

describe("a root rule held by a rule below it", () => {
  test("reports itself quiesced for every think it is held", async () => {
    const workspace = createAuthoringWorkspace(createTargetAdapter(), "held brain");
    const parentRuleId = ruleIdAt(workspace.brainDef, kFirstRulePath);
    place(workspace, parentRuleId, "when", [`tile.sensor->${FakeActionKeys.Signal}`]);
    place(workspace, parentRuleId, "do", [`tile.actuator->${FakeActionKeys.Emit}`]);
    const added = proposeEdit(workspace, { op: "addChildRule", parentRuleId });
    assert.equal(added.ok, true, JSON.stringify(added));
    const childRuleId = ruleIdAt(workspace.brainDef, kChildRulePath);
    place(workspace, childRuleId, "do", [`tile.actuator->${FakeActionKeys.Ring}`]);

    const run = await rehearse(workspace, 4);

    assert.deepEqual(run.observations[1]?.quiesced, [parentRuleId], "the parent is held while its child waits");
    assert.deepEqual(run.observations[1]?.waiting, [childRuleId]);
    assert.deepEqual(run.observations[0]?.quiesced, undefined, "the parent ran on the think it spawned the child");
  });
});

describe("a brain that changes page", () => {
  test("reports the change on the think it happened", async () => {
    const workspace = createAuthoringWorkspace(createTargetAdapter(), "paging brain");
    workspace.history.executeCommand(new AddPageCommand(workspace.brainDef));
    const stayRuleId = ruleIdAt(workspace.brainDef, kFirstRulePath);
    place(workspace, stayRuleId, "do", [`tile.actuator->${FakeActionKeys.Emit}`]);
    const added = proposeEdit(workspace, { op: "addRule", pageIndex: 0 });
    assert.equal(added.ok, true, JSON.stringify(added));
    const leaveRuleId = ruleIdAt(workspace.brainDef, kSecondRulePath);
    place(workspace, leaveRuleId, "when", [`tile.sensor->${FakeActionKeys.Signal}`]);
    place(workspace, leaveRuleId, "do", [
      `tile.actuator->${kSwitchPage}`,
      { tileId: "tile.lit.factory->number", value: 2 },
    ]);

    const run = await rehearse(workspace, 4);

    const switched = run.observations.findIndex((think) => think.pageSwitch !== undefined);
    assert.ok(switched > 0, `the run switched page: ${JSON.stringify(run.observations.map((t) => t.pageSwitch))}`);
    assert.deepEqual(run.observations[switched]?.pageSwitch, { from: 0, to: 1 });
    assert.equal(
      summarizeRun(run).spans.some((span) => span.think.page === "0->1"),
      true
    );
  });
});
