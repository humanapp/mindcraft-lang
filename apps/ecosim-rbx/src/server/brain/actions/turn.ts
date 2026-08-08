import {
  type BrainActionCallChoiceSpec,
  bag,
  CoreTypeIds,
  type CreateHostActuatorOptions,
  choice,
  conditional,
  type ExecutionContext,
  extractNumberValue,
  getSlotId,
  logger,
  type ModifierTileInput,
  mkCallDef,
  mod,
  optional,
  type ParameterTileInput,
  param,
  type ReadonlyList,
  repeated,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/app";
import { EcosimHostActions } from "../abi-ids";
import type { Actor } from "../actor";
import { getSelf } from "../execution-context-types";
import { type Steering, turnAwayFrom, turnToAngle, turnToward } from "../movement";
import { TileIds } from "../tileids";
import { EcosimTypeIds } from "../type-system";
import { hasArg, resolveTargetPosition } from "./utils";

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

const kQuicklyMultiplier = 0.5; // each Quickly increases speed by 50%
const kSlowlyMultiplier = 1; // each Slowly decreases speed by 100% of base (50% of previous)

/** Compute speed multiplier from quickly/slowly repeat counts. */
function getSpeedMultiplier(args: ReadonlyList<Value>): number {
  const quicklyCount = extractNumberValue(args.get(kQuicklySlotId)) ?? 0;
  const slowlyCount = extractNumberValue(args.get(kSlowlySlotId)) ?? 0;
  if (quicklyCount > 0) return 1 + quicklyCount * kQuicklyMultiplier; // 1.5x, 2x, 2.5x
  if (slowlyCount > 0) return 1 / (1 + slowlyCount * kSlowlyMultiplier); // ~0.5x, 0.33x, 0.25x
  return 1;
}

/** Extract priority weight (default 0.5). */
function getWeight(args: ReadonlyList<Value>): number {
  return extractNumberValue(args.get(kPrioritySlotId)) ?? 0.5;
}

// ---------------------------------------------------------------------------
// Compass direction angles (simulation coordinates: +y is south)
// ---------------------------------------------------------------------------

const ANGLE_NORTH = -math.pi / 2; // up
const ANGLE_SOUTH = math.pi / 2; // down
const ANGLE_EAST = 0; // right
const ANGLE_WEST = math.pi; // left

// ---------------------------------------------------------------------------
// Steering computation
// ---------------------------------------------------------------------------

function computeSteering(ctx: ExecutionContext, args: ReadonlyList<Value>, selfActor: Actor): Steering | undefined {
  const speedMultiplier = getSpeedMultiplier(args);
  const weight = getWeight(args);

  if (hasArg(args, kTowardSlotId)) {
    const targetPos = resolveTargetPosition(ctx, args, kAnonActorRefSlotId);
    return targetPos ? turnToward(selfActor, targetPos, weight, speedMultiplier) : undefined;
  }

  if (hasArg(args, kAwayFromSlotId)) {
    const targetPos = resolveTargetPosition(ctx, args, kAnonActorRefSlotId);
    return targetPos ? turnAwayFrom(selfActor, targetPos, weight, speedMultiplier) : undefined;
  }

  if (hasArg(args, kAroundSlotId)) {
    // Turn 180 degrees from current facing
    const oppositeAngle = selfActor.sprite.rotation + math.pi;
    return turnToAngle(selfActor, oppositeAngle, weight, speedMultiplier);
  }

  if (hasArg(args, kLeftSlotId)) {
    // Pure left turn (counterclockwise): turn = -1, no forward
    return { turn: -1, forward: 0, weight, speedMultiplier, label: "turnLeft" };
  }

  if (hasArg(args, kRightSlotId)) {
    // Pure right turn (clockwise): turn = +1, no forward
    return { turn: 1, forward: 0, weight, speedMultiplier, label: "turnRight" };
  }

  // Compass directions
  if (hasArg(args, kNorthSlotId)) return turnToAngle(selfActor, ANGLE_NORTH, weight, speedMultiplier);
  if (hasArg(args, kSouthSlotId)) return turnToAngle(selfActor, ANGLE_SOUTH, weight, speedMultiplier);
  if (hasArg(args, kEastSlotId)) return turnToAngle(selfActor, ANGLE_EAST, weight, speedMultiplier);
  if (hasArg(args, kWestSlotId)) return turnToAngle(selfActor, ANGLE_WEST, weight, speedMultiplier);

  // Default: spin in place continuously (clockwise)
  return { turn: 1, forward: 0, weight, speedMultiplier, label: "turnContinuous" };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function execTurn(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  try {
    const selfActor = getSelf(ctx);
    if (!selfActor) return VOID_VALUE;

    const animalComp = selfActor.animalComp;
    if (!animalComp) return VOID_VALUE; // only animals turn

    const steering = computeSteering(ctx, args, selfActor);
    if (steering) {
      animalComp.steeringQueue.push(steering);
    }
  } catch (error) {
    logger.error("Error executing turn action:", error);
  }

  return VOID_VALUE;
}

export default {
  ...EcosimHostActions.Turn,
  callDef,
  fn: { exec: execTurn },
  isAsync: false,
  metadata: { label: "turn" },
} satisfies CreateHostActuatorOptions;

/** Modifier tiles the `turn` actuator accepts. */
export const modifiers: ModifierTileInput[] = [
  { id: TileIds.Modifier.MovementToward, label: "toward" },
  { id: TileIds.Modifier.MovementAwayFrom, label: "away from" },
  { id: TileIds.Modifier.TurnAround, label: "around" },
  { id: TileIds.Modifier.TurnLeft, label: "left" },
  { id: TileIds.Modifier.TurnRight, label: "right" },
  { id: TileIds.Modifier.DirectionNorth, label: "north" },
  { id: TileIds.Modifier.DirectionSouth, label: "south" },
  { id: TileIds.Modifier.DirectionEast, label: "east" },
  { id: TileIds.Modifier.DirectionWest, label: "west" },
  { id: TileIds.Modifier.Quickly, label: "quickly" },
  { id: TileIds.Modifier.Slowly, label: "slowly" },
];

/** Parameter tiles the `turn` actuator accepts. */
export const parameters: ParameterTileInput[] = [
  { id: TileIds.Parameter.AnonymousActorRef, dataType: EcosimTypeIds.ActorRef, hidden: true },
  {
    id: TileIds.Parameter.Priority,
    dataType: CoreTypeIds.Number,
    label: "priority",
  },
];
