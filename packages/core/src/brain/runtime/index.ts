export * from "./brain";
export * from "./conversions";
export * from "./functions";
export * from "./operators";
export * from "./page";
export * from "./type-system";
export * from "./vm";

import { registerCoreActuators } from "./actuators";
import { registerCoreConversions } from "./conversions";
import { registerCoreOperators } from "./operators";
import { registerCoreSensors } from "./sensors";
import { registerCoreTypes } from "./type-system";

export function registerCoreRuntimeComponents() {
  registerCoreTypes();
  registerCoreActuators();
  registerCoreSensors();
  registerCoreConversions();
  registerCoreOperators();
}
