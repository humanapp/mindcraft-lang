import {
  type ActionDescriptor,
  type BrainActionCallDef,
  type BrainActionCallSpec,
  CoreSensorId,
  CoreTypeIds,
  type ExecutionContext,
  type HostActionBinding,
  type MapValue,
  mkCallDef,
  mkSensorTileId,
  NativeType,
  type Value,
} from "../../interfaces";

const callSpec: BrainActionCallSpec = {
  type: "bag",
  items: [],
};

const callDef: BrainActionCallDef = mkCallDef(callSpec);

const descriptor: ActionDescriptor = {
  key: CoreSensorId.Random,
  kind: "sensor",
  callDef,
  isAsync: false,
  outputType: CoreTypeIds.Number,
};

function fnRandom(ctx: ExecutionContext, _args: MapValue): Value {
  return { t: NativeType.Number, v: ctx.brain.rng() };
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  execSync: fnRandom,
};

export default {
  fnId: CoreSensorId.Random,
  tileId: mkSensorTileId(CoreSensorId.Random),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    exec: fnRandom,
  },
  callDef,
};
