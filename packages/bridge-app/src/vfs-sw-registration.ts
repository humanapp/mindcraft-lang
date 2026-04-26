import type { WorkspaceAdapter } from "./app-bridge.js";

/** Options for {@link registerVfsServiceWorker}. */
export interface VfsSwRegistrationOptions {
  /** URL of the service worker script. */
  swUrl: string;
  /** Returns the workspace whose files the service worker should serve. */
  getWorkspace: () => WorkspaceAdapter;
  /** Invoked once a service worker is controlling the page. */
  onReady?: () => void;
}

/**
 * Register a service worker that serves files from the in-memory workspace via
 * `MessageChannel` requests. No-op in environments without `navigator.serviceWorker`.
 */
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
      const snapshot = options.getWorkspace().exportSnapshot();
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
