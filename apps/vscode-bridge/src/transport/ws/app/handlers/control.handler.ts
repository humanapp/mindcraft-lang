import type { AppControlPongMessage } from "@mindcraft-lang/ts-protocol";
import { safeSend } from "#transport/ws/safe-send.js";
import type { WsHandler, WsHandlerMap } from "#transport/ws/types.js";

const ping: WsHandler = (ws, _payload, id) => {
  const pong: AppControlPongMessage = { type: "control:pong", id };
  safeSend(ws, JSON.stringify(pong));
};

export const controlHandlers: WsHandlerMap = {
  "control:ping": ping,
};
