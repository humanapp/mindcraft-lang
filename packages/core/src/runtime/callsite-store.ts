import { Dict } from "../platform/dict";
import { List } from "../platform/list";
import type { ICallsiteServices } from "./services";
import { NIL_VALUE, type Value } from "./value";

/**
 * Per-callsite storage record holding the state-slot pad and the
 * host-owned state cell for a single `callSiteId`. State slots are
 * indexed by `slotIdx` and back the bytecode `LOAD_CALLSITE_VAR` /
 * `STORE_CALLSITE_VAR` instructions; `hostState` is opaque to the
 * runtime and is set/read by host-language sensors and actuators
 * through the `services.callsite` adapter.
 *
 * `hostState` is `undefined` until written and after `clearHostState`.
 * The slot list grows on demand to cover the largest `slotIdx` ever
 * written; unwritten indices read as {@link NIL_VALUE}.
 */
interface CallsiteRecord {
  slots: List<Value>;
  hostState?: unknown;
}

/**
 * Brain-instance-scoped owner of per-callsite runtime storage. One
 * instance is held by `Brain` and exposed to the VM and host code
 * through the `services.callsite` aggregate; the per-callsite getters
 * and setters defined by {@link ICallsiteServices} forward directly
 * to the same record set.
 *
 * Lifetime: each `callSiteId` is allocated lazily on the first
 * {@link ICallsiteServices.ensure}, {@link ICallsiteServices.setSlot},
 * or {@link ICallsiteServices.setHostState} for that id, and persists
 * until {@link ICallsiteServices.reset} or {@link clearAll}. Clearing
 * host state via {@link ICallsiteServices.clearHostState} does not
 * deallocate the callsite record.
 */
export interface ICallsiteStore extends ICallsiteServices {
  /**
   * Drop every callsite record. Invoked by `Brain.shutdown()` after
   * deactivation so that a subsequent `startup()` re-runs every
   * action's `initializerFuncId`.
   */
  clearAll(): void;
}

/** Allocate a fresh {@link ICallsiteStore}. */
export function createCallsiteStore(): ICallsiteStore {
  const records: Dict<number, CallsiteRecord> = new Dict();

  function allocate(callSiteId: number): CallsiteRecord {
    const created: CallsiteRecord = { slots: List.empty<Value>() };
    records.set(callSiteId, created);
    return created;
  }

  function ensureRecord(callSiteId: number): CallsiteRecord {
    const existing = records.get(callSiteId);
    if (existing) {
      return existing;
    }
    return allocate(callSiteId);
  }

  function padSlotsTo(slots: List<Value>, length: number): void {
    while (slots.size() < length) {
      slots.push(NIL_VALUE);
    }
  }

  return {
    ensure(callSiteId: number): boolean {
      if (records.has(callSiteId)) {
        return false;
      }
      allocate(callSiteId);
      return true;
    },
    reset(callSiteId: number): void {
      records.delete(callSiteId);
    },
    getSlot(callSiteId: number, slotIdx: number): Value {
      const record = records.get(callSiteId);
      if (!record) {
        return NIL_VALUE;
      }
      return record.slots.at(slotIdx) ?? NIL_VALUE;
    },
    setSlot(callSiteId: number, slotIdx: number, value: Value): void {
      const record = ensureRecord(callSiteId);
      padSlotsTo(record.slots, slotIdx + 1);
      record.slots.set(slotIdx, value);
    },
    getHostState(callSiteId: number): unknown {
      return records.get(callSiteId)?.hostState;
    },
    setHostState(callSiteId: number, state: unknown): void {
      ensureRecord(callSiteId).hostState = state;
    },
    clearHostState(callSiteId: number): void {
      const record = records.get(callSiteId);
      if (record) {
        record.hostState = undefined;
      }
    },
    clearAll(): void {
      records.clear();
    },
  };
}
