import {
  bag,
  type CreateHostActuatorOptions,
  type ExecutionContext,
  FALSE_VALUE,
  getCallSiteState,
  getSlotId,
  logger,
  mkCallDef,
  optional,
  type ParameterTileInput,
  param,
  type ReadonlyList,
  setCallSiteState,
  TRUE_VALUE,
  type Value,
  VOID_VALUE,
} from "@wendoo-lang/core/app";
import { EcosimHostActions } from "@/brain/abi-ids";
import { ARCHETYPES } from "@/brain/archetypes";
import { getSelf } from "@/brain/execution-context-types";
import { ICON_BASE } from "@/brain/icon-base";
import { TileIds } from "@/brain/tileids";
import { EcosimTypeIds } from "@/brain/type-system";
import { resolveTargetActor } from "./utils";

const AnonActorRef = param(TileIds.Parameter.AnonymousActorRef, {
  anonymous: true,
});

const callDef = mkCallDef(bag(optional(AnonActorRef)));

const kAnonActorRefSlotId = getSlotId(callDef, AnonActorRef);

const EAT_COOLDOWN_MS = 1000; // 1 second cooldown between eats

type EatState = {
  nextEatTime: number; // Timestamp when the Actor can eat again (cooldown)
};

function initEat(ctx: ExecutionContext): void {
  setCallSiteState(ctx, { nextEatTime: 0 } satisfies EatState);
}

export function execEat(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  try {
    const self = getSelf(ctx);
    if (!self) {
      return VOID_VALUE;
    }

    const animalComp = self.animalComp;
    if (!animalComp) return VOID_VALUE; // only animals eat

    const now = self.engine.simTime;
    const state = getCallSiteState<EatState>(ctx)!;

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
  } catch (error) {
    logger.error("Error executing eat action:", error);
    return VOID_VALUE;
  }
}

export default {
  ...EcosimHostActions.Eat,
  callDef,
  fn: { onInitialized: initEat, exec: execEat },
  isAsync: false,
  metadata: { label: "eat", iconUrl: `${ICON_BASE}/eat.svg` },
} satisfies CreateHostActuatorOptions;

export const parameters: ParameterTileInput[] = [
  { id: TileIds.Parameter.AnonymousActorRef, dataType: EcosimTypeIds.ActorRef, hidden: true },
];
