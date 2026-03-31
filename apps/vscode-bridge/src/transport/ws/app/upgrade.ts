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
const STALE_CONNECTION_MS = 60_000;
const STALE_SWEEP_INTERVAL_MS = 15_000;
const connectionThrottle = new TokenBucketMap(10, 0.5);
const messageBuckets = new Map<WSContext, TokenBucket>();
const lastActivity = new Map<WSContext, number>();

const staleSweepTimer = setInterval(() => {
  const now = Date.now();
  for (const [ws, lastAt] of lastActivity) {
    if (now - lastAt > STALE_CONNECTION_MS) {
      logger.warn("closing stale app ws connection");
      lastActivity.delete(ws);
      try {
        ws.close(1000, "idle timeout");
      } catch {}
    }
  }
}, STALE_SWEEP_INTERVAL_MS);
staleSweepTimer.unref();

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
          routeAppMessage(ws, evt.data);
        },
        onClose(_, ws) {
          messageBuckets.delete(ws);
          lastActivity.delete(ws);
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
