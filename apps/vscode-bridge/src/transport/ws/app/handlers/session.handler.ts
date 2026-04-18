import type { AppSessionWelcomeMessage, SessionErrorMessage } from "@mindcraft-lang/bridge-protocol";
import { PROTOCOL_VERSION, sessionHelloPayloadSchema } from "@mindcraft-lang/bridge-protocol";
import { createBindingToken } from "#core/binding-token.js";
import { logger } from "#core/logging/logger.js";
import {
  discardAppSession,
  getAppSession,
  getSessionCount,
  reclaimAppSession,
  registerAppSession,
} from "#core/session-registry.js";
import { safeSend } from "#transport/ws/safe-send.js";
import type { WsHandler, WsHandlerMap } from "#transport/ws/types.js";

const hello: WsHandler = (ws, payload, id) => {
  const existing = getAppSession(ws);
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

  const clientVersion = helloPayload?.protocolVersion;
  if (clientVersion === undefined || clientVersion < 1 || clientVersion > PROTOCOL_VERSION) {
    logger.warn({ clientVersion, serverVersion: PROTOCOL_VERSION }, "app protocol version mismatch");
    const err: SessionErrorMessage = {
      type: "session:error",
      id,
      payload: {
        message: `unsupported protocol version ${clientVersion}; server supports 1..${PROTOCOL_VERSION}`,
      },
    };
    safeSend(ws, JSON.stringify(err));
    return;
  }

  const session =
    (helloPayload?.sessionId && reclaimAppSession(helloPayload.sessionId, ws)) ||
    registerAppSession(ws, helloPayload?.bindingToken);
  const counts = getSessionCount();

  logger.info(
    { sessionId: session.id, reclaimed: session !== undefined && !!helloPayload?.sessionId, ...counts },
    "app hello accepted"
  );

  const welcome: AppSessionWelcomeMessage = {
    type: "session:welcome",
    id,
    payload: {
      protocolVersion: clientVersion,
      sessionId: session.id,
      joinCode: session.joinCode,
      bindingToken: createBindingToken(session.bindingId),
    },
  };
  safeSend(ws, JSON.stringify(welcome));
};

const goodbye: WsHandler = (ws) => {
  const session = discardAppSession(ws);
  if (session) {
    logger.info({ sessionId: session.id }, "app session goodbye");
  }
};

export const sessionHandlers: WsHandlerMap = {
  "session:hello": hello,
  "session:goodbye": goodbye,
};
