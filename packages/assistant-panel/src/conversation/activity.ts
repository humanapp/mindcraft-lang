import type { ConversationToolCall } from "@wendoo/assistant-relay";

/** What one call did to the document. */
export const ToolActivityKind = {
  /** The call looked at something and changed nothing. */
  Read: "read",
  /** The call built the document or ran it. */
  Ran: "ran",
  /** The call left the document untouched: it was not served, the person stopped it, or it named something absent. */
  Blocked: "blocked",
} as const;

/** What one call did to the document. */
export type ToolActivityKind = (typeof ToolActivityKind)[keyof typeof ToolActivityKind];

/** What one call reads as: what it did, and the wording that stands for it. */
export interface ToolActivity {
  readonly kind: ToolActivityKind;
  /** Display wording for the reader. */
  readonly text: string;
}

/**
 * How the call of `name` reads, stated as the assistant's own activity. A tool
 * this vocabulary does not name reads as a plain look.
 */
export function namedToolActivity(name: string): ToolActivity {
  switch (name) {
    case "read_catalog":
      return { kind: ToolActivityKind.Read, text: "checking tiles" };
    case "read_project":
      return { kind: ToolActivityKind.Read, text: "reading brain" };
    case "suggest_tiles":
      return { kind: ToolActivityKind.Read, text: "finding tiles" };
    case "compile":
      return { kind: ToolActivityKind.Ran, text: "validating" };
    case "simulate":
      return { kind: ToolActivityKind.Ran, text: "rehearsing" };
    case "propose_edit":
      return { kind: ToolActivityKind.Ran, text: "editing" };
    default:
      return { kind: ToolActivityKind.Read, text: "working" };
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
  return namedToolActivity(call.name);
}
