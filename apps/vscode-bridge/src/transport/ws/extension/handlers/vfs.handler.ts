import type {
  FilesystemChangeMessage,
  FilesystemSyncMessage,
  SessionErrorMessage,
} from "@mindcraft-lang/bridge-protocol";
import { fileSystemNotificationSchema } from "@mindcraft-lang/bridge-protocol";
import type { WSContext } from "hono/ws";
import { logger } from "#core/logging/logger.js";
import { getAppSessionById, getExtensionSession } from "#core/session-registry.js";
import { safeSend } from "#transport/ws/safe-send.js";
import type { WsHandler, WsHandlerMap } from "#transport/ws/types.js";

function sendChangeError(ws: WSContext, id: string | undefined, message: string): void {
  if (!id) return;
  const err: SessionErrorMessage = { type: "session:error", id, payload: { message } };
  safeSend(ws, JSON.stringify(err));
}

function sendChangeAck(ws: WSContext, id: string | undefined): void {
  if (!id) return;
  const ack: FilesystemChangeMessage = { type: "filesystem:change", id };
  safeSend(ws, JSON.stringify(ack));
}

const filesystemChange: WsHandler = (ws, payload, id, seq) => {
  const extSession = getExtensionSession(ws);
  if (!extSession) {
    logger.warn("filesystem:change from unregistered extension session");
    sendChangeError(ws, id, "unregistered session");
    return;
  }

  if (!extSession.appSessionId) {
    logger.warn({ sessionId: extSession.id }, "filesystem:change from extension with no paired app");
    sendChangeError(ws, id, "no paired app");
    return;
  }

  const parsed = fileSystemNotificationSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn({ err: parsed.error }, "invalid filesystem:change payload");
    sendChangeError(ws, id, "invalid payload");
    return;
  }

  const appSession = getAppSessionById(extSession.appSessionId);
  if (!appSession) {
    logger.warn({ appSessionId: extSession.appSessionId }, "paired app session not found");
    sendChangeError(ws, id, "app offline");
    return;
  }

  const msg: FilesystemChangeMessage = { type: "filesystem:change", payload: parsed.data, seq };
  if (!safeSend(appSession.ws, JSON.stringify(msg))) {
    logger.warn(
      { appSessionId: extSession.appSessionId, extensionSessionId: extSession.id },
      "failed to relay filesystem:change to app"
    );
    sendChangeError(ws, id, "relay failed");
    return;
  }

  sendChangeAck(ws, id);
};

const filesystemSync: WsHandler = (ws, _payload, id, seq) => {
  const extSession = getExtensionSession(ws);
  if (!extSession) {
    logger.warn("filesystem:sync from unregistered extension session");
    return;
  }

  if (!extSession.appSessionId) {
    logger.warn({ sessionId: extSession.id }, "filesystem:sync from extension with no paired app");
    return;
  }

  const appSession = getAppSessionById(extSession.appSessionId);
  if (!appSession) {
    logger.warn({ appSessionId: extSession.appSessionId }, "paired app session not found");
    return;
  }

  const msg: FilesystemSyncMessage = { type: "filesystem:sync", id, seq };
  if (!safeSend(appSession.ws, JSON.stringify(msg))) {
    logger.warn(
      { appSessionId: extSession.appSessionId, extensionSessionId: extSession.id },
      "failed to relay filesystem:sync to app"
    );
  }
};

export const vfsHandlers: WsHandlerMap = {
  "filesystem:change": filesystemChange,
  "filesystem:sync": filesystemSync,
};
