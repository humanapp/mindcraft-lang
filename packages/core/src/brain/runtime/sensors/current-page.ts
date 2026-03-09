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

function fnCurrentPage(ctx: ExecutionContext, _args: MapValue): Value {
  return { t: NativeType.String, v: ctx.brain.getCurrentPageId() };
}

export default {
  fnId: CoreSensorId.CurrentPage,
  tileId: mkSensorTileId(CoreSensorId.CurrentPage),
  isAsync: false,
  fn: {
    exec: fnCurrentPage,
  },
  callDef,
};
