import type { MindcraftModuleApi } from "@mindcraft-lang/core";
import { registerAccessorTiles } from "./accessors";
import { registerLiteralTiles } from "./literals";
import { registerModifierTiles } from "./modifiers";
import { registerParameterTiles } from "./parameters";
import { registerVariableFactoryTiles } from "./variables";

export function registerTiles(api: MindcraftModuleApi) {
  registerModifierTiles(api);
  registerParameterTiles(api);
  registerVariableFactoryTiles(api);
  registerLiteralTiles(api);
  registerAccessorTiles(api);
}
