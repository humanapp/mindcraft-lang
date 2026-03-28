import type { NodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { logger } from "#core/logging/logger.js";
import { removeExtensionSession } from "#core/session-registry.js";
import { safeSend } from "#transport/ws/safe-send.js";
import { routeExtensionMessage } from "./router.js";

type UpgradeWebSocket = NodeWebSocket["upgradeWebSocket"];

const MAX_MESSAGE_BYTES = 1_048_576;

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
          if (typeof evt.data !== "string") {
            safeSend(ws, JSON.stringify({ type: "error", payload: { message: "binary messages not supported" } }));
            return;
          }
          if (evt.data.length > MAX_MESSAGE_BYTES) {
            safeSend(ws, JSON.stringify({ type: "error", payload: { message: "message too large" } }));
            return;
          }
          routeExtensionMessage(ws, evt.data);
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
