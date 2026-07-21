import type { HostActionIds } from "@mindcraft-lang/core/app";

/**
 * Stable numeric ids for the sim module's host functions and host actions.
 *
 * Both id spaces live in the target range (at or above
 * `TARGET_FUNC_ID_BASE` / `TARGET_ACTION_ID_BASE` from core). An id, once
 * assigned, is permanent: never change it and never reuse it. Append new
 * members at the next free id.
 */

/** Stable funcIds of the sim module's host functions. */
export enum SimFuncId {
  Vector2Add = 1024,
  Vector2Sub = 1025,
  Vector2Mul = 1026,
  Vector2Div = 1027,
  Vector2Dot = 1028,
  Vector2Cross = 1029,
  Vector2Magnitude = 1030,
  Vector2Normalize = 1031,
  Vector2Distance = 1032,
  Vector2Lerp = 1033,
  Vector2Angle = 1034,
  Vector2Rotate = 1035,
  BrainContextGetTargetActor = 1036,
  BrainContextGetTargetPosition = 1037,
  EngineContextGetActorsByArchetype = 1038,
  EngineContextGetActorById = 1039,
  ConvActorRefToNumber = 1040,
  ConvActorRefToVector2 = 1041,
  ConvVector2ToString = 1042,
  SensorBump = 1043,
  SensorSee = 1044,
  ActuatorEat = 1045,
  ActuatorMove = 1046,
  ActuatorSay = 1047,
  ActuatorShoot = 1048,
  ActuatorTurn = 1049,
}

/**
 * Stable type-atom ids of the sim module's native struct types. Serialized
 * programs reference nominal types by these values, so an id, once assigned,
 * is never changed or reused. All values are at or above core's
 * `TARGET_TYPE_ATOM_BASE`. Append new members at the next free id.
 */
export enum SimTypeAtomId {
  Vector2 = 1024,
  ActorRef = 1025,
}

/**
 * Identity records of the sim module's sensors and actuators, one per host
 * action. The record is the single declaration of each action's key and
 * action id; `fnId` references the action's {@link SimFuncId} member. Action
 * ids are permanent once assigned: append new records at the next free
 * action id and never renumber or reuse one.
 */
export const SimHostActions = {
  Bump: { key: "sensor.bump", actionId: 1024, fnId: SimFuncId.SensorBump },
  See: { key: "sensor.see", actionId: 1025, fnId: SimFuncId.SensorSee },
  Eat: { key: "actuator.eat", actionId: 1026, fnId: SimFuncId.ActuatorEat },
  Move: { key: "actuator.move", actionId: 1027, fnId: SimFuncId.ActuatorMove },
  Say: { key: "actuator.say", actionId: 1028, fnId: SimFuncId.ActuatorSay },
  Shoot: { key: "actuator.shoot", actionId: 1029, fnId: SimFuncId.ActuatorShoot },
  Turn: { key: "actuator.turn", actionId: 1030, fnId: SimFuncId.ActuatorTurn },
} as const satisfies Record<string, HostActionIds>;
