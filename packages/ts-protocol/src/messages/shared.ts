import type { FileSystemNotification } from "../filesystem.js";

export interface ErrorPayload {
  message: string;
}

export interface FilesystemChangeMessage {
  type: "filesystem:change";
  id?: string;
  payload: FileSystemNotification;
}
