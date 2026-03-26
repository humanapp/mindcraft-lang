import type { NodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { logger } from "#core/logging/logger.js";
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
        onClose() {
          logger.info("ws connection closed");
        },
        onError(err) {
          logger.error({ err }, "ws error");
        },
      };
    })
  );

  return ws;
}
