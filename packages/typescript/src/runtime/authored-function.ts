import { List } from "@mindcraft-lang/core";
import {
  type BrainProgram,
  ContextTypeIds,
  type ExecutionContext,
  getCallSiteState,
  type HandleId,
  type HostAsyncFn,
  type MapValue,
  mkNativeStructValue,
  NIL_VALUE,
  type runtime,
  type Scheduler,
  setCallSiteState,
  type Value,
  VmStatus,
} from "@mindcraft-lang/core/brain";
import type { UserTileLinkInfo } from "../compiler/types.js";

export function createUserTileExec(
  linkedProgram: BrainProgram,
  linkInfo: UserTileLinkInfo,
  vm: runtime.VM,
  scheduler: Scheduler
): HostAsyncFn {
  const { linkedEntryFuncId, linkedInitFuncId, linkedOnPageEnteredFuncId, program } = linkInfo;
  const { numCallsiteVars } = program;
  const hasParams = linkedProgram.functions.get(linkedEntryFuncId).numParams > 1;
  let nextFiberId = -1;

  function runFiberToCompletion(
    funcId: number,
    args: List<Value>,
    ctx: ExecutionContext,
    callsiteVars: List<Value>
  ): Value | undefined {
    const fiberId = nextFiberId--;
    const fiberCtx: ExecutionContext = { ...ctx };
    const fiber = vm.spawnFiber(fiberId, funcId, args, fiberCtx);
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 10000;
    const result = vm.runFiber(fiber, scheduler);
    if (result.status === VmStatus.DONE) {
      return result.result;
    }
    return undefined;
  }

  function getOrCreateCallsiteVars(ctx: ExecutionContext): List<Value> {
    let vars = getCallSiteState<List<Value>>(ctx);
    if (vars) return vars;

    vars = List.empty<Value>();
    for (let i = 0; i < numCallsiteVars; i++) {
      vars.push(NIL_VALUE);
    }
    setCallSiteState(ctx, vars);

    if (linkedInitFuncId !== undefined) {
      runFiberToCompletion(linkedInitFuncId, List.empty(), ctx, vars);
    }

    return vars;
  }

  return {
    exec(ctx: ExecutionContext, args: MapValue, handleId: HandleId): void {
      const callsiteVars = getOrCreateCallsiteVars(ctx);
      const ctxStruct = mkNativeStructValue(ContextTypeIds.Context, ctx);
      const fiberArgs = hasParams ? List.from<Value>([ctxStruct, args]) : List.from<Value>([ctxStruct]);
      const result = runFiberToCompletion(linkedEntryFuncId, fiberArgs, ctx, callsiteVars);
      vm.handles.resolve(handleId, result ?? NIL_VALUE);
    },

    onPageEntered(ctx: ExecutionContext): void {
      if (linkedOnPageEnteredFuncId === undefined) return;
      const callsiteVars = getCallSiteState<List<Value>>(ctx);
      if (!callsiteVars) return;
      const ctxStruct = mkNativeStructValue(ContextTypeIds.Context, ctx);
      runFiberToCompletion(linkedOnPageEnteredFuncId, List.from<Value>([ctxStruct]), ctx, callsiteVars);
    },
  };
}
