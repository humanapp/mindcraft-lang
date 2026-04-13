import { serve } from "@hono/node-server";
import type { Hono } from "hono";
import { env } from "#config/env.js";
import { logger } from "#core/logging/logger.js";
import { closeAllSessions } from "#core/session-registry.js";

export function startServer(app: Hono) {
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "uncaught exception");
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "unhandled rejection");
    process.exit(1);
  });

  const server = serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      logger.info({ port: info.port }, "server started");
    }
  );

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    closeAllSessions();
    server.close(() => {
      logger.info("server closed");
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error("forced shutdown after timeout");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  return server;
}
