import { WsClient } from "@mindcraft-lang/ts-protocol";
import type { Project } from "./project.js";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

type StatusListener = (status: ConnectionStatus) => void;

export class ProjectSession {
  private _client: WsClient | undefined;
  private _status: ConnectionStatus = "disconnected";
  private _pollTimer: ReturnType<typeof setInterval> | undefined;
  private _listeners = new Set<StatusListener>();

  constructor(public readonly project: Project) {}

  get status(): ConnectionStatus {
    return this._status;
  }

  start(): void {
    if (this._client) return;

    const { bridgeUrl } = this.project.options;
    const url = buildWsUrl(bridgeUrl, this.project.options.clientRole);

    this._client = new WsClient();
    this.setStatus("connecting");
    this._client.connect(url);
    this.startPolling();
  }

  stop(): void {
    this.stopPolling();
    if (!this._client) return;
    this._client.close();
    this._client = undefined;
    this.setStatus("disconnected");
  }

  onStatusChange(listener: StatusListener): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  private setStatus(next: ConnectionStatus): void {
    if (this._status === next) return;
    this._status = next;
    this._listeners.forEach((listener) => {
      listener(next);
    });
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
