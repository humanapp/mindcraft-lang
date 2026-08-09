import type {
  ConversationAssistantEntry,
  ConversationEntry,
  ConversationRecord,
  ConversationToolCall,
  ConversationTurnEnding,
} from "@mindcraft-lang/assistant-relay";
import { CONVERSATION_RECORD_VERSION } from "@mindcraft-lang/assistant-relay";

/** One step of a turn, as it lands in a brain's record. */
export type ConversationUpdate =
  | { readonly kind: "user"; readonly text: string }
  | { readonly kind: "narration"; readonly text: string }
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
  const turn: ConversationAssistantEntry = open ?? { kind: "assistant", narration: "", toolCalls: [] };

  switch (update.kind) {
    case "narration":
      return { ...record, entries: [...before, { ...turn, narration: turn.narration + update.text }] };
    case "toolCall":
      return { ...record, entries: [...before, { ...turn, toolCalls: [...turn.toolCalls, update.call] }] };
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
