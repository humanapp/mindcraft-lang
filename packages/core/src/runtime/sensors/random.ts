import { CoreHostActions } from "../abi-ids";
import type { ExecutionContext, HostActionBinding } from "../context";
import { CoreTypeIds } from "../core-types";
import { type ActionDescriptor, type BrainActionCallDef, type BrainActionCallSpec, mkCallDef } from "../function-defs";
import { mkSensorTileId } from "../tile-ids";
import { NativeType } from "../type-defs";
import type { Value } from "../value";

const callSpec: BrainActionCallSpec = {
  type: "bag",
  items: [],
};

const callDef: BrainActionCallDef = mkCallDef(callSpec);

const descriptor: ActionDescriptor = {
  key: CoreHostActions.Random.key,
  kind: "sensor",
  callDef,
  isAsync: false,
  outputType: CoreTypeIds.Number,
};

function fnRandom(ctx: ExecutionContext): Value {
  const { app } = ctx.services;
  return { t: NativeType.Number, v: app.numerics.round(app.rng.next()) };
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  id: CoreHostActions.Random.actionId,
  execSync: fnRandom,
};

export default {
  key: CoreHostActions.Random.key,
  tileId: mkSensorTileId(CoreHostActions.Random.key),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    exec: fnRandom,
  },
  callDef,
};
