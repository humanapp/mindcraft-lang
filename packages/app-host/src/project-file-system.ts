import type { ProjectFileChange, ProjectFileSnapshot } from "./project-file-snapshot.js";

/**
 * Editing surface for a project's file tree: a flat set of files and
 * directories on which the host applies changes and to which observers may
 * subscribe.
 */
export interface ProjectFileSystem {
  /** Take a snapshot copy of the current project file contents. */
  exportSnapshot(): ProjectFileSnapshot;
  /** Apply a change originating outside the host (e.g. remote sync). */
  applyRemoteChange(change: ProjectFileChange): void;
  /** Apply a change originating in the host UI; emits to local-change listeners. */
  applyLocalChange(change: ProjectFileChange): void;
  /** Subscribe to local changes only. Returns an unsubscribe function. */
  onLocalChange(listener: (change: ProjectFileChange) => void): () => void;
  /** Subscribe to all changes (local and remote). Returns an unsubscribe function. */
  onAnyChange(listener: () => void): () => void;
  /** Flush any pending writes. Implementations may treat this as a no-op. */
  flush(): void;
}
