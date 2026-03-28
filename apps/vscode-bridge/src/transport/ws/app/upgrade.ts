import type { NodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { logger } from "#core/logging/logger.js";
import { removeAppSession } from "#core/session-registry.js";
import { routeAppMessage } from "./router.js";

type UpgradeWebSocket = NodeWebSocket["upgradeWebSocket"];

export function createAppWsRoutes(upgradeWebSocket: UpgradeWebSocket) {
  const routes = new Hono();

  routes.get(
    "/",
    upgradeWebSocket(() => {
      return {
        onOpen() {
          logger.info("app ws connection opened");
        },
        onMessage(evt, ws) {
          routeAppMessage(ws, evt.data.toString());
        },
        onClose(_, ws) {
          const session = removeAppSession(ws);
          if (session) {
            logger.info({ sessionId: session.id }, "app session closed");
          } else {
            logger.info("app ws connection closed (no session)");
          }
        },
        onError(err) {
          logger.error({ err }, "app ws error");
        },
      };
    })
  );

  return routes;
}
