import { z } from "zod";
import type { FileSystemNotification, FilesystemSyncPayload } from "../notifications.js";

export interface ErrorPayload {
  message: string;
}

export interface FilesystemChangeMessage {
  type: "filesystem:change";
  id?: string;
  payload?: FileSystemNotification;
  seq?: number;
}

export interface FilesystemSyncMessage {
  type: "filesystem:sync";
  id?: string;
  payload?: FilesystemSyncPayload;
  seq?: number;
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
  joinCode: z.string().optional(),
  appName: z.string().optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
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
