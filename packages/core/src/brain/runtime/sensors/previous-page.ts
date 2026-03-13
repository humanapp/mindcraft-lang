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

function fnPreviousPage(ctx: ExecutionContext, _args: MapValue): Value {
  return { t: NativeType.String, v: ctx.brain.getPreviousPageId() };
}

export default {
  fnId: CoreSensorId.PreviousPage,
  tileId: mkSensorTileId(CoreSensorId.PreviousPage),
  isAsync: false,
  fn: {
    exec: fnPreviousPage,
  },
  callDef,
};
