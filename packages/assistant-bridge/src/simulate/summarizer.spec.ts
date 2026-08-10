import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { SimulationRun, ThinkObservation } from "../target/adapter.js";
import { summarizeRun } from "./summarizer.js";

/** A think in which `ruleId` reached its gate with `result`, dispatching `actions`. */
function think(ruleId: string, fired: boolean, result: string, ...actions: string[]): ThinkObservation {
  return {
    gates: [{ ruleId, fired, result }],
    dispatches: actions.map((action) => ({ action, args: [], ruleId })),
  };
}

function run(observations: readonly ThinkObservation[]): SimulationRun {
  return {
    thinks: observations.length,
    observations,
    world: { initialPopulation: 12, finalPopulation: 9, brainsExecuted: 3 },
  };
}

describe("trace summary", () => {
  test("compresses a run of identical thinks into one span", () => {
    const idle = Array.from({ length: 200 }, () => think("0/0", false, "false", "sensor.see"));

    const summary = summarizeRun(run(idle));

    assert.equal(summary.thinks, 200);
    assert.deepEqual(summary.spans, [
      {
        from: 0,
        thinks: 200,
        think: { fired: [], when: ["0/0=false"], dispatched: ["sensor.see()=1"] },
      },
    ]);
  });

  test("starts a new span where the think changes", () => {
    const observations = [
      ...Array.from({ length: 3 }, () => think("0/0", false, "false", "sensor.see")),
      ...Array.from({ length: 2 }, () => think("0/0", true, "true", "sensor.see", "actuator.move")),
    ];

    const summary = summarizeRun(run(observations));

    assert.equal(summary.spans.length, 2);
    assert.deepEqual(
      summary.spans.map((span) => [span.from, span.thinks]),
      [
        [0, 3],
        [3, 2],
      ]
    );
    assert.deepEqual(summary.spans[1]?.think.fired, ["0/0"]);
  });

  test("totals gates and dispatches over the whole run", () => {
    const observations = [
      think("0/0", false, "false", "sensor.see"),
      think("0/0", true, "true", "sensor.see", "actuator.move"),
      think("0/0", true, "true", "sensor.see", "actuator.move", "actuator.move"),
    ];

    const summary = summarizeRun(run(observations));

    assert.deepEqual(summary.rules, [
      {
        ruleId: "0/0",
        evaluated: 3,
        fired: 2,
        whenResults: ["false", "true"],
        dispatched: ["actuator.move()=3", "sensor.see()=3"],
      },
    ]);
    assert.deepEqual(summary.dispatchTotals, ["actuator.move()=3", "sensor.see()=3"]);
  });

  test("accounts for a rule that dispatched without reaching a gate", () => {
    const observations: ThinkObservation[] = [
      {
        gates: [{ ruleId: "0/0", fired: true, result: "true" }],
        dispatches: [
          { action: "sensor.see", args: [], ruleId: "0/0" },
          { action: "actuator.move", args: [], ruleId: "0/0/0" },
        ],
      },
    ];

    const summary = summarizeRun(run(observations));

    assert.deepEqual(summary.rules, [
      { ruleId: "0/0", evaluated: 1, fired: 1, whenResults: ["true"], dispatched: ["sensor.see()=1"] },
      { ruleId: "0/0/0", dispatched: ["actuator.move()=1"] },
    ]);
  });

  test("leaves a dispatch the runtime could not attribute out of the per-rule totals", () => {
    const observations: ThinkObservation[] = [
      {
        gates: [{ ruleId: "0/0", fired: true, result: "true" }],
        dispatches: [{ action: "actuator.move", args: [] }],
      },
    ];

    const summary = summarizeRun(run(observations));

    assert.deepEqual(summary.rules, [{ ruleId: "0/0", evaluated: 1, fired: 1, whenResults: ["true"], dispatched: [] }]);
    assert.deepEqual(summary.dispatchTotals, ["actuator.move()=1"]);
  });

  test("counts calls of one action apart when their arguments differ", () => {
    const observations: ThinkObservation[] = [
      {
        gates: [{ ruleId: "0/0", fired: true, result: "true" }],
        dispatches: [
          { action: "actuator.move", args: ["toward=1"], ruleId: "0/0" },
          { action: "actuator.move", args: ["awayFrom=1"], ruleId: "0/0" },
          { action: "actuator.move", args: ["toward=1"], ruleId: "0/0" },
        ],
      },
    ];

    const summary = summarizeRun(run(observations));

    assert.deepEqual(summary.dispatchTotals, ["actuator.move(awayFrom=1)=1", "actuator.move(toward=1)=2"]);
  });

  test("keeps rules in the order they first reached a gate", () => {
    const observations: ThinkObservation[] = [
      {
        gates: [
          { ruleId: "0/1", fired: true, result: "true" },
          { ruleId: "0/0", fired: false, result: "false" },
        ],
        dispatches: [],
      },
    ];

    const summary = summarizeRun(run(observations));

    assert.deepEqual(
      summary.rules.map((rule) => rule.ruleId),
      ["0/1", "0/0"]
    );
  });

  test("marks the summary truncated when the run outgrows the span budget", () => {
    const alternating = Array.from({ length: 400 }, (_, i) => think("0/0", i % 2 === 0, String(i % 2 === 0)));

    const summary = summarizeRun(run(alternating));

    assert.equal(summary.spansTruncated, true);
    assert.ok(summary.spans.length < 400, "the summary stops at the span budget");
    assert.equal(summary.rules[0]?.evaluated, 400, "totals still cover the whole run");
  });

  test("stays within a few kilobytes on a long, busy run", () => {
    const busy = Array.from({ length: 2000 }, (_, i) =>
      think("0/0", i % 3 === 0, `n:${i % 7}`, "sensor.see", "actuator.move")
    );

    const summary = summarizeRun(run(busy));

    assert.ok(JSON.stringify(summary).length < 16000, "the summary fits a tool result");
  });

  test("carries the world observation through unchanged", () => {
    const summary = summarizeRun(run([think("0/0", true, "true")]));

    assert.deepEqual(summary.world, { initialPopulation: 12, finalPopulation: 9, brainsExecuted: 3 });
  });
});
