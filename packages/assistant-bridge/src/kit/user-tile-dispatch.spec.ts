/**
 * What a rehearsal makes of a document that names a compiled user tile: the
 * staged world resolves the tile from the bundle the request carries, the run
 * records the dispatch under the rule that made it, and the summarized account
 * carries it too. A run given no bundle refuses.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { summarizeRun } from "../simulate/summarizer.js";
import type { SimulationRun } from "../target/adapter.js";
import { FakeActionKeys } from "../testing/fake-module.js";
import { createTargetAdapter, FAKE_INPUT_KIND, FAKE_SUBJECT, ruleIdAt } from "../testing/index.js";
import { proposeEdit } from "../tools/propose-edit.js";
import type { AuthoringWorkspace } from "../tools/workspace.js";
import { createAuthoringWorkspace } from "../tools/workspace.js";
import { RehearsalRejection, RehearsalRejectionCode } from "./rehearsal-adapter.js";
import { USER_TILE_ACTION_KEY, USER_TILE_ID, userTileBundle } from "./user-tile-bundle.js";

/** Where the rule that drives the user tile stands: the one a fresh document already holds. */
const kRulePath = "0/0";

/** Fixed-step thinks each rehearsal covers. */
const kThinks = 3;

/** The signal is scripted on for the whole run, so the rule fires every think. */
const kScenario = {
  seed: 20260812,
  subject: FAKE_SUBJECT,
  inputs: [{ kind: FAKE_INPUT_KIND, at: 0, value: true }],
};

/**
 * A workspace whose environment carries the compiled user bundle and whose one
 * rule senses the signal and drives the user actuator.
 */
function workspaceDrivingUserTile(): AuthoringWorkspace {
  const workspace = createAuthoringWorkspace(createTargetAdapter(), "user tile brain");
  workspace.environment.replaceActionBundle(userTileBundle());
  const ruleId = ruleIdAt(workspace.brainDef, kRulePath);
  for (const [side, tileId] of [
    ["when", `tile.sensor->${FakeActionKeys.Signal}`],
    ["do", USER_TILE_ID],
  ] as const) {
    const placed = proposeEdit(workspace, { op: "placeTile", ruleId, side, tileId });
    assert.equal(placed.ok, true, JSON.stringify(placed));
  }
  return workspace;
}

/** Rehearse `workspace`, carrying the bundle its environment holds. */
function rehearse(workspace: AuthoringWorkspace): Promise<SimulationRun> {
  const actionBundle = workspace.environment.appliedActionBundle();
  assert.ok(actionBundle, "the workspace environment reports the bundle it carries");
  return workspace.adapter.run({
    brainDef: workspace.brainDef,
    scenario: kScenario,
    thinks: kThinks,
    actionBundle,
  });
}

describe("a rehearsal of a document naming a compiled user tile", () => {
  test("records the user action's dispatches under the rule that made them", async () => {
    const workspace = workspaceDrivingUserTile();

    const run = await rehearse(workspace);

    const dispatches = run.observations.flatMap((think) =>
      think.dispatches.filter((dispatch) => dispatch.action === USER_TILE_ACTION_KEY)
    );
    assert.equal(dispatches.length, kThinks, "the user action dispatched on every think the rule fired");
    assert.deepEqual(
      [...new Set(dispatches.map((dispatch) => dispatch.ruleId))],
      [ruleIdAt(workspace.brainDef, kRulePath)]
    );
  });

  test("carries the user action into the summarized account", async () => {
    const workspace = workspaceDrivingUserTile();

    const summary = summarizeRun(await rehearse(workspace));

    const call = `${USER_TILE_ACTION_KEY}()`;
    assert.ok(
      summary.dispatchTotals.some((total) => total.startsWith(`${call}=`)),
      JSON.stringify(summary.dispatchTotals)
    );
    const rule = summary.rules.find((totals) => totals.ruleId === ruleIdAt(workspace.brainDef, kRulePath));
    assert.ok(rule, "the rule that drove the user action is accounted for");
    assert.ok(
      rule.dispatched.some((total) => total.startsWith(`${call}=`)),
      JSON.stringify(rule.dispatched)
    );
  });

  test("refuses the run when the request carries no bundle", async () => {
    const workspace = workspaceDrivingUserTile();

    await assert.rejects(
      workspace.adapter.run({ brainDef: workspace.brainDef, scenario: kScenario, thinks: kThinks }),
      (error: unknown) =>
        error instanceof RehearsalRejection &&
        error.code === RehearsalRejectionCode.TilesUnresolved &&
        error.unresolvedTiles.join(",") === USER_TILE_ID
    );
  });

  test("runs a document whose only unresolvable tile stands in an excluded rule", async () => {
    const workspace = workspaceDrivingUserTile();

    const run = await workspace.adapter.run({
      brainDef: workspace.brainDef,
      scenario: kScenario,
      thinks: kThinks,
      excludedRules: [ruleIdAt(workspace.brainDef, kRulePath)],
    });

    assert.equal(run.thinks, kThinks);
    assert.deepEqual(
      run.observations.flatMap((think) => think.dispatches.map((dispatch) => dispatch.action)),
      [],
      "an emptied rule reaches no gate and dispatches nothing"
    );
  });
});
