import type { WorkspaceAdapter, WorkspaceChange, WorkspaceSnapshot } from "@mindcraft-lang/bridge-app";
import { isCompilerControlledPath } from "@mindcraft-lang/ts-compiler";

const LS_FS_KEY = "sim:vscode-bridge:filesystem";
const PERSIST_DEBOUNCE_MS = 500;

type WorkspaceSnapshotEntry = WorkspaceSnapshot extends ReadonlyMap<string, infer T> ? T : never;

function filterSnapshot(entries: Iterable<[string, WorkspaceSnapshotEntry]>): WorkspaceSnapshot {
  const filtered: WorkspaceSnapshot = new Map();

  for (const [path, entry] of entries) {
    if (!isCompilerControlledPath(path)) {
      if (entry.kind === "file") {
        ensureParentDirectories(filtered, path);
      }
      filtered.set(path, entry);
    }
  }

  return filtered;
}

function ensureParentDirectories(snapshot: WorkspaceSnapshot, path: string): void {
  const segments = path.split("/").filter((segment) => segment.length > 0);
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

      const descendants = Array.from(snapshot.entries()).filter(([path]) => path.startsWith(`${change.oldPath}/`));
      snapshot.delete(change.oldPath);
      for (const [path] of descendants) {
        snapshot.delete(path);
      }

      ensureParentDirectories(snapshot, change.newPath);
      snapshot.set(change.newPath, entry);
      for (const [path, childEntry] of descendants) {
        snapshot.set(`${change.newPath}${path.slice(change.oldPath.length)}`, childEntry);
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
      for (const [path, entry] of filterSnapshot(change.entries)) {
        snapshot.set(path, entry);
      }
      break;
  }
}

class SimWorkspaceStore implements WorkspaceAdapter {
  private readonly snapshot: WorkspaceSnapshot;
  private readonly listeners = new Set<(change: WorkspaceChange) => void>();
  private persistTimer: number | undefined;

  constructor() {
    this.snapshot = this.loadSnapshot();
  }

  exportSnapshot(): WorkspaceSnapshot {
    return new Map(this.snapshot);
  }

  applyRemoteChange(change: WorkspaceChange): void {
    if (
      (change.action === "write" && isCompilerControlledPath(change.path)) ||
      (change.action === "delete" && isCompilerControlledPath(change.path)) ||
      (change.action === "rename" &&
        (isCompilerControlledPath(change.oldPath) || isCompilerControlledPath(change.newPath)))
    ) {
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
    const raw = localStorage.getItem(LS_FS_KEY);
    if (!raw) {
      return new Map();
    }

    try {
      const parsed = JSON.parse(raw) as Array<[string, WorkspaceSnapshotEntry]>;
      return filterSnapshot(parsed);
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
      localStorage.setItem(LS_FS_KEY, JSON.stringify([...this.snapshot]));
    }, PERSIST_DEBOUNCE_MS);
  }
}

let workspaceStore: SimWorkspaceStore | undefined;

export function initWorkspaceStore(): WorkspaceAdapter {
  if (!workspaceStore) {
    workspaceStore = new SimWorkspaceStore();
  }

  return workspaceStore;
}

export function getWorkspaceStore(): WorkspaceAdapter {
  return workspaceStore ?? initWorkspaceStore();
}
