import type {
  ControlPingMessage,
  ControlPongMessage,
  FilesystemChangeMessage,
  GeneralErrorMessage,
  SessionErrorMessage,
  SessionGoodbyeMessage,
  SessionHelloMessage,
} from "./shared.js";

export interface ExtensionSessionWelcomePayload {
  sessionId: string;
}

export type ExtensionClientMessage =
  | SessionHelloMessage
  | SessionGoodbyeMessage
  | ControlPingMessage
  | FilesystemChangeMessage;

export interface ExtensionSessionWelcomeMessage {
  type: "session:welcome";
  id?: string;
  payload: ExtensionSessionWelcomePayload;
}

export type ExtensionServerMessage =
  | ExtensionSessionWelcomeMessage
  | SessionErrorMessage
  | ControlPongMessage
  | GeneralErrorMessage;
