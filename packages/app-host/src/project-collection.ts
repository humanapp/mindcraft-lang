import { AppHostErrorCode, appHostError } from "./app-host-error.js";

/** The stable id for the bootstrap project collection. */
export const DEFAULT_PROJECT_COLLECTION_ID = "default";

/** The display name used when creating the bootstrap project collection. */
export const DEFAULT_PROJECT_COLLECTION_NAME = "Default Workspace";

/** Maximum length for a project collection display name after trimming. */
export const PROJECT_COLLECTION_NAME_MAX_LENGTH = 80;

/**
 * Trim and validate a project collection display name.
 *
 * @param name - User-facing project collection name.
 * @returns The trimmed name to persist.
 * @throws AppHostError when the trimmed name is empty or too long.
 */
export function normalizeProjectCollectionName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw appHostError(AppHostErrorCode.INVALID_PROJECT_COLLECTION_NAME, "Workspace name is required");
  }
  if (trimmed.length > PROJECT_COLLECTION_NAME_MAX_LENGTH) {
    throw appHostError(
      AppHostErrorCode.INVALID_PROJECT_COLLECTION_NAME,
      `Workspace name must be ${PROJECT_COLLECTION_NAME_MAX_LENGTH} characters or fewer`
    );
  }
  return trimmed;
}

/** Stored verifier for a protected project collection PIN. */
export interface ProjectCollectionPinVerifier {
  /** Verifier scheme used to derive and compare the stored hash. */
  scheme: "v1";
  /** Base64-encoded verifier salt. */
  salt: string;
  /** Base64-encoded verifier hash. */
  hash: string;
  /** Unix epoch timestamp in milliseconds for verifier creation. */
  createdAt: number;
}

/** Metadata for a group of projects stored under one app namespace. */
export interface ProjectCollection {
  /** Stable storage key for this project collection. */
  projectCollectionId: string;
  /** User-facing display name. Duplicate names are allowed. */
  name: string;
  /** Present when the collection has been tombstoned and hidden from public APIs. */
  deleted?: true;
  /** Present when this project collection requires a PIN unlock in the current tab. */
  pinVerifier?: ProjectCollectionPinVerifier;
  /** Unix epoch timestamp in milliseconds for record creation. */
  createdAt: number;
  /** Unix epoch timestamp in milliseconds for the last metadata update. */
  updatedAt: number;
}
