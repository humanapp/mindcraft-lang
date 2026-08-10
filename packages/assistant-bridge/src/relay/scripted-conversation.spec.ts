import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RelayLoopback } from "@mindcraft-lang/assistant-relay/testing";
import { createRelayLoopback } from "@mindcraft-lang/assistant-relay/testing";
import { createTargetAdapter, FAKE_SUBJECT, ruleIdAt } from "../testing/index.js";
import { executeToolCall } from "../tools/dispatch.js";
import type { AuthoringWorkspace } from "../tools/workspace.js";
import { createAuthoringWorkspace } from "../tools/workspace.js";
import { serveToolCalls } from "./serve-tool-calls.js";

/** Tiles the fake target's brains are authored from. */
const tiles = {
  sensor: "tile.sensor->sensor.fake.signal",
  actuator: "tile.actuator->actuator.fake.emit",
  modifier: "tile.modifier->modifier:fake.loudly",
  parameter: "tile.parameter->parameter:fake.strength",
  numberFactory: "tile.lit.factory->number",
} as const;

/** One call of the scripted turn. */
interface ScriptedCall {
  readonly name: string;
  readonly input: unknown;
}

/** One model step: what it narrates, then the batch it ends in. */
interface ScriptedStep {
  readonly narration: string;
  readonly calls: readonly ScriptedCall[];
}

/**
 * The document both runs of the turn open on: one empty rule, taken from one
 * workspace so every generated identity in it is shared.
 */
const openingDocument = createAuthoringWorkspace(createTargetAdapter(), "fake brain").brainDef.toJson();

/** Id of the one rule {@link openingDocument} holds, which the turn authors. */
const openingRuleId = ruleIdAt(
  createAuthoringWorkspace(createTargetAdapter(), "fake brain", { brainJson: openingDocument }).brainDef,
  "0/0"
);

/** Milliseconds a request in this turn allows for its answer. */
const timeoutMs = 15000;

/** A whole turn: read the world, plan a rule, author it, then verify it runs. */
const script: readonly ScriptedStep[] = [
  {
    narration: "reading what is here",
    calls: [
      { name: "read_project", input: {} },
      { name: "read_catalog", input: { filter: "signal" } },
    ],
  },
  {
    narration: "checking what may open the WHEN",
    calls: [{ name: "suggest_tiles", input: { mode: "insert", ruleId: openingRuleId, side: "when" } }],
  },
  {
    narration: "writing the rule",
    calls: [
      {
        name: "propose_edit",
        input: { op: "placeTiles", ruleId: openingRuleId, side: "when", tileIds: [tiles.sensor] },
      },
      {
        name: "propose_edit",
        input: {
          op: "placeTiles",
          ruleId: openingRuleId,
          side: "do",
          tileIds: [tiles.actuator, tiles.modifier, tiles.parameter, { tileId: tiles.numberFactory, value: 7 }],
        },
      },
    ],
  },
  {
    narration: "making sure it builds and runs",
    calls: [
      { name: "compile", input: {} },
      { name: "simulate", input: { scenario: { seed: 20260805, subject: FAKE_SUBJECT }, thinks: 30 } },
    ],
  },
];

/** A workspace over the fake target, opened on {@link openingDocument}. */
function workspace(): AuthoringWorkspace {
  return createAuthoringWorkspace(createTargetAdapter(), "fake brain", { brainJson: openingDocument });
}

/** `value` as it comes back off the wire. */
function overTheWire(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Drive the turn from the service's end and return every payload the tool
 * server answered with, in call order.
 */
async function runTurn(loopback: RelayLoopback): Promise<unknown[]> {
  const payloads: unknown[] = [];
  loopback.service.send({ type: "turn:start" });
  for (const step of script) {
    loopback.service.send({ type: "turn:narration", text: step.narration });
    loopback.service.send({
      type: "turn:toolCalls",
      requests: step.calls.map((call, index) => ({ requestId: `${step.narration}#${index}`, ...call, timeoutMs })),
    });
    const answered = await loopback.service.next();
    assert.equal(answered.type, "turn:toolResults");
    for (const result of answered.results) {
      assert.equal(result.outcome.kind, "ok");
      payloads.push(result.outcome.payload);
    }
  }
  loopback.service.send({ type: "turn:end", code: "complete" });
  return payloads;
}

/** Serve the turn from the client's end and return the downstream types it saw. */
async function runToolServer(loopback: RelayLoopback, ws: AuthoringWorkspace): Promise<string[]> {
  const seen: string[] = [];
  for (;;) {
    const message = await loopback.toolServer.next();
    seen.push(message.type);
    if (message.type === "turn:toolCalls") loopback.toolServer.send(await serveToolCalls(ws, message));
    if (message.type === "turn:end") return seen;
  }
}

/** Run the same script directly against `ws` and return every payload, in call order. */
async function runInProcess(ws: AuthoringWorkspace): Promise<unknown[]> {
  const payloads: unknown[] = [];
  for (const step of script) {
    for (const call of step.calls) {
      payloads.push((await executeToolCall(ws, call.name, call.input)).payload);
    }
  }
  return payloads;
}

describe("a whole scripted turn over the relay", () => {
  test("carries every tool's result across exactly as running it in process produces it", async () => {
    const loopback = createRelayLoopback();

    const [relayed, seen] = await Promise.all([runTurn(loopback), runToolServer(loopback, workspace())]);
    const inProcess = await runInProcess(workspace());

    assert.deepEqual(relayed, inProcess.map(overTheWire));
    assert.deepEqual(seen, [
      "turn:start",
      "turn:narration",
      "turn:toolCalls",
      "turn:narration",
      "turn:toolCalls",
      "turn:narration",
      "turn:toolCalls",
      "turn:narration",
      "turn:toolCalls",
      "turn:end",
    ]);
  });

  test("ends the turn on a brain that builds and fires the rule it authored", async () => {
    const loopback = createRelayLoopback();

    const [relayed] = await Promise.all([runTurn(loopback), runToolServer(loopback, workspace())]);

    const compiled = relayed.at(-2) as { ok: boolean; diagnostics: unknown[] };
    const simulated = relayed.at(-1) as { ok: boolean; summary: { rules: unknown[]; dispatchTotals: string[] } };
    assert.deepEqual(compiled, { ok: true, diagnostics: [] });
    assert.equal(simulated.summary.rules.length, 1);
    assert.ok(
      simulated.summary.dispatchTotals.some((entry) => entry.startsWith("actuator.fake.emit(")),
      simulated.summary.dispatchTotals.join(" ")
    );
  });
});
