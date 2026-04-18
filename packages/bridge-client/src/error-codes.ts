export const ErrorCode = {
  INVALID_PATH: "INVALID_PATH",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  DIRECTORY_NOT_FOUND: "DIRECTORY_NOT_FOUND",
  PATH_NOT_FOUND: "PATH_NOT_FOUND",
  FILE_READ_ONLY: "FILE_READ_ONLY",
  ETAG_MISMATCH: "ETAG_MISMATCH",
  DIRECTORY_ALREADY_EXISTS: "DIRECTORY_ALREADY_EXISTS",
  DIRECTORY_HAS_READONLY: "DIRECTORY_HAS_READONLY",
  RENAME_SAME_PATH: "RENAME_SAME_PATH",
  BRIDGE_URL_REQUIRED: "BRIDGE_URL_REQUIRED",
  INVALID_CLIENT_ROLE: "INVALID_CLIENT_ROLE",
  SYNC_FAILED: "SYNC_FAILED",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class ProtocolError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ProtocolError";
  }
}
