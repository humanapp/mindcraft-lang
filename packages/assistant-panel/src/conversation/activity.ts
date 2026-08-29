import type { ConversationToolCall } from "@wendoo/assistant-relay";

/** What one call that changed nothing did, as the fold gathering them reads it. */
export const ToolActivityKind = {
  /** The call looked at something and changed nothing. */
  Read: "read",
  /** The call built the document or ran it. */
  Ran: "ran",
  /** The call left the document untouched: it was not served, the person stopped it, or it named something absent. */
  Blocked: "blocked",
} as const;

/** What one call that changed nothing did, as the fold gathering them reads it. */
export type ToolActivityKind = (typeof ToolActivityKind)[keyof typeof ToolActivityKind];

/** One row of the fold gathering what a turn looked at: what happened, and how it reads. */
export interface ToolActivity {
  readonly kind: ToolActivityKind;
  /** Display wording for the reader. */
  readonly text: string;
}

/** How a served call reads, by the tool it named. */
function servedCall(call: ConversationToolCall): ToolActivity {
  switch (call.name) {
    case "read_catalog":
      return { kind: ToolActivityKind.Read, text: "checking what tiles I can use" };
    case "read_project":
      return { kind: ToolActivityKind.Read, text: "reading brain" };
    case "suggest_tiles":
      return { kind: ToolActivityKind.Read, text: "looking for a tile that fits" };
    case "compile":
      return { kind: ToolActivityKind.Ran, text: "building" };
    case "simulate":
      return { kind: ToolActivityKind.Ran, text: "watching it run" };
    case "propose_edit":
      return { kind: ToolActivityKind.Blocked, text: "looked for something that was not there" };
    default:
      return { kind: ToolActivityKind.Read, text: "having a look" };
  }
}

/**
 * The row one recorded tool call reads as, stated as the assistant's own
 * activity.
 */
export function toolActivity(call: ConversationToolCall): ToolActivity {
  const { outcome } = call;
  if (outcome.kind !== "ok") return { kind: ToolActivityKind.Blocked, text: "stopped there" };
  if (outcome.isError) return { kind: ToolActivityKind.Blocked, text: "that did not work" };
  return servedCall(call);
}
