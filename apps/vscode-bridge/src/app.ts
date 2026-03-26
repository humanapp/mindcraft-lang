import { Hono } from "hono";
import { errorHandler } from "#transport/http/middleware/error-handler.js";
import { requestLogger } from "#transport/http/middleware/request-logger.js";
import { health } from "#transport/http/routes/health.js";
import { ws } from "#transport/http/routes/ws.js";

export function createApp() {
  const app = new Hono();

  app.use("*", requestLogger);

  app.route("/", health);
  app.route("/ws", ws);

  app.onError(errorHandler);

  return app;
}
