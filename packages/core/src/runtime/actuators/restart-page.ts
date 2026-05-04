import type { ExecutionContext, HostActionBinding } from "../context";
import {
  type ActionDescriptor,
  type BrainActionCallDef,
  type BrainActionCallSpec,
  callSpecToArgSlots,
} from "../function-defs";
import { CoreActuatorId, mkActuatorTileId } from "../tile-ids";
import { type Value, VOID_VALUE } from "../value";

const callSpec: BrainActionCallSpec = {
  type: "bag",
  items: [],
};

const argSlots = callSpecToArgSlots(callSpec);

const callDef: BrainActionCallDef = {
  callSpec,
  argSlots,
};

const descriptor: ActionDescriptor = {
  key: CoreActuatorId.RestartPage,
  kind: "actuator",
  callDef,
  isAsync: false,
};

function fnRestartPage(ctx: ExecutionContext): Value {
  ctx.services.brainPages.requestPageRestart();
  return VOID_VALUE;
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  execSync: fnRestartPage,
};

export default {
  fnId: CoreActuatorId.RestartPage,
  tileId: mkActuatorTileId(CoreActuatorId.RestartPage),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    exec: fnRestartPage,
  },
  callDef,
};
