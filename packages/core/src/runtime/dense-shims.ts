import { Dict } from "../platform/dict";
import { List } from "../platform/list";
import type { ActionInstance } from "./context";
import type { IBrain, IBrainRule } from "./host-bindings";
import type {
  IActionServices,
  IBrainPageServices,
  IBrainVariableServices,
  ICallSiteServices,
  IProgramServices,
  IRngServices,
  IRuleVariableServices,
} from "./services";
import { NIL_VALUE, type Value } from "./value";

/**
 * Lookup function shape providing a `funcId -> rule` resolution that the
 * dense-state program services delegate to. The brain owns the underlying
 * mapping (today: `funcIdToRule`); D2 retires this shim branch in favor of
 * a `Program`-table lookup populated by the compiler.
 */
export type RuleByFuncIdLookup = (funcId: number) => IBrainRule | undefined;

/** Aggregate of dense-state service implementations produced by {@link createDenseShims}. */
export interface IDenseShims {
  program: IProgramServices;
  brainVars: IBrainVariableServices;
  ruleVars: IRuleVariableServices;
  brainPages: IBrainPageServices;
  rng: IRngServices;
  callSite: ICallSiteServices;
  action: IActionServices;
  /**
   * Reset the per-callsite action state slots while preserving the
   * callsite's host state. Invoked by the brain on page activation; not
   * part of the public {@link IActionServices} dense surface.
   */
  resetCallsite(callSiteId: number, numStateSlots: number): void;
  /** Clear all per-callsite action state and host state (e.g. on page deactivation). */
  clearAllCallsites(): void;
}

/**
 * Build dense-state service adapters for `brain` backed by the legacy
 * brain object graph (`IBrain`, `IBrainRule`). The shared
 * `actionInstances` map backs both the {@link IActionServices} (state slot)
 * and {@link ICallSiteServices} (host state) views.
 *
 * D2, D3, and D4 retire individual branches of this shim by routing the
 * relevant service through compiler-allocated tables and side-tables on
 * the brain orchestrator instead of the legacy object graph.
 */
export function createDenseShims(brain: IBrain, ruleLookup: RuleByFuncIdLookup): IDenseShims {
  const actionInstances: Dict<number, ActionInstance> = new Dict();

  function ensure(callSiteId: number, numStateSlots: number): ActionInstance {
    const existing = actionInstances.get(callSiteId);
    if (existing) {
      return existing;
    }
    const stateSlots = List.empty<Value>();
    for (let i = 0; i < numStateSlots; i++) {
      stateSlots.push(NIL_VALUE);
    }
    const created: ActionInstance = { callSiteId, stateSlots };
    actionInstances.set(callSiteId, created);
    return created;
  }

  return {
    program: {
      getRuleFuncIdForFunc(funcId: number): number | undefined {
        return ruleLookup(funcId) !== undefined ? funcId : undefined;
      },
    },

    brainVars: {
      getByName(name: string): Value {
        return brain.getVariable(name) ?? NIL_VALUE;
      },
      setByName(name: string, value: Value): void {
        brain.setVariable(name, value);
      },
      clearByName(name: string): void {
        brain.clearVariable(name);
      },
    },

    ruleVars: {
      getByName(ruleFuncId: number | undefined, name: string): Value {
        if (ruleFuncId === undefined) {
          return NIL_VALUE;
        }
        const rule = ruleLookup(ruleFuncId);
        if (!rule) {
          return NIL_VALUE;
        }
        return rule.getVariable<Value>(name) ?? NIL_VALUE;
      },
      setByName(ruleFuncId: number | undefined, name: string, value: Value): void {
        if (ruleFuncId === undefined) {
          return;
        }
        const rule = ruleLookup(ruleFuncId);
        if (!rule) {
          return;
        }
        rule.setVariable(name, value);
      },
      clearByName(ruleFuncId: number | undefined, name: string): void {
        if (ruleFuncId === undefined) {
          return;
        }
        const rule = ruleLookup(ruleFuncId);
        if (!rule) {
          return;
        }
        rule.clearVariable(name);
      },
    },

    brainPages: {
      getCurrentPageId(): string {
        return brain.getCurrentPageId();
      },
      getPreviousPageId(): string {
        return brain.getPreviousPageId();
      },
      requestPageChange(pageIndex: number): void {
        brain.requestPageChange(pageIndex);
      },
      requestPageChangeByPageId(pageId: string): void {
        brain.requestPageChangeByPageId(pageId);
      },
      requestPageRestart(): void {
        brain.requestPageRestart();
      },
    },

    rng: {
      next(): number {
        return brain.rng();
      },
    },

    callSite: {
      getHostState(callSiteId: number): unknown {
        return actionInstances.get(callSiteId)?.hostState;
      },
      setHostState(callSiteId: number, state: unknown): void {
        const instance = ensure(callSiteId, 0);
        instance.hostState = state;
      },
    },

    action: {
      ensureCallsite(callSiteId: number, numStateSlots: number): void {
        ensure(callSiteId, numStateSlots);
      },
      getStateSlot(callSiteId: number, slotIdx: number): Value {
        const instance = actionInstances.get(callSiteId);
        if (!instance) {
          return NIL_VALUE;
        }
        return instance.stateSlots.get(slotIdx) ?? NIL_VALUE;
      },
      setStateSlot(callSiteId: number, slotIdx: number, value: Value): void {
        const instance = actionInstances.get(callSiteId);
        if (!instance) {
          return;
        }
        instance.stateSlots.set(slotIdx, value);
      },
    },

    resetCallsite(callSiteId: number, numStateSlots: number): void {
      const previous = actionInstances.get(callSiteId);
      const stateSlots = List.empty<Value>();
      for (let i = 0; i < numStateSlots; i++) {
        stateSlots.push(NIL_VALUE);
      }
      const fresh: ActionInstance = { callSiteId, stateSlots };
      if (previous?.hostState !== undefined) {
        fresh.hostState = previous.hostState;
      }
      actionInstances.set(callSiteId, fresh);
    },

    clearAllCallsites(): void {
      actionInstances.clear();
    },
  };
}
