import type { WorkspaceAdapter, WorkspaceChange } from "./app-bridge.js";

export interface VfsSwRegistrationOptions {
  swUrl: string;
  workspace: WorkspaceAdapter;
}

function sendToSw(message: unknown): void {
  navigator.serviceWorker.controller?.postMessage(message);
}

export function invalidateVfsCache(change: WorkspaceChange): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  invalidateForChange(change);
}

function invalidateForChange(change: WorkspaceChange): void {
  switch (change.action) {
    case "write":
    case "delete":
      sendToSw({ type: "vfs-invalidate", path: change.path });
      break;
    case "rename":
      sendToSw({ type: "vfs-invalidate", path: change.oldPath });
      sendToSw({ type: "vfs-invalidate", path: change.newPath });
      break;
    case "import":
      sendToSw({ type: "vfs-invalidate-all" });
      break;
  }
}

export function registerVfsServiceWorker(options: VfsSwRegistrationOptions): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.register(options.swUrl, { type: "module", scope: "/" }).catch((err) => {
    console.warn("[vfs-sw] registration failed:", err);
  });

  navigator.serviceWorker.addEventListener("message", (event) => {
    const msg = event.data as Record<string, unknown> | null;
    if (!msg || typeof msg.type !== "string") {
      return;
    }

    switch (msg.type) {
      case "vfs-read": {
        const path = msg.path as string;
        const snapshot = options.workspace.exportSnapshot();
        const entry = snapshot.get(path);
        const port = (event as MessageEvent).ports?.[0];
        if (!port) break;

        if (entry && entry.kind === "file") {
          port.postMessage({ found: true, content: entry.content });
        } else {
          port.postMessage({ found: false });
        }
        break;
      }
      case "vfs-ack":
        break;
    }
  });

  options.workspace.onLocalChange(invalidateForChange);
}
