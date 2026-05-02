import {
  type ActionDescriptor,
  type BrainActionCallDef,
  type BrainActionCallSpec,
  CoreSensorId,
  CoreTypeIds,
  type ExecutionContext,
  type HostActionBinding,
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
  key: CoreSensorId.CurrentPage,
  kind: "sensor",
  callDef,
  isAsync: false,
  outputType: CoreTypeIds.String,
};

function fnCurrentPage(ctx: ExecutionContext): Value {
  return { t: NativeType.String, v: ctx.brain.getCurrentPageId() };
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  execSync: fnCurrentPage,
};

export default {
  fnId: CoreSensorId.CurrentPage,
  tileId: mkSensorTileId(CoreSensorId.CurrentPage),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    exec: fnCurrentPage,
  },
  callDef,
};
