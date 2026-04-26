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

/** Payload of {@link ExtensionSessionWelcomeMessage}. */
export interface ExtensionSessionWelcomePayload {
  protocolVersion: number;
  sessionId: string;
}

/** Any message an extension client may send to the bridge. */
export type ExtensionClientMessage =
  | SessionHelloMessage
  | SessionGoodbyeMessage
  | ControlPingMessage
  | FilesystemChangeMessage
  | FilesystemSyncMessage;

/** Initial greeting from the bridge to a newly connected extension client. */
export interface ExtensionSessionWelcomeMessage {
  type: "session:welcome";
  id?: string;
  payload: ExtensionSessionWelcomePayload;
}

/** Payload of {@link ExtensionAppStatusMessage} describing the bound app. */
export interface ExtensionAppStatusPayload {
  /** Whether an app session is currently bound to this extension session. */
  bound: boolean;
  /** Whether the bound app's WebSocket is currently connected. */
  clientConnected?: boolean;
  /** Token the extension can present to rebind the same app session. */
  bindingToken?: string;
}

/** Notifies the extension of changes in the bound app's status. */
export interface ExtensionAppStatusMessage {
  type: "session:appStatus";
  payload: ExtensionAppStatusPayload;
}

/** Any message the bridge may send to an extension client. */
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
