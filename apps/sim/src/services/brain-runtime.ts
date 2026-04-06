import type { MindcraftBrain } from "@mindcraft-lang/core";
import type { IBrainDef } from "@mindcraft-lang/core/brain";
import { getMindcraftEnvironment } from "./mindcraft-environment";

let pendingBrainRebuild = false;
let runtimeInitialized = false;

export function initBrainRuntime(): void {
  if (runtimeInitialized) {
    return;
  }

  runtimeInitialized = true;
  getMindcraftEnvironment().onBrainsInvalidated((event) => {
    if (event.invalidatedBrains.length > 0) {
      pendingBrainRebuild = true;
    }
  });
}

export function createSimBrain(brainDef: IBrainDef, contextData?: unknown): MindcraftBrain {
  return getMindcraftEnvironment().createBrain(brainDef, {
    context: contextData,
  });
}

export function flushPendingBrainRebuilds(): void {
  if (!pendingBrainRebuild) {
    return;
  }

  pendingBrainRebuild = false;
  getMindcraftEnvironment().rebuildInvalidatedBrains();
}
