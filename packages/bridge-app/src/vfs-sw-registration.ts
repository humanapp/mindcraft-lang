import type { WorkspaceAdapter } from "./app-bridge.js";

export interface VfsSwRegistrationOptions {
  swUrl: string;
  workspace: WorkspaceAdapter;
}

export function registerVfsServiceWorker(options: VfsSwRegistrationOptions): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.register(options.swUrl, { type: "module" }).catch(() => {});

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
}
