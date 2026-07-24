import { CoreTypeIds, type MindcraftModuleApi } from "@mindcraft-lang/core/app";
import { ICON_BASE } from "@/brain/icon-base";
import { TileIds } from "@/brain/tileids";
import { EcosimTypeIds } from "@/brain/type-system";
import { registerLiteralTiles } from "./literals";

export function registerTiles(api: MindcraftModuleApi) {
  api.registerModifiers([
    { id: TileIds.Modifier.TimeMs, label: "millis", iconUrl: `${ICON_BASE}/milliseconds.svg` },
    { id: TileIds.Modifier.TimeSecs, label: "seconds", iconUrl: `${ICON_BASE}/seconds.svg` },
  ]);
  api.registerParameters([
    {
      id: TileIds.Parameter.DelayMs,
      dataType: CoreTypeIds.Number,
      label: "delay ms",
      iconUrl: `${ICON_BASE}/delay.svg`,
    },
    { id: TileIds.Parameter.AnonymousVector2, dataType: EcosimTypeIds.Vector2, hidden: true },
  ]);
  registerLiteralTiles(api);
}
