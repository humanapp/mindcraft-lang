import type {
  ConversationEntry,
  ConversationNarrationSegment,
  ConversationRecord,
  ConversationToolCall,
  ConversationTurnEnding,
  ConversationTurnStep,
} from "@wendoo/assistant-relay";
import { NarrationRole } from "@wendoo/assistant-relay";
import { askOffer } from "./blocks";

/**
 * The line an exported transcript opens with, naming the format and version the
 * rest of the document is written in.
 */
export const transcriptExportFormat = "=== wendoo assistant transcript v1";

/** The marker every line carrying words the record holds verbatim opens with. */
const verbatimMarker = "| ";

/** Lines `text` stands as, which an empty string stands as one of. */
function lineCount(text: string): number {
  return text.split("\n").length;
}

/** `text` as one line per line it holds, each opened by {@link verbatimMarker}. */
function verbatim(text: string): string[] {
  return text.split("\n").map((line) => `${verbatimMarker}${line}`);
}

/**
 * Add every durable id `value` carries, however deeply, to `into`, keeping the
 * order they were first met in. An id stands under a key named for one
 * (`ruleId`, `pageId`) or under a key naming a run of them (`tileIds`).
 */
function collectIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectIds(entry, into);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, held] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith("Id") && typeof held === "string") into.add(held);
    if (key.endsWith("Ids") && Array.isArray(held)) {
      for (const entry of held) {
        if (typeof entry === "string") into.add(entry);
      }
    }
    collectIds(held, into);
  }
}

/**
 * What a served payload states about itself at its top level: whether the tool
 * answered the call or refused it, and the code or word it refused under. A
 * payload stating none of these carries no fields.
 */
function payloadFields(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return [];
  const held = payload as Record<string, unknown>;
  const fields: string[] = [];
  if (typeof held.ok === "boolean") fields.push(`payload-ok=${held.ok}`);
  if (typeof held.code === "number" || typeof held.code === "string") fields.push(`payload-code=${held.code}`);
  if (typeof held.error === "string") fields.push(`payload-error=${held.error}`);
  return fields;
}

/** One tool call the turn made: what it asked for, how it was answered, and what it named. */
function callLines(at: number, call: ConversationToolCall): string[] {
  const { outcome } = call;
  const head = [`- step ${at} call ${call.name}`, `outcome=${outcome.kind}`];
  if (outcome.kind === "ok") {
    if (outcome.isError === true) head.push("error=true");
    head.push(...payloadFields(outcome.payload));
  } else {
    head.push(`code=${outcome.code}`);
  }
  const ids = new Set<string>();
  collectIds(call.input, ids);
  if (outcome.kind === "ok") collectIds(outcome.payload, ids);
  const lines = [head.join(" ")];
  if (ids.size > 0) lines.push(`ids: ${[...ids].join(", ")}`);
  return lines;
}

/**
 * One run of the assistant's own words: what it was doing, its headline and body
 * held verbatim under their line counts, and, for a question, the answers the
 * panel offers under it.
 */
function narrationLines(at: number, step: ConversationNarrationSegment): string[] {
  const head = [`- step ${at} narration`];
  if (step.role !== undefined) head.push(`role=${step.role}`);
  if (step.judgment !== undefined) head.push(`judgment=${step.judgment}`);
  const lines = [head.join(" "), `headline lines=${lineCount(step.text)}`, ...verbatim(step.text)];
  if (step.body !== undefined) lines.push(`body lines=${lineCount(step.body)}`, ...verbatim(step.body));
  if (step.role === NarrationRole.Ask) {
    const answers = askOffer(step.text, step.body)?.answers ?? [];
    lines.push(`answers=${answers.length}`, ...answers.map((answer) => `${verbatimMarker}${answer}`));
  }
  return lines;
}

/** One thing a turn did, as the lines the format writes it in. */
function stepLines(at: number, step: ConversationTurnStep): string[] {
  return step.kind === "narration" ? narrationLines(at, step) : callLines(at, step.call);
}

/** How a turn finished, as `kind/code`, and `none` for one still running. */
function endingWord(ending: ConversationTurnEnding | undefined): string {
  return ending === undefined ? "none" : `${ending.kind}/${ending.code}`;
}

/** One entry of the conversation: what the person asked for, or one whole turn. */
function entryLines(at: number, entry: ConversationEntry): string[] {
  if (entry.kind === "user") {
    return [`--- entry ${at} ask lines=${lineCount(entry.text)}`, ...verbatim(entry.text)];
  }
  const lines = [`--- entry ${at} turn steps=${entry.steps.length} ending=${endingWord(entry.ending)}`];
  entry.steps.forEach((step, index) => {
    lines.push(...stepLines(index + 1, step));
  });
  return lines;
}

/**
 * `record` as the diagnostic document a reader is handed to study the
 * conversation itself: the brain it belongs to under `name`, then every entry in
 * the order it happened, each ask and each run of narration held verbatim under
 * its line count, and every tool call under its name, how it was answered, and
 * the durable ids it named. The same record always writes the same document.
 */
export function exportTranscript(record: ConversationRecord, name: string): string {
  const lines = [
    transcriptExportFormat,
    `brain: ${name} (${record.brainId})`,
    `record-version: ${record.version}`,
    `entries: ${record.entries.length}`,
  ];
  record.entries.forEach((entry, at) => {
    lines.push("", ...entryLines(at + 1, entry));
  });
  return `${lines.join("\n")}\n`;
}
