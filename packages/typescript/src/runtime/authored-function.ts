import { List } from "@mindcraft-lang/core";
import {
  type BrainProgram,
  type ErrorValue,
  type ExecutionContext,
  type Fiber,
  getCallSiteState,
  type HandleId,
  type HostAsyncFn,
  type MapValue,
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
  const { numCallsiteVars, execIsAsync } = program;
  const hasParams = linkedProgram.functions.get(linkedEntryFuncId).numParams > 1;
  let nextFiberId = -1;

  const pendingAsyncFibers = new Map<number, HandleId>();

  if (execIsAsync) {
    const prevOnFiberDone = scheduler.onFiberDone;
    scheduler.onFiberDone = (fiberId: number, result?: Value) => {
      prevOnFiberDone?.(fiberId, result);
      const outerHandleId = pendingAsyncFibers.get(fiberId);
      if (outerHandleId !== undefined) {
        pendingAsyncFibers.delete(fiberId);
        vm.handles.resolve(outerHandleId, result ?? NIL_VALUE);
      }
    };

    const prevOnFiberFault = scheduler.onFiberFault;
    scheduler.onFiberFault = (fiberId: number, error: ErrorValue) => {
      prevOnFiberFault?.(fiberId, error);
      const outerHandleId = pendingAsyncFibers.get(fiberId);
      if (outerHandleId !== undefined) {
        pendingAsyncFibers.delete(fiberId);
        vm.handles.reject(outerHandleId, error);
      }
    };

    const prevOnFiberCancelled = scheduler.onFiberCancelled;
    scheduler.onFiberCancelled = (fiberId: number) => {
      prevOnFiberCancelled?.(fiberId);
      const outerHandleId = pendingAsyncFibers.get(fiberId);
      if (outerHandleId !== undefined) {
        pendingAsyncFibers.delete(fiberId);
        vm.handles.cancel(outerHandleId);
      }
    };
  }

  function runFiberInline(
    funcId: number,
    args: List<Value>,
    ctx: ExecutionContext,
    callsiteVars: List<Value>
  ): Value | undefined {
    const fiberId = nextFiberId--;
    const fiber = vm.spawnFiber(fiberId, funcId, args, { ...ctx });
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
      runFiberInline(linkedInitFuncId, List.empty(), ctx, vars);
    }

    return vars;
  }

  function execSync(ctx: ExecutionContext, args: MapValue, handleId: HandleId): void {
    const callsiteVars = getOrCreateCallsiteVars(ctx);
    const fiberArgs = hasParams ? List.from<Value>([args]) : List.empty<Value>();
    const result = runFiberInline(linkedEntryFuncId, fiberArgs, ctx, callsiteVars);
    vm.handles.resolve(handleId, result ?? NIL_VALUE);
  }

  function execAsync(ctx: ExecutionContext, args: MapValue, outerHandleId: HandleId): void {
    const callsiteVars = getOrCreateCallsiteVars(ctx);
    const fiberArgs = hasParams ? List.from<Value>([args]) : List.empty<Value>();

    const fiberId = nextFiberId--;
    const fiber = vm.spawnFiber(fiberId, linkedEntryFuncId, fiberArgs, { ...ctx });
    fiber.callsiteVars = callsiteVars;

    pendingAsyncFibers.set(fiberId, outerHandleId);
    scheduler.addFiber!(fiber);
  }

  return {
    exec: execIsAsync ? execAsync : execSync,

    onPageEntered(ctx: ExecutionContext): void {
      if (linkedOnPageEnteredFuncId === undefined) return;
      const callsiteVars = getCallSiteState<List<Value>>(ctx);
      if (!callsiteVars) return;
      runFiberInline(linkedOnPageEnteredFuncId, List.empty<Value>(), ctx, callsiteVars);
    },
  };
}
