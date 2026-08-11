import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RelayToolCallRequest, RelayToolResult } from "@mindcraft-lang/assistant-relay";
import { correlateToolResults, RelayDeclineCode, RelayTakeoverCode } from "@mindcraft-lang/assistant-relay";
import { createRelayLoopback, RelayLoopbackClosed } from "@mindcraft-lang/assistant-relay/testing";
import { createTargetAdapter, ruleIdAt } from "../testing/index.js";
import type { ToolCallError } from "../tools/dispatch.js";
import { ToolCallErrorCode } from "../tools/dispatch.js";
import { readProject } from "../tools/read-project.js";
import type { AuthoringWorkspace } from "../tools/workspace.js";
import { createAuthoringWorkspace } from "../tools/workspace.js";
import { serveToolCalls, unservedToolResults } from "./serve-tool-calls.js";

/** Tiles the fake target's brains are authored from. */
const tiles = {
  sensor: "tile.sensor->sensor.fake.signal",
  actuator: "tile.actuator->actuator.fake.emit",
} as const;

/** A workspace over the fake target, one empty rule ready at `0/0`. */
function workspace(): AuthoringWorkspace {
  return createAuthoringWorkspace(createTargetAdapter(), "fake brain");
}

/** Milliseconds a request in these batches allows for its answer. */
const timeoutMs = 15000;

/** A request batch of `calls`, one request id per entry. */
function requests(...calls: readonly { name: string; input: unknown }[]): RelayToolCallRequest[] {
  return calls.map((call, index) => ({ requestId: `r${index}`, ...call, timeoutMs }));
}

/** The `ok` payload `result` carries, or the outcome that answered it. */
function payloadOf(result: RelayToolResult): unknown {
  return result.outcome.kind === "ok" ? result.outcome.payload : result.outcome;
}

describe("serving a relay tool-call batch", () => {
  test("answers every call in the batch, however the results travel back", async () => {
    const loopback = createRelayLoopback();
    const ws = workspace();
    const batch = requests(
      { name: "read_project", input: {} },
      { name: "read_catalog", input: { filter: "signal" } },
      { name: "compile", input: {} }
    );

    loopback.service.send({ type: "turn:toolCalls", requests: batch });
    const asked = await loopback.toolServer.next();
    assert.equal(asked.type, "turn:toolCalls");
    const served = await serveToolCalls(ws, asked);
    loopback.toolServer.send({ type: "turn:toolResults", results: [...served.results].reverse() });

    const answered = await loopback.service.next();
    assert.equal(answered.type, "turn:toolResults");
    const correlation = correlateToolResults(batch, answered.results);
    assert.equal(correlation.ok, true);
    assert.deepEqual(
      correlation.results.map((result) => result.requestId),
      ["r0", "r1", "r2"]
    );
    assert.ok(Array.isArray((payloadOf(correlation.results[0]!) as { pages: unknown }).pages));
    assert.deepEqual(payloadOf(correlation.results[2]!), { ok: true, diagnostics: [] });
  });

  test("answers a declined call without running it", async () => {
    const ws = workspace();
    const batch = requests(
      {
        name: "propose_edit",
        input: { op: "placeTiles", ruleId: ruleIdAt(ws.brainDef, "0/0"), side: "when", tileIds: [tiles.sensor] },
      },
      {
        name: "propose_edit",
        input: { op: "placeTiles", ruleId: ruleIdAt(ws.brainDef, "0/0"), side: "do", tileIds: [tiles.actuator] },
      }
    );

    const served = await serveToolCalls(ws, { type: "turn:toolCalls", requests: batch }, (request) =>
      request.requestId === "r1" ? { kind: "declined", code: RelayDeclineCode.UserStopped } : undefined
    );

    assert.deepEqual(served.results[1], {
      requestId: "r1",
      outcome: { kind: "declined", code: RelayDeclineCode.UserStopped },
    });
    assert.deepEqual(readProject(ws).pages[0]?.rules[0]?.do, [], "the declined edit ran nothing");
    assert.equal(ws.history.undoDepth(), 1, "only the served edit is in the history");
  });

  test("answers a taken-over call without running it", async () => {
    const ws = workspace();
    const batch = requests({
      name: "propose_edit",
      input: { op: "placeTiles", ruleId: ruleIdAt(ws.brainDef, "0/0"), side: "when", tileIds: [tiles.sensor] },
    });

    const served = await serveToolCalls(ws, { type: "turn:toolCalls", requests: batch }, () => ({
      kind: "takeover",
      code: RelayTakeoverCode.DocumentEdited,
    }));

    assert.deepEqual(served.results, [
      { requestId: "r0", outcome: { kind: "takeover", code: RelayTakeoverCode.DocumentEdited } },
    ]);
    assert.deepEqual(readProject(ws).pages[0]?.rules[0]?.when, [], "the taken-over call ran nothing");
    assert.equal(ws.history.undoDepth(), 0);
  });

  test("carries a mediated outcome back over the wire as the envelope it is", async () => {
    const loopback = createRelayLoopback();
    const ws = workspace();
    const batch = requests({ name: "read_project", input: {} });

    loopback.service.send({ type: "turn:toolCalls", requests: batch });
    const asked = await loopback.toolServer.next();
    assert.equal(asked.type, "turn:toolCalls");
    loopback.toolServer.send(
      await serveToolCalls(ws, asked, () => ({ kind: "declined", code: RelayDeclineCode.UserStopped }))
    );

    const answered = await loopback.service.next();
    assert.equal(answered.type, "turn:toolResults");
    assert.deepEqual(answered.results, [
      { requestId: "r0", outcome: { kind: "declined", code: RelayDeclineCode.UserStopped } },
    ]);
  });

  test("leaves nothing half-applied when the tool server goes away mid-batch", async () => {
    const loopback = createRelayLoopback();
    const ws = workspace();
    const batch = requests(
      {
        name: "propose_edit",
        input: { op: "placeTiles", ruleId: ruleIdAt(ws.brainDef, "0/0"), side: "when", tileIds: [tiles.sensor] },
      },
      {
        name: "propose_edit",
        input: { op: "placeTiles", ruleId: ruleIdAt(ws.brainDef, "0/0"), side: "do", tileIds: [tiles.actuator] },
      }
    );

    loopback.service.send({ type: "turn:toolCalls", requests: batch });
    const awaited = loopback.service.next();
    const asked = await loopback.toolServer.next();
    assert.equal(asked.type, "turn:toolCalls");
    const partial = await serveToolCalls(ws, { type: "turn:toolCalls", requests: asked.requests.slice(0, 1) });
    loopback.toolServer.close();

    await assert.rejects(awaited, RelayLoopbackClosed, "the batch the turn waited on cannot resolve");
    assert.throws(() => loopback.toolServer.send(partial), RelayLoopbackClosed, "no partial batch reaches the service");
    const rule = readProject(ws).pages[0]?.rules[0];
    assert.deepEqual(
      rule?.when.map((tile) => tile.tileId),
      [tiles.sensor],
      "the call that completed applied"
    );
    assert.deepEqual(rule?.do, [], "the call that never ran applied nothing");
    assert.equal(ws.history.undoDepth(), 1, "the document rests on one undoable edit");
  });
});

describe("answering a batch that could not be served at all", () => {
  test("answers every request the batch asked, correlated one for one", () => {
    const batch = requests({ name: "read_project", input: {} }, { name: "compile", input: {} });

    const unserved = unservedToolResults({ type: "turn:toolCalls", requests: batch });

    const correlation = correlateToolResults(batch, unserved.results);
    assert.equal(correlation.ok, true);
    assert.equal(unserved.type, "turn:toolResults");
    for (const result of unserved.results) {
      assert.ok(result.outcome.kind === "ok", "the answer is an outcome the wire carries");
      assert.equal(result.outcome.isError, true);
      assert.equal((result.outcome.payload as ToolCallError).error, ToolCallErrorCode.ServingFailed);
    }
  });
});
