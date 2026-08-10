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
  setSensorOutput,
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
  /** The asynchronous actuator that settles at dispatch. */
  Chime: "actuator.fake.chime",
  /** The asynchronous actuator the world settles thinks later. */
  Ring: "actuator.fake.ring",
} as const;

/** Name of the output the fake target's emit reports back. */
export const FAKE_EMIT_OUTPUT = "emitted";

/** One `actuator.fake.ring` call the world has taken and not yet settled. */
export interface FakeRinging {
  /** Settle the call, releasing whatever rule is parked on it. */
  settle(): void;
}

/** The world state the fake target's actions read and write. */
export interface FakeWorldState {
  /** What `sensor.fake.signal` reports on the current think. */
  signal: boolean;
  /** Whether the next `actuator.fake.emit` call reports that it emitted. */
  emits?: boolean;
  /** Calls of `actuator.fake.ring` still in flight, in the order they were made. */
  ringing?: FakeRinging[];
}

const Loudly = mod(FakeTileIds.Loudly);
const Strength = param(FakeTileIds.Strength);
const AnonNumber = param(CoreParameterId.AnonymousNumber, { anonymous: true });

const signalCallDef = mkCallDef(bag());
const emitCallDef = mkCallDef(bag(optional(Loudly), optional(Strength)));
const chimeCallDef = mkCallDef(bag(optional(AnonNumber)));
const ringCallDef = mkCallDef(bag());

/** Report the signal the world staged for this think. */
function execSignal(ctx: ExecutionContext): Value {
  return (ctx.data as FakeWorldState | undefined)?.signal ? TRUE_VALUE : FALSE_VALUE;
}

/** Emit, reporting whether the world let the emit out. */
function execEmit(ctx: ExecutionContext): Value {
  const emitted = (ctx.data as FakeWorldState | undefined)?.emits ?? true;
  const verdict = emitted ? TRUE_VALUE : FALSE_VALUE;
  setSensorOutput(ctx, CoreTypeIds.Boolean, FAKE_EMIT_OUTPUT, verdict);
  return verdict;
}

/** Resolve the handle at dispatch, so the issuing rule does not park on the chime. */
function execChime(_ctx: ExecutionContext, _args: ReadonlyList<Value>, handle: AsyncHandle): void {
  handle.resolve(VOID_VALUE);
}

/**
 * Hand the handle to the world and return, so the issuing rule parks until the
 * world settles the ring. A world that never settles it leaves the rule parked
 * for the rest of the run.
 */
function execRing(ctx: ExecutionContext, _args: ReadonlyList<Value>, handle: AsyncHandle): void {
  const state = ctx.data as FakeWorldState | undefined;
  if (!state) {
    handle.resolve(VOID_VALUE);
    return;
  }
  const ringing = state.ringing ?? [];
  state.ringing = ringing;
  ringing.push({
    settle: () => {
      handle.resolve(VOID_VALUE);
    },
  });
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

/** The usage rule the fake target's emit registers for a reader of the catalog. */
export const FAKE_EMIT_GRAMMAR_NOTE = "loudly and strength may come in either order";

/** The named outputs the fake target's emit exposes. */
const emitOutputs = [{ name: FAKE_EMIT_OUTPUT, type: CoreTypeIds.Boolean, label: "it emitted" }] satisfies NonNullable<
  CreateHostActuatorOptions["outputs"]
>;

const emitActuator = {
  key: FakeActionKeys.Emit,
  actionId: TARGET_ACTION_ID_BASE + 1,
  fnId: TARGET_FUNC_ID_BASE + 1,
  callDef: emitCallDef,
  fn: { exec: execEmit },
  isAsync: false,
  outputs: emitOutputs,
  metadata: { label: "emit", grammarNote: FAKE_EMIT_GRAMMAR_NOTE },
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

const ringActuator = {
  key: FakeActionKeys.Ring,
  actionId: TARGET_ACTION_ID_BASE + 3,
  fnId: TARGET_FUNC_ID_BASE + 3,
  callDef: ringCallDef,
  fn: { exec: execRing },
  isAsync: true,
  metadata: { label: "ring" },
} satisfies CreateHostActuatorOptions;

/**
 * The module the fake target installs: one boolean sensor reading the staged
 * signal, one synchronous actuator taking a modifier and a named parameter and
 * reporting a declared output, one asynchronous actuator taking an anonymous
 * number and settling at dispatch, and one asynchronous actuator the world
 * settles when it chooses. A rehearsal over it observes gates, both dispatch
 * kinds with their arguments, a declared output's value, and a call whose
 * lifecycle spans thinks.
 */
export function createFakeModule(): MindcraftModule {
  return {
    id: "mindcraft.assistant-bridge.fake",
    install(api: MindcraftModuleApi): void {
      api.registerHostSensor(createHostSensor(signalSensor));
      api.registerHostActuator(createHostActuator(emitActuator));
      api.registerHostActuator(createHostActuator(chimeActuator));
      api.registerHostActuator(createHostActuator(ringActuator));
      api.registerModifiers([{ id: FakeTileIds.Loudly, label: "loudly" }]);
      api.registerParameters([{ id: FakeTileIds.Strength, dataType: CoreTypeIds.Number, label: "strength" }]);
    },
  };
}
