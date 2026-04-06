import type { MindcraftModule, MindcraftModuleApi } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import * as fns from "./fns";
import * as tiles from "./tiles";
import { registerTypes } from "./type-system";

type SimModuleInstallApi = MindcraftModuleApi & {
  unsafeGetBrainServicesForInstall(): BrainServices;
};

function resolveInstallServices(api: MindcraftModuleApi): BrainServices {
  const services = (api as Partial<SimModuleInstallApi>).unsafeGetBrainServicesForInstall?.();
  if (!services) {
    throw new Error("createSimModule() requires install-time BrainServices access");
  }

  return services;
}

export function registerBrainComponents(services: BrainServices): void {
  registerTypes(services);
  fns.registerFns(services);
  tiles.registerTiles(services);
}

export function createSimModule(): MindcraftModule {
  return {
    id: "mindcraft.sim",
    install(api: MindcraftModuleApi): void {
      registerBrainComponents(resolveInstallServices(api));
    },
  };
}
