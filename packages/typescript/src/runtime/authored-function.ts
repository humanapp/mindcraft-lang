import { List } from "@mindcraft-lang/core";
import {
  type BrainProgram,
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
  type VmRunResult,
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

  function spawnAndRun(
    funcId: number,
    args: List<Value>,
    ctx: ExecutionContext,
    callsiteVars: List<Value>
  ): { fiber: Fiber; result: VmRunResult } {
    const fiberId = nextFiberId--;
    const fiberCtx: ExecutionContext = { ...ctx };
    const fiber = vm.spawnFiber(fiberId, funcId, args, fiberCtx);
    fiber.callsiteVars = callsiteVars;
    fiber.instrBudget = 10000;
    const result = vm.runFiber(fiber, scheduler);
    return { fiber, result };
  }

  function runFiberToCompletion(
    funcId: number,
    args: List<Value>,
    ctx: ExecutionContext,
    callsiteVars: List<Value>
  ): Value | undefined {
    const { result } = spawnAndRun(funcId, args, ctx, callsiteVars);
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

  function execSync(ctx: ExecutionContext, args: MapValue, handleId: HandleId): void {
    const callsiteVars = getOrCreateCallsiteVars(ctx);
    const fiberArgs = hasParams ? List.from<Value>([args]) : List.empty<Value>();
    const result = runFiberToCompletion(linkedEntryFuncId, fiberArgs, ctx, callsiteVars);
    vm.handles.resolve(handleId, result ?? NIL_VALUE);
  }

  function execAsync(ctx: ExecutionContext, args: MapValue, outerHandleId: HandleId): void {
    const callsiteVars = getOrCreateCallsiteVars(ctx);
    const fiberArgs = hasParams ? List.from<Value>([args]) : List.empty<Value>();
    const { fiber, result } = spawnAndRun(linkedEntryFuncId, fiberArgs, ctx, callsiteVars);

    if (result.status === VmStatus.DONE) {
      vm.handles.resolve(outerHandleId, result.result ?? NIL_VALUE);
      return;
    }

    if (result.status === VmStatus.WAITING) {
      waitForHandle(fiber, result.handleId!, outerHandleId);
    }
  }

  function waitForHandle(fiber: Fiber, innerHandleId: HandleId, outerHandleId: HandleId): void {
    const unsub = vm.handles.events.on("completed", (completedId: HandleId) => {
      if (completedId !== innerHandleId) return;
      unsub();

      vm.resumeFiberFromHandle(fiber, innerHandleId, scheduler);
      fiber.instrBudget = 10000;
      const result = vm.runFiber(fiber, scheduler);

      if (result.status === VmStatus.DONE) {
        vm.handles.resolve(outerHandleId, result.result ?? NIL_VALUE);
      } else if (result.status === VmStatus.WAITING) {
        waitForHandle(fiber, result.handleId!, outerHandleId);
      }
    });
  }

  return {
    exec: execIsAsync ? execAsync : execSync,

    onPageEntered(ctx: ExecutionContext): void {
      if (linkedOnPageEnteredFuncId === undefined) return;
      const callsiteVars = getCallSiteState<List<Value>>(ctx);
      if (!callsiteVars) return;
      runFiberToCompletion(linkedOnPageEnteredFuncId, List.empty<Value>(), ctx, callsiteVars);
    },
  };
}
