import {
  createHostActuator,
  createHostSensor,
  type MindcraftModule,
  type MindcraftModuleApi,
} from "@mindcraft-lang/core/app";
import fnBump, { modifiers as bumpModifiers } from "./actions/bump";
import fnEat, { parameters as eatParameters } from "./actions/eat";
import fnMove, { modifiers as moveModifiers, parameters as moveParameters } from "./actions/move";
import fnSay, { parameters as sayParameters } from "./actions/say";
import fnSee, { modifiers as seeModifiers } from "./actions/see";
import fnShoot, { parameters as shootParameters } from "./actions/shoot";
import fnTurn, { modifiers as turnModifiers, parameters as turnParameters } from "./actions/turn";
import { registerEngineContext } from "./engine-context";
import { migrateSimBrainJson } from "./migrations";
import { registerSelfContext } from "./self-context";
import { registerTiles } from "./tiles";
import { registerTypes } from "./type-system";

export function createSimModule(): MindcraftModule {
  return {
    id: "mindcraft.sim",
    migrateBrainJson: migrateSimBrainJson,
    install(api: MindcraftModuleApi): void {
      registerTypes(api);
      registerEngineContext(api);
      registerSelfContext(api);

      api.registerHostSensor(createHostSensor(fnBump));
      api.registerHostSensor(createHostSensor(fnSee));

      api.registerHostActuator(createHostActuator(fnEat));
      api.registerHostActuator(createHostActuator(fnMove));
      api.registerHostActuator(createHostActuator(fnSay));
      api.registerHostActuator(createHostActuator(fnShoot));
      api.registerHostActuator(createHostActuator(fnTurn));

      api.registerModifiers([...bumpModifiers, ...seeModifiers, ...moveModifiers, ...turnModifiers]);
      api.registerParameters([
        ...eatParameters,
        ...moveParameters,
        ...sayParameters,
        ...shootParameters,
        ...turnParameters,
      ]);

      registerTiles(api);
    },
  };
}
