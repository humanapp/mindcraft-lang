import type { WsMessage } from "@mindcraft-lang/bridge-protocol";

type MessageHandler = (msg: WsMessage) => void;

type WsClientState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

interface WsClientOptions {
  maxReconnectDelay?: number;
  initialReconnectDelay?: number;
  requestTimeout?: number;
}

const DEFAULT_MAX_RECONNECT_DELAY = 30_000;
const DEFAULT_INITIAL_RECONNECT_DELAY = 500;
const DEFAULT_REQUEST_TIMEOUT = 30_000;

export class WsClient {
  private ws: WebSocket | undefined;
  private url = "";
  private state: WsClientState = "idle";
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectDelay: number;
  private readonly maxReconnectDelay: number;
  private readonly initialReconnectDelay: number;
  private readonly requestTimeout: number;

  onOpen?: () => void;
  onDisconnect?: () => void;

  private readonly pendingRequests = new Map<
    string,
    { resolve: (msg: WsMessage) => void; reject: (err: Error) => void }
  >();
  private readonly queuedMessages: WsMessage[] = [];
  private readonly listeners = new Map<string, Set<MessageHandler>>();

  constructor(options?: WsClientOptions) {
    this.maxReconnectDelay = options?.maxReconnectDelay ?? DEFAULT_MAX_RECONNECT_DELAY;
    this.initialReconnectDelay = options?.initialReconnectDelay ?? DEFAULT_INITIAL_RECONNECT_DELAY;
    this.requestTimeout = options?.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT;
    this.reconnectDelay = this.initialReconnectDelay;
  }

  get connectionState(): WsClientState {
    return this.state;
  }

  connect(url: string): void {
    if (this.state === "open" || this.state === "connecting") {
      return;
    }
    this.url = url;
    this.state = "connecting";
    this.openSocket();
  }

  close(): void {
    this.state = "closed";
    this.clearReconnectTimer();
    this.rejectAllPending(new Error("client closed"));
    this.ws?.close();
    this.ws = undefined;
  }

  send(msg: WsMessage): void {
    if (this.state === "open" && this.ws) {
      if (this.queuedMessages.length > 0) {
        this.queuedMessages.push(msg);
        this.flushQueue();
      } else {
        try {
          this.ws.send(JSON.stringify(msg));
        } catch {
          this.queuedMessages.push(msg);
        }
      }
    } else if (this.state === "connecting" || this.state === "reconnecting") {
      this.queuedMessages.push(msg);
    }
  }

  request(type: string, payload?: unknown): Promise<WsMessage> {
    const id = crypto.randomUUID();
    const msg: WsMessage = { type, id, payload };

    return new Promise<WsMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`request timed out: ${type}`));
      }, this.requestTimeout);

      this.pendingRequests.set(id, {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.send(msg);
    });
  }

  on(type: string, handler: MessageHandler): () => void {
    let handlers = this.listeners.get(type);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(type, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(type);
      }
    };
  }

  private openSocket(): void {
    const ws = new WebSocket(this.url);

    ws.onopen = () => {
      this.ws = ws;
      this.state = "open";
      this.reconnectDelay = this.initialReconnectDelay;
      this.onOpen?.();
      this.flushQueue();
    };

    ws.onmessage = (event: MessageEvent) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(String(event.data)) as WsMessage;
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    ws.onclose = () => {
      this.handleDisconnect();
    };

    ws.onerror = () => {
      // onclose fires after onerror, so reconnect logic is handled there
    };
  }

  private handleMessage(msg: WsMessage): void {
    if (msg.id) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        this.pendingRequests.delete(msg.id);
        pending.resolve(msg);
        return;
      }
    }

    const handlers = this.listeners.get(msg.type);
    if (handlers) {
      for (const handler of handlers) {
        handler(msg);
      }
    }
  }

  private handleDisconnect(): void {
    this.ws = undefined;
    if (this.state === "closed") {
      return;
    }
    this.state = "reconnecting";
    this.onDisconnect?.();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      if (this.state !== "reconnecting") {
        return;
      }
      this.openSocket();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private flushQueue(): void {
    const queued = this.queuedMessages.splice(0);
    for (const msg of queued) {
      this.send(msg);
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(err);
      this.pendingRequests.delete(id);
    }
  }
}
