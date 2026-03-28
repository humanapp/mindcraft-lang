import type { ErrorPayload } from "./shared.js";

// -- Payloads --

export interface AppSessionWelcomePayload {
  sessionId: string;
  joinCode: string;
}

export interface AppSessionHelloPayload {
  sessionId?: string;
}

export interface AppSessionJoinCodePayload {
  joinCode: string;
}

// -- Client -> Server --

export interface AppSessionHelloMessage {
  type: "session:hello";
  id?: string;
  payload?: AppSessionHelloPayload;
}

export interface AppControlPingMessage {
  type: "control:ping";
  id?: string;
}

export type AppClientMessage = AppSessionHelloMessage | AppControlPingMessage;

// -- Server -> Client --

export interface AppSessionWelcomeMessage {
  type: "session:welcome";
  id?: string;
  payload: AppSessionWelcomePayload;
}

export interface AppSessionJoinCodeMessage {
  type: "session:joinCode";
  payload: AppSessionJoinCodePayload;
}

export interface AppSessionErrorMessage {
  type: "session:error";
  id?: string;
  payload: ErrorPayload;
}

export interface AppControlPongMessage {
  type: "control:pong";
  id?: string;
}

export interface AppErrorMessage {
  type: "error";
  id?: string;
  payload: ErrorPayload;
}

export type AppServerMessage =
  | AppSessionWelcomeMessage
  | AppSessionJoinCodeMessage
  | AppSessionErrorMessage
  | AppControlPongMessage
  | AppErrorMessage;
