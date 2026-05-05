import type { ICallsiteStore } from "./callsite-store";
import type { IBrainRuntime } from "./host-bindings";
import type { IBrainPageServices, IBrainVariableServices, ICallsiteServices } from "./services";
import { NIL_VALUE, type Value } from "./value";

/**
 * Aggregate of platform-service implementations produced by
 * {@link createRuntimeServices}. Combines brain-graph adapters
 * (`brainVars`, `brainPages`) with the per-callsite adapter
 * (`callsite`) backed by an external {@link ICallsiteStore} owned
 * by the brain.
 */
export interface IRuntimeServices {
  brainVars: IBrainVariableServices;
  brainPages: IBrainPageServices;
  callsite: ICallsiteServices;
}

/**
 * Build the runtime-services aggregate. `brain` backs the
 * brain-graph adapters; `callsiteStore` backs the per-callsite
 * adapter and is owned by the caller (the brain) so its lifetime
 * is independent of this aggregate. The store implements
 * {@link ICallsiteServices} directly, so it is exposed as the
 * `callsite` field with no wrapping.
 */
export function createRuntimeServices(brain: IBrainRuntime, callsiteStore: ICallsiteStore): IRuntimeServices {
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

    callsite: callsiteStore,
  };
}
