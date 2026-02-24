import * as actuators from "./actuators";
import * as sensors from "./sensors";

export function registerFns() {
  sensors.registerSensors();
  actuators.registerActuators();
}
