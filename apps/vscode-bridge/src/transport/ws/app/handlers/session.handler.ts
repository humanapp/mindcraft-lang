import type { AppSessionErrorMessage, AppSessionWelcomeMessage } from "@mindcraft-lang/ts-protocol";
import { logger } from "#core/logging/logger.js";
import { getAppSession, getSessionCount, registerAppSession } from "#core/session-registry.js";
import { safeSend } from "#transport/ws/safe-send.js";
import type { WsHandler, WsHandlerMap } from "#transport/ws/types.js";

const hello: WsHandler = (ws, _payload, id) => {
  const existing = getAppSession(ws);
  if (existing) {
    const err: AppSessionErrorMessage = {
      type: "session:error",
      id,
      payload: { message: "session already established" },
    };
    safeSend(ws, JSON.stringify(err));
    return;
  }

  const session = registerAppSession(ws);
  const counts = getSessionCount();

  logger.info({ sessionId: session.id, ...counts }, "app hello accepted");

  const welcome: AppSessionWelcomeMessage = {
    type: "session:welcome",
    id,
    payload: { sessionId: session.id, joinCode: session.joinCode },
  };
  safeSend(ws, JSON.stringify(welcome));
};

export const sessionHandlers: WsHandlerMap = {
  "session:hello": hello,
};
