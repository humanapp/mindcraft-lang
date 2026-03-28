import type { ExtensionSessionErrorMessage, ExtensionSessionWelcomeMessage } from "@mindcraft-lang/ts-protocol";
import { logger } from "#core/logging/logger.js";
import { getExtensionSession, getSessionCount, registerExtensionSession } from "#core/session-registry.js";
import { safeSend } from "#transport/ws/safe-send.js";
import type { WsHandler, WsHandlerMap } from "#transport/ws/types.js";

const hello: WsHandler = (ws, _payload, id) => {
  const existing = getExtensionSession(ws);
  if (existing) {
    const err: ExtensionSessionErrorMessage = {
      type: "session:error",
      id,
      payload: { message: "session already established" },
    };
    safeSend(ws, JSON.stringify(err));
    return;
  }

  const session = registerExtensionSession(ws);
  const counts = getSessionCount();

  logger.info({ sessionId: session.id, ...counts }, "extension hello accepted");

  const welcome: ExtensionSessionWelcomeMessage = {
    type: "session:welcome",
    id,
    payload: { sessionId: session.id },
  };
  safeSend(ws, JSON.stringify(welcome));
};

export const sessionHandlers: WsHandlerMap = {
  "session:hello": hello,
};
