import type { ProjectFileChange, ProjectFileSnapshot, ProjectFileSystemEntry } from "./project-file-snapshot.js";
import type { ProjectFileSystem } from "./project-file-system.js";

/** Options for {@link createInMemoryProjectFileSystem}. */
export interface InMemoryProjectFileSystemOptions {
  /**
   * Predicate invoked for every change. Changes whose path(s) match are
   * silently dropped before being applied to the snapshot.
   */
  shouldExclude?: (path: string) => boolean;
}

/** Create a {@link ProjectFileSystem} that stores all files in memory. */
export function createInMemoryProjectFileSystem(options?: InMemoryProjectFileSystemOptions): ProjectFileSystem {
  return new InMemoryProjectFileSystem(options?.shouldExclude);
}

function ensureParentDirectories(snapshot: ProjectFileSnapshot, path: string): void {
  const segments = path.split("/").filter((s) => s.length > 0);
  for (let i = 1; i < segments.length; i++) {
    const dirPath = segments.slice(0, i).join("/");
    if (!snapshot.has(dirPath)) {
      snapshot.set(dirPath, { kind: "directory" });
    }
  }
}

function removePath(snapshot: ProjectFileSnapshot, path: string): void {
  snapshot.delete(path);
  const prefix = `${path}/`;
  for (const key of Array.from(snapshot.keys())) {
    if (key.startsWith(prefix)) {
      snapshot.delete(key);
    }
  }
}

function filterSnapshot(
  entries: Iterable<[string, ProjectFileSystemEntry]>,
  shouldExclude: ((path: string) => boolean) | undefined
): ProjectFileSnapshot {
  const filtered: ProjectFileSnapshot = new Map();

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

/**
 * Apply a single {@link ProjectFileChange} to a snapshot map in place. A
 * `write` creates any missing parent directories; `delete` and `rmdir` remove
 * the path and its descendants; `import` replaces the whole snapshot.
 */
export function applyProjectFileChangeToSnapshot(snapshot: ProjectFileSnapshot, change: ProjectFileChange): void {
  applyChange(snapshot, change);
}

function applyChange(snapshot: ProjectFileSnapshot, change: ProjectFileChange): void {
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

function isChangeExcluded(change: ProjectFileChange, shouldExclude: (path: string) => boolean): boolean {
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

function filterChange(
  change: ProjectFileChange,
  shouldExclude: (path: string) => boolean
): ProjectFileChange | undefined {
  if (change.action === "import") {
    return { action: "import", entries: Array.from(filterSnapshot(change.entries, shouldExclude)) };
  }

  return isChangeExcluded(change, shouldExclude) ? undefined : change;
}

class InMemoryProjectFileSystem implements ProjectFileSystem {
  private readonly snapshot: ProjectFileSnapshot = new Map();
  private readonly listeners = new Set<(change: ProjectFileChange) => void>();
  private readonly anyChangeListeners = new Set<() => void>();
  private readonly shouldExclude: ((path: string) => boolean) | undefined;

  constructor(shouldExclude: ((path: string) => boolean) | undefined) {
    this.shouldExclude = shouldExclude;
  }

  exportSnapshot(): ProjectFileSnapshot {
    return new Map(this.snapshot);
  }

  applyRemoteChange(change: ProjectFileChange): void {
    let nextChange = change;
    if (this.shouldExclude) {
      const filtered = filterChange(change, this.shouldExclude);
      if (!filtered) {
        return;
      }
      nextChange = filtered;
    }
    applyChange(this.snapshot, nextChange);
    for (const listener of this.anyChangeListeners) {
      listener();
    }
  }

  applyLocalChange(change: ProjectFileChange): void {
    let nextChange = change;
    if (this.shouldExclude) {
      const filtered = filterChange(change, this.shouldExclude);
      if (!filtered) {
        return;
      }
      nextChange = filtered;
    }
    applyChange(this.snapshot, nextChange);
    for (const listener of this.listeners) {
      listener(nextChange);
    }
    for (const listener of this.anyChangeListeners) {
      listener();
    }
  }

  onLocalChange(listener: (change: ProjectFileChange) => void): () => void {
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
