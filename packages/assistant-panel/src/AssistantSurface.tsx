import type { ConversationRecord } from "@wendoo/assistant-relay";
import { useMemo, useState } from "react";
import { useAssistant } from "./assistant-context";
import { ConversationView } from "./ConversationView";
import type { BrainPlaces } from "./conversation/brain-places";
import type { LibraryOffers } from "./conversation/library-offers";
import { offersReporting } from "./conversation/library-offers";
import type { BrainSurface } from "./conversation/tile-visuals";
import { AssistantStatus } from "./session/machine";

/** What the host tells the surface about the entity it presents. */
export interface AssistantSurfaceProps {
  /** The name of the entity whose brain is open, as the host reads it from the document. */
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
   * The brain the tiles the assistant names are drawn against, built from the
   * host's editor config and the brain its editor stands. Absent while the host
   * stands none, which reads every tile by the word the conversation carried.
   */
  brainSurface?: BrainSurface | undefined;
  /**
   * Where the rules and pages the assistant names stand, built from the brain the
   * host's editor stands. Absent while the host stands none, which numbers rules
   * from what the conversation itself has seen and leaves references untappable.
   */
  brainPlaces?: BrainPlaces | undefined;
  /**
   * The shelf the libraries the assistant offers are drawn against, and the
   * host's own install a tap on one runs, as the host's workspaces carry them.
   * Absent leaves every offer inert.
   */
  libraryOffers?: LibraryOffers | undefined;
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
 * What the intent box stands at once the ask `taken` is taken back out of the
 * queue: `taken` above whatever `draft` was already typed there, the two a line
 * apart. A box holding nothing stands at the ask alone.
 */
export function draftWithTakenBack(taken: string, draft: string): string {
  return draft.length === 0 ? taken : `${taken}\n${draft}`;
}

/**
 * The conversation surface bound to the standing session: it shows the active
 * brain's conversation and the asks waiting their turn in it, sends what is
 * typed, puts a waiting ask the person takes back into the intent box, hurries a
 * waiting ask to the front of the queue, stops a running turn, and tells the
 * session of each library an offer's install added. Mounting it starts no
 * session, and it never takes the keyboard on its own.
 */
export function AssistantSurface({
  name,
  onLeaveIntent,
  opensByPerson,
  brainSurface,
  brainPlaces,
  libraryOffers,
}: AssistantSurfaceProps) {
  const { status, record, doing, pending, send, cancelAsk, sendNow, stop, openSession, libraryAdded } = useAssistant();
  const [intent, setIntent] = useState("");
  const brainId = record?.brainId;
  const offers = useMemo(
    () =>
      brainId === undefined
        ? libraryOffers
        : offersReporting(libraryOffers, (coordinate) => libraryAdded(brainId, coordinate)),
    [libraryOffers, libraryAdded, brainId]
  );

  const submit = (): void => {
    const text = intent.trim();
    if (text.length === 0) return;
    setIntent("");
    send(text);
  };

  const takeBack = (id: string): void => {
    const text = cancelAsk(id);
    if (text !== undefined) setIntent((draft) => draftWithTakenBack(text, draft));
  };

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
      pending={pending}
      onCancelAsk={takeBack}
      onSendNow={sendNow}
      onStop={stop}
      onRetry={retry}
      onAskAgain={askAgain}
      onLeaveIntent={onLeaveIntent}
      opensByPerson={opensByPerson}
      brainSurface={brainSurface}
      brainPlaces={brainPlaces}
      libraryOffers={offers}
      onAnswer={send}
      doing={doing}
    />
  );
}
