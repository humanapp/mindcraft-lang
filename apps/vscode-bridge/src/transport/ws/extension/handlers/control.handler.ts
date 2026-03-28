import type { WsHandler, WsHandlerMap } from "../../types.js";

const ping: WsHandler = (ws, _payload, id) => {
  ws.send(JSON.stringify({ type: "control:pong", id }));
};

export const controlHandlers: WsHandlerMap = {
  "control:ping": ping,
};
