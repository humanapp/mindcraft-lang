import { z } from "zod";
import type { ErrorPayload, FilesystemChangeMessage } from "./shared.js";

// -- Payload Schemas --

export const appSessionHelloPayloadSchema = z.object({
  sessionId: z.string().optional(),
});

// -- Payload Types --

export interface AppSessionWelcomePayload {
  sessionId: string;
  joinCode: string;
}

export type AppSessionHelloPayload = z.infer<typeof appSessionHelloPayloadSchema>;

export interface AppSessionJoinCodePayload {
  joinCode: string;
}

// -- Client -> Server --

export interface AppSessionHelloMessage {
  type: "session:hello";
  id?: string;
  payload?: AppSessionHelloPayload;
}

export interface AppSessionGoodbyeMessage {
  type: "session:goodbye";
  id?: string;
}

export interface AppControlPingMessage {
  type: "control:ping";
  id?: string;
}

export type AppClientMessage =
  | AppSessionHelloMessage
  | AppSessionGoodbyeMessage
  | AppControlPingMessage
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
