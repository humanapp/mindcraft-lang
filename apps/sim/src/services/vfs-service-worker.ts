import { registerVfsServiceWorker } from "@mindcraft-lang/bridge-app";
import { getWorkspaceStore } from "./workspace-store";

export function initVfsServiceWorker(): void {
  const swUrl = import.meta.env.DEV ? "/src/vfs-sw-entry.ts" : "/vfs-service-worker.js";
  registerVfsServiceWorker({ swUrl, workspace: getWorkspaceStore() });
}
