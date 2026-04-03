import { LogLevel, logger } from "@mindcraft-lang/core";
import { registerCoreBrainComponents } from "@mindcraft-lang/core/brain";
import { setTileVisualProvider } from "@mindcraft-lang/core/brain/tiles";
import { enableClipboardLogging } from "@mindcraft-lang/ui";
import { registerBrainComponents } from "@/brain";
import { genVisualForTile } from "./brain/tiles/visual-provider";
import { registerUserTilesAtStartup } from "./services/user-tile-registration";
import { initProject } from "./services/vscode-bridge";

enableClipboardLogging(true);

// ----------------------------------------------------
// Configure logger

logger.level = LogLevel.DEBUG;

// ----------------------------------------------------
// Register brain components

setTileVisualProvider(genVisualForTile);
registerCoreBrainComponents();
registerBrainComponents();

// ----------------------------------------------------
// Initialize project and compile user tiles

initProject();

// Register user-authored tiles so brains referencing them can deserialize

registerUserTilesAtStartup();
