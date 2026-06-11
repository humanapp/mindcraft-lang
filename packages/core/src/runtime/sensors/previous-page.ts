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
  key: CoreHostActions.PreviousPage.key,
  kind: "sensor",
  callDef,
  isAsync: false,
  outputType: CoreTypeIds.String,
};

function fnPreviousPage(ctx: ExecutionContext): Value {
  return { t: NativeType.String, v: ctx.services.brain.pages.getPreviousPageId() };
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  id: CoreHostActions.PreviousPage.actionId,
  execSync: fnPreviousPage,
};

export default {
  key: CoreHostActions.PreviousPage.key,
  tileId: mkSensorTileId(CoreHostActions.PreviousPage.key),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    exec: fnPreviousPage,
  },
  callDef,
};
