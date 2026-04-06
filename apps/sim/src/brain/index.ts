import type { MindcraftModule, MindcraftModuleApi } from "@mindcraft-lang/core";
import { toHostActuatorDef, toHostSensorDef } from "./fns/action-def";
import fnEat from "./fns/actuators/eat";
import fnMove from "./fns/actuators/move";
import fnSay from "./fns/actuators/say";
import fnShoot from "./fns/actuators/shoot";
import fnTurn from "./fns/actuators/turn";
import fnBump from "./fns/sensors/bump";
import fnSee from "./fns/sensors/see";
import { registerTiles } from "./tiles";
import { registerTypes } from "./type-system";

export function createSimModule(): MindcraftModule {
  return {
    id: "mindcraft.sim",
    install(api: MindcraftModuleApi): void {
      registerTypes(api);

      api.registerHostSensor(toHostSensorDef(fnBump));
      api.registerHostSensor(toHostSensorDef(fnSee));

      api.registerHostActuator(toHostActuatorDef(fnEat));
      api.registerHostActuator(toHostActuatorDef(fnMove));
      api.registerHostActuator(toHostActuatorDef(fnSay));
      api.registerHostActuator(toHostActuatorDef(fnShoot));
      api.registerHostActuator(toHostActuatorDef(fnTurn));

      registerTiles(api);
    },
  };
}
