import {
  bag,
  CoreTypeIds,
  type CreateHostSensorOptions,
  choice,
  type ExecutionContext,
  FALSE_VALUE,
  getSlotId,
  type ModifierTileInput,
  mkCallDef,
  mkNumberValue,
  mod,
  optional,
  type ReadonlyList,
  TRUE_VALUE,
  type Value,
  Vector2,
} from "@mindcraft-lang/core/app";
import { hasArg } from "@/brain/actions/utils";
import type { Archetype } from "@/brain/actor";
import { getSelf } from "@/brain/execution-context-types";
import { TargetActorCapabilityBitSet, TileIds } from "@/brain/tileids";

const Carnivore = mod(TileIds.Modifier.ActorKindCarnivore);
const Herbivore = mod(TileIds.Modifier.ActorKindHerbivore);
const Plant = mod(TileIds.Modifier.ActorKindPlant);

const callDef = mkCallDef(bag(optional(choice(Carnivore, Herbivore, Plant))));

const kActorKindCarnivoreSlotId = getSlotId(callDef, Carnivore);
const kActorKindHerbivoreSlotId = getSlotId(callDef, Herbivore);
const kActorKindPlantSlotId = getSlotId(callDef, Plant);

function execBump(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
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

  const bHasCarnivoreFilter = hasArg(args, kActorKindCarnivoreSlotId);
  const bHasHerbivoreFilter = hasArg(args, kActorKindHerbivoreSlotId);
  const bHasPlantFilter = hasArg(args, kActorKindPlantSlotId);

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

  const bumpedActor = self.engine.getActorById(bumpedActorId);
  if (bumpedActor) {
    self.debugTargetPositions.set(bumpedActor.actorId, new Vector2(bumpedActor.sprite.x, bumpedActor.sprite.y));
  }

  return TRUE_VALUE;
}

export default {
  key: TileIds.Sensor.Bump,
  callDef,
  fn: {
    exec: execBump,
  },
  isAsync: false,
  outputType: CoreTypeIds.Boolean,
  metadata: { label: "bump", iconUrl: "/assets/brain/icons/bump.svg" },
  capabilities: TargetActorCapabilityBitSet,
} satisfies CreateHostSensorOptions;

export const modifiers: ModifierTileInput[] = [
  { id: TileIds.Modifier.ActorKindCarnivore, label: "carnivore", iconUrl: "/assets/brain/icons/carnivore.svg" },
  { id: TileIds.Modifier.ActorKindHerbivore, label: "herbivore", iconUrl: "/assets/brain/icons/herbivore.svg" },
  { id: TileIds.Modifier.ActorKindPlant, label: "plant", iconUrl: "/assets/brain/icons/plant.svg" },
];
