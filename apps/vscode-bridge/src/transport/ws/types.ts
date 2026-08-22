import type { WSContext } from "hono/ws";

export type { WsMessage } from "@wendoo/bridge-protocol";
export { wsMessageSchema } from "@wendoo/bridge-protocol";

export type WsHandler = (ws: WSContext, payload: unknown, id?: string, seq?: number) => void;

export type WsHandlerMap = Record<string, WsHandler>;
