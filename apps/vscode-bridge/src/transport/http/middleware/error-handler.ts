import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "#core/logging/logger.js";

export function errorHandler(err: Error, c: Context) {
  if (err instanceof HTTPException) {
    logger.warn({ status: err.status, message: err.message }, "HTTP exception");
    return c.json({ error: err.message }, err.status);
  }

  logger.error({ err }, "unhandled error");
  return c.json({ error: "Internal Server Error" }, 500);
}
