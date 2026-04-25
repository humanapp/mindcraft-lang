/**
 * Denormalized copy of the producing app's identity for a shared project.
 *
 * Mirrors `MindcraftExportHost` so listings and previews can be served
 * without fetching the full `.mindcraft` payload from blob storage.
 */
export interface SharedProjectHostInfo {
  /** Application identifier of the host that produced the latest revision. */
  name: string;
  /** Semver version of the host application that produced the latest revision. */
  version: string;
}

/**
 * Public, mutable metadata for a project that has been shared via the backend.
 *
 * A `SharedProject` is the stable container; its content is captured in an
 * append-only sequence of `SharedProjectRevision`s. It carries only the
 * pointer to the latest revision plus a small set of denormalized fields
 * (title, description, host) sourced from that revision's payload, so
 * listing endpoints can render entries without fetching the `.mindcraft`
 * blob.
 *
 * No user identifiers are present -- there are no accounts, and write access
 * is gated by an opaque edit token tracked separately on the server.
 */
export interface SharedProject {
  /** Stable, server-assigned identifier for the project container. */
  projectId: string;
  /** Human-readable title shown in listings; sourced from the latest revision's payload. */
  title: string;
  /** Human-readable description shown in listings; sourced from the latest revision's payload. */
  description: string;
  /** Producing app for the latest revision. */
  host: SharedProjectHostInfo;
  /**
   * Pointer to the most recent revision. Revisions are immutable, so this is
   * the only field whose change advances the project's content.
   */
  latestRevisionId: string;
  /** ISO-8601 timestamp of project creation. */
  createdAt: string;
  /** ISO-8601 timestamp of the most recent revision publish. */
  updatedAt: string;
}

/**
 * Immutable snapshot of a shared project's content at a point in time.
 *
 * The `.mindcraft` payload itself (a `MindcraftExportDocument`) is not
 * embedded; instead, `payloadUrl` references the blob in object storage.
 * This keeps metadata small and lets revisions be listed cheaply.
 */
export interface SharedProjectRevision {
  /** Stable, server-assigned identifier for this revision. */
  revisionId: string;
  /** Identifier of the `SharedProject` this revision belongs to. */
  projectId: string;
  /** ISO-8601 timestamp at which the revision was published. */
  createdAt: string;
  /**
   * CDN URL of the `.mindcraft` payload for this revision. Suitable for
   * direct `fetch()` by the client.
   *
   * Backend note: persist the underlying storage key (not the rendered URL)
   * in the server-side item type, and compute `payloadUrl` on read. That
   * keeps the CDN domain swappable without rewriting historical records.
   */
  payloadUrl: string;
  /**
   * Optional CDN URL of the thumbnail image captured with this revision.
   * Suitable for direct use in `<img src=...>`. Absent if the revision was
   * published without a thumbnail.
   *
   * Backend note: persist the underlying storage key (not the rendered URL)
   * in the server-side item type, and compute `thumbnailUrl` on read. That
   * keeps the CDN domain swappable without rewriting historical records.
   */
  thumbnailUrl?: string;
}
