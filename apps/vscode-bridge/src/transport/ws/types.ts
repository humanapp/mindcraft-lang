import type { WSContext } from "hono/ws";

export interface WsMessage {
  type: string;
  id?: string;
  payload?: unknown;
}

export type WsHandler = (ws: WSContext, payload: unknown, id?: string) => void;

export type WsHandlerMap = Record<string, WsHandler>;
