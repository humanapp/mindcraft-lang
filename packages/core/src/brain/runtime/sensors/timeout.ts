import {
  type BrainActionCallDef,
  bag,
  CoreParameterId,
  CoreSensorId,
  type ExecutionContext,
  FALSE_VALUE,
  getCallSiteState,
  getSlotId,
  isNumberValue,
  type MapValue,
  mkCallDef,
  mkSensorTileId,
  optional,
  param,
  setCallSiteState,
  TRUE_VALUE,
  type Value,
} from "../../interfaces";

const AnonNumber = param(CoreParameterId.AnonymousNumber, {
  name: "anonNumber",
  required: true,
  anonymous: true,
});

const callDef: BrainActionCallDef = mkCallDef(bag(optional(AnonNumber)));

const kAnonymousNumberSlotId = getSlotId(callDef, AnonNumber);

type TimeoutState = {
  fireTime: number;
  lastTick: number;
  fired: boolean;
};

function onPageEntered(ctx: ExecutionContext) {
  const state: TimeoutState = {
    fireTime: 0,
    lastTick: -1,
    fired: false,
  };
  setCallSiteState(ctx, state);
}

function execTimeout(ctx: ExecutionContext, args: MapValue): Value {
  let delay = 1; // default 1 second
  const anonNumberValue = args.v.get(kAnonymousNumberSlotId)!;
  if (anonNumberValue) {
    if (isNumberValue(anonNumberValue)) {
      delay = anonNumberValue.v;
    }
  }

  let state = getCallSiteState<TimeoutState>(ctx);
  if (!state) {
    state = {
      fireTime: 0,
      lastTick: -1,
      fired: false,
    };
    setCallSiteState(ctx, state);
  }

  if (state.fired) {
    return TRUE_VALUE;
  }

  let shouldFire = false;

  if (ctx.currentTick !== state.lastTick + 1) {
    // Ticks were skipped -- reset the timer
    state.fireTime = ctx.time + delay;
    state.fired = false;
  }

  if (ctx.time >= state.fireTime) {
    shouldFire = true;
    state.fired = true;
  }

  state.lastTick = ctx.currentTick;

  return shouldFire ? TRUE_VALUE : FALSE_VALUE;
}

export default {
  fnId: CoreSensorId.Timeout,
  tileId: mkSensorTileId(CoreSensorId.Timeout),
  isAsync: false,
  fn: {
    onPageEntered,
    exec: execTimeout,
  },
  callDef,
};
