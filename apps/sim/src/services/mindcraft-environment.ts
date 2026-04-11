import { coreModule, createMindcraftEnvironment, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { DocsTileEntry } from "@mindcraft-lang/docs";
import { createSimModule } from "@/brain";

export type SimMindcraftEnvironment = MindcraftEnvironment & {
  userTileDocEntries: DocsTileEntry[];
  userTileDocRevision: number;
};

let environment: SimMindcraftEnvironment | undefined;

const docRevisionListeners = new Set<() => void>();

export function subscribeToDocRevision(listener: () => void): () => void {
  docRevisionListeners.add(listener);
  return () => docRevisionListeners.delete(listener);
}

export function getDocRevisionSnapshot(): number {
  return getMindcraftEnvironment().userTileDocRevision;
}

export function bumpDocRevision(): void {
  getMindcraftEnvironment().userTileDocRevision++;
  for (const listener of docRevisionListeners) {
    listener();
  }
}

export function initMindcraftEnvironment(): SimMindcraftEnvironment {
  if (!environment) {
    environment = Object.assign(
      createMindcraftEnvironment({
        modules: [coreModule(), createSimModule()],
      }),
      { userTileDocEntries: [] as DocsTileEntry[], userTileDocRevision: 0 }
    );
  }

  return environment;
}

export function getMindcraftEnvironment(): SimMindcraftEnvironment {
  return environment ?? initMindcraftEnvironment();
}
