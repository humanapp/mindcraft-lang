// Brain subsystem - visual programming system

export * as compiler from "./compiler";
export * from "./compiler/types";
export * from "./interfaces";
export * as languageService from "./language-service";
export * as model from "./model";
export * as runtime from "./runtime";
export * from "./services";
export * from "./services-factory";
export * as tiles from "./tiles";

import { registerCoreRuntimeComponents } from "./runtime";
import { type BrainServices, getBrainServices, hasBrainServices, setBrainServices } from "./services";
import { createBrainServices } from "./services-factory";
import { registerCoreTileComponents } from "./tiles";

/**
 * Registers all core brain components (runtime and tiles) and sets up the global services.
 * This should be called once during application initialization before using any brain functionality.
 *
 * If you need a custom services instance for testing, create one using createBrainServices()
 * and pass it to the components that need it instead of calling this function.
 *
 * @returns The initialized BrainServices instance
 */
export function registerCoreBrainComponents(): BrainServices {
  // Don't re-initialize if already done
  if (hasBrainServices()) {
    return getBrainServices();
  }

  // Create all registries
  const services = createBrainServices();

  // Set as global BEFORE registration so tiles can use getBrainServices()
  setBrainServices(services);

  // Register core components with the new services
  registerCoreRuntimeComponents();

  // Register core tiles
  registerCoreTileComponents();

  return services;
}
