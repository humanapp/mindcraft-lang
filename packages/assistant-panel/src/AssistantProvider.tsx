import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { AssistantContextValue } from "./assistant-context";
import { AssistantContext } from "./assistant-context";
import { activeRecord } from "./conversation/store";
import type { AssistantMachineOptions } from "./session/machine";
import { AssistantMachine, doingFor } from "./session/machine";

/** What the provider is built over, plus the tree it wraps. */
export interface AssistantProviderProps extends AssistantMachineOptions {
  children: ReactNode;
}

/**
 * Stands the assistant over the tree it wraps. A brain's session is opened by
 * `openSession` or by its first send, the brain named active is dialed for
 * quietly whenever it holds none, and every session is closed when the provider
 * unmounts. The machine is built from the options the first render gives and is
 * not rebuilt when they change.
 */
export function AssistantProvider({ children, ...options }: AssistantProviderProps) {
  const [machine] = useState(() => new AssistantMachine(options));

  useEffect(() => () => machine.close(), [machine]);

  const state = useSyncExternalStore(machine.subscribe, machine.getState, machine.getState);

  const actions = useMemo(
    () => ({
      send: (text: string) => machine.send(text),
      libraryAdded: (brainId: string, coordinate: string) => machine.libraryAdded(brainId, coordinate),
      stop: () => machine.stop(),
      stopAll: () => machine.stopAll(),
      setActiveBrain: (brainId: string) => machine.setActiveBrain(brainId),
      openSession: (brainId: string) => machine.openSession(brainId),
    }),
    [machine]
  );

  const value = useMemo<AssistantContextValue>(
    () => ({
      status: state.status,
      record: activeRecord(state.store),
      doing: doingFor(state.doing, state.store.activeBrainId),
      ...actions,
    }),
    [actions, state]
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}
