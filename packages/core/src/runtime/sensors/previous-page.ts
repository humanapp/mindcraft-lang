import type { ExecutionContext, HostActionBinding } from "../context";
import { CoreTypeIds } from "../core-types";
import { type ActionDescriptor, type BrainActionCallDef, type BrainActionCallSpec, mkCallDef } from "../function-defs";
import { CoreSensorId, mkSensorTileId } from "../tile-ids";
import { NativeType } from "../type-defs";
import type { Value } from "../value";

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

function fnPreviousPage(ctx: ExecutionContext): Value {
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
