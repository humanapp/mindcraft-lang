import type { GeneralErrorMessage } from "@mindcraft-lang/bridge-protocol";
import type { WSContext } from "hono/ws";
import { logger } from "#core/logging/logger.js";
import { safeSend } from "#transport/ws/safe-send.js";
import type { WsHandlerMap } from "#transport/ws/types.js";
import { wsMessageSchema } from "#transport/ws/types.js";
import { compileHandlers } from "./handlers/compile.handler.js";
import { controlHandlers } from "./handlers/control.handler.js";
import { debugHandlers } from "./handlers/debug.handler.js";
import { projectHandlers } from "./handlers/project.handler.js";
import { sessionHandlers } from "./handlers/session.handler.js";
import { vfsHandlers } from "./handlers/vfs.handler.js";

const handlers: WsHandlerMap = {
  ...sessionHandlers,
  ...controlHandlers,
  ...compileHandlers,
  ...debugHandlers,
  ...projectHandlers,
  ...vfsHandlers,
};

export function routeExtensionMessage(ws: WSContext, raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const err: GeneralErrorMessage = { type: "error", payload: { message: "invalid JSON" } };
    safeSend(ws, JSON.stringify(err));
    return;
  }

  const result = wsMessageSchema.safeParse(parsed);
  if (!result.success) {
    const err: GeneralErrorMessage = { type: "error", payload: { message: "invalid message envelope" } };
    safeSend(ws, JSON.stringify(err));
    return;
  }

  const msg = result.data;

  const handler = handlers[msg.type];
  if (!handler) {
    logger.warn({ type: msg.type }, "unknown extension message type");
    const err: GeneralErrorMessage = { type: "error", payload: { message: `unknown type: ${msg.type}` } };
    safeSend(ws, JSON.stringify(err));
    return;
  }

  try {
    handler(ws, msg.payload, msg.id, msg.seq);
  } catch (err) {
    logger.error({ err, type: msg.type }, "handler error");
    const errMsg: GeneralErrorMessage = { type: "error", id: msg.id, payload: { message: "internal error" } };
    safeSend(ws, JSON.stringify(errMsg));
  }
}
