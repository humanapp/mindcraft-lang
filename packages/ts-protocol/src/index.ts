export { WsClient } from "./ws-client.js";

export interface WsMessage {
  type: string;
  id?: string;
  payload?: unknown;
}

export type SessionRole = "extension" | "runtime";

export interface HelloPayload {
  role: SessionRole;
}
