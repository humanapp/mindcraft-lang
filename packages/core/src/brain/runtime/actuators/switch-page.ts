import {
  CoreActuatorId,
  CoreParameterId,
  choice,
  type ExecutionContext,
  getSlotId,
  isNumberValue,
  isStringValue,
  type MapValue,
  mkActuatorTileId,
  mkCallDef,
  param,
  type Value,
  VOID_VALUE,
} from "../../interfaces";

const AnonNumber = param(CoreParameterId.AnonymousNumber, { anonymous: true });
const AnonString = param(CoreParameterId.AnonymousString, { anonymous: true });

const callDef = mkCallDef(choice(AnonNumber, AnonString));

const kAnonymousNumberSlotId = getSlotId(callDef, AnonNumber);
const kAnonymousStringSlotId = getSlotId(callDef, AnonString);

function fnSwitchPage(ctx: ExecutionContext, args: MapValue): Value {
  const hasArg = args.v.has(0);
  if (!hasArg) {
    // No argument provided, do nothing or handle as needed
    //console.warn("Switch Page actuator called without any arguments");
    return VOID_VALUE;
  }
  const argValue = args.v.get(0);
  if (!argValue) {
    // Argument is explicitly undefined or null, do nothing
    //console.warn("Switch Page actuator called with undefined/null argument");
    return VOID_VALUE;
  }

  const hasNumberArg = isNumberValue(argValue);
  const hasStringArg = isStringValue(argValue);

  if (hasNumberArg) {
    const pageNumber = argValue.v - 1; // Convert 1-based to 0-based index
    ctx.brain.requestPageChange(pageNumber);
  } else if (hasStringArg) {
    const str = argValue.v;
    // Try stable pageId first (from BrainTilePageDef), then fall back to
    // page name lookup so brain code can compute page names at runtime.
    ctx.brain.requestPageChangeByPageId(str);
  }

  return VOID_VALUE;
}

export default {
  fnId: CoreActuatorId.SwitchPage,
  tileId: mkActuatorTileId(CoreActuatorId.SwitchPage),
  isAsync: false,
  fn: {
    exec: fnSwitchPage,
  },
  callDef,
};
