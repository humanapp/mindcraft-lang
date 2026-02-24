import {
  type BrainActionCallDef,
  type BrainActionCallSpec,
  CoreActuatorId,
  callSpecToArgSlots,
  type ExecutionContext,
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

function fnRestartPage(ctx: ExecutionContext, _args: MapValue): Value {
  ctx.brain.requestPageRestart();
  return VOID_VALUE;
}

export default {
  fnId: CoreActuatorId.RestartPage,
  tileId: mkActuatorTileId(CoreActuatorId.RestartPage),
  isAsync: false,
  fn: {
    exec: fnRestartPage,
  },
  callDef,
};
