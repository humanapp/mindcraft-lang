export * from "./brain";
export * from "./context-types";
export * from "./conversions";
export * from "./functions";
export * from "./math-builtins";
export * from "./operators";
export * from "./page";
export * from "./type-system";
export * from "./vm";

import { registerCoreActuators } from "./actuators";
import { registerContextTypes } from "./context-types";
import { registerCoreConversions } from "./conversions";
import { registerMathBuiltins } from "./math-builtins";
import { registerCoreOperators } from "./operators";
import { registerCoreSensors } from "./sensors";
import { registerCoreTypes } from "./type-system";

export function registerCoreRuntimeComponents() {
  registerCoreTypes();
  registerContextTypes();
  registerCoreActuators();
  registerCoreSensors();
  registerCoreConversions();
  registerCoreOperators();
  registerMathBuiltins();
}
