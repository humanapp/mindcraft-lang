import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { getClientIp, TokenBucketMap } from "#core/throttle.js";
import { errorHandler } from "#transport/http/middleware/error-handler.js";
import { requestLogger } from "#transport/http/middleware/request-logger.js";
import { health } from "#transport/http/routes/health.js";
import { createAppWsRoutes } from "#transport/ws/app/upgrade.js";
import { createExtensionWsRoutes } from "#transport/ws/extension/upgrade.js";

const httpThrottle = new TokenBucketMap(30, 2);

export function createApp() {
  const app = new Hono();
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  app.use("*", requestLogger);

  app.use("/health", async (c, next) => {
    if (!httpThrottle.consume(getClientIp(c))) {
      return c.json({ error: "rate limit exceeded" }, 429);
    }
    await next();
  });

  app.route("/", health);
  app.route("/app", createAppWsRoutes(upgradeWebSocket));
  app.route("/extension", createExtensionWsRoutes(upgradeWebSocket));

  app.onError(errorHandler);

  return { app, injectWebSocket };
}
