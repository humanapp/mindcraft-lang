import {
  bag,
  CoreTypeIds,
  type CreateHostSensorOptions,
  choice,
  type ExecutionContext,
  FALSE_VALUE,
  getSlotId,
  logger,
  type ModifierTileInput,
  mkCallDef,
  mkNumberValue,
  mod,
  optional,
  type ReadonlyList,
  setRuleVariable,
  TRUE_VALUE,
  type Value,
  Vector2,
} from "@wendoo-lang/core/app";
import { EcosimHostActions } from "../abi-ids";
import type { Archetype } from "../actor";
import { getSelf } from "../execution-context-types";
import { TargetActorCapabilityBitSet, TileIds } from "../tileids";
import { hasArg } from "./utils";

const Carnivore = mod(TileIds.Modifier.ActorKindCarnivore);
const Herbivore = mod(TileIds.Modifier.ActorKindHerbivore);
const Plant = mod(TileIds.Modifier.ActorKindPlant);

const callDef = mkCallDef(bag(optional(choice(Carnivore, Herbivore, Plant))));

const kActorKindCarnivoreSlotId = getSlotId(callDef, Carnivore);
const kActorKindHerbivoreSlotId = getSlotId(callDef, Herbivore);
const kActorKindPlantSlotId = getSlotId(callDef, Plant);

function execBump(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  try {
    // Get the Actor from the execution context (optional - sensor can work without it)
    const selfActor = getSelf(ctx);

    if (!selfActor) {
      return FALSE_VALUE;
    }

    // Check if there are any bumps in the actor's bump queue
    const hasBumped = selfActor.bumpQueue.size() > 0;

    if (!hasBumped) {
      return FALSE_VALUE;
    }

    const bHasCarnivoreFilter = hasArg(args, kActorKindCarnivoreSlotId);
    const bHasHerbivoreFilter = hasArg(args, kActorKindHerbivoreSlotId);
    const bHasPlantFilter = hasArg(args, kActorKindPlantSlotId);

    let archetypeFilter: Archetype | undefined;

    if (bHasCarnivoreFilter) {
      archetypeFilter = "carnivore";
    } else if (bHasHerbivoreFilter) {
      archetypeFilter = "herbivore";
    } else if (bHasPlantFilter) {
      archetypeFilter = "plant";
    }

    // Take the first queued bump that matches the archetype filter, if any.
    let bumpedActorId: number | undefined;
    for (const otherActorId of selfActor.bumpQueue) {
      if (archetypeFilter !== undefined) {
        const otherActor = selfActor.engine.getActorById(otherActorId);
        if (otherActor?.archetype !== archetypeFilter) continue;
      }
      bumpedActorId = otherActorId;
      break;
    }

    if (bumpedActorId === undefined) {
      return FALSE_VALUE;
    }

    // Store as "targetActor" for the DO side to access
    setRuleVariable(ctx, "targetActor", mkNumberValue(bumpedActorId));

    const bumpedActor = selfActor.engine.getActorById(bumpedActorId);
    if (bumpedActor) {
      selfActor.debugTargetPositions.set(bumpedActor.actorId, new Vector2(bumpedActor.sprite.x, bumpedActor.sprite.y));
    }

    return TRUE_VALUE;
  } catch (error) {
    logger.error("Error executing bump sensor:", error);
    return FALSE_VALUE;
  }
}

export default {
  ...EcosimHostActions.Bump,
  callDef,
  fn: {
    exec: execBump,
  },
  isAsync: false,
  outputType: CoreTypeIds.Boolean,
  metadata: { label: "bump" },
  capabilities: TargetActorCapabilityBitSet,
} satisfies CreateHostSensorOptions;

/** Modifier tiles the `bump` sensor accepts. */
export const modifiers: ModifierTileInput[] = [
  {
    id: TileIds.Modifier.ActorKindCarnivore,
    label: "carnivore",
    language: { form: "a carnivore" },
  },
  {
    id: TileIds.Modifier.ActorKindHerbivore,
    label: "herbivore",
    language: { form: "a herbivore" },
  },
  {
    id: TileIds.Modifier.ActorKindPlant,
    label: "plant",
    language: { form: "a plant" },
  },
];
