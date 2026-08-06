import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createAuthoringWorkspace, proposeEdit } from "@mindcraft-lang/assistant-bridge";
import { ConformanceCheckCode, checkAdapterConformance } from "@mindcraft-lang/assistant-bridge/kit";
import { createTargetAdapter } from "./adapter";

/** Fixed steps each conformance run covers. */
const RUN_THINKS = 200;

/** Scenario the conformance runs stage. */
const SCENARIO = { seed: 20260805, subject: "herbivore" };

/** A workspace carrying one rule: run away from a carnivore it can see. */
function authoredWorkspace() {
  const workspace = createAuthoringWorkspace(createTargetAdapter(), "conformance brain");
  const when = proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: "0/0",
    side: "when",
    tileIds: ["tile.sensor->sensor.see", "tile.modifier->modifier.actor_kind.carnivore"],
  });
  assert.equal(when.ok, true, JSON.stringify(when));
  const doSide = proposeEdit(workspace, {
    op: "placeTiles",
    ruleId: "0/0",
    side: "do",
    tileIds: [
      "tile.actuator->actuator.move",
      "tile.modifier->modifier.movement.awayfrom",
      "tile.literal->struct:<ActorRef>->it",
    ],
  });
  assert.equal(doSide.ok, true, JSON.stringify(doSide));
  return workspace;
}

describe("the ecosim adapter against the bridge's conformance suite", () => {
  test("is deterministic, bounded, and observes the brain's gates", async () => {
    const workspace = authoredWorkspace();

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
      [ConformanceCheckCode.Determinism, ConformanceCheckCode.Boundedness, ConformanceCheckCode.GateEvents]
    );
    assert.equal(report.ok, true);
  });

  test("attributes what the creature under study dispatched, with the arguments it carried", async () => {
    const workspace = authoredWorkspace();

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
      dispatches.every((dispatch) => dispatch.ruleId === undefined || dispatch.ruleId.startsWith("0/")),
      "dispatches are attributed to rules of the brain under study"
    );
  });
});
