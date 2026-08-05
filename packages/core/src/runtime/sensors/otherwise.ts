import { CoreHostActions } from "../abi-ids";
import type { ExecutionContext, HostActionBinding } from "../context";
import { CoreTypeIds } from "../core-types";
import { type ActionDescriptor, type BrainActionCallDef, type BrainActionCallSpec, mkCallDef } from "../function-defs";
import { RuleFiringState } from "../rule-services";
import { mkSensorTileId } from "../tile-ids";
import { FALSE_VALUE, TRUE_VALUE, type Value } from "../value";

const callSpec: BrainActionCallSpec = {
  type: "bag",
  items: [],
};

const callDef: BrainActionCallDef = mkCallDef(callSpec);

const descriptor: ActionDescriptor = {
  key: CoreHostActions.Otherwise.key,
  kind: "sensor",
  callDef,
  isAsync: false,
  outputType: CoreTypeIds.Boolean,
};

/**
 * Sensor body: true when the rule immediately above this one at its own nesting
 * level evaluated its WHEN and did not fire. A subject that fired, one still
 * evaluating, and a rule with no preceding sibling all read false.
 */
function fnOtherwise(ctx: ExecutionContext): Value {
  const ruleFuncId = ctx.currentRuleFuncId;
  if (ruleFuncId === undefined) return FALSE_VALUE;
  const subjectFuncId = ctx.services.brain.program.getPrecedingSiblingRuleFuncId(ruleFuncId);
  if (subjectFuncId === undefined) return FALSE_VALUE;
  const subjectState = ctx.services.brain.ruleFiring.get(subjectFuncId);
  return subjectState === RuleFiringState.DID_NOT_FIRE ? TRUE_VALUE : FALSE_VALUE;
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  id: CoreHostActions.Otherwise.actionId,
  execSync: fnOtherwise,
};

export default {
  key: CoreHostActions.Otherwise.key,
  tileId: mkSensorTileId(CoreHostActions.Otherwise.key),
  isAsync: false,
  descriptor,
  binding,
  fn: {
    exec: fnOtherwise,
  },
  callDef,
};
