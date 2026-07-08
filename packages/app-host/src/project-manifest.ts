/** Persisted metadata describing a project (independent of its file contents). */
export interface ProjectManifest {
  /** Stable, opaque project identifier. */
  readonly id: string;
  /** Project collection that owns this project. */
  readonly projectCollectionId: string;
  /** Project display name. */
  readonly name: string;
  /** Semver version of the project's own content, in package.json semantics. */
  readonly version: string;
  /** Free-form description. */
  readonly description: string;
  /** Optional URL or data URI for a thumbnail image. */
  readonly thumbnailUrl?: string;
  /** Extension dependencies keyed by their `<owner>/<repo>` coordinate; each value is an extension reference string. */
  readonly extensions?: Readonly<Record<string, string>>;
  /** Present when the project has been tombstoned and hidden from public APIs. */
  readonly deleted?: true;
  /** Creation timestamp, milliseconds since the Unix epoch. */
  readonly createdAt: number;
  /** Last-modified timestamp, milliseconds since the Unix epoch. */
  readonly updatedAt: number;
}
