export { ErrorCode, ProtocolError } from "./error-codes.js";
export type {
  ExportedFileSystem,
  ExportedFileSystemEntry,
  FileSystemNotification,
  FileTreeEntry,
  IFileSystem,
  StatResult,
} from "./filesystem.js";
export { FileSystem, fileSystemNotificationSchema, NotifyingFileSystem } from "./filesystem.js";
export type { WsMessage } from "./schemas.js";

export { wsMessageSchema } from "./schemas.js";
export { WsClient } from "./ws-client.js";

export type SessionRole = "app" | "extension";

export type {
  AppClientMessage,
  AppServerMessage,
  AppSessionJoinCodeMessage,
  AppSessionJoinCodePayload,
  AppSessionWelcomeMessage,
  AppSessionWelcomePayload,
  ControlPingMessage,
  ControlPongMessage,
  ErrorPayload,
  ExtensionClientMessage,
  ExtensionServerMessage,
  ExtensionSessionWelcomeMessage,
  ExtensionSessionWelcomePayload,
  FilesystemChangeMessage,
  GeneralErrorMessage,
  SessionErrorMessage,
  SessionGoodbyeMessage,
  SessionHelloMessage,
  SessionHelloPayload,
} from "./messages/index.js";
export { sessionHelloPayloadSchema } from "./messages/index.js";
