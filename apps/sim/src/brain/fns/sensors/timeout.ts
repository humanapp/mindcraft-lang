import {
  bag,
  CoreParameterId,
  CoreTypeIds,
  choice,
  conditional,
  type ExecutionContext,
  FALSE_VALUE,
  getCallSiteState,
  getSlotId,
  isNumberValue,
  type MapValue,
  mkCallDef,
  mod,
  optional,
  param,
  setCallSiteState,
  TRUE_VALUE,
  type Value,
  VOID_VALUE,
} from "@mindcraft-lang/core/brain";
import { getSelf } from "@/brain/execution-context-types";
import type { ActionDef } from "@/brain/fns/action-def";
import { TileIds } from "@/brain/tileids";

const AnonNumber = param(CoreParameterId.AnonymousNumber, {
  name: "anonNumber",
  required: true,
  anonymous: true,
});
const TimeMs = mod(TileIds.Modifier.TimeMs);
const TimeSecs = mod(TileIds.Modifier.TimeSecs);

const callDef = mkCallDef(bag(AnonNumber, conditional("anonNumber", optional(choice(TimeMs, TimeSecs)))));

const kAnonymousNumberSlotId = getSlotId(callDef, AnonNumber);
const kTimeMsSlotId = getSlotId(callDef, TimeMs);
const kTimeSecsSlotId = getSlotId(callDef, TimeSecs);

type TimeoutState = {
  fireTime: number;
  lastTick: number;
  fired: boolean;
};

function onPageEntered(ctx: ExecutionContext) {
  // Reset timeout state when page is entered
  const state: TimeoutState = {
    fireTime: 0,
    lastTick: -1,
    fired: false,
  };
  setCallSiteState(ctx, state);
}

function execTimeout(ctx: ExecutionContext, args: MapValue): Value {
  // Get the Actor from the execution context (optional - sensor can work without it)
  const self = getSelf(ctx);

  if (!self) {
    console.warn("Timeout sensor invoked without an actor in context");
    return VOID_VALUE;
  }

  const hasMsArg = args.v.has(kTimeMsSlotId);
  let delay = 1; // default to 1 second if no argument is provided
  // Get the anonymous number argument. This is the timeout duration. This number is in seconds by default, but will be in milliseconds if the TimeMs modifier is present.
  const anonNumberValue = args.v.get(kAnonymousNumberSlotId)!;
  if (anonNumberValue) {
    if (!isNumberValue(anonNumberValue)) {
      // console.warn("Timeout sensor anonymous number argument is not a number");
      return VOID_VALUE;
    } else {
      delay = anonNumberValue.v;
    }
  }
  if (!hasMsArg) {
    // Interpret incoming units as seconds if no millisecond modifier is provided
    delay *= 1000;
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
    return TRUE_VALUE; // Once fired, always return true until reset by a tick skip
  }

  let shouldFire = false;

  if (ctx.currentTick !== state.lastTick + 1) {
    // If ticks were skipped, reset the timer
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
  tileId: TileIds.Sensor.Timeout,
  callDef,
  fn: {
    onPageEntered,
    exec: execTimeout,
  },
  isAsync: false,
  returnType: CoreTypeIds.Boolean,
  visual: { label: "timeout", iconUrl: "/assets/brain/icons/timer.svg" },
} satisfies ActionDef;
