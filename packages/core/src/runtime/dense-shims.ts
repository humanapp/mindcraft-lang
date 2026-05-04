import { Dict } from "../platform/dict";
import { List } from "../platform/list";
import type { ActionInstance } from "./context";
import type { IBrain } from "./host-bindings";
import type {
  IActionServices,
  IBrainPageServices,
  IBrainVariableServices,
  ICallSiteServices,
  IRngServices,
} from "./services";
import { NIL_VALUE, type Value } from "./value";

/** Aggregate of dense-state service implementations produced by {@link createDenseShims}. */
export interface IDenseShims {
  brainVars: IBrainVariableServices;
  brainPages: IBrainPageServices;
  rng: IRngServices;
  callSite: ICallSiteServices;
  action: IActionServices;
  /**
   * Tear down all per-callsite storage (action state slots and host state).
   * Used by `Brain.shutdown()` after the active page has been deactivated.
   * After teardown, every prior `callSiteId` is invalid until the next
   * `ensureCallsite` re-allocates.
   */
  reset(): void;
}

/**
 * Build dense-state service adapters for `brain` backed by the legacy
 * {@link IBrain} object graph. The shared `actionInstances` map backs both
 * the {@link IActionServices} (state slot) and {@link ICallSiteServices}
 * (host state) views.
 *
 * D3 and D4 retire the remaining branches of this shim by routing
 * per-callsite host state and per-callsite action-state slots through
 * compiler-allocated tables and side-tables on the brain orchestrator.
 */
export function createDenseShims(brain: IBrain): IDenseShims {
  const actionInstances: Dict<number, ActionInstance> = new Dict();

  function allocateInstance(callSiteId: number): ActionInstance {
    const created: ActionInstance = { callSiteId, stateSlots: List.empty<Value>() };
    actionInstances.set(callSiteId, created);
    return created;
  }

  function ensureInstance(callSiteId: number): ActionInstance {
    const existing = actionInstances.get(callSiteId);
    if (existing) {
      return existing;
    }
    return allocateInstance(callSiteId);
  }

  function padSlotsTo(slots: List<Value>, length: number): void {
    while (slots.size() < length) {
      slots.push(NIL_VALUE);
    }
  }

  return {
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
        const instance = ensureInstance(callSiteId);
        instance.hostState = state;
      },
      clearHostState(callSiteId: number): void {
        const instance = actionInstances.get(callSiteId);
        if (instance) {
          instance.hostState = undefined;
        }
      },
    },

    action: {
      ensureCallsite(callSiteId: number): boolean {
        if (actionInstances.has(callSiteId)) {
          return false;
        }
        allocateInstance(callSiteId);
        return true;
      },
      getStateSlot(callSiteId: number, slotIdx: number): Value {
        const instance = actionInstances.get(callSiteId);
        if (!instance) {
          return NIL_VALUE;
        }
        return instance.stateSlots.get(slotIdx) ?? NIL_VALUE;
      },
      setStateSlot(callSiteId: number, slotIdx: number, value: Value): void {
        const instance = ensureInstance(callSiteId);
        padSlotsTo(instance.stateSlots, slotIdx + 1);
        instance.stateSlots.set(slotIdx, value);
      },
      resetCallsite(callSiteId: number): void {
        actionInstances.delete(callSiteId);
      },
    },

    reset(): void {
      actionInstances.clear();
    },
  };
}
