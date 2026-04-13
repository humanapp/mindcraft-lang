import { BrainDef, type IBrainDef, type MindcraftBrain, type MindcraftEnvironment } from "@mindcraft-lang/core/app";

let env: MindcraftEnvironment | undefined;
let pendingBrainRebuild = false;
let runtimeInitialized = false;

function getEnv(): MindcraftEnvironment {
  if (!env) {
    throw new Error("Brain runtime not initialized -- call initBrainRuntime() first");
  }
  return env;
}

export function initBrainRuntime(environment: MindcraftEnvironment): void {
  if (runtimeInitialized) {
    return;
  }

  env = environment;
  runtimeInitialized = true;
  environment.onBrainsInvalidated((event) => {
    if (event.invalidatedBrains.length > 0) {
      pendingBrainRebuild = true;
    }
  });
}

export function createSimBrain(brainDef: IBrainDef, contextData?: unknown): MindcraftBrain {
  return getEnv().createBrain(brainDef, {
    context: contextData,
  });
}

export function createEmptySimBrain(name: string, contextData?: unknown): MindcraftBrain {
  const e = getEnv();
  const emptyDef = e.withServices((services) => BrainDef.emptyBrainDef(services, name));
  return e.createBrain(emptyDef, { context: contextData });
}

export function flushPendingBrainRebuilds(): void {
  if (!pendingBrainRebuild) {
    return;
  }

  pendingBrainRebuild = false;
  getEnv().rebuildInvalidatedBrains();
}
