import {
  type ActionDescriptor,
  type BrainActionCallDef,
  type BrainActionCallSpec,
  CoreActuatorId,
  callSpecToArgSlots,
  type ExecutionContext,
  type HostActionBinding,
  type MapValue,
  mkActuatorTileId,
  mkParameterTileId,
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
  key: CoreActuatorId.RestartPage,
  kind: "actuator",
  callDef,
  isAsync: false,
};

function fnRestartPage(ctx: ExecutionContext, _args: MapValue): Value {
  ctx.brain.requestPageRestart();
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
