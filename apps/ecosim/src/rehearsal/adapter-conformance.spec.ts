import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createAuthoringWorkspace, proposeEdit } from "@mindcraft-lang/assistant-bridge";
import { ConformanceCheckCode, checkAdapterConformance } from "@mindcraft-lang/assistant-bridge/kit";
import { ruleIdAt } from "@mindcraft-lang/assistant-bridge/testing";
import { createTargetAdapter } from "./adapter";
import { sourceRehearsalContent } from "./source-content";

/** Fixed steps each conformance run covers. */
const RUN_THINKS = 200;

/** The app's own assets, read from the tree these specs run in. */
const CONTENT = sourceRehearsalContent();

/** Scenario the conformance runs stage. */
const SCENARIO = { seed: 20260805, subject: "herbivore" };

/**
 * A workspace carrying one rule -- run away from a carnivore it can see -- and a
 * child rule under it that calls out on the same trigger.
 */
function authoredWorkspace() {
  const workspace = createAuthoringWorkspace(createTargetAdapter(CONTENT), "conformance brain");
  const parentRuleId = ruleIdAt(workspace.brainDef, "0/0");
  const when = proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: parentRuleId,
    side: "when",
    tileIds: ["tile.sensor->sensor.see", "tile.modifier->modifier.actor_kind.carnivore"],
  });
  assert.equal(when.ok, true, JSON.stringify(when));
  const doSide = proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: parentRuleId,
    side: "do",
    tileIds: [
      "tile.actuator->actuator.move",
      "tile.modifier->modifier.movement.awayfrom",
      "tile.literal->struct:<ActorRef>->it",
    ],
  });
  assert.equal(doSide.ok, true, JSON.stringify(doSide));
  const child = proposeEdit(workspace, { op: "addChildRule", parentRuleId });
  assert.equal(child.ok, true, JSON.stringify(child));
  const childRuleId = (child as { rule: { ruleId: string } }).rule.ruleId;
  const childDo = proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: childRuleId,
    side: "do",
    tileIds: ["tile.actuator->actuator.say", { tileId: "tile.lit.factory->string", value: "run" }],
  });
  assert.equal(childDo.ok, true, JSON.stringify(childDo));
  return { workspace, parentRuleId, childRuleId };
}

describe("the ecosim adapter against the bridge's conformance suite", () => {
  test("is deterministic, bounded, and observes the brain's rules", async () => {
    const { workspace } = authoredWorkspace();

    const report = await checkAdapterConformance({
      adapter: workspace.adapter,
      brainDef: workspace.brainDef,
      scenario: SCENARIO,
      thinks: RUN_THINKS,
    });

    for (const check of report.checks) {
      assert.equal(check.ok, true, `${check.code}: ${check.detail}`);
    }
    assert.deepEqual(
      report.checks.map((check) => check.code),
      [
        ConformanceCheckCode.Determinism,
        ConformanceCheckCode.Boundedness,
        ConformanceCheckCode.GateEvents,
        ConformanceCheckCode.ChildRuleObservation,
      ]
    );
    assert.equal(report.ok, true);
  });

  test("attributes what the creature under study dispatched, with the arguments it carried", async () => {
    const { workspace, parentRuleId, childRuleId } = authoredWorkspace();

    const run = await workspace.adapter.run({
      brainDef: workspace.brainDef,
      scenario: SCENARIO,
      thinks: RUN_THINKS,
    });

    const dispatches = run.observations.flatMap((think) => think.dispatches);
    assert.ok(dispatches.length > 0, "the creature under study dispatched host actions");
    const moves = dispatches.filter((dispatch) => dispatch.action === "actuator.move");
    assert.ok(moves.length > 0, "the creature moved");
    assert.ok(
      moves.some((move) => move.args.length > 0),
      "a move carries the arguments that say which way it went"
    );
    assert.ok(
      dispatches.every(
        (dispatch) =>
          dispatch.ruleId === undefined || dispatch.ruleId === parentRuleId || dispatch.ruleId === childRuleId
      ),
      "dispatches are attributed to the rule of the brain under study that made them"
    );
  });

  test("names the child rule as the one that called out", async () => {
    const { workspace, childRuleId } = authoredWorkspace();

    const run = await workspace.adapter.run({
      brainDef: workspace.brainDef,
      scenario: SCENARIO,
      thinks: RUN_THINKS,
    });

    const says = run.observations.flatMap((think) =>
      think.dispatches.filter((dispatch) => dispatch.action === "actuator.say")
    );
    assert.ok(says.length > 0, "the child rule ran");
    assert.deepEqual([...new Set(says.map((dispatch) => dispatch.ruleId))], [childRuleId]);
  });
});
