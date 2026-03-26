import type { HelloPayload, SessionRole } from "@mindcraft-lang/ts-protocol";
import { logger } from "#core/logging/logger.js";
import { getSession, getSessionCount, registerSession } from "#core/session-registry.js";
import type { WsHandler, WsHandlerMap } from "../types.js";

const VALID_ROLES: ReadonlySet<SessionRole> = new Set(["extension", "runtime"]);

const hello: WsHandler = (ws, payload, id) => {
  const existing = getSession(ws);
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

  const { role } = (payload ?? {}) as Partial<HelloPayload>;

  if (!role || !VALID_ROLES.has(role)) {
    ws.send(
      JSON.stringify({
        type: "session:error",
        id,
        payload: { message: "invalid or missing role; expected 'extension' or 'runtime'" },
      })
    );
    return;
  }

  const session = registerSession(ws, role);
  const counts = getSessionCount();

  logger.info({ sessionId: session.id, role, ...counts }, "hello accepted");

  ws.send(
    JSON.stringify({
      type: "session:welcome",
      id,
      payload: { sessionId: session.id, role },
    })
  );
};

export const sessionHandlers: WsHandlerMap = {
  "session:hello": hello,
};
