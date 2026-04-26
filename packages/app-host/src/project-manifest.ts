/** Persisted metadata describing a project (independent of its workspace contents). */
export interface ProjectManifest {
  /** Stable, opaque project identifier. */
  readonly id: string;
  /** Project display name. */
  readonly name: string;
  /** Free-form description. */
  readonly description: string;
  /** Optional URL or data URI for a thumbnail image. */
  readonly thumbnailUrl?: string;
  /** Creation timestamp, milliseconds since the Unix epoch. */
  readonly createdAt: number;
  /** Last-modified timestamp, milliseconds since the Unix epoch. */
  readonly updatedAt: number;
}
