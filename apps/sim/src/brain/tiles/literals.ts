import { BrainTileLiteralDef, type MindcraftModuleApi, mkNativeStructValue } from "@mindcraft-lang/core/app";
import { getSelf, getTargetActor } from "../execution-context-types";
import { TargetActorCapabilityBitSet } from "../tileids";
import { MyTypeIds } from "../type-system";

export function registerLiteralTiles(api: MindcraftModuleApi) {
  const meVisual = {
    label: "me",
    iconUrl: "/assets/brain/icons/actor-mask.svg",
  };
  const itVisual = {
    label: "it",
    iconUrl: "/assets/brain/icons/actor-mask.svg",
  };

  api.registerTile(
    new BrainTileLiteralDef(
      MyTypeIds.ActorRef,
      mkNativeStructValue(MyTypeIds.ActorRef, getSelf),
      {
        visual: meVisual,
        persist: false,
        valueLabel: "me",
      },
      api.brainServices
    )
  );
  api.registerTile(
    new BrainTileLiteralDef(
      MyTypeIds.ActorRef,
      mkNativeStructValue(MyTypeIds.ActorRef, getTargetActor),
      {
        visual: itVisual,
        persist: false,
        valueLabel: "it",
        requirements: TargetActorCapabilityBitSet,
      },
      api.brainServices
    )
  );
}
