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
    runId: "run-1",
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
        think: { fired: [], when: ["0/0=false"], dispatched: ["sensor.see()=1@0/0"] },
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

  test("names the rule behind each call in a think's own detail", () => {
    const observations: ThinkObservation[] = [
      {
        gates: [{ ruleId: "0/0", fired: true, result: "true" }],
        dispatches: [
          { action: "actuator.move", args: [], ruleId: "0/0" },
          { action: "actuator.move", args: [], ruleId: "0/0/0" },
          { action: "actuator.move", args: [] },
        ],
      },
    ];

    const summary = summarizeRun(run(observations));

    assert.deepEqual(summary.spans[0]?.think.dispatched, [
      "actuator.move()=1",
      "actuator.move()=1@0/0",
      "actuator.move()=1@0/0/0",
    ]);
    assert.deepEqual(summary.dispatchTotals, ["actuator.move()=3"], "the run totals stay attribution-free");
  });

  test("leaves a call that ends where it was made unadorned", () => {
    const observations: ThinkObservation[] = [
      {
        gates: [],
        dispatches: [{ action: "actuator.chime", args: [], ruleId: "0/0" }],
      },
    ];

    const summary = summarizeRun(run(observations));

    assert.deepEqual(summary.dispatchTotals, ["actuator.chime()=1"]);
  });

  test("renders a call's declared output, outcome, and how long it took", () => {
    const observations: ThinkObservation[] = [
      {
        gates: [],
        dispatches: [
          { action: "actuator.shoot", args: ["per/sec=8"], ruleId: "0/0", output: "shot fired=false" },
          { action: "actuator.ring", args: [], ruleId: "0/0", outcome: "resolved", settledAfter: 2 },
          { action: "actuator.ring", args: [], ruleId: "0/1", outcome: "pending" },
        ],
      },
    ];

    const summary = summarizeRun(run(observations));

    assert.deepEqual(summary.dispatchTotals, [
      "actuator.ring()[pending]=1",
      "actuator.ring()[resolved,+2]=1",
      "actuator.shoot(per/sec=8)[shot fired=false]=1",
    ]);
  });

  test("counts calls of one action apart when only their endings differ", () => {
    const observations: ThinkObservation[] = [
      {
        gates: [],
        dispatches: [
          { action: "actuator.ring", args: [], ruleId: "0/0" },
          { action: "actuator.ring", args: [], ruleId: "0/0", outcome: "pending" },
        ],
      },
    ];

    const summary = summarizeRun(run(observations));

    assert.deepEqual(summary.dispatchTotals, ["actuator.ring()=1", "actuator.ring()[pending]=1"]);
  });

  test("carries a think's waiting, quiesced, and page change into its span", () => {
    const observations: ThinkObservation[] = [
      { gates: [], dispatches: [], waiting: ["0/0"], quiesced: ["0/1"], pageSwitch: { from: 0, to: 2 } },
    ];

    const summary = summarizeRun(run(observations));

    assert.deepEqual(summary.spans[0]?.think.waiting, ["0/0"]);
    assert.deepEqual(summary.spans[0]?.think.quiesced, ["0/1"]);
    assert.equal(summary.spans[0]?.think.page, "0->2");
  });

  test("leaves a think in which nothing waited or switched pages carrying neither", () => {
    const summary = summarizeRun(run([think("0/0", true, "true")]));

    assert.equal(summary.spans[0]?.think.waiting, undefined);
    assert.equal(summary.spans[0]?.think.quiesced, undefined);
    assert.equal(summary.spans[0]?.think.page, undefined);
  });

  test("starts a new span where only what a rule is waiting on changes", () => {
    const observations: ThinkObservation[] = [
      { gates: [], dispatches: [] },
      { gates: [], dispatches: [], waiting: ["0/0"] },
      { gates: [], dispatches: [], waiting: ["0/0"] },
    ];

    const summary = summarizeRun(run(observations));

    assert.deepEqual(
      summary.spans.map((span) => [span.from, span.thinks]),
      [
        [0, 1],
        [1, 2],
      ]
    );
  });

  test("carries the world observation through unchanged", () => {
    const summary = summarizeRun(run([think("0/0", true, "true")]));

    assert.deepEqual(summary.world, { initialPopulation: 12, finalPopulation: 9, brainsExecuted: 3 });
  });

  test("addresses the account by the id of the run it summarizes", () => {
    const summary = summarizeRun({ ...run([think("0/0", true, "true")]), runId: "run-7" });

    assert.equal(summary.runId, "run-7");
  });

  test("starts a new span where only the page a think entered changes", () => {
    const observations: ThinkObservation[] = [
      { gates: [], dispatches: [], pageSwitch: { from: 0, to: 1 } },
      { gates: [], dispatches: [], pageSwitch: { from: 1, to: 2 } },
    ];

    const summary = summarizeRun(run(observations));

    assert.equal(summary.spans.length, 2);
  });

  test("starts a new span where only what a rule held from re-firing changes", () => {
    const observations: ThinkObservation[] = [
      { gates: [], dispatches: [], quiesced: ["0/0"] },
      { gates: [], dispatches: [], quiesced: ["0/1"] },
    ];

    const summary = summarizeRun(run(observations));

    assert.equal(summary.spans.length, 2);
  });

  test("keeps a state change out of the span key, so an animating channel compresses to one span", () => {
    const observations = Array.from(
      { length: 200 },
      (_, i): ThinkObservation => ({ ...think("0/0", true, "true", "actuator.show"), state: [`display=${i}`] })
    );

    const summary = summarizeRun(run(observations));

    assert.equal(summary.spans.length, 1);
    assert.equal(summary.spansTruncated, false);
    assert.deepEqual(summary.spans[0], {
      from: 0,
      thinks: 200,
      think: { fired: ["0/0"], when: ["0/0=true"], dispatched: ["actuator.show()=1@0/0"] },
    });
  });

  test("logs each state change under the think it fell on", () => {
    const observations: ThinkObservation[] = [
      { gates: [], dispatches: [], state: ["display=00000", "speaker=idle"] },
      { gates: [], dispatches: [] },
      { gates: [], dispatches: [], state: ["display=09990"] },
      { gates: [], dispatches: [], state: ["speaker=giggle#1"] },
    ];

    const summary = summarizeRun(run(observations));

    assert.deepEqual(summary.state, ["0 display=00000", "0 speaker=idle", "2 display=09990", "3 speaker=giggle#1"]);
    assert.equal(summary.stateTruncated, undefined);
  });

  test("leaves a run whose target reports no state carrying no change log", () => {
    const summary = summarizeRun(run([think("0/0", true, "true")]));

    assert.equal(summary.state, undefined);
    assert.equal(summary.stateTruncated, undefined);
  });

  test("cuts the change log at its budget when the display changes every think", () => {
    const busy = Array.from(
      { length: 200 },
      (_, i): ThinkObservation => ({ gates: [], dispatches: [], state: [`display=${i}`] })
    );

    const summary = summarizeRun(run(busy));

    assert.equal(summary.state?.length, 80);
    assert.equal(summary.stateTruncated, true);
    assert.equal(summary.state?.[0], "0 display=0");
    assert.equal(summary.state?.[79], "79 display=79");
  });
});

/** The think each entry of a state log falls on. */
function thinksOf(identities: readonly string[]): number[] {
  return identities.map((entry) => Number(entry.slice(0, entry.indexOf(" "))));
}

/** The hash each entry of a state log carries. */
function hashesOf(identities: readonly string[]): string[] {
  return identities.map((entry) => entry.slice(entry.indexOf(" ") + 1));
}

describe("the state a run stood in", () => {
  test("carries one entry for a run that never leaves the state it started in", () => {
    const summary = summarizeRun(run(Array.from({ length: 40 }, () => think("0/0", true, "true"))));

    assert.deepEqual(thinksOf(summary.identity), [0]);
    assert.equal(summary.identityTruncated, undefined);
  });

  test("logs the state again on each think it changed on, and on no other", () => {
    const observations: ThinkObservation[] = [
      { gates: [], dispatches: [], state: ["display=00000"] },
      { gates: [], dispatches: [] },
      { gates: [], dispatches: [], state: ["display=09990"] },
      { gates: [], dispatches: [] },
    ];

    const summary = summarizeRun(run(observations));

    assert.deepEqual(thinksOf(summary.identity), [0, 2]);
  });

  test("brings the first hash back when the run returns to a state it already stood in", () => {
    const observations: ThinkObservation[] = [
      { gates: [], dispatches: [], state: ["display=00000"] },
      { gates: [], dispatches: [], state: ["display=09990"] },
      { gates: [], dispatches: [], state: ["display=00000"] },
    ];

    const hashes = hashesOf(summarizeRun(run(observations)).identity);

    assert.equal(hashes.length, 3);
    assert.equal(hashes[0], hashes[2]);
    assert.notEqual(hashes[0], hashes[1]);
  });

  test("changes state where the brain changed page, whatever its channels did", () => {
    const observations: ThinkObservation[] = [
      { gates: [], dispatches: [] },
      { gates: [], dispatches: [], pageSwitch: { from: 0, to: 1 } },
      { gates: [], dispatches: [], pageSwitch: { from: 1, to: 0 } },
    ];

    const hashes = hashesOf(summarizeRun(run(observations)).identity);

    assert.deepEqual(thinksOf(summarizeRun(run(observations)).identity), [0, 1, 2]);
    assert.equal(hashes[0], hashes[2], "the page it came back to is the page it started on");
  });

  test("holds one state for a run that reports nothing and never changes page", () => {
    const summary = summarizeRun(run([think("0/0", true, "true"), think("0/0", false, "false")]));

    assert.deepEqual(thinksOf(summary.identity), [0]);
  });

  test("takes what a channel declares it contributes over the value it reported", () => {
    const observations: ThinkObservation[] = [
      { gates: [], dispatches: [], state: ["speaker=giggle#1"] },
      { gates: [], dispatches: [], state: ["speaker=giggle#2"] },
      { gates: [], dispatches: [], state: ["speaker=idle"] },
    ];
    const stateChannels = [
      {
        name: "speaker",
        description: "the sound playing",
        identityValue: (reported: string) => reported.split("#")[0] ?? reported,
      },
    ];

    const derived = hashesOf(summarizeRun(run(observations), { stateChannels }).identity);
    const raw = hashesOf(summarizeRun(run(observations)).identity);

    assert.equal(derived.length, 2, "the counter alone does not change the state");
    assert.equal(raw.length, 3, "the counter alone changes the value reported");
    assert.deepEqual(thinksOf(summarizeRun(run(observations), { stateChannels }).identity), [0, 2]);
  });

  test("leaves a channel declaring no contribution reporting its own value", () => {
    const observations: ThinkObservation[] = [
      { gates: [], dispatches: [], state: ["display=00000"] },
      { gates: [], dispatches: [], state: ["display=09990"] },
    ];
    const stateChannels = [{ name: "display", description: "the screen" }];

    assert.equal(summarizeRun(run(observations), { stateChannels }).identity.length, 2);
  });

  test("cuts the log at its budget when the state changes every think", () => {
    const busy = Array.from(
      { length: 200 },
      (_, i): ThinkObservation => ({ gates: [], dispatches: [], state: [`display=${i}`] })
    );

    const summary = summarizeRun(run(busy));

    assert.equal(summary.identity.length, 80);
    assert.equal(summary.identityTruncated, true);
    assert.deepEqual(thinksOf(summary.identity).slice(0, 3), [0, 1, 2]);
  });
});
