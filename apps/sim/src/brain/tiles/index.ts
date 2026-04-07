import type { MindcraftModuleApi } from "@mindcraft-lang/core";
import type { BrainServices } from "@mindcraft-lang/core/brain";
import { registerAccessorTiles } from "./accessors";
import { registerLiteralTiles } from "./literals";
import { registerModifierTiles } from "./modifiers";
import { registerParameterTiles } from "./parameters";
import { registerVariableFactoryTiles } from "./variables";

export function registerTiles(api: MindcraftModuleApi, services: BrainServices) {
  registerModifierTiles(api);
  registerParameterTiles(api);
  registerVariableFactoryTiles(api);
  registerLiteralTiles(api, services);
  registerAccessorTiles(api);
}
