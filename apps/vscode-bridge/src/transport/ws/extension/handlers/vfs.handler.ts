import type { FilesystemChangeMessage, FilesystemSyncMessage } from "@mindcraft-lang/bridge-protocol";
import { fileSystemNotificationSchema } from "@mindcraft-lang/bridge-protocol";
import { logger } from "#core/logging/logger.js";
import { getAppSessionById, getExtensionSession } from "#core/session-registry.js";
import { safeSend } from "#transport/ws/safe-send.js";
import type { WsHandler, WsHandlerMap } from "#transport/ws/types.js";

const filesystemChange: WsHandler = (ws, payload, id) => {
  const extSession = getExtensionSession(ws);
  if (!extSession) {
    logger.warn("filesystem:change from unregistered extension session");
    return;
  }

  if (!extSession.appSessionId) {
    logger.warn({ sessionId: extSession.id }, "filesystem:change from extension with no paired app");
    return;
  }

  const parsed = fileSystemNotificationSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn({ err: parsed.error }, "invalid filesystem:change payload");
    return;
  }

  const appSession = getAppSessionById(extSession.appSessionId);
  if (!appSession) {
    logger.warn({ appSessionId: extSession.appSessionId }, "paired app session not found");
    return;
  }

  const msg: FilesystemChangeMessage = { type: "filesystem:change", id, payload: parsed.data };
  if (!safeSend(appSession.ws, JSON.stringify(msg))) {
    logger.warn(
      { appSessionId: extSession.appSessionId, extensionSessionId: extSession.id },
      "failed to relay filesystem:change to app"
    );
  }
};

const filesystemSync: WsHandler = (ws, _payload, id) => {
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

  const msg: FilesystemSyncMessage = { type: "filesystem:sync", id };
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
