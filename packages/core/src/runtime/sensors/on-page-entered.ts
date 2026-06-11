import { CoreHostActions } from "../abi-ids";
import type { ExecutionContext, HostActionBinding } from "../context";
import { getCallSiteState, setCallSiteState } from "../context";
import { CoreTypeIds } from "../core-types";
import { type ActionDescriptor, type BrainActionCallDef, type BrainActionCallSpec, mkCallDef } from "../function-defs";
import { mkSensorTileId } from "../tile-ids";
import { FALSE_VALUE, TRUE_VALUE, type Value } from "../value";

const callSpec: BrainActionCallSpec = {
  type: "bag",
  items: [],
};

const callDef: BrainActionCallDef = mkCallDef(callSpec);

const descriptor: ActionDescriptor = {
  key: CoreHostActions.OnPageEntered.key,
  kind: "sensor",
  callDef,
  isAsync: false,
  outputType: CoreTypeIds.Boolean,
};

type TimeoutState = {
  fired: boolean;
};

function onPageEntered(ctx: ExecutionContext) {
  // Reset state when page is entered
  const state: TimeoutState = {
    fired: false,
  };
  setCallSiteState(ctx, state);
}

function fnOnPageEntered(ctx: ExecutionContext): Value {
  const state = getCallSiteState<TimeoutState>(ctx);
  if (state && !state.fired) {
    state.fired = true;
    return TRUE_VALUE;
  }
  return FALSE_VALUE;
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  id: CoreHostActions.OnPageEntered.actionId,
  onPageEntered,
  execSync: fnOnPageEntered,
};

export default {
  key: CoreHostActions.OnPageEntered.key,
  tileId: mkSensorTileId(CoreHostActions.OnPageEntered.key),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    onPageEntered,
    exec: fnOnPageEntered,
  },
  callDef,
};
