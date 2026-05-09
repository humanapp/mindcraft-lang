/** The stable id for the bootstrap project collection. */
export const DEFAULT_PROJECT_COLLECTION_ID = "default";

/** The display name used when creating the bootstrap project collection. */
export const DEFAULT_PROJECT_COLLECTION_NAME = "Default Workspace";

/** Metadata for a group of projects stored under one app namespace. */
export interface ProjectCollection {
  /** Stable storage key for this project collection. */
  projectCollectionId: string;
  /** User-facing display name. Duplicate names are allowed. */
  name: string;
  /** Present when the collection has been tombstoned and hidden from public APIs. */
  deleted?: true;
  /** Unix epoch timestamp in milliseconds for record creation. */
  createdAt: number;
  /** Unix epoch timestamp in milliseconds for the last metadata update. */
  updatedAt: number;
}
