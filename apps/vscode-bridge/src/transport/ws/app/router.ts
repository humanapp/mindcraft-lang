import type { AppErrorMessage } from "@mindcraft-lang/ts-protocol";
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
    const err: AppErrorMessage = { type: "error", payload: { message: "invalid JSON" } };
    safeSend(ws, JSON.stringify(err));
    return;
  }

  if (typeof msg.type !== "string") {
    const err: AppErrorMessage = { type: "error", payload: { message: "missing message type" } };
    safeSend(ws, JSON.stringify(err));
    return;
  }

  const handler = handlers[msg.type];
  if (!handler) {
    logger.warn({ type: msg.type }, "unknown app message type");
    const err: AppErrorMessage = { type: "error", payload: { message: `unknown type: ${msg.type}` } };
    safeSend(ws, JSON.stringify(err));
    return;
  }

  try {
    handler(ws, msg.payload, msg.id);
  } catch (err) {
    logger.error({ err, type: msg.type }, "handler error");
    const errMsg: AppErrorMessage = { type: "error", id: msg.id, payload: { message: "internal error" } };
    safeSend(ws, JSON.stringify(errMsg));
  }
}
