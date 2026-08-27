import { z } from "zod";
import type { NarrationJudgment, NarrationRole } from "./messages.js";
import { NarrationJudgment as JudgmentCode, RelayTurnEndCode, NarrationRole as RoleCode } from "./messages.js";
import type { RelayToolOutcome } from "./tool-calls.js";
import { relayToolOutcomeSchema } from "./tool-calls.js";

/**
 * Version {@link ConversationRecord} carries. A record states the version it
 * was written at, and a reader accepts only the versions it knows.
 */
export const CONVERSATION_RECORD_VERSION = 2;

/** Something the person said, which started a turn. */
export interface ConversationUserEntry {
  readonly kind: "user";
  readonly text: string;
}

/** One tool call an assistant turn made, and the answer the call was given. */
export interface ConversationToolCall {
  /** Bridge tool name, as the model produced it. */
  readonly name: string;
  /** Raw input as the model produced it, kept verbatim. */
  readonly input: unknown;
  /** What answered the call, kept verbatim. */
  readonly outcome: RelayToolOutcome;
}

/** Why a turn stopped without a `turn:end` from the service. */
export const ConversationTurnFailureCode = {
  /** No session could be opened to carry the turn. */
  NotConnected: "not_connected",
  /** The session closed while the turn was running. */
  Disconnected: "disconnected",
  /** Serving one of the turn's tool calls threw, so its batch went unanswered. */
  ToolServingFailed: "tool_serving_failed",
} as const;

/** Why a turn stopped without a `turn:end` from the service. */
export type ConversationTurnFailureCode =
  (typeof ConversationTurnFailureCode)[keyof typeof ConversationTurnFailureCode];

/** How a turn finished: the code the service ended it with, or the failure that cut it short. */
export type ConversationTurnEnding =
  | { readonly kind: "end"; readonly code: RelayTurnEndCode }
  | { readonly kind: "failure"; readonly code: ConversationTurnFailureCode };

/**
 * One run of narration: the deltas that arrived with no tool call between them,
 * joined in stream order.
 */
export interface ConversationNarrationSegment {
  readonly kind: "narration";
  /**
   * The headline the run opens with, and the whole of a run the service placed
   * no body in.
   */
  readonly text: string;
  /** The longer form standing under {@link text}, which a surface may fold away. */
  readonly body?: string;
  /** What this run is doing; absent where the service could not tell. */
  readonly role?: NarrationRole;
  /** How the rehearsal went; present only when {@link role} is `verdict`. */
  readonly judgment?: NarrationJudgment;
}

/** One tool call the turn made at this point, and the answer it was given. */
export interface ConversationToolCallStep {
  readonly kind: "toolCall";
  readonly call: ConversationToolCall;
}

/** One thing an assistant turn did. */
export type ConversationTurnStep = ConversationNarrationSegment | ConversationToolCallStep;

/** One assistant turn: what it narrated, what it called, and how it finished. */
export interface ConversationAssistantEntry {
  readonly kind: "assistant";
  /**
   * What the turn narrated and what it called, in the order it arrived. A run
   * of narration is one segment; the next segment starts after the tool calls
   * that interrupted it.
   */
  readonly steps: readonly ConversationTurnStep[];
  /** How the turn finished; absent while it is still running. */
  readonly ending?: ConversationTurnEnding;
}

/** One entry of a conversation: something the person said, or one assistant turn. */
export type ConversationEntry = ConversationUserEntry | ConversationAssistantEntry;

/**
 * The whole conversation held for one brain, in the order it happened.
 *
 * Tool inputs and the payloads that answered them are kept verbatim, and each
 * turn keeps its narration interleaved with its calls in arrival order.
 * Entries accumulate for the life of the conversation; the record carries no
 * size bound of its own.
 */
export interface ConversationRecord {
  /** {@link CONVERSATION_RECORD_VERSION} the record was written at. */
  readonly version: number;
  /** The brain the conversation is about, by the id its host addresses it with. */
  readonly brainId: string;
  readonly entries: readonly ConversationEntry[];
}

/** Schema of {@link ConversationToolCall}. */
const conversationToolCallSchema = z.strictObject({
  name: z.string().min(1),
  input: z.unknown(),
  outcome: relayToolOutcomeSchema,
});

/** Schema of {@link ConversationTurnEnding}. */
const conversationTurnEndingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("end"), code: z.enum(RelayTurnEndCode) }),
  z.strictObject({ kind: z.literal("failure"), code: z.enum(ConversationTurnFailureCode) }),
]);

/** Schema of {@link ConversationTurnStep}. */
const conversationTurnStepSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("narration"),
    text: z.string(),
    body: z.string().optional(),
    role: z.enum(RoleCode).optional(),
    judgment: z.enum(JudgmentCode).optional(),
  }),
  z.strictObject({ kind: z.literal("toolCall"), call: conversationToolCallSchema }),
]);

/** Schema of {@link ConversationEntry}. */
const conversationEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user"), text: z.string() }),
  z.strictObject({
    kind: z.literal("assistant"),
    steps: z.array(conversationTurnStepSchema),
    ending: conversationTurnEndingSchema.optional(),
  }),
]);

/** Schema of {@link ConversationRecord}. */
export const conversationRecordSchema = z.strictObject({
  version: z.literal(CONVERSATION_RECORD_VERSION),
  brainId: z.string().min(1),
  entries: z.array(conversationEntrySchema),
});
