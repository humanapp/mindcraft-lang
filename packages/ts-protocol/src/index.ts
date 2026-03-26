export interface WsMessage {
  type: string;
  id?: string;
  payload?: unknown;
}
