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
} from "@wendoo/core/app";
import { EcosimHostActions } from "../abi-ids";
import { ARCHETYPES } from "../archetypes";
import { getSelf } from "../execution-context-types";
import { TileIds } from "../tileids";
import { EcosimTypeIds } from "../type-system";
import { resolveTargetActor } from "./utils";

const AnonActorRef = param(TileIds.Parameter.AnonymousActorRef, {
  anonymous: true,
  name: "target",
  derived: true,
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

/**
 * Transfers energy from the resolved target to the acting animal when the
 * target's archetype is in the actor's prey list and the cooldown has elapsed.
 *
 * @param ctx - The execution context.
 * @param args - The action's argument list.
 * @returns TRUE when a bite landed, FALSE when it was rejected, VOID when the
 *   actor cannot eat at all.
 */
export function execEat(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  try {
    const selfActor = getSelf(ctx);
    if (!selfActor) {
      return VOID_VALUE;
    }

    const animalComp = selfActor.animalComp;
    if (!animalComp) return VOID_VALUE; // only animals eat

    const now = selfActor.engine.simTime;
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
    const prey = ARCHETYPES[selfActor.archetype].energy.prey;
    if (!prey.includes(actor.archetype)) {
      return FALSE_VALUE;
    }

    // Transfer energy from the target to the eater. The bite amount is capped by what
    // the target actually has, so over-eating can't fabricate energy.
    const BITE_ENERGY = 30;
    const gained = actor.drainEnergy(BITE_ENERGY);
    selfActor.gainEnergy(gained);

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
  metadata: { label: "eat" },
} satisfies CreateHostActuatorOptions;

/** Parameter tiles the `eat` actuator accepts. */
export const parameters: ParameterTileInput[] = [
  { id: TileIds.Parameter.AnonymousActorRef, dataType: EcosimTypeIds.ActorRef, hidden: true },
];
