import type { WsMessage } from "@mindcraft-lang/ts-protocol";
import { WsClient } from "@mindcraft-lang/ts-protocol";
import type { ClientRole } from "./project.js";

type InternalHandler = (msg: WsMessage) => void;

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

export interface SessionEventMap {
  status: ConnectionStatus;
}

export class ProjectSession<TClient extends WsMessage, TServer extends WsMessage> {
  private _client: WsClient | undefined;
  private _status: ConnectionStatus = "disconnected";
  private _pollTimer: ReturnType<typeof setInterval> | undefined;
  private _eventListeners = new Map<string, Set<(value: never) => void>>();
  private _messageHandlers = new Map<string, Set<InternalHandler>>();
  private _clientUnsubs: (() => void)[] = [];
  private _clientRole: ClientRole;
  private _bridgeUrl: string;
  private _sessionId: string | undefined;

  constructor(clientRole: ClientRole, bridgeUrl: string) {
    this._clientRole = clientRole;
    this._bridgeUrl = bridgeUrl;
    this.addEventListener("status", (status) => {
      if (status === "connected") {
        const msg = this._sessionId
          ? { type: "session:hello", payload: { sessionId: this._sessionId } }
          : { type: "session:hello" };
        this.send(msg as TClient);
      }
    });
  }

  get status(): ConnectionStatus {
    return this._status;
  }

  get sessionId(): string | undefined {
    return this._sessionId;
  }

  start(): void {
    if (this._client) return;

    const url = buildWsUrl(this._bridgeUrl, this._clientRole);

    this._client = new WsClient();
    this._client.onOpen = () => {
      this.setStatus("connected");
    };
    this._client.onDisconnect = () => {
      this.setStatus("reconnecting");
    };
    this.setStatus("connecting");
    this.reregisterHandlers();
    this._client.connect(url);
    this.startPolling();

    this._client.on("session:welcome", (msg: WsMessage) => {
      const payload = msg.payload as { sessionId?: string } | undefined;
      if (payload?.sessionId) {
        this._sessionId = payload.sessionId;
      }
    });
  }

  stop(): void {
    this.stopPolling();
    for (const unsub of this._clientUnsubs) unsub();
    this._clientUnsubs = [];
    if (!this._client) return;
    this._client.send({ type: "session:goodbye" });
    this._client.close();
    this._client = undefined;
    this.setStatus("disconnected");
  }

  on<T extends TServer["type"]>(type: T, handler: (msg: Extract<TServer, { type: T }>) => void): () => void {
    const wrapper: InternalHandler = (msg) => {
      handler(msg as Extract<TServer, { type: T }>);
    };

    let set = this._messageHandlers.get(type);
    if (!set) {
      set = new Set();
      this._messageHandlers.set(type, set);
    }
    set.add(wrapper);

    if (this._client) {
      this._clientUnsubs.push(this._client.on(type, wrapper));
    }

    return () => {
      set.delete(wrapper);
      if (set.size === 0) this._messageHandlers.delete(type);
    };
  }

  send(msg: TClient): void {
    if (!this._client) {
      throw new Error("Session not started");
    }
    this._client.send(msg);
  }

  addEventListener<K extends keyof SessionEventMap>(
    event: K,
    listener: (value: SessionEventMap[K]) => void
  ): () => void {
    let set = this._eventListeners.get(event);
    if (!set) {
      set = new Set();
      this._eventListeners.set(event, set);
    }
    set.add(listener as (value: never) => void);
    return () => {
      set.delete(listener as (value: never) => void);
      if (set.size === 0) this._eventListeners.delete(event);
    };
  }

  private emit<K extends keyof SessionEventMap>(event: K, value: SessionEventMap[K]): void {
    const set = this._eventListeners.get(event);
    if (set) {
      for (const listener of set) {
        (listener as (value: SessionEventMap[K]) => void)(value);
      }
    }
  }

  private setStatus(next: ConnectionStatus): void {
    if (this._status === next) return;
    this._status = next;
    this.emit("status", next);
  }

  private startPolling(): void {
    if (this._pollTimer) return;
    this._pollTimer = setInterval(() => {
      if (this._client) {
        const state = this._client.connectionState;
        if (state === "open") {
          this.setStatus("connected");
        } else if (state === "connecting") {
          this.setStatus("connecting");
        } else if (state === "reconnecting") {
          this.setStatus("reconnecting");
        } else {
          this.setStatus("disconnected");
        }
      }
    }, 500);
  }

  private stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = undefined;
    }
  }

  private reregisterHandlers(): void {
    for (const [type, handlers] of this._messageHandlers) {
      for (const handler of handlers) {
        this._clientUnsubs.push(this._client!.on(type, handler));
      }
    }
  }
}

function buildWsUrl(bridgeUrl: string, clientRole: string): string {
  // Strip any existing scheme (ws, wss, http, https, etc.) so URL can parse the rest reliably.
  const withoutScheme = bridgeUrl.replace(/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//, "");
  const parsed = new URL(`http://${withoutScheme}`);
  const { hostname, port } = parsed;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  const scheme = isLocalhost ? "ws://" : "wss://";
  const portPart = port !== "" ? `:${port}` : "";
  return `${scheme}${hostname}${portPart}/${clientRole}`;
}
