import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { errorHandler } from "#transport/http/middleware/error-handler.js";
import { requestLogger } from "#transport/http/middleware/request-logger.js";
import { health } from "#transport/http/routes/health.js";
import { createWsRoutes } from "#transport/ws/upgrade.js";

export function createApp() {
  const app = new Hono();
  const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

  app.use("*", requestLogger);

  app.route("/", health);
  app.route("/ws", createWsRoutes(upgradeWebSocket));

  app.onError(errorHandler);

  return { app, injectWebSocket };
}
