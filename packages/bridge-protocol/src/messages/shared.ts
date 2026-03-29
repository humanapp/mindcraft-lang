import { z } from "zod";
import type { FileSystemNotification } from "../notifications.js";

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

export const sessionHelloPayloadSchema = z.object({
  sessionId: z.string().optional(),
});

export type SessionHelloPayload = z.infer<typeof sessionHelloPayloadSchema>;

export interface SessionHelloMessage {
  type: "session:hello";
  id?: string;
  payload?: SessionHelloPayload;
}

export interface SessionGoodbyeMessage {
  type: "session:goodbye";
  id?: string;
}
