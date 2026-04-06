import type { MindcraftModuleApi } from "@mindcraft-lang/core";
import { CoreTypeIds } from "@mindcraft-lang/core/brain";
import { BrainTileParameterDef } from "@mindcraft-lang/core/brain/tiles";
import { TileIds } from "@/brain/tileids";
import { MyTypeIds } from "@/brain/type-system";

export function registerParameterTiles(api: MindcraftModuleApi) {
  const delayVisual = {
    label: "delay ms",
    iconUrl: "/assets/brain/icons/delay.svg",
  };
  const durationVisual = {
    label: "duration",
    iconUrl: "/assets/brain/icons/duration.svg",
  };
  const priorityVisual = {
    label: "priority",
    iconUrl: "/assets/brain/icons/priority.svg",
  };
  const rateVisual = {
    label: "per/sec",
    iconUrl: "/assets/brain/icons/fps.svg",
  };
  api.registerTile(
    new BrainTileParameterDef(TileIds.Parameter.AnonymousActorRef, MyTypeIds.ActorRef, {
      hidden: true,
    })
  );
  api.registerTile(
    new BrainTileParameterDef(TileIds.Parameter.DelayMs, CoreTypeIds.Number, {
      visual: delayVisual,
    })
  );
  api.registerTile(
    new BrainTileParameterDef(TileIds.Parameter.Duration, CoreTypeIds.Number, {
      visual: durationVisual,
    })
  );
  api.registerTile(
    new BrainTileParameterDef(TileIds.Parameter.Priority, CoreTypeIds.Number, {
      visual: priorityVisual,
    })
  );
  api.registerTile(
    new BrainTileParameterDef(TileIds.Parameter.Rate, CoreTypeIds.Number, {
      visual: rateVisual,
    })
  );
}
