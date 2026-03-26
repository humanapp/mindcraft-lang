import { BridgeClient } from "@mindcraft-lang/ts-authoring";
import { getAppSettings, onAppSettingsChange } from "./app-settings";

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

type StatusListener = (status: ConnectionStatus) => void;

let client: BridgeClient | undefined;
let status: ConnectionStatus = "disconnected";
const listeners = new Set<StatusListener>();

function setStatus(next: ConnectionStatus): void {
  if (next === status) return;
  status = next;
  for (const fn of listeners) {
    fn(status);
  }
}

function mapClientState(state: string): ConnectionStatus {
  switch (state) {
    case "open":
      return "connected";
    case "connecting":
      return "connecting";
    case "reconnecting":
      return "reconnecting";
    default:
      return "disconnected";
  }
}

let pollTimer: ReturnType<typeof setInterval> | undefined;

function startPolling(): void {
  stopPolling();
  pollTimer = setInterval(() => {
    if (client) {
      setStatus(mapClientState(client.connectionState));
    }
  }, 500);
}

function stopPolling(): void {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

export function connectBridge(): void {
  if (client) return;

  const { vscodeBridgeUrl } = getAppSettings();
  let base: string;
  if (vscodeBridgeUrl.startsWith("ws://") || vscodeBridgeUrl.startsWith("wss://")) {
    base = vscodeBridgeUrl;
  } else {
    const isLocalhost = /^localhost(:|$)/.test(vscodeBridgeUrl) || /^127\./.test(vscodeBridgeUrl);
    const scheme = isLocalhost ? "ws://" : "wss://";
    base = `${scheme}${vscodeBridgeUrl}`;
  }
  const url = base.endsWith("/ws") ? base : `${base.replace(/\/+$/, "")}/ws`;

  client = new BridgeClient();
  setStatus("connecting");
  client.connect(url);
  startPolling();
}

export function disconnectBridge(): void {
  stopPolling();
  if (client) {
    client.close();
    client = undefined;
  }
  setStatus("disconnected");
}

export function getBridgeStatus(): ConnectionStatus {
  return status;
}

export function getBridgeClient(): BridgeClient | undefined {
  return client;
}

export function onBridgeStatusChange(fn: StatusListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

onAppSettingsChange((settings, prev) => {
  if (settings.vscodeBridgeUrl !== prev.vscodeBridgeUrl && client) {
    disconnectBridge();
    connectBridge();
  }
});
