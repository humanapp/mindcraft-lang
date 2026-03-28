export const ErrorCode = {
  APP_NAME_REQUIRED: "APP_NAME_REQUIRED",
  PROJECT_ID_REQUIRED: "PROJECT_ID_REQUIRED",
  PROJECT_NAME_REQUIRED: "PROJECT_NAME_REQUIRED",
  BRIDGE_URL_REQUIRED: "BRIDGE_URL_REQUIRED",
  INVALID_CLIENT_ROLE: "INVALID_CLIENT_ROLE",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AuthoringError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AuthoringError";
  }
}
