/**
 * What a rehearsal records of the subject's declared state channels: the
 * baseline every channel gets on the first think, the deltas that follow, the
 * silence of a channel that does not move, and the id each run is addressed by.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SimulationRun } from "../target/adapter.js";
import {
  createTargetAdapter,
  FAKE_BELL_CHANNEL,
  FAKE_INPUT_KIND,
  FAKE_SIGNAL_CHANNEL,
  FAKE_SUBJECT,
  FakeActionKeys,
  ruleIdAt,
} from "../testing/index.js";
import { proposeEdit } from "../tools/propose-edit.js";
import type { AuthoringWorkspace } from "../tools/workspace.js";
import { createAuthoringWorkspace } from "../tools/workspace.js";

/** Where the rule a fresh brain document already holds stands. */
const kFirstRulePath = "0/0";

/** Seed every rehearsal here draws from. */
const kSeed = 20260812;

/** Rehearse `workspace` with the signal held on for the whole run. */
function rehearse(workspace: AuthoringWorkspace, thinks: number): Promise<SimulationRun> {
  return workspace.adapter.run({
    brainDef: workspace.brainDef,
    scenario: { seed: kSeed, subject: FAKE_SUBJECT, inputs: [{ kind: FAKE_INPUT_KIND, at: 0, value: true }] },
    thinks,
  });
}

/** Every state entry the run recorded, as `think channel=value`. */
function changes(run: SimulationRun): string[] {
  return run.observations.flatMap((think, index) => (think.state ?? []).map((entry) => `${index} ${entry}`));
}

/** Entries of `channel` alone, as `think value`. */
function changesOf(run: SimulationRun, channel: string): string[] {
  return changes(run)
    .filter((entry) => entry.includes(` ${channel}=`))
    .map((entry) => entry.replace(`${channel}=`, ""));
}

describe("subject state channels", () => {
  test("names every channel the target declares", () => {
    assert.deepEqual(
      createTargetAdapter()
        .stateChannels()
        .map((channel) => channel.name),
      [FAKE_SIGNAL_CHANNEL, FAKE_BELL_CHANNEL]
    );
  });

  test("records every declared channel on the first think, whatever it holds", async () => {
    const run = await rehearse(createAuthoringWorkspace(createTargetAdapter(), "baseline brain"), 4);

    assert.deepEqual(run.observations[0]?.state, [`${FAKE_SIGNAL_CHANNEL}=on`, `${FAKE_BELL_CHANNEL}=quiet`]);
  });

  test("leaves a channel that does not move out of every later think", async () => {
    const run = await rehearse(createAuthoringWorkspace(createTargetAdapter(), "quiet brain"), 12);

    assert.deepEqual(changesOf(run, FAKE_BELL_CHANNEL), ["0 quiet"], "the bell nothing rings reports once");
  });

  test("records a channel again on the think its value changed", async () => {
    const adapter = createTargetAdapter();
    const workspace = createAuthoringWorkspace(adapter, "ringing brain");
    const ruleId = ruleIdAt(workspace.brainDef, kFirstRulePath);
    const placed = proposeEdit(workspace, {
      op: "placeTiles",
      ruleId,
      side: "do",
      tileIds: [`tile.actuator->${FakeActionKeys.Ring}`],
    });
    assert.equal(placed.ok, true, JSON.stringify(placed));

    const run = await rehearse(workspace, 8);

    const bell = changesOf(run, FAKE_BELL_CHANNEL);
    assert.equal(bell[0], "0 ringing", "the ring the first think made is already audible when the think closes");
    assert.ok(bell.length > 1, `the bell settles and rings again over the run: ${bell.join("; ")}`);
    assert.ok(
      bell.every((entry, index) => index === 0 || entry !== bell[index - 1]),
      "no entry repeats the value before it"
    );
  });

  test("reconstructs a channel's value on every think of the run from the deltas alone", async () => {
    const run = await rehearse(createAuthoringWorkspace(createTargetAdapter(), "reconstruction brain"), 10);

    let held: string | undefined;
    for (const think of run.observations) {
      for (const entry of think.state ?? []) {
        if (entry.startsWith(`${FAKE_SIGNAL_CHANNEL}=`)) held = entry.slice(FAKE_SIGNAL_CHANNEL.length + 1);
      }
      assert.ok(held !== undefined, "the baseline makes the channel known from the first think on");
    }
  });

  test("numbers the runs of one adapter from one, in the order they were asked for", async () => {
    const adapter = createTargetAdapter();
    const workspace = createAuthoringWorkspace(adapter, "numbered brain");

    const first = await rehearse(workspace, 2);
    const second = await rehearse(workspace, 2);
    const third = await rehearse(workspace, 2);

    assert.deepEqual([first.runId, second.runId, third.runId], ["run-1", "run-2", "run-3"]);
  });

  test("gives two adapters the same ids for the same sequence of runs", async () => {
    const here = await rehearse(createAuthoringWorkspace(createTargetAdapter(), "one brain"), 2);
    const there = await rehearse(createAuthoringWorkspace(createTargetAdapter(), "another brain"), 2);

    assert.equal(here.runId, there.runId);
  });
});
