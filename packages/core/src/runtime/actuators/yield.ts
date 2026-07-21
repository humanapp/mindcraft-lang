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
  key: CoreHostActions.Yield.key,
  kind: "actuator",
  callDef,
  isAsync: false,
};

function fnYield(_ctx: ExecutionContext): Value {
  return VOID_VALUE;
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  id: CoreHostActions.Yield.actionId,
  execSync: fnYield,
};

export default {
  key: CoreHostActions.Yield.key,
  tileId: mkActuatorTileId(CoreHostActions.Yield.key),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    exec: fnYield,
  },
  callDef,
};
