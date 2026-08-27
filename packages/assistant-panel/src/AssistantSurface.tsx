import type { ConversationRecord } from "@wendoo/assistant-relay";
import { useState } from "react";
import { useAssistant } from "./assistant-context";
import { ConversationView } from "./ConversationView";
import type { BrainSurface } from "./conversation/tile-visuals";
import { AssistantStatus } from "./session/machine";

/** What the host tells the surface about the entity it presents. */
export interface AssistantSurfaceProps {
  /** The name of the entity whose mind is open, as the host reads it from the document. */
  name: string;
  /**
   * Hand the keyboard to whatever the host stands the surface in, called as the
   * keyboard leaves the intent box. Answers whether the host took it; the
   * surface lands the keyboard on itself when the host took none, and whenever
   * this is not given.
   */
  onLeaveIntent?: (() => boolean) | undefined;
  /**
   * How many times the person themselves opened the panel. Each new count lands
   * the keyboard in the intent box. Absent for an open the person did not ask
   * for, which lands the keyboard nowhere.
   */
  opensByPerson?: number | undefined;
  /**
   * The brain the tiles the entity names are drawn against, built from the
   * host's editor config and the brain its editor stands. Absent while the host
   * stands none, which reads every tile by the word the conversation carried.
   */
  brainSurface?: BrainSurface | undefined;
}

/** The last thing the person asked for, or `undefined` when they have asked for nothing yet. */
function lastAsked(record: ConversationRecord | undefined): string | undefined {
  const entries = record?.entries ?? [];
  for (let at = entries.length - 1; at >= 0; at--) {
    const entry = entries[at];
    if (entry?.kind === "user") return entry.text;
  }
  return undefined;
}

/**
 * The conversation surface bound to the standing session: it shows the active
 * brain's conversation, sends what is typed, and stops a running turn. Mounting
 * it starts no session, and it never takes the keyboard on its own.
 */
export function AssistantSurface({ name, onLeaveIntent, opensByPerson, brainSurface }: AssistantSurfaceProps) {
  const { status, record, send, stop, openSession } = useAssistant();
  const [intent, setIntent] = useState("");

  const submit = (): void => {
    const text = intent.trim();
    if (text.length === 0) return;
    setIntent("");
    send(text);
  };

  const brainId = record?.brainId;
  const retry = status === AssistantStatus.Failed && brainId !== undefined ? () => openSession(brainId) : undefined;
  const asked = lastAsked(record);
  const askAgain = asked === undefined ? undefined : () => send(asked);

  return (
    <ConversationView
      name={name}
      status={status}
      record={record}
      intent={intent}
      onIntentChange={setIntent}
      onSend={submit}
      onStop={stop}
      onRetry={retry}
      onAskAgain={askAgain}
      onLeaveIntent={onLeaveIntent}
      opensByPerson={opensByPerson}
      brainSurface={brainSurface}
    />
  );
}
