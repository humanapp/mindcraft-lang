import type { ReadonlyList } from "../../platform/list";
import { CoreHostActions } from "../abi-ids";
import type { ExecutionContext, HostActionBinding } from "../context";
import { CoreTypeIds } from "../core-types";
import { type ActionDescriptor, type BrainActionCallDef, type BrainActionCallSpec, mkCallDef } from "../function-defs";
import { RuleFiringState } from "../rule-services";
import { type AsyncHandle, FALSE_VALUE, TRUE_VALUE, type Value } from "../value";

const callSpec: BrainActionCallSpec = {
  type: "bag",
  items: [],
};

const callDef: BrainActionCallDef = mkCallDef(callSpec);

const descriptor: ActionDescriptor = {
  key: CoreHostActions.RuleTrigger.key,
  kind: "sensor",
  callDef,
  isAsync: true,
  outputType: CoreTypeIds.Boolean,
};

/**
 * Action body: answers whether the calling rule's subject -- the rule
 * immediately above it at its own nesting level -- has fired and completed.
 *
 * - The subject's cluster is in flight: the handle is left pending in the
 *   subject's watcher slot and the calling rule's own record is written
 *   `DidNotFire`.
 * - The subject fired and its cluster has emptied with no fault or
 *   cancellation in it: resolves true.
 * - The subject is settled without a firing, its firing was abandoned by a
 *   fault or a cancellation in its cluster, or the calling rule has no subject:
 *   resolves false.
 */
function fnRuleTrigger(ctx: ExecutionContext, _args: ReadonlyList<Value>, handle: AsyncHandle): void {
  const brain = ctx.services.brain;
  const ruleFuncId = ctx.currentRuleFuncId;
  const subjectFuncId = ruleFuncId === undefined ? undefined : brain.program.getPrecedingSiblingRuleFuncId(ruleFuncId);
  if (subjectFuncId === undefined) {
    handle.resolve(FALSE_VALUE);
    return;
  }

  if (brain.ruleCompletion.hasLiveSubtree(subjectFuncId)) {
    brain.ruleFiring.set(ruleFuncId, RuleFiringState.DID_NOT_FIRE);
    brain.ruleCompletion.setWatcher(subjectFuncId, handle.id);
    return;
  }

  const completed =
    brain.ruleFiring.get(subjectFuncId) === RuleFiringState.DID_FIRE &&
    !brain.ruleCompletion.isAbandoned(subjectFuncId);
  handle.resolve(completed ? TRUE_VALUE : FALSE_VALUE);
}

const binding: HostActionBinding = {
  binding: "host",
  descriptor,
  id: CoreHostActions.RuleTrigger.actionId,
  execAsync: fnRuleTrigger,
  // A rule holds at most one watcher, and a trigger handle lives only in a
  // watcher slot, so the live count is bounded by the program's rule count.
  uncappedHandles: true,
};

export default {
  key: CoreHostActions.RuleTrigger.key,
  isAsync: true,
  descriptor,
  binding,
  fn: {
    exec: fnRuleTrigger,
  },
  callDef,
};
