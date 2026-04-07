import { CoreTypeIds, type MindcraftModuleApi } from "@mindcraft-lang/core/app";
import { TileIds } from "@/brain/tileids";
import { registerAccessorTiles } from "./accessors";
import { registerLiteralTiles } from "./literals";
import { registerVariableFactoryTiles } from "./variables";

export function registerTiles(api: MindcraftModuleApi) {
  api.registerModifiers([
    { id: TileIds.Modifier.TimeMs, label: "millis", iconUrl: "/assets/brain/icons/milliseconds.svg" },
    { id: TileIds.Modifier.TimeSecs, label: "seconds", iconUrl: "/assets/brain/icons/seconds.svg" },
  ]);
  api.registerParameters([
    {
      id: TileIds.Parameter.DelayMs,
      dataType: CoreTypeIds.Number,
      label: "delay ms",
      iconUrl: "/assets/brain/icons/delay.svg",
    },
  ]);
  registerVariableFactoryTiles(api);
  registerLiteralTiles(api);
  registerAccessorTiles(api);
}
