import type { ProjectFileChange, ProjectFileSnapshot, ProjectFileSystemEntry } from "@wendoo-lang/app-host";
import { fileContentFromWire, fileContentToWire } from "@wendoo-lang/app-host";
import type { FileSystemSnapshot } from "@wendoo-lang/bridge-client";
import type { FileSystemNotification } from "@wendoo-lang/bridge-protocol";

/** Convert an app-host project file snapshot into a bridge-client snapshot. */
export function toFileSystemSnapshot(snapshot: ProjectFileSnapshot): FileSystemSnapshot {
  return new Map(snapshot);
}

/** Convert an app-host project file mutation into a bridge protocol notification. */
export function toFileSystemNotification(change: ProjectFileChange): FileSystemNotification {
  switch (change.action) {
    case "write":
      return {
        action: "write",
        path: change.path,
        ...fileContentToWire(change.content),
        newEtag: change.newEtag,
        ...(change.isReadonly !== undefined ? { isReadonly: change.isReadonly } : {}),
        ...(change.expectedEtag !== undefined ? { expectedEtag: change.expectedEtag } : {}),
      };
    case "delete":
      return {
        action: "delete",
        path: change.path,
        ...(change.expectedEtag !== undefined ? { expectedEtag: change.expectedEtag } : {}),
      };
    case "rename":
      return {
        action: "rename",
        oldPath: change.oldPath,
        newPath: change.newPath,
        ...(change.expectedEtag !== undefined ? { expectedEtag: change.expectedEtag } : {}),
      };
    case "mkdir":
      return { action: "mkdir", path: change.path };
    case "rmdir":
      return { action: "rmdir", path: change.path };
    case "import":
      return { action: "import", entries: [...change.entries].map(toWireEntry) };
  }
}

/** Convert a bridge protocol notification into an app-host project file mutation. */
export function toProjectFileChange(notification: FileSystemNotification): ProjectFileChange {
  switch (notification.action) {
    case "write":
      return {
        action: "write",
        path: notification.path,
        content: fileContentFromWire(notification),
        newEtag: notification.newEtag,
        ...(notification.isReadonly !== undefined ? { isReadonly: notification.isReadonly } : {}),
        ...(notification.expectedEtag !== undefined ? { expectedEtag: notification.expectedEtag } : {}),
      };
    case "delete":
      return {
        action: "delete",
        path: notification.path,
        ...(notification.expectedEtag !== undefined ? { expectedEtag: notification.expectedEtag } : {}),
      };
    case "rename":
      return {
        action: "rename",
        oldPath: notification.oldPath,
        newPath: notification.newPath,
        ...(notification.expectedEtag !== undefined ? { expectedEtag: notification.expectedEtag } : {}),
      };
    case "mkdir":
      return { action: "mkdir", path: notification.path };
    case "rmdir":
      return { action: "rmdir", path: notification.path };
    case "import":
      return { action: "import", entries: [...notification.entries].map(fromWireEntry) };
  }
}

/** One entry of a filesystem notification's `import` snapshot, as the protocol carries it. */
type WireSnapshotEntry = Extract<FileSystemNotification, { action: "import" }>["entries"][number][1];

/** Encode a project snapshot entry for the wire. */
function toWireEntry([path, entry]: [string, ProjectFileSystemEntry]): [string, WireSnapshotEntry] {
  if (entry.kind === "directory") {
    return [path, entry];
  }
  const { content, ...rest } = entry;
  return [path, { ...rest, ...fileContentToWire(content) }];
}

/** Decode a wire entry back into a project snapshot entry. */
function fromWireEntry([path, entry]: [string, WireSnapshotEntry]): [string, ProjectFileSystemEntry] {
  if (entry.kind === "directory") {
    return [path, entry];
  }
  const { encoding, ...rest } = entry;
  return [path, { ...rest, content: fileContentFromWire(entry) }];
}
