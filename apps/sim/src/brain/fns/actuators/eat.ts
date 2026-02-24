import {
  bag,
  CoreTypeIds,
  type ExecutionContext,
  FALSE_VALUE,
  getCallSiteState,
  getSlotId,
  type MapValue,
  mkCallDef,
  optional,
  param,
  setCallSiteState,
  TRUE_VALUE,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import { ARCHETYPES } from "@/brain/archetypes";
import { getSelf } from "@/brain/execution-context-types";
import { TileIds } from "@/brain/tileids";
import type { ActionDef } from "../action-def";
import { resolveTargetActor } from "../utils";

const AnonActorRef = param(TileIds.Parameter.AnonymousActorRef, {
  anonymous: true,
});

const callDef = mkCallDef(bag(optional(AnonActorRef)));

const kAnonActorRefSlotId = getSlotId(callDef, AnonActorRef);

const EAT_COOLDOWN_MS = 1000; // 1 second cooldown between eats

type EatState = {
  nextEatTime: number; // Timestamp when the Actor can eat again (cooldown)
};

export function execEat(ctx: ExecutionContext, args: MapValue): Value {
  const self = getSelf(ctx);
  if (!self) {
    //console.warn("Eat actuator called without Actor in execution context");
    return VOID_VALUE;
  }

  const animalComp = self.animalComp;
  if (!animalComp) return VOID_VALUE; // only animals eat

  const now = self.engine.simTime;
  let state = getCallSiteState<EatState>(ctx);
  if (!state) {
    state = {
      nextEatTime: 0,
    } satisfies EatState;
    setCallSiteState(ctx, state);
  }

  // Check cooldown
  if (now < state.nextEatTime) {
    return FALSE_VALUE;
  }

  const actor = resolveTargetActor(ctx, args, kAnonActorRefSlotId);
  if (!actor) {
    return FALSE_VALUE;
  }

  // Check diet rules: does this archetype's prey list include the target's archetype?
  const prey = ARCHETYPES[self.archetype].energy.prey;
  if (!prey.includes(actor.archetype)) {
    return FALSE_VALUE;
  }

  // Transfer energy from target to self. The bite amount is capped by what
  // the target actually has, so over-eating can't fabricate energy.
  const BITE_ENERGY = 30;
  const gained = actor.drainEnergy(BITE_ENERGY);
  self.gainEnergy(gained);

  state.nextEatTime = now + EAT_COOLDOWN_MS;

  return TRUE_VALUE;
}

export default {
  tileId: TileIds.Actuator.Eat,
  callDef,
  fn: { exec: execEat },
  isAsync: false,
  returnType: CoreTypeIds.Void,
  visual: { label: "eat", iconUrl: "/assets/brain/icons/eat.svg" },
} satisfies ActionDef;
