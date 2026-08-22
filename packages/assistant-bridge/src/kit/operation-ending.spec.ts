/**
 * What a rehearsal records of an operation ending its target published: a call
 * the world would not run, an operation another call interrupted, and one that
 * ran on to its own end after its call had already returned.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { AddPageCommand } from "@wendoo/core/brain/model";
import { summarizeRun } from "../simulate/summarizer.js";
import type { DispatchObservation, SimulationRun } from "../target/adapter.js";
import { DispatchOutcome } from "../target/adapter.js";
import {
  createTargetAdapter,
  FAKE_INPUT_KIND,
  FAKE_RING_THINKS,
  FAKE_SUBJECT,
  FakeActionKeys,
  FakeTileIds,
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

/** Where the one rule of a second page stands. */
const kSecondPageRulePath = "1/0";

/** Action key of core's page switch. */
const kSwitchPage = "switch-page";

/** Tile the fake target's signal sensor is addressed by. */
const signalTile = `tile.sensor->${FakeActionKeys.Signal}`;

/** Tile the fake target's bell-leasing actuator is addressed by. */
const ringTile = `tile.actuator->${FakeActionKeys.Ring}`;

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
 * Two sibling rules that both sense the signal and ring, the second carrying
 * `secondRingModifiers`. The first takes the bell every time it is free, so the
 * second always meets a bell already held.
 */
async function rehearseTwoRingers(thinks: number, secondRingModifiers: TileRunEntry[]): Promise<SimulationRun> {
  const workspace = createAuthoringWorkspace(createTargetAdapter(), "contending brain");
  const firstRuleId = ruleIdAt(workspace.brainDef, kFirstRulePath);
  place(workspace, firstRuleId, "when", [signalTile]);
  place(workspace, firstRuleId, "do", [ringTile, `tile.modifier->${FakeTileIds.InBackground}`]);
  const added = proposeEdit(workspace, { op: "addRule", pageIndex: 0 });
  assert.equal(added.ok, true, JSON.stringify(added));
  const secondRuleId = ruleIdAt(workspace.brainDef, kSecondRulePath);
  place(workspace, secondRuleId, "when", [signalTile]);
  place(workspace, secondRuleId, "do", [ringTile, ...secondRingModifiers]);
  return rehearse(workspace, thinks);
}

describe("an operation the world would not run", () => {
  test("reports the call that started it as dropped", async () => {
    const run = await rehearseTwoRingers(4, []);

    const rings = dispatchesOf(run, FakeActionKeys.Ring);
    const dropped = rings.filter((ring) => ring.outcome === DispatchOutcome.Dropped);
    assert.ok(dropped.length > 0, `some ring met a held bell: ${JSON.stringify(rings)}`);
    assert.equal(dropped[0]?.settledAfter, undefined, "a dropped call never started, so it took no time");
  });

  test("renders the ending in the run's own account", async () => {
    const summary = summarizeRun(await rehearseTwoRingers(4, []));

    assert.ok(
      summary.dispatchTotals.some((entry) => entry.includes(`[${DispatchOutcome.Dropped}]`)),
      `the totals carry the dropped calls: ${summary.dispatchTotals.join(" ")}`
    );
  });
});

describe("an operation another call interrupted", () => {
  test("reports the interrupted call as preempted", async () => {
    const run = await rehearseTwoRingers(4, [`tile.modifier->${FakeTileIds.Immediately}`]);

    const rings = dispatchesOf(run, FakeActionKeys.Ring);
    assert.ok(
      rings.some((ring) => ring.outcome === DispatchOutcome.Preempted),
      `a ring lost the bell to the insistent one: ${JSON.stringify(rings)}`
    );
    assert.ok(
      summarizeRun(run).dispatchTotals.some((entry) => entry.includes(`[${DispatchOutcome.Preempted}]`)),
      "the account carries the interrupted call's ending"
    );
  });
});

describe("an operation whose caller was cancelled under it", () => {
  test("keeps the ending the world published over the unended call it would otherwise read as", async () => {
    const workspace = createAuthoringWorkspace(createTargetAdapter(), "page switching brain");
    workspace.history.executeCommand(new AddPageCommand(workspace.brainDef));
    const ringerId = ruleIdAt(workspace.brainDef, kFirstRulePath);
    place(workspace, ringerId, "when", [signalTile]);
    place(workspace, ringerId, "do", [ringTile]);
    const added = proposeEdit(workspace, { op: "addRule", pageIndex: 0 });
    assert.equal(added.ok, true, JSON.stringify(added));
    const switcherId = ruleIdAt(workspace.brainDef, kSecondRulePath);
    place(workspace, switcherId, "when", [signalTile]);
    place(workspace, switcherId, "do", [
      `tile.actuator->${kSwitchPage}`,
      { tileId: "tile.lit.factory->number", value: 2 },
    ]);
    const insistentId = ruleIdAt(workspace.brainDef, kSecondPageRulePath);
    place(workspace, insistentId, "when", [signalTile]);
    place(workspace, insistentId, "do", [ringTile, `tile.modifier->${FakeTileIds.Immediately}`]);

    const run = await rehearse(workspace, 6);

    const abandoned = dispatchesOf(run, FakeActionKeys.Ring).find((ring) => ring.ruleId === ringerId);
    assert.equal(abandoned?.outcome, DispatchOutcome.Preempted, JSON.stringify(run.observations));
  });
});

describe("an operation that outlived its call", () => {
  test("reports the true end of a call that returned at dispatch", async () => {
    const workspace = createAuthoringWorkspace(createTargetAdapter(), "background brain");
    const ruleId = ruleIdAt(workspace.brainDef, kFirstRulePath);
    place(workspace, ruleId, "when", [signalTile]);
    place(workspace, ruleId, "do", [ringTile, `tile.modifier->${FakeTileIds.InBackground}`]);

    const run = await rehearse(workspace, 6);

    const ended = dispatchesOf(run, FakeActionKeys.Ring).filter(
      (ring) => ring.outcome === DispatchOutcome.BackgroundEnd
    );
    assert.ok(ended.length > 0, "a ring that returned at dispatch still reported its own end");
    assert.equal(ended[0]?.settledAfter, FAKE_RING_THINKS, "the end fell the ring's whole duration after the call");
    assert.deepEqual(run.observations[0]?.waiting, undefined, "no rule parked on a ring made in the background");
  });
});
