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
  AppControlPingMessage,
  AppControlPongMessage,
  AppErrorMessage,
  AppServerMessage,
  AppSessionErrorMessage,
  AppSessionGoodbyeMessage,
  AppSessionHelloMessage,
  AppSessionHelloPayload,
  AppSessionJoinCodeMessage,
  AppSessionJoinCodePayload,
  AppSessionWelcomeMessage,
  AppSessionWelcomePayload,
  ErrorPayload,
  ExtensionClientMessage,
  ExtensionControlPingMessage,
  ExtensionControlPongMessage,
  ExtensionErrorMessage,
  ExtensionServerMessage,
  ExtensionSessionErrorMessage,
  ExtensionSessionHelloMessage,
  ExtensionSessionWelcomeMessage,
  ExtensionSessionWelcomePayload,
  FilesystemChangeMessage,
} from "./messages/index.js";
export { appSessionHelloPayloadSchema } from "./messages/index.js";
