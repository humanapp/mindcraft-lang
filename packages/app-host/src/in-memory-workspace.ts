import type { WorkspaceAdapter } from "./workspace-adapter.js";
import type { WorkspaceChange, WorkspaceEntry, WorkspaceSnapshot } from "./workspace-snapshot.js";

/** Options for {@link createInMemoryWorkspace}. */
export interface InMemoryWorkspaceOptions {
  /**
   * Predicate invoked for every change. Changes whose path(s) match are
   * silently dropped before being applied to the snapshot.
   */
  shouldExclude?: (path: string) => boolean;
}

/** Create a {@link WorkspaceAdapter} that stores all files in memory. */
export function createInMemoryWorkspace(options?: InMemoryWorkspaceOptions): WorkspaceAdapter {
  return new InMemoryWorkspace(options?.shouldExclude);
}

function ensureParentDirectories(snapshot: WorkspaceSnapshot, path: string): void {
  const segments = path.split("/").filter((s) => s.length > 0);
  for (let i = 1; i < segments.length; i++) {
    const dirPath = segments.slice(0, i).join("/");
    if (!snapshot.has(dirPath)) {
      snapshot.set(dirPath, { kind: "directory" });
    }
  }
}

function removePath(snapshot: WorkspaceSnapshot, path: string): void {
  snapshot.delete(path);
  const prefix = `${path}/`;
  for (const key of Array.from(snapshot.keys())) {
    if (key.startsWith(prefix)) {
      snapshot.delete(key);
    }
  }
}

function filterSnapshot(
  entries: Iterable<[string, WorkspaceEntry]>,
  shouldExclude: ((path: string) => boolean) | undefined
): WorkspaceSnapshot {
  const filtered: WorkspaceSnapshot = new Map();

  for (const [path, entry] of entries) {
    if (shouldExclude?.(path)) {
      continue;
    }
    if (entry.kind === "file") {
      ensureParentDirectories(filtered, path);
    }
    filtered.set(path, entry);
  }

  return filtered;
}

function applyChange(snapshot: WorkspaceSnapshot, change: WorkspaceChange): void {
  switch (change.action) {
    case "write":
      ensureParentDirectories(snapshot, change.path);
      snapshot.set(change.path, {
        kind: "file",
        content: change.content,
        etag: change.newEtag,
        isReadonly: change.isReadonly ?? false,
      });
      break;
    case "delete":
      removePath(snapshot, change.path);
      break;
    case "rename": {
      const entry = snapshot.get(change.oldPath);
      if (!entry) {
        break;
      }

      const descendants = Array.from(snapshot.entries()).filter(([p]) => p.startsWith(`${change.oldPath}/`));
      snapshot.delete(change.oldPath);
      for (const [p] of descendants) {
        snapshot.delete(p);
      }

      ensureParentDirectories(snapshot, change.newPath);
      snapshot.set(change.newPath, entry);
      for (const [p, childEntry] of descendants) {
        snapshot.set(`${change.newPath}${p.slice(change.oldPath.length)}`, childEntry);
      }
      break;
    }
    case "mkdir":
      ensureParentDirectories(snapshot, change.path);
      snapshot.set(change.path, { kind: "directory" });
      break;
    case "rmdir":
      removePath(snapshot, change.path);
      break;
    case "import":
      snapshot.clear();
      for (const [path, entry] of filterSnapshot(change.entries, undefined)) {
        snapshot.set(path, entry);
      }
      break;
  }
}

function isChangeExcluded(change: WorkspaceChange, shouldExclude: (path: string) => boolean): boolean {
  switch (change.action) {
    case "write":
    case "delete":
    case "mkdir":
    case "rmdir":
      return shouldExclude(change.path);
    case "rename":
      return shouldExclude(change.oldPath) || shouldExclude(change.newPath);
    case "import":
      return false;
  }
}

class InMemoryWorkspace implements WorkspaceAdapter {
  private readonly snapshot: WorkspaceSnapshot = new Map();
  private readonly listeners = new Set<(change: WorkspaceChange) => void>();
  private readonly anyChangeListeners = new Set<() => void>();
  private readonly shouldExclude: ((path: string) => boolean) | undefined;

  constructor(shouldExclude: ((path: string) => boolean) | undefined) {
    this.shouldExclude = shouldExclude;
  }

  exportSnapshot(): WorkspaceSnapshot {
    return new Map(this.snapshot);
  }

  applyRemoteChange(change: WorkspaceChange): void {
    if (this.shouldExclude && isChangeExcluded(change, this.shouldExclude)) {
      return;
    }
    applyChange(this.snapshot, change);
    for (const listener of this.anyChangeListeners) {
      listener();
    }
  }

  applyLocalChange(change: WorkspaceChange): void {
    if (this.shouldExclude && isChangeExcluded(change, this.shouldExclude)) {
      return;
    }
    applyChange(this.snapshot, change);
    for (const listener of this.listeners) {
      listener(change);
    }
    for (const listener of this.anyChangeListeners) {
      listener();
    }
  }

  onLocalChange(listener: (change: WorkspaceChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onAnyChange(listener: () => void): () => void {
    this.anyChangeListeners.add(listener);
    return () => {
      this.anyChangeListeners.delete(listener);
    };
  }

  flush(): void {
    // No-op: persistence is handled by the project store.
  }
}
