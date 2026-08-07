import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RelayToolCallRequest, RelayToolResult } from "./tool-calls.js";
import { correlateToolResults, RelayCorrelationErrorCode } from "./tool-calls.js";

/** A request batch of `names`, one request id per entry. */
function requests(...names: readonly string[]): RelayToolCallRequest[] {
  return names.map((name, index) => ({ requestId: `r${index}`, name, input: {}, timeoutMs: 15000 }));
}

/** An `ok` result for `requestId` carrying `payload`. */
function answered(requestId: string, payload: unknown): RelayToolResult {
  return { requestId, outcome: { kind: "ok", payload } };
}

describe("relay tool-call correlation", () => {
  test("returns results in request order however they arrive", () => {
    const batch = requests("read_project", "read_catalog", "suggest_tiles");

    const correlation = correlateToolResults(batch, [
      answered("r2", "third"),
      answered("r0", "first"),
      answered("r1", "second"),
    ]);

    assert.equal(correlation.ok, true);
    assert.deepEqual(
      correlation.results.map((result) => result.requestId),
      ["r0", "r1", "r2"]
    );
    assert.deepEqual(
      correlation.results.map((result) => (result.outcome.kind === "ok" ? result.outcome.payload : undefined)),
      ["first", "second", "third"]
    );
  });

  test("reports the requests a short batch left unanswered", () => {
    const batch = requests("read_project", "compile", "simulate");

    const correlation = correlateToolResults(batch, [answered("r1", null)]);

    assert.equal(correlation.ok, false);
    assert.equal(correlation.code, RelayCorrelationErrorCode.MissingResult);
    assert.deepEqual(correlation.requestIds, ["r0", "r2"]);
  });

  test("reports a result for a request the batch never asked", () => {
    const batch = requests("read_project");

    const correlation = correlateToolResults(batch, [answered("r0", null), answered("r9", null)]);

    assert.equal(correlation.ok, false);
    assert.equal(correlation.code, RelayCorrelationErrorCode.UnknownRequest);
    assert.deepEqual(correlation.requestIds, ["r9"]);
  });

  test("reports a request answered more than once", () => {
    const batch = requests("read_project", "compile");

    const correlation = correlateToolResults(batch, [answered("r0", null), answered("r0", null), answered("r1", null)]);

    assert.equal(correlation.ok, false);
    assert.equal(correlation.code, RelayCorrelationErrorCode.DuplicateResult);
    assert.deepEqual(correlation.requestIds, ["r0"]);
  });
});
