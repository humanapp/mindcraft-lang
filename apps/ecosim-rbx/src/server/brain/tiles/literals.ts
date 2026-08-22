import { BrainTileLiteralDef, mkNativeStructValue, type WendooModuleApi } from "@wendoo/core/app";
import { getSelf, getTargetActor } from "../execution-context-types";
import { TargetActorCapabilityBitSet } from "../tileids";
import { EcosimTypeIds } from "../type-system";

/**
 * Registers the `[me]` and `[it]` actor-reference literal tiles.
 *
 * @param api - The module registration API.
 */
export function registerLiteralTiles(api: WendooModuleApi) {
  const meVisual = {
    label: "me",
  };
  const itVisual = {
    label: "it",
  };

  api.registerTile(
    new BrainTileLiteralDef(
      EcosimTypeIds.ActorRef,
      mkNativeStructValue(EcosimTypeIds.ActorRef, getSelf),
      {
        metadata: meVisual,
        persist: false,
        valueLabel: "me",
      },
      api.brainServices
    )
  );
  api.registerTile(
    new BrainTileLiteralDef(
      EcosimTypeIds.ActorRef,
      mkNativeStructValue(EcosimTypeIds.ActorRef, getTargetActor),
      {
        metadata: itVisual,
        persist: false,
        valueLabel: "it",
        requirements: TargetActorCapabilityBitSet,
      },
      api.brainServices
    )
  );
}
