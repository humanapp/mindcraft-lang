import {
  bag,
  CoreTypeIds,
  type CreateHostSensorOptions,
  choice,
  type ExecutionContext,
  extractNumberValue,
  FALSE_VALUE,
  getCallSiteState,
  getSlotId,
  List,
  logger,
  type ModifierTileInput,
  mkCallDef,
  mkListValue,
  mkNumberValue,
  mod,
  type NumberValue,
  optional,
  type ReadonlyList,
  repeated,
  type StructValue,
  setCallSiteState,
  setRuleVariable,
  TRUE_VALUE,
  type Value,
  Vector2,
} from "@mindcraft-lang/core/app";
import { EcosimHostActions } from "../abi-ids";
import type { Archetype } from "../actor";
import { getSelf } from "../execution-context-types";
import { SeeSensorCapabilityBitSet, TileIds } from "../tileids";
import { mkVector2Value } from "../type-system";
import type { SightResult } from "../vision";
import { hasArg } from "./utils";

const Carnivore = mod(TileIds.Modifier.ActorKindCarnivore);
const Herbivore = mod(TileIds.Modifier.ActorKindHerbivore);
const Plant = mod(TileIds.Modifier.ActorKindPlant);
const Nearby = mod(TileIds.Modifier.DistanceNearby);
const FarAway = mod(TileIds.Modifier.DistanceFarAway);

const callDef = mkCallDef(
  bag(
    optional(choice(Carnivore, Herbivore, Plant)),
    optional(choice(repeated(Nearby, { max: 3 }), repeated(FarAway, { max: 3 })))
  )
);

const kActorKindCarnivoreSlotId = getSlotId(callDef, Carnivore);
const kActorKindHerbivoreSlotId = getSlotId(callDef, Herbivore);
const kActorKindPlantSlotId = getSlotId(callDef, Plant);
const kDistanceNearbySlotId = getSlotId(callDef, Nearby);
const kDistanceFarAwaySlotId = getSlotId(callDef, FarAway);

const kNearbyDistanceThresholdSq = 100 * 100; // 100 pixels
const kFarAwayDistanceThresholdSq = 300 * 300; // 300 pixels

type SeeState = {
  rememberedActorId?: NumberValue; // ID of the last seen actor that passed filters, if any
  rememberedPos?: StructValue; // Position of the last seen actor that passed filters, if any
  memoryExpiration: number; // Timestamp when the remembered actor ID should be forgotten
};

function initSee(ctx: ExecutionContext): void {
  setCallSiteState(ctx, {
    rememberedActorId: undefined,
    rememberedPos: undefined,
    memoryExpiration: 0,
  } satisfies SeeState);
}

function execSee(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  try {
    // Get the Actor from the execution context (optional - sensor can work without it)
    const selfActor = getSelf(ctx);

    let state = getCallSiteState<SeeState>(ctx)!;

    if (!selfActor) {
      logger.warn("See sensor invoked without an actor in context");
      return FALSE_VALUE;
    }

    // Check if there are any sightings in the actor's sight queue
    const hasSeen = selfActor.sightQueue.size() > 0;

    if (!hasSeen) {
      return FALSE_VALUE;
    }

    // Check if remembered actor has expired
    const now = selfActor.engine.simTime;
    if (state.rememberedPos !== undefined && now > state.memoryExpiration) {
      state = {
        rememberedActorId: undefined,
        rememberedPos: undefined,
        memoryExpiration: 0,
      } satisfies SeeState;
      setCallSiteState(ctx, state);
    }

    const bHasCarnivoreFilter = hasArg(args, kActorKindCarnivoreSlotId);
    const bHasHerbivoreFilter = hasArg(args, kActorKindHerbivoreSlotId);
    const bHasPlantFilter = hasArg(args, kActorKindPlantSlotId);
    let nearbyThresholdSq = kNearbyDistanceThresholdSq;
    let farAwayThresholdSq = kFarAwayDistanceThresholdSq;
    const nearbyCount = extractNumberValue(args.get(kDistanceNearbySlotId)) ?? 0;
    const farAwayCount = extractNumberValue(args.get(kDistanceFarAwaySlotId)) ?? 0;
    if (nearbyCount > 0) {
      // decrease nearby threshold for each additional nearby modifier (e.g., "see herbivore nearby nearby" is more restrictive than "see herbivore nearby")
      nearbyThresholdSq = kNearbyDistanceThresholdSq / nearbyCount;
    }
    if (farAwayCount > 0) {
      // increase far away threshold for each additional far away modifier (e.g., "see herbivore far away far away" is more restrictive than "see herbivore far away")
      farAwayThresholdSq = kFarAwayDistanceThresholdSq * farAwayCount;
    }

    let sightResult: SightResult | undefined;
    let archetype: Archetype | undefined;

    if (bHasCarnivoreFilter) {
      archetype = "carnivore";
    } else if (bHasHerbivoreFilter) {
      archetype = "herbivore";
    } else if (bHasPlantFilter) {
      archetype = "plant";
    }

    // Build the filtered list in a single pass, avoiding redundant getActorById
    // lookups and distance recomputations.  Uses distanceSq already present on
    // each SightResult (populated by queryVisibleActors).
    let filteredSightQueue: SightResult[];

    const needsArchetypeFilter = archetype !== undefined;
    const needsNearby = nearbyCount > 0;
    const needsFarAway = !needsNearby && farAwayCount > 0;
    const needsAnyFilter = needsArchetypeFilter || needsNearby || needsFarAway;

    if (needsAnyFilter) {
      filteredSightQueue = [];
      for (let i = 0; i < selfActor.sightQueue.size(); i++) {
        const sr = selfActor.sightQueue[i];
        if (needsArchetypeFilter && sr.actor.archetype !== archetype) continue;
        if (needsNearby && sr.distanceSq > nearbyThresholdSq) continue;
        if (needsFarAway && sr.distanceSq < farAwayThresholdSq) continue;
        filteredSightQueue.push(sr);
      }
    } else {
      filteredSightQueue = selfActor.sightQueue;
    }

    if (filteredSightQueue.size() > 0) {
      // Find the nearest actor in the (unsorted) filtered list -- O(n) scan
      let nearestIdx = 0;
      let nearestDistSq = filteredSightQueue[0].distanceSq;
      for (let i = 1; i < filteredSightQueue.size(); i++) {
        if (filteredSightQueue[i].distanceSq < nearestDistSq) {
          nearestDistSq = filteredSightQueue[i].distanceSq;
          nearestIdx = i;
        }
      }
      sightResult = filteredSightQueue[nearestIdx];
    }

    if (!sightResult) {
      return FALSE_VALUE; // No seen actor passed the filters (if any)
    }

    const seenActor = sightResult.actor;
    const targetPos = new Vector2(seenActor.sprite.x, seenActor.sprite.y);

    // Set as remembered actor
    state.rememberedPos = mkVector2Value(targetPos);
    state.rememberedActorId = mkNumberValue(seenActor.actorId);
    state.memoryExpiration = now + ctx.services.app.rng.next() * 2000 + 500; // Remember for 0.5-2.5s of sim time
    setCallSiteState(ctx, state);

    // Store targets for the DO side to access
    const seenActors = filteredSightQueue.filter((sr) => sr.actor.sprite.body !== undefined).map((sr) => sr.actor);
    setRuleVariable(
      ctx,
      "targetActors",
      mkListValue("", List.from(seenActors.map((actor) => mkNumberValue(actor.actorId))))
    );
    setRuleVariable(
      ctx,
      "targetPositions",
      mkListValue("", List.from(seenActors.map((actor) => mkVector2Value(new Vector2(actor.sprite.x, actor.sprite.y)))))
    );
    setRuleVariable(ctx, "targetActor", state.rememberedActorId!);
    setRuleVariable(ctx, "targetPos", state.rememberedPos!);
    selfActor.debugTargetPositions.set(seenActor.actorId, targetPos);
    return TRUE_VALUE;
  } catch (error) {
    logger.error("Error executing see sensor:", error);
    return FALSE_VALUE;
  }
}

export default {
  ...EcosimHostActions.See,
  callDef,
  fn: {
    onInitialized: initSee,
    exec: execSee,
  },
  isAsync: false,
  outputType: CoreTypeIds.Boolean,
  metadata: { label: "see" },
  capabilities: SeeSensorCapabilityBitSet,
} satisfies CreateHostSensorOptions;

/** Modifier tiles the `see` sensor accepts. */
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
  { id: TileIds.Modifier.DistanceNearby, label: "nearby" },
  { id: TileIds.Modifier.DistanceFarAway, label: "far away" },
];
