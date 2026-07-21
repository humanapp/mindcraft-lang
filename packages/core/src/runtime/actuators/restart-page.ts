import { CoreHostActions } from "../abi-ids";
import type { ExecutionContext, HostActionBinding } from "../context";
import {
  type ActionDescriptor,
  type BrainActionCallDef,
  type BrainActionCallSpec,
  callSpecToArgSlots,
} from "../function-defs";
import { mkActuatorTileId } from "../tile-ids";
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
  key: CoreHostActions.RestartPage.key,
  kind: "actuator",
  callDef,
  isAsync: false,
};

function fnRestartPage(ctx: ExecutionContext): Value {
  ctx.services.brain.pages.requestPageRestart();
  return VOID_VALUE;
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  id: CoreHostActions.RestartPage.actionId,
  execSync: fnRestartPage,
};

export default {
  key: CoreHostActions.RestartPage.key,
  tileId: mkActuatorTileId(CoreHostActions.RestartPage.key),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    exec: fnRestartPage,
  },
  callDef,
};
