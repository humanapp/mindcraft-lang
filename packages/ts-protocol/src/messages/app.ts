import { z } from "zod";
import type {
  ControlPingMessage,
  ControlPongMessage,
  FilesystemChangeMessage,
  GeneralErrorMessage,
  SessionErrorMessage,
} from "./shared.js";

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

export type AppClientMessage =
  | AppSessionHelloMessage
  | AppSessionGoodbyeMessage
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
