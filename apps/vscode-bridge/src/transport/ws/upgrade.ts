import type { NodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { logger } from "#core/logging/logger.js";
import { removeSession } from "#core/session-registry.js";
import { routeMessage } from "./router.js";

export type UpgradeWebSocket = NodeWebSocket["upgradeWebSocket"];

export function createWsRoutes(upgradeWebSocket: UpgradeWebSocket) {
  const ws = new Hono();

  ws.get(
    "/",
    upgradeWebSocket((c) => {
      return {
        onOpen(_, ws) {
          logger.info("ws connection opened");
        },
        onMessage(evt, ws) {
          routeMessage(ws, evt.data.toString());
        },
        onClose(_, ws) {
          const session = removeSession(ws);
          if (session) {
            logger.info({ sessionId: session.id, role: session.role }, "ws session closed");
          } else {
            logger.info("ws connection closed (no session)");
          }
        },
        onError(err) {
          logger.error({ err }, "ws error");
        },
      };
    })
  );

  return ws;
}
