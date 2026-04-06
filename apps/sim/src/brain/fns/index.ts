import type { BrainServices } from "@mindcraft-lang/core/brain";
import * as actuators from "./actuators";
import * as sensors from "./sensors";

export function registerFns(services: BrainServices) {
  sensors.registerSensors(services);
  actuators.registerActuators(services);
}
