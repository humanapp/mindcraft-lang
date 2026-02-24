import {
  type BrainActionCallDef,
  type BrainActionCallSpec,
  CoreSensorId,
  type ExecutionContext,
  FALSE_VALUE,
  getCallSiteState,
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

export default {
  fnId: CoreSensorId.OnPageEntered,
  tileId: mkSensorTileId(CoreSensorId.OnPageEntered),
  isAsync: false,
  fn: {
    onPageEntered,
    exec: fnOnPageEntered,
  },
  callDef,
};
