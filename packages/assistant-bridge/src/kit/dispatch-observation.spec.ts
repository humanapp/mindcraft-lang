/**
 * What a rehearsal records of the host actions the brain under study
 * dispatched: every call the runtime made, synchronous or asynchronous, with
 * its arguments rendered and the rule it belongs to named.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { DispatchObservation, SimulationRun } from "../target/adapter.js";
import { FakeActionKeys, FakeTileIds } from "../testing/fake-module.js";
import { createTargetAdapter, FAKE_INPUT_KIND, FAKE_SUBJECT, ruleIdAt } from "../testing/index.js";
import { proposeEdit } from "../tools/propose-edit.js";
import type { TileRunEntry } from "../tools/tool-schemas.js";
import type { AuthoringWorkspace } from "../tools/workspace.js";
import { createAuthoringWorkspace } from "../tools/workspace.js";

/** Where the rule that emits stands: the one a fresh brain document already holds. */
const kEmitRulePath = "0/0";

/** Where the rule that chimes stands, added beside the first. */
const kChimeRulePath = "0/1";

/** The number the chime carries, as the authored literal mints it. */
const kChimeAmount = 3;

/** Place `tileIds` at the end of `side` of `ruleId`, asserting the editor accepted the run. */
function place(workspace: AuthoringWorkspace, ruleId: string, side: "when" | "do", tileIds: TileRunEntry[]): void {
  const result = proposeEdit(workspace, { op: "placeTiles", ruleId, side, tileIds });
  assert.equal(result.ok, true, JSON.stringify(result));
}

/**
 * Rehearse two rules that both sense the signal: one emits loudly at a named
 * modifier, the other chimes at an anonymous amount. The signal is scripted on
 * for the whole run, so both rules fire every think.
 */
async function rehearseBothDispatchKinds(thinks: number): Promise<{ run: SimulationRun; chimeRuleId: string }> {
  const workspace = createAuthoringWorkspace(createTargetAdapter(), "dispatch brain");
  const added = proposeEdit(workspace, { op: "addRule", pageIndex: 0 });
  assert.equal(added.ok, true, JSON.stringify(added));
  const emitRuleId = ruleIdAt(workspace.brainDef, kEmitRulePath);
  const chimeRuleId = ruleIdAt(workspace.brainDef, kChimeRulePath);

  place(workspace, emitRuleId, "when", [`tile.sensor->${FakeActionKeys.Signal}`]);
  place(workspace, emitRuleId, "do", [`tile.actuator->${FakeActionKeys.Emit}`, `tile.modifier->${FakeTileIds.Loudly}`]);
  place(workspace, chimeRuleId, "when", [`tile.sensor->${FakeActionKeys.Signal}`]);
  place(workspace, chimeRuleId, "do", [
    `tile.actuator->${FakeActionKeys.Chime}`,
    { tileId: "tile.lit.factory->number", value: kChimeAmount },
  ]);

  const run = await workspace.adapter.run({
    brainDef: workspace.brainDef,
    scenario: {
      seed: 20260806,
      subject: FAKE_SUBJECT,
      inputs: [{ kind: FAKE_INPUT_KIND, at: 0, value: true }],
    },
    thinks,
  });
  return { run, chimeRuleId };
}

/** Every dispatch of `action` the run recorded, in order. */
function dispatchesOf(run: SimulationRun, action: string): DispatchObservation[] {
  return run.observations.flatMap((think) => think.dispatches.filter((dispatch) => dispatch.action === action));
}

describe("a rehearsal's dispatch observations", () => {
  test("records an asynchronous action's calls as it records a synchronous one's", async () => {
    const thinks = 8;

    const { run } = await rehearseBothDispatchKinds(thinks);

    assert.equal(dispatchesOf(run, FakeActionKeys.Emit).length, thinks);
    assert.equal(dispatchesOf(run, FakeActionKeys.Chime).length, thinks);
  });

  test("renders an asynchronous call's arguments and attributes it to its rule", async () => {
    const { run, chimeRuleId } = await rehearseBothDispatchKinds(4);

    const chime = dispatchesOf(run, FakeActionKeys.Chime)[0];
    assert.ok(chime, "the asynchronous action dispatched");
    assert.equal(chime.ruleId, chimeRuleId);
    assert.deepEqual(chime.args, [String(kChimeAmount)]);
  });

  test("names a filled named slot and leaves an anonymous one bare", async () => {
    const { run } = await rehearseBothDispatchKinds(4);

    const emit = dispatchesOf(run, FakeActionKeys.Emit)[0];
    assert.ok(emit, "the synchronous action dispatched");
    assert.deepEqual(emit.args, ["loudly=1"]);
    assert.deepEqual(dispatchesOf(run, FakeActionKeys.Chime)[0]?.args, [String(kChimeAmount)]);
  });

  test("reports both kinds on the same think, in the order the runtime made them", async () => {
    const { run } = await rehearseBothDispatchKinds(2);

    assert.deepEqual(
      run.observations[0]?.dispatches.map((dispatch) => dispatch.action),
      [FakeActionKeys.Signal, FakeActionKeys.Emit, FakeActionKeys.Signal, FakeActionKeys.Chime]
    );
  });
});
