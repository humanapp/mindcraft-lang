import type { NodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { logger } from "#core/logging/logger.js";
import { removeAppSession } from "#core/session-registry.js";
import { getClientIp, TokenBucket, TokenBucketMap } from "#core/throttle.js";
import { safeSend } from "#transport/ws/safe-send.js";
import { routeAppMessage } from "./router.js";

type UpgradeWebSocket = NodeWebSocket["upgradeWebSocket"];

const MAX_MESSAGE_BYTES = 1_048_576;
const connectionThrottle = new TokenBucketMap(10, 0.5);
const messageBuckets = new Map<WSContext, TokenBucket>();

export function createAppWsRoutes(upgradeWebSocket: UpgradeWebSocket) {
  const routes = new Hono();

  routes.use("*", async (c, next) => {
    if (!connectionThrottle.consume(getClientIp(c))) {
      return c.json({ error: "too many connections" }, 429);
    }
    await next();
  });

  routes.get(
    "/",
    upgradeWebSocket(() => {
      return {
        onOpen(_, ws) {
          logger.info("app ws connection opened");
          messageBuckets.set(ws, new TokenBucket(100, 50));
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
          const bucket = messageBuckets.get(ws);
          if (bucket && !bucket.consume()) {
            safeSend(ws, JSON.stringify({ type: "error", payload: { message: "rate limit exceeded" } }));
            return;
          }
          routeAppMessage(ws, evt.data);
        },
        onClose(_, ws) {
          messageBuckets.delete(ws);
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
