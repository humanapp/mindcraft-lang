/**
 * Stable numeric id declarations for the host-function and host-action
 * registries.
 *
 * Every host function and host action registers under a required,
 * author-assigned numeric id declared as an explicitly-valued enum member.
 * Serialized programs record these ids verbatim, so an id, once assigned,
 * is permanent: never change it and never reuse it. Removing an entry
 * leaves a gap forever.
 *
 * The shared `HOST_CALL` funcId space is partitioned by owner:
 *
 * - core owns `[0, TARGET_FUNC_ID_BASE)`
 * - the active target owns `[TARGET_FUNC_ID_BASE, DYNAMIC_FUNC_ID_BASE)`
 * - dynamically registered, program-dependent functions (user-declared enum
 *   conversions and operators) own `[DYNAMIC_FUNC_ID_BASE, ...)`
 *
 * The host-action id space partitions the same way at
 * `TARGET_ACTION_ID_BASE`, with no dynamic region.
 *
 * Ids 0-127 encode as 1-byte var-uints in the binary program form; keep the
 * hottest core operators there.
 */

/** First funcId owned by the active target; core funcIds are below this. */
export const TARGET_FUNC_ID_BASE = 1024;

/**
 * First funcId of the dynamic region for program-dependent host functions
 * (user-declared enum conversions and operators). Ids at and above this
 * value are not part of the device ABI; they are stable only for a given
 * compiled program.
 */
export const DYNAMIC_FUNC_ID_BASE = 65536;

/** First host-action id owned by the active target; core action ids are below this. */
export const TARGET_ACTION_ID_BASE = 1024;

/**
 * Owner of a registration scope: which partition of the id space the
 * registering code is allowed to assign ids from.
 */
export type StableIdOwner = "core" | "target" | "dynamic";

/**
 * Stable funcIds of the core host functions: operator overloads,
 * conversions, builtins, context methods, and the sensor/actuator function
 * entries. Append new members at the next free id; never renumber.
 */
export enum CoreFuncId {
  OpAndBoolean = 0,
  OpOrBoolean = 1,
  OpNotBoolean = 2,
  OpAddNumber = 3,
  OpSubtractNumber = 4,
  OpMultiplyNumber = 5,
  OpDivideNumber = 6,
  OpModuloNumber = 7,
  OpPowerNumber = 8,
  OpNegateNumber = 9,
  OpBitwiseAndNumber = 10,
  OpBitwiseOrNumber = 11,
  OpBitwiseXorNumber = 12,
  OpBitwiseNotNumber = 13,
  OpLeftShiftNumber = 14,
  OpRightShiftNumber = 15,
  OpEqualToBoolean = 16,
  OpNotEqualToBoolean = 17,
  OpEqualToNumber = 18,
  OpNotEqualToNumber = 19,
  OpLessThanNumber = 20,
  OpLessThanOrEqualToNumber = 21,
  OpGreaterThanNumber = 22,
  OpGreaterThanOrEqualToNumber = 23,
  OpAddString = 24,
  OpEqualToString = 25,
  OpNotEqualToString = 26,
  OpEqualToNil = 27,
  OpNotEqualToNil = 28,
  OpNotNil = 29,
  OpEqualToNumberNil = 30,
  OpEqualToNilNumber = 31,
  OpNotEqualToNumberNil = 32,
  OpNotEqualToNilNumber = 33,
  OpEqualToBooleanNil = 34,
  OpEqualToNilBoolean = 35,
  OpNotEqualToBooleanNil = 36,
  OpNotEqualToNilBoolean = 37,
  OpEqualToStringNil = 38,
  OpEqualToNilString = 39,
  OpNotEqualToStringNil = 40,
  OpNotEqualToNilString = 41,
  ConvNumberToString = 42,
  ConvStringToNumber = 43,
  ConvNumberToBoolean = 44,
  ConvBooleanToNumber = 45,
  ConvStringToBoolean = 46,
  ConvBooleanToString = 47,
  BrainContextGetVariable = 48,
  BrainContextSetVariable = 49,
  RuleContextGetVariable = 50,
  RuleContextSetVariable = 51,
  SensorRandom = 52,
  SensorOnPageEntered = 53,
  SensorTimeout = 54,
  SensorCurrentPage = 55,
  SensorPreviousPage = 56,
  ActuatorSwitchPage = 57,
  ActuatorRestartPage = 58,
  ActuatorYield = 59,
  ListGet = 60,
  StringGet = 61,
  MapKeys = 62,
  MapValues = 63,
  MapSize = 64,
  MapClear = 65,
  MathAbs = 66,
  MathAcos = 67,
  MathAsin = 68,
  MathAtan = 69,
  MathAtan2 = 70,
  MathCeil = 71,
  MathCos = 72,
  MathExp = 73,
  MathFloor = 74,
  MathLog = 75,
  MathMax = 76,
  MathMin = 77,
  MathPow = 78,
  MathRandom = 79,
  MathRound = 80,
  MathSin = 81,
  MathSqrt = 82,
  MathTan = 83,
  StrLength = 84,
  StrCharAt = 85,
  StrCharCodeAt = 86,
  StrIndexOf = 87,
  StrLastIndexOf = 88,
  StrSlice = 89,
  StrSubstring = 90,
  StrToLowerCase = 91,
  StrToUpperCase = 92,
  StrTrim = 93,
  StrSplit = 94,
  StrConcat = 95,
}

/**
 * Identity bundle for one host action: its string key (the build-time
 * authoring identity, used for registry keys, function names, and tile ids)
 * and its stable numeric ids (the device-ABI dispatch identity).
 */
export interface HostActionIds {
  /** Action key: registry key, host-function name, and tile-id basis. */
  readonly key: string;
  /** Stable host-action id; the `HOST_ACTION_CALL` operand. */
  readonly actionId: number;
  /** Stable funcId of the action's host function. */
  readonly fnId: number;
}

/**
 * Identity records of the core sensors and actuators, one per host action.
 * The record is the single declaration of each action's key and action id;
 * `fnId` references the action's {@link CoreFuncId} member. Action ids are
 * permanent once assigned: append new records at the next free action id and
 * never renumber or reuse one.
 */
export const CoreHostActions = {
  SwitchPage: { key: "switch-page", actionId: 0, fnId: CoreFuncId.ActuatorSwitchPage },
  RestartPage: { key: "restart-page", actionId: 1, fnId: CoreFuncId.ActuatorRestartPage },
  Yield: { key: "yield", actionId: 2, fnId: CoreFuncId.ActuatorYield },
  Random: { key: "random", actionId: 3, fnId: CoreFuncId.SensorRandom },
  OnPageEntered: { key: "on-page-entered", actionId: 4, fnId: CoreFuncId.SensorOnPageEntered },
  Timeout: { key: "sensor.timeout", actionId: 5, fnId: CoreFuncId.SensorTimeout },
  CurrentPage: { key: "current-page", actionId: 6, fnId: CoreFuncId.SensorCurrentPage },
  PreviousPage: { key: "previous-page", actionId: 7, fnId: CoreFuncId.SensorPreviousPage },
} as const satisfies Record<string, HostActionIds>;
