import type { FilesystemChangeMessage, FilesystemSyncMessage } from "@mindcraft-lang/bridge-protocol";
import { fileSystemNotificationSchema, filesystemSyncPayloadSchema } from "@mindcraft-lang/bridge-protocol";
import { logger } from "#core/logging/logger.js";
import { getAppSession, getExtensionsByAppSessionId } from "#core/session-registry.js";
import { safeSend } from "#transport/ws/safe-send.js";
import type { WsHandler, WsHandlerMap } from "#transport/ws/types.js";

const filesystemChange: WsHandler = (ws, payload, id) => {
  const appSession = getAppSession(ws);
  if (!appSession) {
    logger.warn("filesystem:change from unregistered app session");
    return;
  }

  const parsed = fileSystemNotificationSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn({ err: parsed.error }, "invalid filesystem:change payload");
    return;
  }

  const extensions = getExtensionsByAppSessionId(appSession.id);
  if (extensions.length === 0) {
    return;
  }

  const msg: FilesystemChangeMessage = { type: "filesystem:change", id, payload: parsed.data };
  const raw = JSON.stringify(msg);
  for (const ext of extensions) {
    if (!safeSend(ext.ws, raw)) {
      logger.warn(
        { extensionSessionId: ext.id, appSessionId: appSession.id },
        "failed to relay filesystem:change to extension"
      );
    }
  }
};

const filesystemSync: WsHandler = (ws, payload, id) => {
  const appSession = getAppSession(ws);
  if (!appSession) {
    logger.warn("filesystem:sync from unregistered app session");
    return;
  }

  const parsed = filesystemSyncPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn({ err: parsed.error }, "invalid filesystem:sync payload");
    return;
  }

  const extensions = getExtensionsByAppSessionId(appSession.id);
  if (extensions.length === 0) {
    return;
  }

  const msg: FilesystemSyncMessage = { type: "filesystem:sync", id, payload: parsed.data };
  const raw = JSON.stringify(msg);
  for (const ext of extensions) {
    if (!safeSend(ext.ws, raw)) {
      logger.warn(
        { extensionSessionId: ext.id, appSessionId: appSession.id },
        "failed to relay filesystem:sync to extension"
      );
    }
  }
};

export const filesystemHandlers: WsHandlerMap = {
  "filesystem:change": filesystemChange,
  "filesystem:sync": filesystemSync,
};
