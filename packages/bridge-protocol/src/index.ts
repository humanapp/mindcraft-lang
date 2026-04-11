export const PROTOCOL_VERSION = 1;

export type {
  AppClientMessage,
  AppServerMessage,
  AppSessionJoinCodeMessage,
  AppSessionJoinCodePayload,
  AppSessionWelcomeMessage,
  AppSessionWelcomePayload,
  CompileDiagnosticEntry,
  CompileDiagnosticRange,
  CompileDiagnosticsMessage,
  CompileDiagnosticsPayload,
  CompileStatusMessage,
  CompileStatusPayload,
  ControlPingMessage,
  ControlPongMessage,
  ErrorPayload,
  ExtensionAppStatusMessage,
  ExtensionAppStatusPayload,
  ExtensionClientMessage,
  ExtensionServerMessage,
  ExtensionSessionWelcomeMessage,
  ExtensionSessionWelcomePayload,
  FilesystemChangeMessage,
  FilesystemSyncMessage,
  GeneralErrorMessage,
  SessionErrorMessage,
  SessionGoodbyeMessage,
  SessionHelloMessage,
  SessionHelloPayload,
} from "./messages/index.js";
export {
  compileDiagnosticsPayloadSchema,
  compileStatusPayloadSchema,
  sessionHelloPayloadSchema,
} from "./messages/index.js";
export type { FileSystemNotification, FilesystemSyncPayload } from "./notifications.js";
export {
  fileSystemNotificationSchema,
  filesystemSyncPayloadSchema,
  MAX_FILE_CONTENT_BYTES,
  MAX_SNAPSHOT_CONTENT_BYTES,
} from "./notifications.js";

export type { WsMessage } from "./schemas.js";
export { wsMessageSchema } from "./schemas.js";

export type SessionRole = "app" | "extension";
