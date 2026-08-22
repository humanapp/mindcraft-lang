import type { RelayDownstreamMessage } from "@wendoo-lang/assistant-relay";
import { relayDownstreamMessageSchema } from "@wendoo-lang/assistant-relay";
import type { AssistantChannel, AssistantConnect } from "./channel";

/** Raised by a socket channel's `next` once the session it reads has closed. */
class AssistantSocketClosed extends Error {
  constructor() {
    super("the assistant session socket is closed");
    this.name = "AssistantSocketClosed";
  }
}

/** Downstream messages delivered but not yet read, and the reader waiting on them. */
class Inbox {
  private readonly delivered: RelayDownstreamMessage[] = [];
  private readonly waiting: ((message: RelayDownstreamMessage) => void)[] = [];
  private readonly failing: ((reason: unknown) => void)[] = [];
  private closed = false;

  deliver(message: RelayDownstreamMessage): void {
    const waiter = this.waiting.shift();
    this.failing.shift();
    if (waiter) waiter(message);
    else this.delivered.push(message);
  }

  /** The next message, in the order it arrived. Rejects once the inbox is closed and drained. */
  next(): Promise<RelayDownstreamMessage> {
    const held = this.delivered.shift();
    if (held) return Promise.resolve(held);
    if (this.closed) return Promise.reject(new AssistantSocketClosed());
    return new Promise<RelayDownstreamMessage>((resolve, reject) => {
      this.waiting.push(resolve);
      this.failing.push(reject);
    });
  }

  close(): void {
    this.closed = true;
    this.waiting.length = 0;
    for (const reject of this.failing.splice(0)) reject(new AssistantSocketClosed());
  }
}

/** One frame's JSON, or `undefined` when the frame carries none. */
function readFrame(data: unknown): unknown {
  if (typeof data !== "string") return undefined;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

/**
 * Open relay sessions over browser WebSockets to `url`, the service's session
 * endpoint as the app's own configuration spells it.
 *
 * Each call opens one socket and resolves once that socket is open. It rejects
 * when the socket faults or closes before opening. A frame the relay wire does
 * not admit closes the session, and every `next` still waiting rejects.
 */
export function createWebSocketConnect(url: string): AssistantConnect {
  return () =>
    new Promise<AssistantChannel>((resolve, reject) => {
      const socket = new WebSocket(url);
      const inbox = new Inbox();
      let opened = false;
      let settleClosed: () => void = () => {};
      const closed = new Promise<void>((settle) => {
        settleClosed = settle;
      });

      const channel: AssistantChannel = {
        send: (message) => socket.send(JSON.stringify(message)),
        next: () => inbox.next(),
        close: () => socket.close(),
        closed,
      };

      socket.addEventListener("open", () => {
        opened = true;
        resolve(channel);
      });
      socket.addEventListener("message", (event: MessageEvent) => {
        const parsed = relayDownstreamMessageSchema.safeParse(readFrame(event.data));
        if (!parsed.success) {
          socket.close();
          return;
        }
        inbox.deliver(parsed.data as RelayDownstreamMessage);
      });
      socket.addEventListener("close", () => {
        inbox.close();
        settleClosed();
        if (!opened) reject(new AssistantSocketClosed());
      });
      socket.addEventListener("error", () => {
        inbox.close();
        settleClosed();
        if (!opened) reject(new AssistantSocketClosed());
      });
    });
}
