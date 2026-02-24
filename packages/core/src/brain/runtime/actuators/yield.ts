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

function fnYield(ctx: ExecutionContext, _args: MapValue): Value {
  // TODO: Implement
  return VOID_VALUE;
}
export default {
  fnId: CoreActuatorId.Yield,
  tileId: mkActuatorTileId(CoreActuatorId.Yield),
  isAsync: false,
  fn: {
    exec: fnYield,
  },
  callDef,
};
