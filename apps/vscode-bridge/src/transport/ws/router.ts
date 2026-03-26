import type { WSContext } from "hono/ws";
import { logger } from "#core/logging/logger.js";
import { compileHandlers } from "./handlers/compile.handler.js";
import { controlHandlers } from "./handlers/control.handler.js";
import { debugHandlers } from "./handlers/debug.handler.js";
import { projectHandlers } from "./handlers/project.handler.js";
import { sessionHandlers } from "./handlers/session.handler.js";
import { vfsHandlers } from "./handlers/vfs.handler.js";
import type { WsHandlerMap, WsMessage } from "./types.js";

const handlers: WsHandlerMap = {
  ...vfsHandlers,
  ...controlHandlers,
  ...sessionHandlers,
  ...debugHandlers,
  ...projectHandlers,
  ...compileHandlers,
};

export function routeMessage(ws: WSContext, raw: string) {
  let msg: WsMessage;
  try {
    msg = JSON.parse(raw);
  } catch {
    ws.send(JSON.stringify({ type: "error", payload: { message: "invalid JSON" } }));
    return;
  }

  if (typeof msg.type !== "string") {
    ws.send(JSON.stringify({ type: "error", payload: { message: "missing message type" } }));
    return;
  }

  const handler = handlers[msg.type];
  if (!handler) {
    logger.warn({ type: msg.type }, "unknown message type");
    ws.send(JSON.stringify({ type: "error", payload: { message: `unknown type: ${msg.type}` } }));
    return;
  }

  handler(ws, msg.payload, msg.id);
}
