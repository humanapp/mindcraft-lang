import {
  bag,
  CoreTypeIds,
  choice,
  type ExecutionContext,
  FALSE_VALUE,
  getSlotId,
  type MapValue,
  mkCallDef,
  mkNumberValue,
  mod,
  TRUE_VALUE,
  type Value,
} from "@mindcraft-lang/core/brain";
import type { Archetype } from "@/brain/actor";
import { getSelf } from "@/brain/execution-context-types";
import type { ActionDef } from "@/brain/fns/action-def";
import { TargetActorCapabilityBitSet, TileIds } from "@/brain/tileids";

const Carnivore = mod(TileIds.Modifier.ActorKindCarnivore);
const Herbivore = mod(TileIds.Modifier.ActorKindHerbivore);
const Plant = mod(TileIds.Modifier.ActorKindPlant);

const callDef = mkCallDef(bag(choice(Carnivore, Herbivore, Plant)));

const kActorKindCarnivoreSlotId = getSlotId(callDef, Carnivore);
const kActorKindHerbivoreSlotId = getSlotId(callDef, Herbivore);
const kActorKindPlantSlotId = getSlotId(callDef, Plant);

function execBump(ctx: ExecutionContext, args: MapValue): Value {
  // Get the Actor from the execution context (optional - sensor can work without it)
  const self = getSelf(ctx);

  if (!self) {
    console.warn("Bump sensor invoked without an actor in context");
    return FALSE_VALUE;
  }

  // Check if there are any bumps in the actor's bump queue
  const hasBumped = self.bumpQueue.size > 0;

  if (!hasBumped) {
    return FALSE_VALUE;
  }

  const bHasCarnivoreFilter = args.v.has(kActorKindCarnivoreSlotId);
  const bHasHerbivoreFilter = args.v.has(kActorKindHerbivoreSlotId);
  const bHasPlantFilter = args.v.has(kActorKindPlantSlotId);

  let filteredBumps: Iterable<number> = self.bumpQueue;
  let archetypeFilter: Archetype | undefined;

  if (bHasCarnivoreFilter) {
    archetypeFilter = "carnivore";
  } else if (bHasHerbivoreFilter) {
    archetypeFilter = "herbivore";
  } else if (bHasPlantFilter) {
    archetypeFilter = "plant";
  }

  // If there is an archetype filter, check if any of the bumped actors match it
  if (archetypeFilter) {
    const filtered = Array.from(self.bumpQueue).filter((otherActorId) => {
      const otherActor = self.engine.getActorById(otherActorId);
      return otherActor?.archetype === archetypeFilter;
    });

    if (filtered.length === 0) {
      return FALSE_VALUE;
    }
    filteredBumps = filtered;
  }

  const bumpedActorId = filteredBumps[Symbol.iterator]().next().value!;

  // Store as "targetActor" for the DO side to access
  ctx.rule?.setVariable("targetActor", mkNumberValue(bumpedActorId));

  return TRUE_VALUE;
}

export default {
  tileId: TileIds.Sensor.Bump,
  callDef,
  fn: {
    exec: execBump,
  },
  isAsync: false,
  returnType: CoreTypeIds.Boolean, // TODO: Return bumped actor, not just a boolean
  visual: { label: "bump", iconUrl: "/assets/brain/icons/bump.svg" },
  capabilities: TargetActorCapabilityBitSet, // Indicates that this sensor provides a "targetActor" for tiles that require it
} satisfies ActionDef;
