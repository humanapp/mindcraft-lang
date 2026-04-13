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
const STALE_CONNECTION_MS = 60_000;
const STALE_SWEEP_INTERVAL_MS = 15_000;
const connectionThrottle = new TokenBucketMap(10, 0.5);
const messageBuckets = new Map<WSContext, TokenBucket>();
const lastActivity = new Map<WSContext, number>();

const staleSweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [ws, lastAt] of lastActivity) {
    if (now - lastAt > STALE_CONNECTION_MS) {
      logger.warn("closing stale extension ws connection");
      lastActivity.delete(ws);
      try {
        ws.close(1000, "idle timeout");
      } catch {}
    }
  }
}, STALE_SWEEP_INTERVAL_MS);
staleSweepTimer.unref();

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
          lastActivity.set(ws, Date.now());
        },
        onMessage(evt, ws) {
          lastActivity.set(ws, Date.now());
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
          lastActivity.delete(ws);
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
