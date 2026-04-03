import type { CompileDiagnosticsMessage, CompileStatusMessage } from "@mindcraft-lang/bridge-protocol";
import { compileDiagnosticsPayloadSchema, compileStatusPayloadSchema } from "@mindcraft-lang/bridge-protocol";
import { logger } from "#core/logging/logger.js";
import { getAppSession, getExtensionsByAppSessionId } from "#core/session-registry.js";
import { safeSend } from "#transport/ws/safe-send.js";
import type { WsHandler, WsHandlerMap } from "#transport/ws/types.js";

const compileDiagnostics: WsHandler = (ws, payload, id, seq) => {
  const appSession = getAppSession(ws);
  if (!appSession) {
    logger.warn("compile:diagnostics from unregistered app session");
    return;
  }

  const parsed = compileDiagnosticsPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn({ err: parsed.error }, "invalid compile:diagnostics payload");
    return;
  }

  const extensions = getExtensionsByAppSessionId(appSession.id);
  if (extensions.length === 0) {
    return;
  }

  const msg: CompileDiagnosticsMessage = { type: "compile:diagnostics", id, payload: parsed.data };
  const raw = JSON.stringify(msg);
  for (const ext of extensions) {
    if (!safeSend(ext.ws, raw)) {
      logger.warn(
        { extensionSessionId: ext.id, appSessionId: appSession.id },
        "failed to relay compile:diagnostics to extension"
      );
    }
  }
};

const compileStatus: WsHandler = (ws, payload, id, seq) => {
  const appSession = getAppSession(ws);
  if (!appSession) {
    logger.warn("compile:status from unregistered app session");
    return;
  }

  const parsed = compileStatusPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    logger.warn({ err: parsed.error }, "invalid compile:status payload");
    return;
  }

  const extensions = getExtensionsByAppSessionId(appSession.id);
  if (extensions.length === 0) {
    return;
  }

  const msg: CompileStatusMessage = { type: "compile:status", id, payload: parsed.data };
  const raw = JSON.stringify(msg);
  for (const ext of extensions) {
    if (!safeSend(ext.ws, raw)) {
      logger.warn(
        { extensionSessionId: ext.id, appSessionId: appSession.id },
        "failed to relay compile:status to extension"
      );
    }
  }
};

export const compileHandlers: WsHandlerMap = {
  "compile:diagnostics": compileDiagnostics,
  "compile:status": compileStatus,
};
