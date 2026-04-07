import {
  createHostActuator,
  createHostSensor,
  type MindcraftModule,
  type MindcraftModuleApi,
  type ModifierTileInput,
  type ParameterTileInput,
} from "@mindcraft-lang/core/app";
import fnBump, { modifiers as bumpModifiers } from "./actions/bump";
import fnEat, { parameters as eatParameters } from "./actions/eat";
import fnMove, { modifiers as moveModifiers, parameters as moveParameters } from "./actions/move";
import fnSay, { parameters as sayParameters } from "./actions/say";
import fnSee, { modifiers as seeModifiers } from "./actions/see";
import fnShoot, { parameters as shootParameters } from "./actions/shoot";
import fnTurn, { modifiers as turnModifiers, parameters as turnParameters } from "./actions/turn";
import { registerTiles } from "./tiles";
import { registerTypes } from "./type-system";

function dedup<T extends { id: string }>(arrays: readonly (readonly T[])[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const arr of arrays) {
    for (const item of arr) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        result.push(item);
      }
    }
  }
  return result;
}

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

      api.registerModifiers(dedup<ModifierTileInput>([bumpModifiers, seeModifiers, moveModifiers, turnModifiers]));
      api.registerParameters(
        dedup<ParameterTileInput>([eatParameters, moveParameters, sayParameters, shootParameters, turnParameters])
      );

      registerTiles(api);
    },
  };
}
