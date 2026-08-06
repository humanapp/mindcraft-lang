import type {
  AsyncHandle,
  CreateHostActuatorOptions,
  CreateHostSensorOptions,
  ExecutionContext,
  MindcraftModule,
  MindcraftModuleApi,
  ReadonlyList,
  Value,
} from "@mindcraft-lang/core/app";
import {
  bag,
  CoreParameterId,
  CoreTypeIds,
  createHostActuator,
  createHostSensor,
  FALSE_VALUE,
  mkCallDef,
  mod,
  optional,
  param,
  TARGET_ACTION_ID_BASE,
  TARGET_FUNC_ID_BASE,
  TRUE_VALUE,
  VOID_VALUE,
} from "@mindcraft-lang/core/app";

/** Tile ids the fake target's arguments are addressed by. */
export const FakeTileIds = {
  /** Modifier making an emit loud. */
  Loudly: "modifier:fake.loudly",
  /** Parameter carrying how hard to emit. */
  Strength: "parameter:fake.strength",
} as const;

/** Action keys the fake target's brains dispatch. */
export const FakeActionKeys = {
  Signal: "sensor.fake.signal",
  Emit: "actuator.fake.emit",
  /** The asynchronous actuator. */
  Chime: "actuator.fake.chime",
} as const;

/** The one piece of world state the fake target's sensor reads. */
export interface FakeWorldState {
  /** What `sensor.fake.signal` reports on the current think. */
  signal: boolean;
}

const Loudly = mod(FakeTileIds.Loudly);
const Strength = param(FakeTileIds.Strength);
const AnonNumber = param(CoreParameterId.AnonymousNumber, { anonymous: true });

const signalCallDef = mkCallDef(bag());
const emitCallDef = mkCallDef(bag(optional(Loudly), optional(Strength)));
const chimeCallDef = mkCallDef(bag(optional(AnonNumber)));

/** Report the signal the world staged for this think. */
function execSignal(ctx: ExecutionContext): Value {
  return (ctx.data as FakeWorldState | undefined)?.signal ? TRUE_VALUE : FALSE_VALUE;
}

function execEmit(): Value {
  return VOID_VALUE;
}

/** Resolve the handle at dispatch, so the issuing rule does not park on the chime. */
function execChime(_ctx: ExecutionContext, _args: ReadonlyList<Value>, handle: AsyncHandle): void {
  handle.resolve(VOID_VALUE);
}

const signalSensor = {
  key: FakeActionKeys.Signal,
  actionId: TARGET_ACTION_ID_BASE,
  fnId: TARGET_FUNC_ID_BASE,
  callDef: signalCallDef,
  fn: { exec: execSignal },
  isAsync: false,
  outputType: CoreTypeIds.Boolean,
  metadata: { label: "the signal is on" },
} satisfies CreateHostSensorOptions;

const emitActuator = {
  key: FakeActionKeys.Emit,
  actionId: TARGET_ACTION_ID_BASE + 1,
  fnId: TARGET_FUNC_ID_BASE + 1,
  callDef: emitCallDef,
  fn: { exec: execEmit },
  isAsync: false,
  metadata: { label: "emit" },
} satisfies CreateHostActuatorOptions;

const chimeActuator = {
  key: FakeActionKeys.Chime,
  actionId: TARGET_ACTION_ID_BASE + 2,
  fnId: TARGET_FUNC_ID_BASE + 2,
  callDef: chimeCallDef,
  fn: { exec: execChime },
  isAsync: true,
  metadata: { label: "chime" },
} satisfies CreateHostActuatorOptions;

/**
 * The module the fake target installs: one boolean sensor reading the staged
 * signal, one synchronous actuator taking a modifier and a named parameter, and
 * one asynchronous actuator taking an anonymous number, so a rehearsal over it
 * observes gates and both dispatch kinds with their arguments.
 */
export function createFakeModule(): MindcraftModule {
  return {
    id: "mindcraft.assistant-bridge.fake",
    install(api: MindcraftModuleApi): void {
      api.registerHostSensor(createHostSensor(signalSensor));
      api.registerHostActuator(createHostActuator(emitActuator));
      api.registerHostActuator(createHostActuator(chimeActuator));
      api.registerModifiers([{ id: FakeTileIds.Loudly, label: "loudly" }]);
      api.registerParameters([{ id: FakeTileIds.Strength, dataType: CoreTypeIds.Number, label: "strength" }]);
    },
  };
}
