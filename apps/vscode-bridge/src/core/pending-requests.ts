import type { FileSystemNotification } from "@mindcraft-lang/bridge-protocol";
import type { WSContext } from "hono/ws";
import { safeSend } from "#transport/ws/safe-send.js";

export interface PendingRequest {
  extensionWs: WSContext;
  appSessionId: string;
  payload: FileSystemNotification;
  timer: ReturnType<typeof setTimeout>;
}

// Bridge-owned timeout: if the app doesn't respond within REQUEST_TIMEOUT_MS,
// the bridge auto-fails the request back to the extension.
const REQUEST_TIMEOUT_MS = 30_000;

const pendingRequests = new Map<string, PendingRequest>();

export function addPendingRequest(
  id: string,
  extensionWs: WSContext,
  appSessionId: string,
  payload: FileSystemNotification
): void {
  const timer = setTimeout(() => {
    pendingRequests.delete(id);
    const err = { type: "session:error", id, payload: { message: "app did not respond" } };
    safeSend(extensionWs, JSON.stringify(err));
  }, REQUEST_TIMEOUT_MS);
  pendingRequests.set(id, { extensionWs, appSessionId, payload, timer });
}

export function takePendingRequest(id: string): PendingRequest | undefined {
  const entry = pendingRequests.get(id);
  if (!entry) return undefined;
  clearTimeout(entry.timer);
  pendingRequests.delete(id);
  return entry;
}
