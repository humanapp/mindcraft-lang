import { CoreTypeIds, type MindcraftModuleApi } from "@mindcraft-lang/core/app";
import { TileIds } from "@/brain/tileids";
import { MyTypeIds } from "@/brain/type-system";

export function registerParameterTiles(api: MindcraftModuleApi) {
  api.registerParameters([
    { id: TileIds.Parameter.AnonymousActorRef, dataType: MyTypeIds.ActorRef, hidden: true },
    {
      id: TileIds.Parameter.DelayMs,
      dataType: CoreTypeIds.Number,
      label: "delay ms",
      iconUrl: "/assets/brain/icons/delay.svg",
    },
    {
      id: TileIds.Parameter.Duration,
      dataType: CoreTypeIds.Number,
      label: "duration",
      iconUrl: "/assets/brain/icons/duration.svg",
    },
    {
      id: TileIds.Parameter.Priority,
      dataType: CoreTypeIds.Number,
      label: "priority",
      iconUrl: "/assets/brain/icons/priority.svg",
    },
    {
      id: TileIds.Parameter.Rate,
      dataType: CoreTypeIds.Number,
      label: "per/sec",
      iconUrl: "/assets/brain/icons/fps.svg",
    },
  ]);
}
