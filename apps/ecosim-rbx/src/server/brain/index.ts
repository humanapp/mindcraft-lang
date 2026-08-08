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
import { registerBrainContext } from "./brain-context";
import { registerEngineContext } from "./engine-context";
import { migrateEcosimBrainJson } from "./migrations";
import { registerTiles } from "./tiles";
import { registerTypes } from "./type-system";

/**
 * Builds the ecosim brain module: the `Vector2` and `ActorRef` types, the
 * engine and brain context extensions, the seven sensors and actuators, and
 * their modifier, parameter, and literal tiles.
 *
 * @returns The module, ready to pass to `createMindcraftEnvironment`.
 */
export function createEcosimModule(): MindcraftModule {
  return {
    id: "mindcraft.ecosim",
    migrateBrainJson: migrateEcosimBrainJson,
    install(api: MindcraftModuleApi): void {
      registerTypes(api);
      registerEngineContext(api);
      registerBrainContext(api);

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
