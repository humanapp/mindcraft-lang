import { LogLevel, logger } from "@mindcraft-lang/core";
import { registerCoreBrainComponents } from "@mindcraft-lang/core/brain";
import { setTileVisualProvider } from "@mindcraft-lang/core/brain/tiles";
import { initCompiler } from "@mindcraft-lang/typescript";
import { enableClipboardLogging } from "@mindcraft-lang/ui";
import { registerBrainComponents } from "@/brain";
import { genVisualForTile } from "./brain/tiles/visual-provider";

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
// Preload TypeScript compiler lib files in the background

initCompiler();
