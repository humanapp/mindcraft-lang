export * from "./abi-ids";
export * from "./action-registry";
export * from "./brain-program-binary-codec";
export * from "./brain-program-codec";
export * from "./brain-program-dump";
export * from "./brain-runtime";
export * from "./buffer-builtins";
export * from "./bytecode";
export * from "./call-spec";
export * from "./callsite-store";
export * from "./context";
export * from "./context-types";
export * from "./conversion-defs";
export * from "./conversions";
export * from "./core-types";
export * from "./element-access-builtins";
export * from "./events";
export * from "./function-defs";
export * from "./functions";
export * from "./host-bindings";
export * from "./map-builtins";
export * from "./math-builtins";
export * from "./operator-defs";
export * from "./operators";
export * from "./profile-numerics";
export * from "./program";
export * from "./program-image";
export * from "./rule-services";
export * from "./runtime-services";
export * from "./services";
export * from "./string-builtins";
export * from "./tile-ids";
export * from "./type-defs";
export * from "./type-system";
export * from "./value";
export * from "./vm";
export * from "./vm-types";

import type { BrainServices } from "../brain/services";
import { registerCoreActuators } from "./actuators";
import { registerBufferBuiltins } from "./buffer-builtins";
import { registerContextTypes } from "./context-types";
import { registerCoreConversions } from "./conversions";
import { registerElementAccessBuiltins } from "./element-access-builtins";
import { registerMapBuiltins } from "./map-builtins";
import { registerMathBuiltins } from "./math-builtins";
import { registerCoreOperators } from "./operators";
import { registerCoreSensors } from "./sensors";
import { registerStringBuiltins } from "./string-builtins";
import { registerCoreTypes } from "./type-system";

/** Register all built-in runtime components (types, contexts, actuators, sensors, operators, conversions, builtins) on `services`. */
export function registerCoreRuntimeComponents(services: BrainServices) {
  services.runtime.functions.withOwner("core", () => {
    services.runtime.actions.withOwner("core", () => {
      services.runtime.types.withOwner("core", () => {
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
        registerBufferBuiltins(services);
      });
    });
  });
}
