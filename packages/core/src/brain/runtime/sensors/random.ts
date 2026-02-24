import {
  type BrainActionCallDef,
  type BrainActionCallSpec,
  CoreSensorId,
  type ExecutionContext,
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

function fnRandom(ctx: ExecutionContext, _args: MapValue): Value {
  return { t: NativeType.Number, v: ctx.brain.rng() };
}

export default {
  fnId: CoreSensorId.Random,
  tileId: mkSensorTileId(CoreSensorId.Random),
  isAsync: false,
  fn: {
    exec: fnRandom,
  },
  callDef,
};
