import type {
  ControlPingMessage,
  ControlPongMessage,
  FilesystemChangeMessage,
  GeneralErrorMessage,
  SessionErrorMessage,
  SessionGoodbyeMessage,
  SessionHelloMessage,
} from "./shared.js";

// -- Payloads --

export interface ExtensionSessionWelcomePayload {
  sessionId: string;
}

// -- Client -> Server --

export type ExtensionClientMessage =
  | SessionHelloMessage
  | SessionGoodbyeMessage
  | ControlPingMessage
  | FilesystemChangeMessage;

// -- Server -> Client --

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
