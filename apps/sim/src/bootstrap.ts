import { LogLevel, logger } from "@mindcraft-lang/core";
import { registerCoreBrainComponents } from "@mindcraft-lang/core/brain";
import { setTileVisualProvider } from "@mindcraft-lang/core/brain/tiles";
import { registerBrainComponents } from "@/brain";
import { genVisualForTile } from "./brain/tiles/visual-provider";

// ----------------------------------------------------
// Configure logger

logger.level = LogLevel.DEBUG;

// ----------------------------------------------------
// Register brain components

setTileVisualProvider(genVisualForTile);
registerCoreBrainComponents();
registerBrainComponents();
