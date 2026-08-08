import { z } from "zod";

/**
 * Correlation id of one tool call, unique within its session. The side issuing
 * the request allocates it, and the answer carries it back.
 */
export type RelayRequestId = string;

/** One tool call the service asks the client to serve. */
export interface RelayToolCallRequest {
  readonly requestId: RelayRequestId;
  /** Bridge tool name, as the model produced it. */
  readonly name: string;
  /** Raw input as the model produced it; the bridge's own schema validates it. */
  readonly input: unknown;
  /**
   * Milliseconds the service waits for this one call's answer, measured from
   * when the batch was sent. A call still unanswered at the deadline is not
   * retried: the turn fails.
   */
  readonly timeoutMs: number;
}

/** Schema of {@link RelayToolCallRequest}. */
export const relayToolCallRequestSchema = z.strictObject({
  requestId: z.string().min(1),
  name: z.string().min(1),
  input: z.unknown(),
  timeoutMs: z.number().int().positive(),
});

/** Why the client did not run a call. */
export const RelayDeclineCode = {
  /** The person stopped the turn. */
  UserStopped: "user_stopped",
} as const;

/** Why the client did not run a call. */
export type RelayDeclineCode = (typeof RelayDeclineCode)[keyof typeof RelayDeclineCode];

/** What the person did to the document while a call was in flight. */
export const RelayTakeoverCode = {
  /** The person edited the document themselves. */
  DocumentEdited: "document_edited",
} as const;

/** What the person did to the document while a call was in flight. */
export type RelayTakeoverCode = (typeof RelayTakeoverCode)[keyof typeof RelayTakeoverCode];

/**
 * One call's answer: what the tool returned, or the person's mediation in its
 * place. A declined or taken-over call ran nothing, and the document is exactly
 * as the call found it.
 */
export type RelayToolOutcome =
  | {
      readonly kind: "ok";
      /** JSON-serializable payload the bridge tool returned, carried across unchanged. */
      readonly payload: unknown;
      /** `true` when the bridge could not serve the call at all and `payload` states why. */
      readonly isError?: boolean;
    }
  | { readonly kind: "declined"; readonly code: RelayDeclineCode }
  | { readonly kind: "takeover"; readonly code: RelayTakeoverCode };

/** Schema of {@link RelayToolOutcome}. */
export const relayToolOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ok"), payload: z.unknown(), isError: z.boolean().optional() }),
  z.strictObject({ kind: z.literal("declined"), code: z.enum(RelayDeclineCode) }),
  z.strictObject({ kind: z.literal("takeover"), code: z.enum(RelayTakeoverCode) }),
]);

/** One {@link RelayToolOutcome} bound to the request it answers. */
export interface RelayToolResult {
  readonly requestId: RelayRequestId;
  readonly outcome: RelayToolOutcome;
}

/** Schema of {@link RelayToolResult}. */
export const relayToolResultSchema = z.strictObject({
  requestId: z.string().min(1),
  outcome: relayToolOutcomeSchema,
});

/** Why a result batch does not answer the requests it was sent for. */
export const RelayCorrelationErrorCode = {
  /** One or more requests got no result. */
  MissingResult: "missing_result",
  /** The batch answered a request id it was not asked for. */
  UnknownRequest: "unknown_request",
  /** The batch answered one request more than once. */
  DuplicateResult: "duplicate_result",
} as const;

/** Why a result batch does not answer the requests it was sent for. */
export type RelayCorrelationErrorCode = (typeof RelayCorrelationErrorCode)[keyof typeof RelayCorrelationErrorCode];

/** A result batch matched to its requests, or the first way it does not match them. */
export type RelayCorrelation =
  | { readonly ok: true; readonly results: readonly RelayToolResult[] }
  | {
      readonly ok: false;
      readonly code: RelayCorrelationErrorCode;
      /** The request ids the code is about. */
      readonly requestIds: readonly RelayRequestId[];
    };

/**
 * Match `results` to `requests` by request id and return them in request order.
 * Results may arrive in any order, and every request must be answered exactly
 * once; a batch that answers otherwise comes back as a correlation error.
 */
export function correlateToolResults(
  requests: readonly RelayToolCallRequest[],
  results: readonly RelayToolResult[]
): RelayCorrelation {
  const byId = new Map<RelayRequestId, RelayToolResult>();
  const duplicates: RelayRequestId[] = [];
  for (const result of results) {
    if (byId.has(result.requestId)) duplicates.push(result.requestId);
    else byId.set(result.requestId, result);
  }
  if (duplicates.length > 0) {
    return { ok: false, code: RelayCorrelationErrorCode.DuplicateResult, requestIds: duplicates };
  }

  const asked = new Set(requests.map((request) => request.requestId));
  const unknown = [...byId.keys()].filter((requestId) => !asked.has(requestId));
  if (unknown.length > 0) {
    return { ok: false, code: RelayCorrelationErrorCode.UnknownRequest, requestIds: unknown };
  }

  const missing = requests.filter((request) => !byId.has(request.requestId)).map((request) => request.requestId);
  if (missing.length > 0) {
    return { ok: false, code: RelayCorrelationErrorCode.MissingResult, requestIds: missing };
  }

  return { ok: true, results: requests.map((request) => byId.get(request.requestId)!) };
}
