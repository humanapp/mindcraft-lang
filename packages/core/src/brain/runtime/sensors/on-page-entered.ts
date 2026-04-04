import {
  type ActionDescriptor,
  type BrainActionCallDef,
  type BrainActionCallSpec,
  CoreSensorId,
  CoreTypeIds,
  type ExecutionContext,
  FALSE_VALUE,
  getCallSiteState,
  type HostActionBinding,
  type MapValue,
  mkCallDef,
  mkSensorTileId,
  setCallSiteState,
  TRUE_VALUE,
  type Value,
} from "../../interfaces";

const callSpec: BrainActionCallSpec = {
  type: "bag",
  items: [],
};

const callDef: BrainActionCallDef = mkCallDef(callSpec);

const descriptor: ActionDescriptor = {
  key: CoreSensorId.OnPageEntered,
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

function fnOnPageEntered(ctx: ExecutionContext, _args: MapValue): Value {
  const state = getCallSiteState<TimeoutState>(ctx)!;
  if (!state?.fired) {
    state.fired = true;
    return TRUE_VALUE;
  }
  return FALSE_VALUE;
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  onPageEntered,
  execSync: fnOnPageEntered,
};

export default {
  fnId: CoreSensorId.OnPageEntered,
  tileId: mkSensorTileId(CoreSensorId.OnPageEntered),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    onPageEntered,
    exec: fnOnPageEntered,
  },
  callDef,
};
