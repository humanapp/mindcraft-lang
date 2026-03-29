import type { AppSessionWelcomeMessage, SessionErrorMessage } from "@mindcraft-lang/ts-protocol";
import { appSessionHelloPayloadSchema } from "@mindcraft-lang/ts-protocol";
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

  const parsed = appSessionHelloPayloadSchema.optional().safeParse(payload);
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
  const session = (helloPayload?.sessionId && reclaimAppSession(helloPayload.sessionId, ws)) || registerAppSession(ws);
  const counts = getSessionCount();

  logger.info(
    { sessionId: session.id, reclaimed: session !== undefined && !!helloPayload?.sessionId, ...counts },
    "app hello accepted"
  );

  const welcome: AppSessionWelcomeMessage = {
    type: "session:welcome",
    id,
    payload: { sessionId: session.id, joinCode: session.joinCode },
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
