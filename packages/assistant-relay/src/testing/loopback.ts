import type { RelayDownstreamMessage, RelayUpstreamMessage } from "../messages.js";
import { relayDownstreamMessageSchema, relayUpstreamMessageSchema } from "../messages.js";

/** Raised by a loopback end once the pairing has closed. */
export class RelayLoopbackClosed extends Error {
  constructor() {
    super("the relay loopback is closed");
    this.name = "RelayLoopbackClosed";
  }
}

/** One end of a loopback pairing: what it writes, and what its peer writes to it. */
export interface RelayLoopbackEnd<Out, In> {
  /** Encode `message` and hand it to the peer. Throws {@link RelayLoopbackClosed} once the pairing has closed. */
  send(message: Out): void;
  /**
   * The peer's next message, in the order the peer sent it. Messages already
   * delivered are drained first; after those, a closed pairing rejects with
   * {@link RelayLoopbackClosed}, whether it closed before this call or while it
   * was waiting.
   */
  next(): Promise<In>;
  /** Close the pairing from this end. Closing twice does nothing further. */
  close(): void;
}

/**
 * Both ends of one relay session, paired in memory. Every message crosses as
 * JSON and is parsed by the receiving side's schema, so a message that would
 * not survive the wire does not survive the pairing either.
 */
export interface RelayLoopback {
  /** The service's end: it sends downstream messages and receives upstream ones. */
  readonly service: RelayLoopbackEnd<RelayDownstreamMessage, RelayUpstreamMessage>;
  /** The app's end, which serves the tools: it sends upstream messages and receives downstream ones. */
  readonly toolServer: RelayLoopbackEnd<RelayUpstreamMessage, RelayDownstreamMessage>;
}

/** One direction's delivered-but-unread messages and the reader waiting on them. */
class Mailbox<In> {
  private readonly delivered: In[] = [];
  private readonly waiting: { resolve: (message: In) => void; reject: (reason: unknown) => void }[] = [];
  private closed = false;

  deliver(message: In): void {
    const waiter = this.waiting.shift();
    if (waiter) waiter.resolve(message);
    else this.delivered.push(message);
  }

  next(): Promise<In> {
    if (this.delivered.length > 0) return Promise.resolve(this.delivered.shift() as In);
    if (this.closed) return Promise.reject(new RelayLoopbackClosed());
    return new Promise<In>((resolve, reject) => {
      this.waiting.push({ resolve, reject });
    });
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiting.splice(0)) waiter.reject(new RelayLoopbackClosed());
  }
}

/** `message` as it comes back off the wire. */
function overTheWire(message: unknown): unknown {
  return JSON.parse(JSON.stringify(message));
}

/** Pair the two ends of one relay session in memory. Closing either end closes the pairing. */
export function createRelayLoopback(): RelayLoopback {
  const toService = new Mailbox<RelayUpstreamMessage>();
  const toToolServer = new Mailbox<RelayDownstreamMessage>();
  let open = true;

  const close = (): void => {
    if (!open) return;
    open = false;
    toService.close();
    toToolServer.close();
  };

  return {
    service: {
      send: (message) => {
        if (!open) throw new RelayLoopbackClosed();
        toToolServer.deliver(relayDownstreamMessageSchema.parse(overTheWire(message)) as RelayDownstreamMessage);
      },
      next: () => toService.next(),
      close,
    },
    toolServer: {
      send: (message) => {
        if (!open) throw new RelayLoopbackClosed();
        toService.deliver(relayUpstreamMessageSchema.parse(overTheWire(message)) as RelayUpstreamMessage);
      },
      next: () => toToolServer.next(),
      close,
    },
  };
}
