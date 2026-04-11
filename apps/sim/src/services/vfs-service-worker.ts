import { registerVfsServiceWorker } from "@mindcraft-lang/bridge-app";
import type { SimEnvironmentStore } from "./sim-environment-store";

export function initVfsServiceWorker(store: SimEnvironmentStore): void {
  const swUrl = import.meta.env.DEV ? "/src/vfs-sw-entry.ts" : "/vfs-service-worker.js";
  registerVfsServiceWorker({ swUrl, workspace: store.workspace });
  store.workspace.onLocalChange(() => store.bumpVfsRevision());
}
