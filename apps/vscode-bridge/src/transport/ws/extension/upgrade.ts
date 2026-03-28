import type { NodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { logger } from "#core/logging/logger.js";
import { removeExtensionSession } from "#core/session-registry.js";
import { routeExtensionMessage } from "./router.js";

type UpgradeWebSocket = NodeWebSocket["upgradeWebSocket"];

export function createExtensionWsRoutes(upgradeWebSocket: UpgradeWebSocket) {
  const routes = new Hono();

  routes.get(
    "/",
    upgradeWebSocket(() => {
      return {
        onOpen() {
          logger.info("extension ws connection opened");
        },
        onMessage(evt, ws) {
          routeExtensionMessage(ws, evt.data.toString());
        },
        onClose(_, ws) {
          const session = removeExtensionSession(ws);
          if (session) {
            logger.info({ sessionId: session.id }, "extension session closed");
          } else {
            logger.info("extension ws connection closed (no session)");
          }
        },
        onError(err) {
          logger.error({ err }, "extension ws error");
        },
      };
    })
  );

  return routes;
}
