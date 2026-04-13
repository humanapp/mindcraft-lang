import type {
  ExportedFileSystem,
  ExportedFileSystemEntry,
  FileSystemNotification,
} from "@mindcraft-lang/bridge-client";
import type { WorkspaceAdapter, WorkspaceChange, WorkspaceSnapshot } from "./app-bridge.js";

export interface LocalStorageWorkspaceOptions {
  storageKey: string;
  debounceMs?: number;
  shouldExclude?: (path: string) => boolean;
}

export function createLocalStorageWorkspace(options: LocalStorageWorkspaceOptions): WorkspaceAdapter {
  return new LocalStorageWorkspaceStore(options);
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
  entries: Iterable<[string, ExportedFileSystemEntry]>,
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

class LocalStorageWorkspaceStore implements WorkspaceAdapter {
  private readonly snapshot: WorkspaceSnapshot;
  private readonly listeners = new Set<(change: WorkspaceChange) => void>();
  private readonly storageKey: string;
  private readonly debounceMs: number;
  private readonly shouldExclude: ((path: string) => boolean) | undefined;
  private persistTimer: number | undefined;

  constructor(options: LocalStorageWorkspaceOptions) {
    this.storageKey = options.storageKey;
    this.debounceMs = options.debounceMs ?? 500;
    this.shouldExclude = options.shouldExclude;
    this.snapshot = this.loadSnapshot();
  }

  exportSnapshot(): WorkspaceSnapshot {
    return new Map(this.snapshot);
  }

  applyRemoteChange(change: WorkspaceChange): void {
    if (this.shouldExclude && isChangeExcluded(change, this.shouldExclude)) {
      return;
    }

    applyChange(this.snapshot, change);
    this.persist();
  }

  onLocalChange(listener: (change: WorkspaceChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private loadSnapshot(): WorkspaceSnapshot {
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) {
      return new Map();
    }

    try {
      const parsed = JSON.parse(raw) as Array<[string, ExportedFileSystemEntry]>;
      return filterSnapshot(parsed, this.shouldExclude);
    } catch {
      return new Map();
    }
  }

  private persist(): void {
    if (this.persistTimer !== undefined) {
      window.clearTimeout(this.persistTimer);
    }

    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = undefined;
      localStorage.setItem(this.storageKey, JSON.stringify([...this.snapshot]));
    }, this.debounceMs);
  }
}
