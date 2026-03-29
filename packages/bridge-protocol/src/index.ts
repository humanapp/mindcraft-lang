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
export type { FileSystemNotification } from "./notifications.js";
export { fileSystemNotificationSchema } from "./notifications.js";

export type { WsMessage } from "./schemas.js";
export { wsMessageSchema } from "./schemas.js";

export type SessionRole = "app" | "extension";
