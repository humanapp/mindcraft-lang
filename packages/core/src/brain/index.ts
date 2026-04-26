// Brain subsystem - visual programming system

export * as compiler from "./compiler";
export * from "./compiler/types";
export * from "./interfaces";
export * as languageService from "./language-service";
export * as model from "./model";
export * as runtime from "./runtime";
export { ContextTypeIds, ContextTypeNames } from "./runtime/context-types";
export { BrainServices } from "./services";
export * from "./services-factory";
export * as tiles from "./tiles";

import { registerCoreRuntimeComponents } from "./runtime";
import type { BrainServices } from "./services";
import { registerCoreTileComponents } from "./tiles";

/** Register the core runtime components (types, operators, conversions, builtins) and core tile components on `services`. Returns the same `services` for chaining. */
export function installCoreBrainComponents(services: BrainServices): BrainServices {
  registerCoreRuntimeComponents(services);
  registerCoreTileComponents(services);
  return services;
}
