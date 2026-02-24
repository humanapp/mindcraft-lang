import { type List, Vector2 } from "@mindcraft-lang/core";
import {
  type BrainActionCallChoiceSpec,
  bag,
  CoreTypeIds,
  choice,
  conditional,
  type ExecutionContext,
  extractListValue,
  extractNumberValue,
  getCallSiteState,
  getSlotId,
  type ListValue,
  type MapValue,
  mkCallDef,
  mod,
  optional,
  param,
  repeated,
  type StructValue,
  setCallSiteState,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import type { Actor } from "@/brain/actor";
import { getSelf } from "@/brain/execution-context-types";
import type { ActionDef } from "@/brain/fns/action-def";
import { resolveTargetPosition } from "@/brain/fns/utils";
import { type Steering, steerAvoid, steerAwayFrom, steerForward, steerToward } from "@/brain/movement";
import { TileIds } from "@/brain/tileids";
import { extractVector2, mkVector2Value } from "@/brain/type-system";

// ---------------------------------------------------------------------------
// Call definition & slot IDs
// ---------------------------------------------------------------------------

const Forward = mod(TileIds.Modifier.MovementForward);
const Toward = mod(TileIds.Modifier.MovementToward);
const AwayFrom = mod(TileIds.Modifier.MovementAwayFrom);
const Avoid = mod(TileIds.Modifier.MovementAvoid);
const Wander = mod(TileIds.Modifier.MovementWander);
const Quickly = mod(TileIds.Modifier.Quickly);
const Slowly = mod(TileIds.Modifier.Slowly);
const Priority = param(TileIds.Parameter.Priority);
const AnonActorRef = param(TileIds.Parameter.AnonymousActorRef, {
  anonymous: true,
});

// Named choice so the conditional can check if a targeted modifier was selected
const TargetedModifier: BrainActionCallChoiceSpec = {
  type: "choice",
  name: "targeted",
  options: [Toward, AwayFrom, Avoid],
};

const callDef = mkCallDef(
  bag(
    optional(
      choice(
        // Mutually exclusive directional modifiers
        Forward,
        TargetedModifier,
        // Wander is exclusive with directional modifiers (default if none provided)
        Wander
      )
    ),
    // Optional anonymous actorRef, available only when a targeted modifier is selected
    optional(conditional("targeted", optional(AnonActorRef))),
    // Mutually exclusive speed modifiers, each repeatable up to 3 times
    optional(choice(repeated(Quickly, { max: 3 }), repeated(Slowly, { max: 3 }))),
    optional(Priority)
  )
);

const kTowardSlotId = getSlotId(callDef, Toward);
const kAwayFromSlotId = getSlotId(callDef, AwayFrom);
const kAvoidSlotId = getSlotId(callDef, Avoid);
const kWanderSlotId = getSlotId(callDef, Wander);
const kQuicklySlotId = getSlotId(callDef, Quickly);
const kSlowlySlotId = getSlotId(callDef, Slowly);
const kPrioritySlotId = getSlotId(callDef, Priority);
const kAnonActorRefSlotId = getSlotId(callDef, AnonActorRef);

// ---------------------------------------------------------------------------
// Wander state (persisted across ticks via call-site state)
// ---------------------------------------------------------------------------

type MoveState = {
  wanderTargetPos: StructValue;
  wanderTargetExpiresAt: number;
};

// ---------------------------------------------------------------------------
// Speed & weight helpers
// ---------------------------------------------------------------------------

/** Compute speed multiplier from quickly/slowly repeat counts. */
function getSpeedMultiplier(args: MapValue): number {
  const quicklyCount = extractNumberValue(args.v.get(kQuicklySlotId)) ?? 0;
  const slowlyCount = extractNumberValue(args.v.get(kSlowlySlotId)) ?? 0;
  if (quicklyCount > 0) return 1 + quicklyCount * 0.5; // 1.5x, 2x, 2.5x
  if (slowlyCount > 0) return 1 / (1 + slowlyCount * 0.5); // ~0.67x, 0.5x, 0.4x
  return 1;
}

/** Extract priority weight (default 0.5). */
function getWeight(args: MapValue): number {
  return extractNumberValue(args.v.get(kPrioritySlotId)) ?? 0.5;
}

/**
 * Resolve target position for "away from" mode.
 *
 * When no explicit actor-ref argument is provided, prefers the rule's
 * `targetPositions` list variable (computing center of mass of up to 2
 * positions) over a single target position.
 */
function resolveAwayFromTarget(ctx: ExecutionContext, args: MapValue): Vector2 | undefined {
  // If an explicit actor-ref was provided, use it directly
  if (args.v.has(kAnonActorRefSlotId)) {
    return resolveTargetPosition(ctx, args, kAnonActorRefSlotId);
  }

  // Try targetPositions list variable -> center of mass of the 2 nearest
  const targetPositionsVar = ctx.rule?.getVariable<ListValue>("targetPositions");
  if (targetPositionsVar) {
    const self = getSelf(ctx);
    const sx = self?.sprite.x ?? 0;
    const sy = self?.sprite.y ?? 0;
    const targetPositionsList = extractListValue(targetPositionsVar) as List<StructValue>;
    const allPositions = targetPositionsList.map((posVal) => extractVector2(posVal)!);

    // Pick the 2 nearest positions (list may be unsorted)
    let best1Idx = -1;
    let best1Dist = Number.POSITIVE_INFINITY;
    let best2Idx = -1;
    let best2Dist = Number.POSITIVE_INFINITY;
    allPositions.forEach((pos, i) => {
      const dx = pos.X - sx;
      const dy = pos.Y - sy;
      const distSq = dx * dx + dy * dy;
      if (distSq < best1Dist) {
        best2Idx = best1Idx;
        best2Dist = best1Dist;
        best1Idx = i;
        best1Dist = distSq;
      } else if (distSq < best2Dist) {
        best2Idx = i;
        best2Dist = distSq;
      }
    });

    let sum = new Vector2(0, 0);
    let count = 0;
    if (best1Idx >= 0) {
      sum = sum.add(allPositions.get(best1Idx));
      count++;
    }
    if (best2Idx >= 0) {
      sum = sum.add(allPositions.get(best2Idx));
      count++;
    }
    if (count > 0) return sum.mul(1 / count);
  }

  // Fall back to standard resolution (rule variables)
  return resolveTargetPosition(ctx, args);
}

// ---------------------------------------------------------------------------
// Steering computation
// ---------------------------------------------------------------------------

function computeWanderSteering(ctx: ExecutionContext, self: Actor, weight: number, speedMultiplier: number): Steering {
  const now = self.engine.simTime;
  let state = getCallSiteState<MoveState>(ctx);
  if (!state || state.wanderTargetExpiresAt < now) {
    state = {
      wanderTargetPos: mkVector2Value(self.randomPosition()),
      wanderTargetExpiresAt: now + ctx.brain.rng() * 5000 + 2000, // 2-7 seconds
    } satisfies MoveState;
    setCallSiteState(ctx, state);
  }
  const targetPos = extractVector2(state.wanderTargetPos)!;
  return steerToward(self, targetPos, weight, speedMultiplier);
}

function computeSteering(ctx: ExecutionContext, args: MapValue, self: Actor): Steering | undefined {
  const speedMultiplier = getSpeedMultiplier(args);
  const weight = getWeight(args);

  if (args.v.has(kWanderSlotId)) {
    return computeWanderSteering(ctx, self, weight, speedMultiplier);
  }

  if (args.v.has(kTowardSlotId)) {
    const targetPos = resolveTargetPosition(ctx, args, kAnonActorRefSlotId);
    return targetPos ? steerToward(self, targetPos, weight, speedMultiplier) : undefined;
  }

  if (args.v.has(kAwayFromSlotId)) {
    const targetPos = resolveAwayFromTarget(ctx, args);
    return targetPos ? steerAwayFrom(self, targetPos, weight, speedMultiplier) : undefined;
  }

  if (args.v.has(kAvoidSlotId)) {
    const targetPos = resolveTargetPosition(ctx, args, kAnonActorRefSlotId);
    return targetPos ? steerAvoid(self, targetPos, weight, speedMultiplier) : undefined;
  }

  // Default: move forward (includes explicit Forward modifier or no directional modifier)
  return steerForward(self, weight, speedMultiplier);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function execMove(ctx: ExecutionContext, args: MapValue): Value {
  const self = getSelf(ctx);
  if (!self) {
    //console.warn("Move actuator called without Actor in execution context");
    return VOID_VALUE;
  }

  const animalComp = self.animalComp;
  if (!animalComp) return VOID_VALUE; // only animals move

  const steering = computeSteering(ctx, args, self);
  if (steering) {
    animalComp.steeringQueue.push(steering);
  }

  return VOID_VALUE;
}

export default {
  tileId: TileIds.Actuator.Move,
  callDef,
  fn: { exec: execMove },
  isAsync: false,
  returnType: CoreTypeIds.Void,
  visual: { label: "move", iconUrl: "/assets/brain/icons/move.svg" },
} satisfies ActionDef;
