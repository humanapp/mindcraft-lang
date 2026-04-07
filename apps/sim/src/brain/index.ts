import type { MindcraftModule, MindcraftModuleApi } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { toHostActuatorDef, toHostSensorDef } from "./actions/action-def";
import fnBump from "./actions/bump";
import fnEat from "./actions/eat";
import fnMove from "./actions/move";
import fnSay from "./actions/say";
import fnSee from "./actions/see";
import fnShoot from "./actions/shoot";
import fnTurn from "./actions/turn";
import { registerTiles } from "./tiles";
import { registerTypes } from "./type-system";

export function createSimModule(): MindcraftModule {
  return {
    id: "mindcraft.sim",
    install(api: MindcraftModuleApi): void {
      const services = (
        api as unknown as { unsafeGetBrainServicesForInstall(): BrainServices }
      ).unsafeGetBrainServicesForInstall();
      registerTypes(api);

      api.registerHostSensor(toHostSensorDef(fnBump));
      api.registerHostSensor(toHostSensorDef(fnSee));

      api.registerHostActuator(toHostActuatorDef(fnEat));
      api.registerHostActuator(toHostActuatorDef(fnMove));
      api.registerHostActuator(toHostActuatorDef(fnSay));
      api.registerHostActuator(toHostActuatorDef(fnShoot));
      api.registerHostActuator(toHostActuatorDef(fnTurn));

      registerTiles(api, services);
    },
  };
}
