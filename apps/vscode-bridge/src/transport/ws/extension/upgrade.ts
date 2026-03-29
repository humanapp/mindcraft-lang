import type { NodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { logger } from "#core/logging/logger.js";
import { removeExtensionSession } from "#core/session-registry.js";
import { getClientIp, TokenBucket, TokenBucketMap } from "#core/throttle.js";
import { safeSend } from "#transport/ws/safe-send.js";
import { routeExtensionMessage } from "./router.js";

type UpgradeWebSocket = NodeWebSocket["upgradeWebSocket"];

const MAX_MESSAGE_BYTES = 1_048_576;
const connectionThrottle = new TokenBucketMap(10, 0.5);
const messageBuckets = new Map<WSContext, TokenBucket>();

export function createExtensionWsRoutes(upgradeWebSocket: UpgradeWebSocket) {
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
          logger.info("extension ws connection opened");
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
          routeExtensionMessage(ws, evt.data);
        },
        onClose(_, ws) {
          messageBuckets.delete(ws);
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
