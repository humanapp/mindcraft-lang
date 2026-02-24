import { CoreTypeIds, getBrainServices } from "@mindcraft-lang/core/brain";
import { BrainTileParameterDef } from "@mindcraft-lang/core/brain/tiles";
import { TileIds } from "@/brain/tileids";
import { MyTypeIds } from "@/brain/type-system";

export function registerParameterTiles() {
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
  const { tiles } = getBrainServices();
  tiles.registerTileDef(
    new BrainTileParameterDef(TileIds.Parameter.AnonymousActorRef, MyTypeIds.ActorRef, {
      hidden: true,
    })
  );
  tiles.registerTileDef(
    new BrainTileParameterDef(TileIds.Parameter.DelayMs, CoreTypeIds.Number, {
      visual: delayVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileParameterDef(TileIds.Parameter.Duration, CoreTypeIds.Number, {
      visual: durationVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileParameterDef(TileIds.Parameter.Priority, CoreTypeIds.Number, {
      visual: priorityVisual,
    })
  );
  tiles.registerTileDef(
    new BrainTileParameterDef(TileIds.Parameter.Rate, CoreTypeIds.Number, {
      visual: rateVisual,
    })
  );
}
