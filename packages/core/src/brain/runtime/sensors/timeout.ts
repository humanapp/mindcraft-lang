import { MathOps } from "../../../platform/math";
import {
  type ActionDescriptor,
  type BrainActionCallDef,
  bag,
  CoreParameterId,
  CoreSensorId,
  CoreTypeIds,
  type ExecutionContext,
  FALSE_VALUE,
  getCallSiteState,
  getSlotId,
  type HostActionBinding,
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

const descriptor: ActionDescriptor = {
  key: CoreSensorId.Timeout,
  kind: "sensor",
  callDef,
  isAsync: false,
  outputType: CoreTypeIds.Boolean,
};

const kAnonymousNumberSlotId = getSlotId(callDef, AnonNumber);

type TimeoutState = {
  fireTime: number;
  lastTick: number;
};

function onPageEntered(ctx: ExecutionContext) {
  const state: TimeoutState = {
    fireTime: 0,
    // -2 ensures the first tick (0) triggers the skip-reset branch
    // (0 !== -2 + 1), which initializes fireTime to ctx.time + delay
    // instead of firing immediately.
    lastTick: -2,
  };
  setCallSiteState(ctx, state);
}

function execTimeout(ctx: ExecutionContext, args: MapValue): Value {
  let delay = 1; // default 1 second
  const anonNumberValue = args.v.get(kAnonymousNumberSlotId);
  if (anonNumberValue !== undefined) {
    // The user supplied a delay expression. If it failed to evaluate to a
    // valid finite number (e.g. nil from an unassigned variable, or a
    // NaN-poisoned arithmetic result), refuse to fire so the rule
    // evaluates false rather than silently using the default delay.
    if (!isNumberValue(anonNumberValue) || MathOps.isNaN(anonNumberValue.v)) {
      return FALSE_VALUE;
    }
    delay = anonNumberValue.v;
  }

  let state = getCallSiteState<TimeoutState>(ctx);
  if (!state) {
    state = {
      fireTime: 0,
      // -2 ensures the first tick (0) triggers the skip-reset branch
      // (0 !== -2 + 1), which initializes fireTime to ctx.time + delay
      // instead of firing immediately.
      lastTick: -2,
    };
    setCallSiteState(ctx, state);
  }

  let shouldFire = false;

  if (ctx.currentTick !== state.lastTick + 1) {
    // Ticks were skipped -- reset the timer
    state.fireTime = ctx.time + delay * 1000;
  }

  if (ctx.time >= state.fireTime) {
    shouldFire = true;
    state.fireTime = ctx.time + delay * 1000;
  }

  state.lastTick = ctx.currentTick;

  return shouldFire ? TRUE_VALUE : FALSE_VALUE;
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  onPageEntered,
  execSync: execTimeout,
};

export default {
  fnId: CoreSensorId.Timeout,
  tileId: mkSensorTileId(CoreSensorId.Timeout),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    onPageEntered,
    exec: execTimeout,
  },
  callDef,
};
