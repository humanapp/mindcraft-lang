import type { BrainServices } from "@mindcraft-lang/core/brain";
import { registerAccessorTiles } from "./accessors";
import { registerActuatorTiles } from "./actuators";
import { registerLiteralTiles } from "./literals";
import { registerModifierTiles } from "./modifiers";
import { registerParameterTiles } from "./parameters";
import { registerSensorTiles } from "./sensors";
import { registerVariableFactoryTiles } from "./variables";

export function registerTiles(services: BrainServices) {
  registerModifierTiles(services);
  registerParameterTiles(services);
  registerSensorTiles(services);
  registerActuatorTiles(services);
  registerVariableFactoryTiles(services);
  registerLiteralTiles(services);
  registerAccessorTiles(services);
}
