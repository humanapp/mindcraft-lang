import {
  coreModule,
  createMindcraftEnvironment,
  type MindcraftEnvironment,
  withMindcraftEnvironmentServices,
} from "@mindcraft-lang/core";
import { createSimModule } from "@/brain";

let environment: MindcraftEnvironment | undefined;

export function initMindcraftEnvironment(): MindcraftEnvironment {
  if (!environment) {
    environment = createMindcraftEnvironment({
      modules: [coreModule(), createSimModule()],
    });
  }

  return environment;
}

export function getMindcraftEnvironment(): MindcraftEnvironment {
  return environment ?? initMindcraftEnvironment();
}

export function withSimBrainServices<T>(callback: () => T): T {
  return withMindcraftEnvironmentServices(getMindcraftEnvironment(), callback);
}
