export { ErrorCode, ProtocolError } from "./error-codes.js";
export type {
  ExportedFileSystem,
  ExportedFileSystemEntry,
  FileSystemNotification,
  FileTreeEntry,
  IFileSystem,
  StatResult,
} from "./filesystem.js";
export { FileSystem, NotifyingFileSystem } from "./filesystem.js";
export { WsClient } from "./ws-client.js";

export interface WsMessage {
  type: string;
  id?: string;
  payload?: unknown;
}

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
