export { WsClient } from "./ws-client.js";

export interface WsMessage {
  type: string;
  id?: string;
  payload?: unknown;
}

export type SessionRole = "app" | "extension";
