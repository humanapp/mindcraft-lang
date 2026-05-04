import type { ReadonlyList } from "../../platform/list";
import { choice, param } from "../call-spec";
import type { ExecutionContext, HostActionBinding } from "../context";
import { type ActionDescriptor, getSlotId, mkCallDef } from "../function-defs";
import { CoreActuatorId, CoreParameterId, mkActuatorTileId } from "../tile-ids";
import { isNilValue, isNumberValue, isStringValue, type Value, VOID_VALUE } from "../value";

const AnonNumber = param(CoreParameterId.AnonymousNumber, { anonymous: true });
const AnonString = param(CoreParameterId.AnonymousString, { anonymous: true });

const callDef = mkCallDef(choice(AnonNumber, AnonString));

const descriptor: ActionDescriptor = {
  key: CoreActuatorId.SwitchPage,
  kind: "actuator",
  callDef,
  isAsync: false,
};

const kAnonymousNumberSlotId = getSlotId(callDef, AnonNumber);
const kAnonymousStringSlotId = getSlotId(callDef, AnonString);

function fnSwitchPage(ctx: ExecutionContext, args: ReadonlyList<Value>): Value {
  const numberArg = args.get(kAnonymousNumberSlotId);
  const stringArg = args.get(kAnonymousStringSlotId);

  if (numberArg !== undefined && !isNilValue(numberArg) && isNumberValue(numberArg)) {
    const pageNumber = numberArg.v - 1; // Convert 1-based to 0-based index
    ctx.services.brain.pages.requestPageChange(pageNumber);
  } else if (stringArg !== undefined && !isNilValue(stringArg) && isStringValue(stringArg)) {
    // Try stable pageId first (from BrainTilePageDef), then fall back to
    // page name lookup so brain code can compute page names at runtime.
    ctx.services.brain.pages.requestPageChangeByPageId(stringArg.v);
  } else {
    // No argument provided -- restart the current page
    ctx.services.brain.pages.requestPageRestart();
  }

  return VOID_VALUE;
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  execSync: fnSwitchPage,
};

export default {
  fnId: CoreActuatorId.SwitchPage,
  tileId: mkActuatorTileId(CoreActuatorId.SwitchPage),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    exec: fnSwitchPage,
  },
  callDef,
};
