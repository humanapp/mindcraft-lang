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
  key: CoreSensorId.Random,
  kind: "sensor",
  callDef,
  isAsync: false,
  outputType: CoreTypeIds.Number,
};

function fnRandom(ctx: ExecutionContext): Value {
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
