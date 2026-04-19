import type { WorkspaceChange, WorkspaceSnapshot } from "./workspace-snapshot.js";

export interface WorkspaceAdapter {
  exportSnapshot(): WorkspaceSnapshot;
  applyRemoteChange(change: WorkspaceChange): void;
  onLocalChange(listener: (change: WorkspaceChange) => void): () => void;
  flush(): void;
}
