export { WsClient } from "./ws-client.js";

export interface WsMessage {
  type: string;
  id?: string;
  payload?: unknown;
}

export type SessionRole = "app" | "extension";

export type {
  AppClientMessage,
  AppControlPingMessage,
  AppControlPongMessage,
  AppErrorMessage,
  AppServerMessage,
  AppSessionErrorMessage,
  AppSessionHelloMessage,
  AppSessionHelloPayload,
  AppSessionJoinCodeMessage,
  AppSessionJoinCodePayload,
  AppSessionWelcomeMessage,
  AppSessionWelcomePayload,
  ErrorPayload,
  ExtensionClientMessage,
  ExtensionControlPingMessage,
  ExtensionControlPongMessage,
  ExtensionErrorMessage,
  ExtensionServerMessage,
  ExtensionSessionErrorMessage,
  ExtensionSessionHelloMessage,
  ExtensionSessionWelcomeMessage,
  ExtensionSessionWelcomePayload,
} from "./messages/index.js";
