import type { WSContext } from "hono/ws";

export type { WsMessage } from "@mindcraft-lang/ts-protocol";

export type WsHandler = (ws: WSContext, payload: unknown, id?: string) => void;

export type WsHandlerMap = Record<string, WsHandler>;
