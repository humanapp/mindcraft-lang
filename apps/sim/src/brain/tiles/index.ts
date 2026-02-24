import { registerAccessorTiles } from "./accessors";
import { registerActuatorTiles } from "./actuators";
import { registerLiteralTiles } from "./literals";
import { registerModifierTiles } from "./modifiers";
import { registerParameterTiles } from "./parameters";
import { registerSensorTiles } from "./sensors";
import { registerVariableFactoryTiles } from "./variables";

export function registerTiles() {
  registerModifierTiles();
  registerParameterTiles();
  registerSensorTiles();
  registerActuatorTiles();
  registerVariableFactoryTiles();
  registerLiteralTiles();
  registerAccessorTiles();
}
