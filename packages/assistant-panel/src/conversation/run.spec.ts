/**
 * Pins what one rehearsal account comes to as the timeline the transcript draws:
 * where the cells are cut, what each cell says about the rules that fired, held
 * and parked over it, how the calls it made are counted over its stretch, which
 * words of a call survive into what a reader is shown, and which cells open on a
 * change of the state the run stood in.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ConversationToolCall } from "@wendoo/assistant-relay";
import { runEvidence } from "./run";

/** One stretch of a rehearsal, as an account reports it. */
function span(from: number, thinks: number, think: Record<string, unknown>): Record<string, unknown> {
  return { from, thinks, think: { fired: [], when: [], dispatched: [], ...think } };
}

/** A rehearsal that ran and came back reporting `summary`. */
function rehearsed(summary: Record<string, unknown>): ConversationToolCall {
  return {
    name: "simulate",
    input: { scenario: { seed: 1, subject: "herbivore" }, thinks: 12 },
    outcome: {
      kind: "ok",
      payload: {
        ok: true,
        summary: {
          runId: "run-1",
          thinks: 12,
          rules: [],
          dispatchTotals: [],
          spansTruncated: false,
          identity: ["0 00000001"],
          world: { initialPopulation: 1, finalPopulation: 1, brainsExecuted: 1 },
          ...summary,
        },
      },
    },
  };
}

/** The timeline `summary` comes to, which every test in this file reads. */
function cellsOf(summary: Record<string, unknown>) {
  const evidence = runEvidence(rehearsed(summary));
  assert.ok(evidence, "the rehearsal came back with an account");
  return evidence.cells;
}

describe("what a cell of a run's timeline says about its stretch", () => {
  test("carries the rules whose gate passed over the stretch", () => {
    const cells = cellsOf({
      spans: [span(0, 12, { fired: ["rule-0"], when: ["rule-0=true", "rule-1=false"] })],
    });

    assert.deepEqual(
      cells.map((cell) => cell.fired),
      [["rule-0"]]
    );
  });

  test("reads the rules that reached their gate and did not pass as the ones it held on", () => {
    const cells = cellsOf({
      spans: [span(0, 12, { fired: ["rule-0"], when: ["rule-0=true", "rule-1=false", "rule-2=false"] })],
    });

    assert.deepEqual(cells[0]?.held, ["rule-1", "rule-2"]);
  });

  test("carries the rules parked on a call over the stretch", () => {
    const cells = cellsOf({ spans: [span(0, 12, { waiting: ["rule-3"] })] });

    assert.deepEqual(cells[0]?.waiting, ["rule-3"]);
  });

  test("counts a call the account reports per think over every think of the stretch", () => {
    const cells = cellsOf({
      spans: [
        span(0, 12, { fired: ["rule-0"], when: ["rule-0=true"], dispatched: ["actuator.move(toward=1,it)=1@rule-0"] }),
      ],
    });

    assert.deepEqual(cells[0]?.calls, [{ action: "actuator.move", args: ["toward", "it"], count: 12 }]);
  });

  test("merges calls that read the same way, however many rules made them", () => {
    const cells = cellsOf({
      spans: [
        span(0, 10, {
          fired: ["rule-0", "rule-1"],
          when: ["rule-0=true", "rule-1=true"],
          dispatched: ["actuator.move(toward=1,it)=1@rule-0", "actuator.move(toward=1,it)=2@rule-1"],
        }),
      ],
    });

    assert.deepEqual(cells[0]?.calls, [{ action: "actuator.move", args: ["toward", "it"], count: 30 }]);
  });

  test("counts a call over the piece of a stretch a state change cut, not the whole stretch", () => {
    const cells = cellsOf({
      spans: [span(0, 12, { fired: ["rule-0"], when: ["rule-0=true"], dispatched: ["actuator.move()=1@rule-0"] })],
      identity: ["0 00000001", "8 00000002"],
    });

    assert.deepEqual(
      cells.map((cell) => [cell.thinks, cell.calls[0]?.count]),
      [
        [8, 8],
        [4, 4],
      ]
    );
  });

  test("reads a call the account reports with no arguments at all", () => {
    const cells = cellsOf({ spans: [span(0, 4, { dispatched: ["microbit-v2.display-clear()=1@rule-0"] })] });

    assert.deepEqual(cells[0]?.calls, [{ action: "microbit-v2.display-clear", args: [], count: 4 }]);
  });

  test("keeps the arguments a call spelled in words and leaves out every one carrying a value", () => {
    const cells = cellsOf({
      spans: [
        span(0, 2, {
          dispatched: [
            'actuator.say(tile.parameter->anon.string="0.928",loudly=1)=1@rule-0',
            'microbit-v2.display-scroll("HELLO",in background=1)=1@rule-1',
          ],
        }),
      ],
    });

    assert.deepEqual(
      cells[0]?.calls.map((made) => made.args),
      [["loudly"], ["in background"]]
    );
  });

  test("names the channels a state change reported, and never what they reported", () => {
    const cells = cellsOf({
      spans: [span(0, 12, { fired: ["rule-0"], when: ["rule-0=true"] })],
      identity: ["0 00000001", "6 00000002"],
      state: ["0 display=0000000000", "6 display=0900009000", "6 speaker=hello"],
    });

    assert.deepEqual(
      cells.map((cell) => cell.changed),
      [undefined, ["display", "speaker"]]
    );
  });

  test("leaves the state the run opened in unmarked, having changed to nothing", () => {
    const cells = cellsOf({
      spans: [span(0, 12, {})],
      identity: ["0 00000001"],
      state: ["0 display=0000000000"],
    });

    assert.equal(cells[0]?.changed, undefined);
  });

  test("marks a state change the account reported no channel for", () => {
    const cells = cellsOf({
      spans: [span(0, 12, {})],
      identity: ["0 00000001", "6 00000002"],
      state: [],
    });

    assert.deepEqual(cells[1]?.changed, []);
  });
});
