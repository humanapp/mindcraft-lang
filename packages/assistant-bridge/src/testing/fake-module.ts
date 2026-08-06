import type {
  CreateHostActuatorOptions,
  CreateHostSensorOptions,
  ExecutionContext,
  MindcraftModule,
  MindcraftModuleApi,
  Value,
} from "@mindcraft-lang/core/app";
import {
  bag,
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
} as const;

/** The one piece of world state the fake target's sensor reads. */
export interface FakeWorldState {
  /** What `sensor.fake.signal` reports on the current think. */
  signal: boolean;
}

const Loudly = mod(FakeTileIds.Loudly);
const Strength = param(FakeTileIds.Strength);

const signalCallDef = mkCallDef(bag());
const emitCallDef = mkCallDef(bag(optional(Loudly), optional(Strength)));

/** Report the signal the world staged for this think. */
function execSignal(ctx: ExecutionContext): Value {
  return (ctx.data as FakeWorldState | undefined)?.signal ? TRUE_VALUE : FALSE_VALUE;
}

function execEmit(): Value {
  return VOID_VALUE;
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

/**
 * The module the fake target installs: one boolean sensor reading the staged
 * signal, and one actuator taking a modifier and a parameter, so a rehearsal
 * over it observes both gates and dispatch arguments.
 */
export function createFakeModule(): MindcraftModule {
  return {
    id: "mindcraft.assistant-bridge.fake",
    install(api: MindcraftModuleApi): void {
      api.registerHostSensor(createHostSensor(signalSensor));
      api.registerHostActuator(createHostActuator(emitActuator));
      api.registerModifiers([{ id: FakeTileIds.Loudly, label: "loudly" }]);
      api.registerParameters([{ id: FakeTileIds.Strength, dataType: CoreTypeIds.Number, label: "strength" }]);
    },
  };
}
