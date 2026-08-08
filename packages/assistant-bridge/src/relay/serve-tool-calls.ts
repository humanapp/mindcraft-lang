import type {
  RelayToolCallBatch,
  RelayToolCallRequest,
  RelayToolOutcome,
  RelayToolResult,
  RelayToolResultBatch,
} from "@mindcraft-lang/assistant-relay";
import { executeToolCall } from "../tools/dispatch.js";
import type { AuthoringWorkspace } from "../tools/workspace.js";

/** An answer the person's mediation gives a call in place of running it: `declined` or `takeover`. */
export type MediatedToolOutcome = Exclude<RelayToolOutcome, { kind: "ok" }>;

/**
 * Consulted before each call in a batch. Return an outcome to answer the call
 * without running it, or `undefined` to let it run; the call waits on the
 * returned promise.
 */
export type ToolCallMediator = (
  request: RelayToolCallRequest
) => Promise<MediatedToolOutcome | undefined> | MediatedToolOutcome | undefined;

/**
 * Serve one relay tool-call batch against `workspace` and return the batch of
 * correlated results, one per request, in request order. Calls run in order, so
 * two edits in one batch see each other's effects. A tool that refuses a call
 * reports through its own payload; only `mediate` produces an outcome other
 * than `ok`.
 */
export async function serveToolCalls(
  workspace: AuthoringWorkspace,
  batch: RelayToolCallBatch,
  mediate?: ToolCallMediator
): Promise<RelayToolResultBatch> {
  const results: RelayToolResult[] = [];
  for (const request of batch.requests) {
    const mediated = await mediate?.(request);
    if (mediated) {
      results.push({ requestId: request.requestId, outcome: mediated });
      continue;
    }
    const served = await executeToolCall(workspace, request.name, request.input);
    results.push({
      requestId: request.requestId,
      outcome: { kind: "ok", payload: served.payload, ...(served.isError ? { isError: true } : {}) },
    });
  }
  return { type: "turn:toolResults", results };
}
