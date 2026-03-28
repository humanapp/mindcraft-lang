import { logger } from "#core/logging/logger.js";
import { getExtensionSession, getSessionCount, registerExtensionSession } from "#core/session-registry.js";
import { safeSend } from "#transport/ws/safe-send.js";
import type { WsHandler, WsHandlerMap } from "#transport/ws/types.js";

const hello: WsHandler = (ws, _payload, id) => {
  const existing = getExtensionSession(ws);
  if (existing) {
    safeSend(
      ws,
      JSON.stringify({
        type: "session:error",
        id,
        payload: { message: "session already established" },
      })
    );
    return;
  }

  const session = registerExtensionSession(ws);
  const counts = getSessionCount();

  logger.info({ sessionId: session.id, ...counts }, "extension hello accepted");

  safeSend(
    ws,
    JSON.stringify({
      type: "session:welcome",
      id,
      payload: { sessionId: session.id },
    })
  );
};

export const sessionHandlers: WsHandlerMap = {
  "session:hello": hello,
};
