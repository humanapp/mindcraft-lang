import { logger } from "#core/logging/logger.js";
import { getExtensionSession, getSessionCount, registerExtensionSession } from "#core/session-registry.js";
import type { WsHandler, WsHandlerMap } from "../../types.js";

const hello: WsHandler = (ws, _payload, id) => {
  const existing = getExtensionSession(ws);
  if (existing) {
    ws.send(
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

  ws.send(
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
