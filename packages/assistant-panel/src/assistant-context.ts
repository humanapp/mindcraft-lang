import type { ConversationRecord } from "@wendoo/assistant-relay";
import { createContext, useContext } from "react";
import type { AssistantStatus, PendingAsk, TurnDoing } from "./session/machine";

/** The assistant session, as anything under the provider reads and drives it. */
export interface AssistantContextValue {
  readonly status: AssistantStatus;
  /** The active brain's conversation; absent until {@link AssistantContextValue.setActiveBrain} has named one. */
  readonly record: ConversationRecord | undefined;
  /**
   * What the active brain's running turn is at -- the tool call the model is
   * writing, or the batch most recently served, held until the turn's next
   * signal. Absent while the turn is narrating, has done nothing nameable, or
   * is over; never recorded in the conversation.
   */
  readonly doing: TurnDoing | undefined;
  /**
   * What the active brain has waiting of the person's own asks, in the order
   * they were typed; empty while nothing waits.
   */
  readonly pending: readonly PendingAsk[];
  /**
   * Start a turn on the active brain from what the person said. An ask made
   * while a turn of that brain's is running waits for it, and the asks waiting
   * one after another take one turn together once it ends.
   */
  readonly send: (text: string) => void;
  /**
   * Take back the waiting ask `id` names, answering with the text it held and
   * `undefined` when no ask of that name waits.
   */
  readonly cancelAsk: (id: string) => string | undefined;
  /**
   * Take the waiting ask `id` names to the front of the queue and open its turn
   * as soon as the floor is free, stopping a turn still running for it. The ask
   * takes that turn alone, and everything else waits on in the order it arrived.
   */
  readonly sendNow: (id: string) => void;
  /**
   * Tell `brainId`'s session that the person added the library at `coordinate`,
   * which opens a turn carrying that news. An add made while a turn of that
   * brain's is running takes its turn once that one ends, and an add of a
   * coordinate already waiting tells nobody twice; an add to a brain holding no
   * session tells nobody.
   */
  readonly libraryAdded: (brainId: string, coordinate: string) => void;
  /** Ask the running turn to stop. */
  readonly stop: () => void;
  /**
   * Ask every running turn to stop, whatever brain it was sent for. Call it
   * where the surface the turns were started from is being closed for good.
   */
  readonly stopAll: () => void;
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
