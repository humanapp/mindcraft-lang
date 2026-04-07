import {
  createHostActuator,
  createHostSensor,
  type MindcraftModule,
  type MindcraftModuleApi,
} from "@mindcraft-lang/core";
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
      registerTypes(api);

      api.registerHostSensor(createHostSensor(fnBump));
      api.registerHostSensor(createHostSensor(fnSee));

      api.registerHostActuator(createHostActuator(fnEat));
      api.registerHostActuator(createHostActuator(fnMove));
      api.registerHostActuator(createHostActuator(fnSay));
      api.registerHostActuator(createHostActuator(fnShoot));
      api.registerHostActuator(createHostActuator(fnTurn));

      registerTiles(api);
    },
  };
}
