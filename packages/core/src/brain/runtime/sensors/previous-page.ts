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
  key: CoreSensorId.PreviousPage,
  kind: "sensor",
  callDef,
  isAsync: false,
  outputType: CoreTypeIds.String,
};

function fnPreviousPage(ctx: ExecutionContext, _args: MapValue): Value {
  return { t: NativeType.String, v: ctx.brain.getPreviousPageId() };
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  execSync: fnPreviousPage,
};

export default {
  fnId: CoreSensorId.PreviousPage,
  tileId: mkSensorTileId(CoreSensorId.PreviousPage),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    exec: fnPreviousPage,
  },
  callDef,
};
