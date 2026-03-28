import type { WSContext } from "hono/ws";
import { logger } from "#core/logging/logger.js";

export function safeSend(ws: WSContext, data: string): boolean {
  try {
    ws.send(data);
    return true;
  } catch (err) {
    logger.warn({ err }, "failed to send WebSocket message");
    return false;
  }
}
