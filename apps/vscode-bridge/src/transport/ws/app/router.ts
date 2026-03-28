import type { WSContext } from "hono/ws";
import { logger } from "#core/logging/logger.js";
import { safeSend } from "#transport/ws/safe-send.js";
import type { WsHandlerMap, WsMessage } from "#transport/ws/types.js";
import { controlHandlers } from "./handlers/control.handler.js";
import { sessionHandlers } from "./handlers/session.handler.js";

const handlers: WsHandlerMap = {
  ...sessionHandlers,
  ...controlHandlers,
};

export function routeAppMessage(ws: WSContext, raw: string) {
  let msg: WsMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    safeSend(ws, JSON.stringify({ type: "error", payload: { message: "invalid JSON" } }));
    return;
  }

  if (typeof msg.type !== "string") {
    safeSend(ws, JSON.stringify({ type: "error", payload: { message: "missing message type" } }));
    return;
  }

  const handler = handlers[msg.type];
  if (!handler) {
    logger.warn({ type: msg.type }, "unknown app message type");
    safeSend(ws, JSON.stringify({ type: "error", payload: { message: `unknown type: ${msg.type}` } }));
    return;
  }

  try {
    handler(ws, msg.payload, msg.id);
  } catch (err) {
    logger.error({ err, type: msg.type }, "handler error");
    safeSend(ws, JSON.stringify({ type: "error", id: msg.id, payload: { message: "internal error" } }));
  }
}
