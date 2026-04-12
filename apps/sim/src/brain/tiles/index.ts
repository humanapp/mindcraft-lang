import { CoreTypeIds, type MindcraftModuleApi } from "@mindcraft-lang/core/app";
import { TileIds } from "@/brain/tileids";
import { SimTypeIds } from "@/brain/type-system";
import { registerLiteralTiles } from "./literals";

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
    { id: TileIds.Parameter.AnonymousVector2, dataType: SimTypeIds.Vector2, hidden: true },
  ]);
  registerLiteralTiles(api);
}
