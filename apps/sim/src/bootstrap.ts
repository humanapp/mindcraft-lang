import { LogLevel, logger } from "@mindcraft-lang/core";
import { registerCoreBrainComponents } from "@mindcraft-lang/core/brain";
import { enableClipboardLogging } from "@mindcraft-lang/ui";
import { registerBrainComponents } from "@/brain";
import { registerUserTilesAtStartup } from "./services/user-tile-registration";
import { initProject } from "./services/vscode-bridge";

enableClipboardLogging(true);

// ----------------------------------------------------
// Configure logger

logger.level = LogLevel.DEBUG;

// ----------------------------------------------------
// Register brain components

registerCoreBrainComponents();
registerBrainComponents();

// Register user-authored tiles so brains referencing them can deserialize

registerUserTilesAtStartup();

// ----------------------------------------------------
// Initialize project and compile user tiles

initProject();
