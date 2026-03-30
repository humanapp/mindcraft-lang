import type {
  ExtensionAppStatusMessage,
  ExtensionSessionWelcomeMessage,
  SessionErrorMessage,
} from "@mindcraft-lang/bridge-protocol";
import { sessionHelloPayloadSchema } from "@mindcraft-lang/bridge-protocol";
import { logger } from "#core/logging/logger.js";
import {
  discardExtensionSession,
  getExtensionSession,
  getSessionCount,
  reclaimExtensionSession,
  registerExtensionSession,
} from "#core/session-registry.js";
import { safeSend } from "#transport/ws/safe-send.js";
import type { WsHandler, WsHandlerMap } from "#transport/ws/types.js";

const hello: WsHandler = (ws, payload, id) => {
  const existing = getExtensionSession(ws);
  if (existing) {
    const err: SessionErrorMessage = {
      type: "session:error",
      id,
      payload: { message: "session already established" },
    };
    safeSend(ws, JSON.stringify(err));
    return;
  }

  const parsed = sessionHelloPayloadSchema.optional().safeParse(payload);
  if (!parsed.success) {
    const err: SessionErrorMessage = {
      type: "session:error",
      id,
      payload: { message: "invalid hello payload" },
    };
    safeSend(ws, JSON.stringify(err));
    return;
  }

  const helloPayload = parsed.data;
  const session =
    (helloPayload?.sessionId && reclaimExtensionSession(helloPayload.sessionId, ws)) ||
    registerExtensionSession(ws, helloPayload?.joinCode);
  const counts = getSessionCount();

  logger.info(
    { sessionId: session.id, reclaimed: session !== undefined && !!helloPayload?.sessionId, ...counts },
    "extension hello accepted"
  );

  const welcome: ExtensionSessionWelcomeMessage = {
    type: "session:welcome",
    id,
    payload: { sessionId: session.id },
  };
  safeSend(ws, JSON.stringify(welcome));

  const appStatus: ExtensionAppStatusMessage = {
    type: "session:appStatus",
    payload: { bound: session.appSessionId !== undefined },
  };
  safeSend(ws, JSON.stringify(appStatus));
};

const goodbye: WsHandler = (ws) => {
  const session = discardExtensionSession(ws);
  if (session) {
    logger.info({ sessionId: session.id }, "extension session goodbye");
  }
};

export const sessionHandlers: WsHandlerMap = {
  "session:hello": hello,
  "session:goodbye": goodbye,
};
