import {
  type BrainActionCallChoiceSpec,
  bag,
  CoreTypeIds,
  choice,
  conditional,
  type ExecutionContext,
  extractNumberValue,
  getSlotId,
  type MapValue,
  mkCallDef,
  mod,
  optional,
  param,
  repeated,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import type { Actor } from "@/brain/actor";
import { getSelf } from "@/brain/execution-context-types";
import type { ActionDef } from "@/brain/fns/action-def";
import { resolveTargetPosition } from "@/brain/fns/utils";
import { type Steering, turnAwayFrom, turnToAngle, turnToward } from "@/brain/movement";
import { TileIds } from "@/brain/tileids";

// ---------------------------------------------------------------------------
// Call definition & slot IDs
// ---------------------------------------------------------------------------

const Toward = mod(TileIds.Modifier.MovementToward);
const AwayFrom = mod(TileIds.Modifier.MovementAwayFrom);
const Around = mod(TileIds.Modifier.TurnAround);
const Left = mod(TileIds.Modifier.TurnLeft);
const Right = mod(TileIds.Modifier.TurnRight);
const North = mod(TileIds.Modifier.DirectionNorth);
const South = mod(TileIds.Modifier.DirectionSouth);
const East = mod(TileIds.Modifier.DirectionEast);
const West = mod(TileIds.Modifier.DirectionWest);
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
  options: [Toward, AwayFrom],
};

const callDef = mkCallDef(
  bag(
    optional(
      choice(
        // Targeted modifiers (toward / away from a target)
        TargetedModifier,
        // Fixed-direction modifiers (mutually exclusive with each other and targeted)
        Around,
        Left,
        Right,
        North,
        South,
        East,
        West
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
const kAroundSlotId = getSlotId(callDef, Around);
const kLeftSlotId = getSlotId(callDef, Left);
const kRightSlotId = getSlotId(callDef, Right);
const kNorthSlotId = getSlotId(callDef, North);
const kSouthSlotId = getSlotId(callDef, South);
const kEastSlotId = getSlotId(callDef, East);
const kWestSlotId = getSlotId(callDef, West);
const kQuicklySlotId = getSlotId(callDef, Quickly);
const kSlowlySlotId = getSlotId(callDef, Slowly);
const kPrioritySlotId = getSlotId(callDef, Priority);
const kAnonActorRefSlotId = getSlotId(callDef, AnonActorRef);

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

// ---------------------------------------------------------------------------
// Compass direction angles (screen coordinates: +Y is down)
// ---------------------------------------------------------------------------

const ANGLE_NORTH = -Math.PI / 2; // up
const ANGLE_SOUTH = Math.PI / 2; // down
const ANGLE_EAST = 0; // right
const ANGLE_WEST = Math.PI; // left

// ---------------------------------------------------------------------------
// Steering computation
// ---------------------------------------------------------------------------

function computeSteering(ctx: ExecutionContext, args: MapValue, self: Actor): Steering | undefined {
  const speedMultiplier = getSpeedMultiplier(args);
  const weight = getWeight(args);

  if (args.v.has(kTowardSlotId)) {
    const targetPos = resolveTargetPosition(ctx, args, kAnonActorRefSlotId);
    return targetPos ? turnToward(self, targetPos, weight, speedMultiplier) : undefined;
  }

  if (args.v.has(kAwayFromSlotId)) {
    const targetPos = resolveTargetPosition(ctx, args, kAnonActorRefSlotId);
    return targetPos ? turnAwayFrom(self, targetPos, weight, speedMultiplier) : undefined;
  }

  if (args.v.has(kAroundSlotId)) {
    // Turn 180 degrees from current facing
    const oppositeAngle = self.sprite.rotation + Math.PI;
    return turnToAngle(self, oppositeAngle, weight, speedMultiplier);
  }

  if (args.v.has(kLeftSlotId)) {
    // Pure left turn (counterclockwise): turn = -1, no forward
    return { turn: -1, forward: 0, weight, speedMultiplier, label: "turnLeft" };
  }

  if (args.v.has(kRightSlotId)) {
    // Pure right turn (clockwise): turn = +1, no forward
    return { turn: 1, forward: 0, weight, speedMultiplier, label: "turnRight" };
  }

  // Compass directions
  if (args.v.has(kNorthSlotId)) return turnToAngle(self, ANGLE_NORTH, weight, speedMultiplier);
  if (args.v.has(kSouthSlotId)) return turnToAngle(self, ANGLE_SOUTH, weight, speedMultiplier);
  if (args.v.has(kEastSlotId)) return turnToAngle(self, ANGLE_EAST, weight, speedMultiplier);
  if (args.v.has(kWestSlotId)) return turnToAngle(self, ANGLE_WEST, weight, speedMultiplier);

  // Default: no-op (no directional modifier specified)
  return undefined;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function execTurn(ctx: ExecutionContext, args: MapValue): Value {
  const self = getSelf(ctx);
  if (!self) return VOID_VALUE;

  const animalComp = self.animalComp;
  if (!animalComp) return VOID_VALUE; // only animals turn

  const steering = computeSteering(ctx, args, self);
  if (steering) {
    animalComp.steeringQueue.push(steering);
  }

  return VOID_VALUE;
}

export default {
  tileId: TileIds.Actuator.Turn,
  callDef,
  fn: { exec: execTurn },
  isAsync: false,
  returnType: CoreTypeIds.Void,
  visual: { label: "turn", iconUrl: "/assets/brain/icons/turn.svg" },
} satisfies ActionDef;
