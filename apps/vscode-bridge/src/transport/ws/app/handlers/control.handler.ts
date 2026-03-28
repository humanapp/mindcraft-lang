import { safeSend } from "#transport/ws/safe-send.js";
import type { WsHandler, WsHandlerMap } from "#transport/ws/types.js";

const ping: WsHandler = (ws, _payload, id) => {
  safeSend(ws, JSON.stringify({ type: "control:pong", id }));
};

export const controlHandlers: WsHandlerMap = {
  "control:ping": ping,
};
