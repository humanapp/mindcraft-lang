import { z } from "zod";
import type { RelayConnect, RelayConnectAccepted, RelayConnectRefused } from "./session.js";
import { RelayRefusalCode, relayToolManifestSchema } from "./session.js";
import type { RelayToolCallRequest, RelayToolResult } from "./tool-calls.js";
import { relayToolCallRequestSchema, relayToolResultSchema } from "./tool-calls.js";

/**
 * A model turn has begun. Narration, tool-call batches, and finally one
 * {@link RelayTurnEnd} follow it; a session runs one turn at a time.
 */
export interface RelayTurnStart {
  readonly type: "turn:start";
}

/** One fragment of the assistant's narration, in stream order. */
export interface RelayNarrationDelta {
  readonly type: "turn:narration";
  readonly text: string;
}

/** The tool calls the turn's current model step asked for, to be served as one batch. */
export interface RelayToolCallBatch {
  readonly type: "turn:toolCalls";
  readonly requests: readonly RelayToolCallRequest[];
}

/** How a turn ended. */
export const RelayTurnEndCode = {
  /** The assistant finished its answer. */
  Complete: "complete",
  /** A stop from the person ended the turn. */
  Stopped: "stopped",
  /**
   * The assistant broke off mid-answer and there is no more of it coming. What
   * it narrated and applied before breaking off stands; the person may ask
   * again.
   */
  Truncated: "truncated",
  /**
   * The service could not carry the turn to an answer. The document rests at
   * the last edit a tool call applied, valid and undoable.
   */
  Failed: "failed",
} as const;

/** How a turn ended. */
export type RelayTurnEndCode = (typeof RelayTurnEndCode)[keyof typeof RelayTurnEndCode];

/** The turn is over; no further narration or tool call belongs to it. */
export interface RelayTurnEnd {
  readonly type: "turn:end";
  readonly code: RelayTurnEndCode;
  /** Human-readable context; the code is the contract. */
  readonly message?: string;
}

/** The client's answers to one {@link RelayToolCallBatch}, in any order. */
export interface RelayToolResultBatch {
  readonly type: "turn:toolResults";
  readonly results: readonly RelayToolResult[];
}

/** Something the person said, which starts a turn. */
export interface RelayUserMessage {
  readonly type: "session:userMessage";
  readonly text: string;
}

/** The person asked the turn in flight to stop. */
export interface RelayStop {
  readonly type: "turn:stop";
}

/** Every message the service sends the client over a relay session. */
export type RelayDownstreamMessage =
  | RelayConnectAccepted
  | RelayConnectRefused
  | RelayTurnStart
  | RelayNarrationDelta
  | RelayToolCallBatch
  | RelayTurnEnd;

/**
 * Every message the client sends the service over a relay session: the connect,
 * tool results, a user message, and a stop.
 */
export type RelayUpstreamMessage = RelayConnect | RelayToolResultBatch | RelayUserMessage | RelayStop;

/** Schema of {@link RelayDownstreamMessage}. */
export const relayDownstreamMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("session:accepted"), sessionId: z.string().min(1) }),
  z.strictObject({
    type: z.literal("session:refused"),
    code: z.enum(RelayRefusalCode),
    protocolVersion: z.number().int().positive(),
    message: z.string().optional(),
  }),
  z.strictObject({ type: z.literal("turn:start") }),
  z.strictObject({ type: z.literal("turn:narration"), text: z.string() }),
  z.strictObject({ type: z.literal("turn:toolCalls"), requests: z.array(relayToolCallRequestSchema) }),
  z.strictObject({
    type: z.literal("turn:end"),
    code: z.enum(RelayTurnEndCode),
    message: z.string().optional(),
  }),
]);

/** Schema of {@link RelayUpstreamMessage}. */
export const relayUpstreamMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("session:connect"),
    protocolVersion: z.number().int().positive(),
    manifest: relayToolManifestSchema,
    conversation: z.unknown().optional(),
  }),
  z.strictObject({ type: z.literal("turn:toolResults"), results: z.array(relayToolResultSchema) }),
  z.strictObject({ type: z.literal("session:userMessage"), text: z.string() }),
  z.strictObject({ type: z.literal("turn:stop") }),
]);
