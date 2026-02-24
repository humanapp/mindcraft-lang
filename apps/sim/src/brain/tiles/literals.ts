import { getBrainServices, mkNativeStructValue } from "@mindcraft-lang/core/brain";
import { BrainTileLiteralDef } from "@mindcraft-lang/core/brain/tiles";
import { getSelf, getTargetActor } from "../execution-context-types";
import { TargetActorCapabilityBitSet } from "../tileids";
import { MyTypeIds } from "../type-system";

export function registerLiteralTiles() {
  const meVisual = {
    label: "me",
    iconUrl: "/assets/brain/icons/actor-mask.svg",
  };
  const itVisual = {
    label: "it",
    iconUrl: "/assets/brain/icons/actor-mask.svg",
  };

  const { tiles } = getBrainServices();

  tiles.registerTileDef(
    new BrainTileLiteralDef(MyTypeIds.ActorRef, mkNativeStructValue(MyTypeIds.ActorRef, getSelf), {
      visual: meVisual,
      persist: false,
      valueLabel: "me",
    })
  );
  tiles.registerTileDef(
    new BrainTileLiteralDef(MyTypeIds.ActorRef, mkNativeStructValue(MyTypeIds.ActorRef, getTargetActor), {
      visual: itVisual,
      persist: false,
      valueLabel: "it",
      // The "it" literal is only valid in contexts that provide a target actor,
      // which is indicated by this capability requirement. The capabilities of
      // a context are determined by the OR'd `capabilities` fields of all tiles
      // the ctx covers, which includes the current rule and all its ancestors.
      requirements: TargetActorCapabilityBitSet,
    })
  );
}
