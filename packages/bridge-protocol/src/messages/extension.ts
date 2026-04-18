import type { CompileDiagnosticsMessage, CompileStatusMessage } from "./compile.js";
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

export interface ExtensionSessionWelcomePayload {
  protocolVersion: number;
  sessionId: string;
}

export type ExtensionClientMessage =
  | SessionHelloMessage
  | SessionGoodbyeMessage
  | ControlPingMessage
  | FilesystemChangeMessage
  | FilesystemSyncMessage;

export interface ExtensionSessionWelcomeMessage {
  type: "session:welcome";
  id?: string;
  payload: ExtensionSessionWelcomePayload;
}

export interface ExtensionAppStatusPayload {
  bound: boolean;
  clientConnected?: boolean;
  bindingToken?: string;
}

export interface ExtensionAppStatusMessage {
  type: "session:appStatus";
  payload: ExtensionAppStatusPayload;
}

export type ExtensionServerMessage =
  | ExtensionSessionWelcomeMessage
  | ExtensionAppStatusMessage
  | SessionErrorMessage
  | ControlPongMessage
  | GeneralErrorMessage
  | FilesystemChangeMessage
  | FilesystemSyncMessage
  | CompileDiagnosticsMessage
  | CompileStatusMessage;
