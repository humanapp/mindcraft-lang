/** Wire-format version of the bridge protocol. Bumped on incompatible changes. */
export const PROTOCOL_VERSION = 1;

export type {
  FolderAckMessage,
  FolderAppMessage,
  FolderChangeMessage,
  FolderDiagnosticsMessage,
  FolderErrorMessage,
  FolderErrorPayload,
  FolderExternalChangeMessage,
  FolderFilesMessage,
  FolderHelloMessage,
  FolderHelloPayload,
  FolderHostMessage,
  FolderLoadFilesMessage,
  FolderManifestWriteMessage,
  FolderManifestWritePayload,
  FolderWelcomeMessage,
  FolderWelcomePayload,
} from "./folder-session.js";
export {
  FOLDER_HOST_MODE_FOLDER,
  FOLDER_HOST_MODE_GLOBAL,
  FOLDER_HOST_MODE_URL_PARAM,
  FOLDER_SESSION_PROTOCOL_VERSION,
  FolderSessionErrorCode,
} from "./folder-session.js";
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
  filesystemNotificationSchema,
  filesystemSyncPayloadSchema,
  MAX_FILE_CONTENT_BYTES,
  MAX_SNAPSHOT_CONTENT_BYTES,
} from "./notifications.js";

export type { WsMessage } from "./schemas.js";
export { wsMessageSchema } from "./schemas.js";

/** Identifies which side of the bridge a session belongs to. */
export type SessionRole = "app" | "extension";
