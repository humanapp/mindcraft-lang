import type { FileSystemNotification } from "../filesystem.js";

export interface ErrorPayload {
  message: string;
}

export interface FilesystemChangeMessage {
  type: "filesystem:change";
  id?: string;
  payload: FileSystemNotification;
}

export interface ControlPingMessage {
  type: "control:ping";
  id?: string;
}

export interface ControlPongMessage {
  type: "control:pong";
  id?: string;
}

export interface SessionErrorMessage {
  type: "session:error";
  id?: string;
  payload: ErrorPayload;
}

export interface GeneralErrorMessage {
  type: "error";
  id?: string;
  payload: ErrorPayload;
}
