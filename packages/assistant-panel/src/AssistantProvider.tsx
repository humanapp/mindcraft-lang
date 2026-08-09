import type { ConversationRecord } from "@mindcraft-lang/assistant-relay";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { activeRecord } from "./conversation/store";
import type { AssistantMachineOptions, AssistantStatus } from "./session/machine";
import { AssistantMachine } from "./session/machine";

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
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

/** What the provider is built over, plus the tree it wraps. */
export interface AssistantProviderProps extends AssistantMachineOptions {
  children: ReactNode;
}

/**
 * Stands one assistant session over the tree it wraps. The session is opened on
 * the first send and closed when the provider unmounts.
 */
export function AssistantProvider({ children, connect, manifest, workspace, mediate }: AssistantProviderProps) {
  const [machine] = useState(
    () => new AssistantMachine({ connect, manifest, workspace, ...(mediate ? { mediate } : {}) })
  );

  useEffect(() => () => machine.close(), [machine]);

  const state = useSyncExternalStore(machine.subscribe, machine.getState, machine.getState);

  const value = useMemo<AssistantContextValue>(
    () => ({
      status: state.status,
      record: activeRecord(state.store),
      send: (text: string) => machine.send(text),
      stop: () => machine.stop(),
      setActiveBrain: (brainId: string) => machine.setActiveBrain(brainId),
    }),
    [machine, state]
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

/** Read the assistant session. Throws when used outside an {@link AssistantProvider}. */
export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) {
    throw new Error("useAssistant must be used within an AssistantProvider");
  }
  return value;
}
