export * from "../runtime/type-system";
export * from "./accessors";
export * from "./actuators";
export * from "./builder";
export * from "./catalog";
export * from "./controlflow";
export * from "./factories";
export * from "./literals";
export * from "./missing";
export * from "./modifiers";
export * from "./operators";
export * from "./pagetiles";
export * from "./parameters";
export * from "./parameters";
export * from "./sensors";
export * from "./variables";

import { registerCoreActuatorTileDefs } from "./actuators";
import { registerCoreControlFlowTileDefs } from "./controlflow";
import { registerCoreLiteralFactoryTileDefs } from "./literals";
import { registerCoreOperatorTileDefs } from "./operators";
import { registerCoreParameterTileDefs } from "./parameters";
import { registerCoreSensorTileDefs } from "./sensors";
import { registerCoreVariableFactoryTileDefs } from "./variables";

export function registerCoreTileComponents() {
  registerCoreOperatorTileDefs();
  registerCoreControlFlowTileDefs();
  registerCoreVariableFactoryTileDefs();
  registerCoreLiteralFactoryTileDefs();
  registerCoreParameterTileDefs();
  registerCoreActuatorTileDefs();
  registerCoreSensorTileDefs();
}
