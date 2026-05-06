import type { ProjectFileChange, ProjectFileSnapshot } from "@mindcraft-lang/app-host";
import type { FileSystemSnapshot } from "@mindcraft-lang/bridge-client";
import type { FileSystemNotification } from "@mindcraft-lang/bridge-protocol";

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
        content: change.content,
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
      return { action: "import", entries: [...change.entries] };
  }
}

/** Convert a bridge protocol notification into an app-host project file mutation. */
export function toProjectFileChange(notification: FileSystemNotification): ProjectFileChange {
  switch (notification.action) {
    case "write":
      return {
        action: "write",
        path: notification.path,
        content: notification.content,
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
      return { action: "import", entries: [...notification.entries] };
  }
}
