import type { ConversationToolCall } from "@mindcraft-lang/assistant-relay";

/** What one tool call did, as the status line beneath the narration reads it. */
export const ToolActivityKind = {
  /** The call looked at something and changed nothing. */
  Read: "read",
  /** An edit landed in the document. */
  Changed: "changed",
  /** An edit was refused, so the next one goes somewhere else. */
  Explored: "explored",
  /** The call built the document or ran it. */
  Ran: "ran",
  /** The call was not served, or the person stopped it. */
  Blocked: "blocked",
} as const;

/** What one tool call did, as the status line beneath the narration reads it. */
export type ToolActivityKind = (typeof ToolActivityKind)[keyof typeof ToolActivityKind];

/** One line of the status beneath the narration: what happened, and how it reads. */
export interface ToolActivity {
  readonly kind: ToolActivityKind;
  /** Display wording for the reader. */
  readonly text: string;
}

/** The `op` a `propose_edit` input named, or `undefined` when it named none. */
function editOperation(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const op = (input as { op?: unknown }).op;
  return typeof op === "string" ? op : undefined;
}

/** Whether an answered `propose_edit` payload reports the edit as applied. */
function editApplied(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && (payload as { ok?: unknown }).ok === true;
}

/** How an applied edit reads, by the operation that produced it. */
function appliedEdit(op: string | undefined): string {
  switch (op) {
    case "addRule":
      return "added a rule";
    case "replaceTile":
      return "swapped a tile";
    case "deleteTile":
      return "took a tile out";
    default:
      return "placed tiles";
  }
}

/** How a served call reads, by the tool it named. */
function servedCall(call: ConversationToolCall, payload: unknown): ToolActivity {
  switch (call.name) {
    case "read_catalog":
      return { kind: ToolActivityKind.Read, text: "checking what tiles I can use" };
    case "read_project":
      return { kind: ToolActivityKind.Read, text: "reading my own rules" };
    case "suggest_tiles":
      return { kind: ToolActivityKind.Read, text: "looking for a tile that fits" };
    case "compile":
      return { kind: ToolActivityKind.Ran, text: "building" };
    case "simulate":
      return { kind: ToolActivityKind.Ran, text: "watching it run" };
    case "propose_edit":
      return editApplied(payload)
        ? { kind: ToolActivityKind.Changed, text: appliedEdit(editOperation(call.input)) }
        : { kind: ToolActivityKind.Explored, text: "tried that -- it does not fit there" };
    default:
      return { kind: ToolActivityKind.Read, text: "having a look" };
  }
}

/**
 * The status line one recorded tool call reads as, stated as activity of the
 * entity itself.
 */
export function toolActivity(call: ConversationToolCall): ToolActivity {
  const { outcome } = call;
  if (outcome.kind !== "ok") return { kind: ToolActivityKind.Blocked, text: "stopped there" };
  if (outcome.isError) return { kind: ToolActivityKind.Blocked, text: "that did not work" };
  return servedCall(call, outcome.payload);
}
