import { createHostActuator, createHostSensor, type WendooModule, type WendooModuleApi } from "@wendoo/core/app";
import fnBump, { modifiers as bumpModifiers } from "./actions/bump";
import fnEat, { parameters as eatParameters } from "./actions/eat";
import fnMove, { modifiers as moveModifiers, parameters as moveParameters } from "./actions/move";
import fnSay, { parameters as sayParameters } from "./actions/say";
import fnSee, { modifiers as seeModifiers } from "./actions/see";
import fnShoot, { outputTiles as shootOutputTiles, parameters as shootParameters } from "./actions/shoot";
import fnTurn, { modifiers as turnModifiers, parameters as turnParameters } from "./actions/turn";
import { registerBrainContext } from "./brain-context";
import { registerEngineContext } from "./engine-context";
import { migrateEcosimBrainJson } from "./migrations";
import { registerTiles } from "./tiles";
import { registerTypes } from "./type-system";

export function createEcosimModule(): WendooModule {
  return {
    id: "wendoo.ecosim",
    migrateBrainJson: migrateEcosimBrainJson,
    install(api: WendooModuleApi): void {
      registerTypes(api);
      registerEngineContext(api);
      registerBrainContext(api);

      api.registerHostSensor(createHostSensor(fnBump));
      api.registerHostSensor(createHostSensor(fnSee));

      api.registerHostActuator(createHostActuator(fnEat));
      api.registerHostActuator(createHostActuator(fnMove));
      api.registerHostActuator(createHostActuator(fnSay));
      api.registerHostActuator(createHostActuator(fnShoot));
      for (const outputTile of shootOutputTiles) {
        api.registerTile(outputTile);
      }
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
