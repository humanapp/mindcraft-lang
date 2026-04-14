import { LogLevel, logger } from "@mindcraft-lang/core/app";
import { enableClipboardLogging } from "@mindcraft-lang/ui";
import { SimEnvironmentStore } from "./services/sim-environment-store";
import { hydrateUserTilesAtStartup } from "./services/user-tile-registration";
import { initVfsServiceWorker } from "./services/vfs-service-worker";
import { initProject } from "./services/vscode-bridge";

enableClipboardLogging(true);

// ----------------------------------------------------
// Configure logger

logger.level = LogLevel.DEBUG;

// ----------------------------------------------------
// Create the canonical environment store

export const simStore = new SimEnvironmentStore();

hydrateUserTilesAtStartup(simStore);
initVfsServiceWorker(simStore);

// ----------------------------------------------------
// Initialize project and compile user tiles

initProject(simStore);
