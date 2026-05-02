import {
  type ActionDescriptor,
  type BrainActionCallDef,
  type BrainActionCallSpec,
  CoreActuatorId,
  callSpecToArgSlots,
  type ExecutionContext,
  type HostActionBinding,
  mkActuatorTileId,
  type Value,
  VOID_VALUE,
} from "../../interfaces";

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
  key: CoreActuatorId.Yield,
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
  execSync: fnYield,
};

export default {
  fnId: CoreActuatorId.Yield,
  tileId: mkActuatorTileId(CoreActuatorId.Yield),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    exec: fnYield,
  },
  callDef,
};
