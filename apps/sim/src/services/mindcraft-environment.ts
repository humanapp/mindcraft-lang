import { coreModule, createMindcraftEnvironment, type MindcraftEnvironment } from "@mindcraft-lang/core/app";
import type { DocsTileEntry } from "@mindcraft-lang/docs";
import { createSimModule } from "@/brain";

export type SimMindcraftEnvironment = MindcraftEnvironment & {
  userTileDocEntries: DocsTileEntry[];
};

let environment: SimMindcraftEnvironment | undefined;

export function initMindcraftEnvironment(): SimMindcraftEnvironment {
  if (!environment) {
    environment = Object.assign(
      createMindcraftEnvironment({
        modules: [coreModule(), createSimModule()],
      }),
      { userTileDocEntries: [] as DocsTileEntry[] }
    );
  }

  return environment;
}

export function getMindcraftEnvironment(): SimMindcraftEnvironment {
  return environment ?? initMindcraftEnvironment();
}
