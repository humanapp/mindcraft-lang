import type { ErrorPayload } from "./shared.js";

// -- Payloads --

export interface ExtensionSessionWelcomePayload {
  sessionId: string;
}

// -- Client -> Server --

export interface ExtensionSessionHelloMessage {
  type: "session:hello";
  id?: string;
}

export interface ExtensionControlPingMessage {
  type: "control:ping";
  id?: string;
}

export type ExtensionClientMessage = ExtensionSessionHelloMessage | ExtensionControlPingMessage;

// -- Server -> Client --

export interface ExtensionSessionWelcomeMessage {
  type: "session:welcome";
  id?: string;
  payload: ExtensionSessionWelcomePayload;
}

export interface ExtensionSessionErrorMessage {
  type: "session:error";
  id?: string;
  payload: ErrorPayload;
}

export interface ExtensionControlPongMessage {
  type: "control:pong";
  id?: string;
}

export interface ExtensionErrorMessage {
  type: "error";
  id?: string;
  payload: ErrorPayload;
}

export type ExtensionServerMessage =
  | ExtensionSessionWelcomeMessage
  | ExtensionSessionErrorMessage
  | ExtensionControlPongMessage
  | ExtensionErrorMessage;
