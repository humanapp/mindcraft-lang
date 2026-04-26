import type { WorkspaceChange, WorkspaceSnapshot } from "./workspace-snapshot.js";

/**
 * Editing surface for a project's workspace: a flat set of files and
 * directories on which the host applies changes and to which observers may
 * subscribe.
 */
export interface WorkspaceAdapter {
  /** Take a snapshot copy of the current workspace contents. */
  exportSnapshot(): WorkspaceSnapshot;
  /** Apply a change originating outside the host (e.g. remote sync). */
  applyRemoteChange(change: WorkspaceChange): void;
  /** Apply a change originating in the host UI; emits to local-change listeners. */
  applyLocalChange(change: WorkspaceChange): void;
  /** Subscribe to local changes only. Returns an unsubscribe function. */
  onLocalChange(listener: (change: WorkspaceChange) => void): () => void;
  /** Subscribe to all changes (local and remote). Returns an unsubscribe function. */
  onAnyChange(listener: () => void): () => void;
  /** Flush any pending writes. Implementations may treat this as a no-op. */
  flush(): void;
}
