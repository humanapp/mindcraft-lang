import type { ConversationRecord } from "@mindcraft-lang/assistant-relay";
import { createContext, useContext } from "react";
import type { AssistantStatus } from "./session/machine";

/** The assistant session, as anything under the provider reads and drives it. */
export interface AssistantContextValue {
  readonly status: AssistantStatus;
  /** The active brain's conversation; absent until {@link AssistantContextValue.setActiveBrain} has named one. */
  readonly record: ConversationRecord | undefined;
  /** Start a turn on the active brain from what the person said. */
  readonly send: (text: string) => void;
  /** Ask the running turn to stop. */
  readonly stop: () => void;
  /** Show a brain's conversation, opening an empty one when the brain has none. */
  readonly setActiveBrain: (brainId: string) => void;
  /** Open a brain's session now, so its first send finds one standing. */
  readonly openSession: (brainId: string) => void;
}

/** The session a provider stands, `null` where none does. */
export const AssistantContext = createContext<AssistantContextValue | null>(null);

/** Read the assistant session. Throws when used outside an `AssistantProvider`. */
export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) {
    throw new Error("useAssistant must be used within an AssistantProvider");
  }
  return value;
}
