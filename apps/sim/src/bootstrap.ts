import { LogLevel, logger } from "@mindcraft-lang/core/app";
import { enableClipboardLogging } from "@mindcraft-lang/ui";
import { initBrainRuntime } from "./services/brain-runtime";
import { initMindcraftEnvironment } from "./services/mindcraft-environment";
import { hydrateUserTilesAtStartup } from "./services/user-tile-registration";
import { initProject } from "./services/vscode-bridge";

enableClipboardLogging(true);

// ----------------------------------------------------
// Configure logger

logger.level = LogLevel.DEBUG;

// ----------------------------------------------------
initMindcraftEnvironment();
initBrainRuntime();
hydrateUserTilesAtStartup();

// ----------------------------------------------------
// Initialize project and compile user tiles

initProject();
