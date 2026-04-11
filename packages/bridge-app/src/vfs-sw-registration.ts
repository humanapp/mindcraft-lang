import type { WorkspaceAdapter } from "./app-bridge.js";

export interface VfsSwRegistrationOptions {
  swUrl: string;
  workspace: WorkspaceAdapter;
  onReady?: () => void;
}

export function registerVfsServiceWorker(options: VfsSwRegistrationOptions): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }

  if (navigator.serviceWorker.controller) {
    options.onReady?.();
  } else {
    navigator.serviceWorker.addEventListener("controllerchange", () => options.onReady?.(), { once: true });
  }

  navigator.serviceWorker
    .register(options.swUrl, { type: "module", scope: "/" })
    .then((reg) => {
      if (!navigator.serviceWorker.controller && reg.active) {
        reg.active.postMessage({ type: "claim" });
      }
    })
    .catch((err) => {
      console.warn("[vfs-sw] registration failed:", err);
    });

  navigator.serviceWorker.addEventListener("message", (event) => {
    const msg = event.data as Record<string, unknown> | null;
    if (!msg || typeof msg.type !== "string") {
      return;
    }

    if (msg.type === "vfs-read") {
      const path = msg.path as string;
      const snapshot = options.workspace.exportSnapshot();
      const entry = snapshot.get(path);
      const port = (event as MessageEvent).ports?.[0];
      if (!port) return;

      if (entry && entry.kind === "file") {
        port.postMessage({ found: true, content: entry.content });
      } else {
        port.postMessage({ found: false });
      }
    }
  });
}
