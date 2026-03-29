import type {
  ControlPingMessage,
  ControlPongMessage,
  FilesystemChangeMessage,
  GeneralErrorMessage,
  SessionErrorMessage,
  SessionGoodbyeMessage,
  SessionHelloMessage,
} from "./shared.js";

// -- Payload Types --

export interface AppSessionWelcomePayload {
  sessionId: string;
  joinCode: string;
}

export interface AppSessionJoinCodePayload {
  joinCode: string;
}

// -- Client -> Server --

export type AppClientMessage =
  | SessionHelloMessage
  | SessionGoodbyeMessage
  | ControlPingMessage
  | FilesystemChangeMessage;

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

export type AppServerMessage =
  | AppSessionWelcomeMessage
  | AppSessionJoinCodeMessage
  | SessionErrorMessage
  | ControlPongMessage
  | GeneralErrorMessage;
