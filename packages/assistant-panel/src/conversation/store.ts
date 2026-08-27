import type {
  ConversationAssistantEntry,
  ConversationEntry,
  ConversationNarrationSegment,
  ConversationRecord,
  ConversationToolCall,
  ConversationTurnEnding,
  ConversationTurnStep,
  NarrationJudgment,
  NarrationRole,
} from "@wendoo/assistant-relay";
import { CONVERSATION_RECORD_VERSION, NarrationPart } from "@wendoo/assistant-relay";

/** One fragment of narration, as it lands in a brain's record. */
export interface NarrationUpdate {
  readonly kind: "narration";
  readonly text: string;
  /** The part of its run this fragment belongs to; absent for the headline. */
  readonly part?: NarrationPart;
  /** What the run this fragment belongs to is doing; read from the first fragment carrying one. */
  readonly role?: NarrationRole;
  /** How the rehearsal went; read from the first fragment of a `verdict` run carrying one. */
  readonly judgment?: NarrationJudgment;
}

/** One step of a turn, as it lands in a brain's record. */
export type ConversationUpdate =
  | { readonly kind: "user"; readonly text: string }
  | NarrationUpdate
  | { readonly kind: "toolCall"; readonly call: ConversationToolCall }
  | { readonly kind: "ending"; readonly ending: ConversationTurnEnding };

/** Every brain's conversation, and which one the host is showing. */
export interface ConversationStore {
  readonly records: ReadonlyMap<string, ConversationRecord>;
  /** Brain {@link activeRecord} answers for; absent until the host names one. */
  readonly activeBrainId?: string;
}

/** A store holding no conversation and naming no active brain. */
export function emptyConversationStore(): ConversationStore {
  return { records: new Map() };
}

/** The conversation held for `brainId`, empty when the brain has none yet. */
export function recordFor(store: ConversationStore, brainId: string): ConversationRecord {
  return store.records.get(brainId) ?? { version: CONVERSATION_RECORD_VERSION, brainId, entries: [] };
}

/** The active brain's conversation, or `undefined` while the host has named no brain. */
export function activeRecord(store: ConversationStore): ConversationRecord | undefined {
  return store.activeBrainId === undefined ? undefined : recordFor(store, store.activeBrainId);
}

/** `store` with `brainId` as the brain {@link activeRecord} answers for. */
export function withActiveBrain(store: ConversationStore, brainId: string): ConversationStore {
  return { ...store, activeBrainId: brainId };
}

/** The turn still running at the end of `entries`, or `undefined` when none is. */
function openTurn(entries: readonly ConversationEntry[]): ConversationAssistantEntry | undefined {
  const last = entries.length > 0 ? entries[entries.length - 1] : undefined;
  return last?.kind === "assistant" && last.ending === undefined ? last : undefined;
}

/**
 * `steps` with `update`'s text joined onto the segment they end in, or carrying
 * a new segment when the last thing the turn did was call a tool. Text marked
 * as body joins that segment's body and everything else joins its headline. The
 * first fragment carrying a role gives the segment both its role and its
 * judgment, whether or not it is the one that opened the segment, and a later
 * fragment moves neither. Empty text opens no segment and leaves `steps` as
 * they stand.
 */
function withNarration(
  steps: readonly ConversationTurnStep[],
  update: NarrationUpdate
): readonly ConversationTurnStep[] {
  if (update.text.length === 0) return steps;
  const last = steps.length > 0 ? steps[steps.length - 1] : undefined;
  const standing: ConversationNarrationSegment = last?.kind === "narration" ? last : { kind: "narration", text: "" };
  const marked = standing.role === undefined ? update : standing;
  const open: ConversationNarrationSegment = {
    ...standing,
    ...(marked.role === undefined ? {} : { role: marked.role }),
    ...(marked.judgment === undefined ? {} : { judgment: marked.judgment }),
  };
  const grown: ConversationNarrationSegment =
    update.part === NarrationPart.Body
      ? { ...open, body: (open.body ?? "") + update.text }
      : { ...open, text: open.text + update.text };
  return [...(last?.kind === "narration" ? steps.slice(0, -1) : steps), grown];
}

/**
 * `record` with `update` applied. Narration, tool calls and an ending land on
 * the turn still running at the end of the record, which is opened when none
 * is.
 */
function withUpdateApplied(record: ConversationRecord, update: ConversationUpdate): ConversationRecord {
  if (update.kind === "user") {
    return { ...record, entries: [...record.entries, { kind: "user", text: update.text }] };
  }

  const open = openTurn(record.entries);
  const before = open ? record.entries.slice(0, -1) : record.entries;
  const turn: ConversationAssistantEntry = open ?? { kind: "assistant", steps: [] };

  switch (update.kind) {
    case "narration":
      return { ...record, entries: [...before, { ...turn, steps: withNarration(turn.steps, update) }] };
    case "toolCall":
      return {
        ...record,
        entries: [...before, { ...turn, steps: [...turn.steps, { kind: "toolCall", call: update.call }] }],
      };
    case "ending":
      return { ...record, entries: [...before, { ...turn, ending: update.ending }] };
  }
}

/** `store` with `update` applied to `brainId`'s conversation, leaving every other brain's untouched. */
export function withUpdate(store: ConversationStore, brainId: string, update: ConversationUpdate): ConversationStore {
  const records = new Map(store.records);
  records.set(brainId, withUpdateApplied(recordFor(store, brainId), update));
  return { ...store, records };
}
