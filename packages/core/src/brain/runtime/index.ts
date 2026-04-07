export * from "./action-registry";
export * from "./brain";
export * from "./context-types";
export * from "./conversions";
export * from "./element-access-builtins";
export * from "./functions";
export * from "./linker";
export * from "./map-builtins";
export * from "./math-builtins";
export * from "./operators";
export * from "./page";
export * from "./string-builtins";
export * from "./type-system";
export * from "./vm";

import type { BrainServices } from "../services";
import { runWithBrainServices } from "../services";
import { registerCoreActuators } from "./actuators";
import { registerContextTypes } from "./context-types";
import { registerCoreConversions } from "./conversions";
import { registerElementAccessBuiltins } from "./element-access-builtins";
import { registerMapBuiltins } from "./map-builtins";
import { registerMathBuiltins } from "./math-builtins";
import { registerCoreOperators } from "./operators";
import { registerCoreSensors } from "./sensors";
import { registerStringBuiltins } from "./string-builtins";
import { registerCoreTypes } from "./type-system";

export function registerCoreRuntimeComponents(services: BrainServices) {
  runWithBrainServices(services, () => {
    registerCoreTypes(services);
    registerContextTypes(services);
    registerCoreActuators(services);
    registerCoreSensors(services);
    registerCoreConversions(services);
    registerCoreOperators(services);
    registerElementAccessBuiltins(services);
    registerMapBuiltins(services);
    registerMathBuiltins(services);
    registerStringBuiltins(services);
  });
}
