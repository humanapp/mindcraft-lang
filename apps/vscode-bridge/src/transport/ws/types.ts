import type { WSContext } from "hono/ws";

export type { WsMessage } from "@mindcraft-lang/bridge-client";
export { wsMessageSchema } from "@mindcraft-lang/bridge-client";

export type WsHandler = (ws: WSContext, payload: unknown, id?: string) => void;

export type WsHandlerMap = Record<string, WsHandler>;
