import type { RelayDownstreamMessage, RelayUpstreamMessage } from "@wendoo-lang/assistant-relay";

/**
 * One open relay session, as the machine speaks to it.
 *
 * `next` resolves with the service's messages in the order the service sent
 * them, and rejects once the session has closed.
 */
export interface AssistantChannel {
  send(message: RelayUpstreamMessage): void;
  next(): Promise<RelayDownstreamMessage>;
  close(): void;
  /** Resolves once the session has closed, whether the service dropped it or `close` ended it. Never rejects. */
  readonly closed: Promise<void>;
}

/**
 * Opens one relay session. The machine calls it on the first send of a session
 * and holds the channel it returns until the session closes. Rejecting leaves
 * the machine with no session.
 */
export type AssistantConnect = () => Promise<AssistantChannel>;
