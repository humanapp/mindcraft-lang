import type {
  ControlPingMessage,
  ControlPongMessage,
  FilesystemChangeMessage,
  FilesystemSyncMessage,
  GeneralErrorMessage,
  SessionErrorMessage,
  SessionGoodbyeMessage,
  SessionHelloMessage,
} from "./shared.js";

export interface AppSessionWelcomePayload {
  sessionId: string;
  joinCode: string;
}

export interface AppSessionJoinCodePayload {
  joinCode: string;
}

export type AppClientMessage =
  | SessionHelloMessage
  | SessionGoodbyeMessage
  | ControlPingMessage
  | FilesystemChangeMessage
  | FilesystemSyncMessage;

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
  | GeneralErrorMessage
  | FilesystemChangeMessage
  | FilesystemSyncMessage;
