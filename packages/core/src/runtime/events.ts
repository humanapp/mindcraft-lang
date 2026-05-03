import type { ErrorValue, HandleId, Value } from "./value";

/** Payload emitted when a fiber faults. */
export interface FiberFaultEvent {
  fiberId: number;
  err: ErrorValue;
}

/** Payload emitted when a fiber completes execution. */
export interface FiberDoneEvent {
  fiberId: number;
  retv: Value;
}

/** Payload emitted when a fiber is cancelled. */
export interface FiberCancelledEvent {
  fiberId: number;
}

/** Payload emitted when a fiber transitions to waiting on a handle. */
export interface FiberWaitingEvent {
  fiberId: number;
  handleId: HandleId;
}

/** Optional passive observer hooks for VM runtime lifecycle events. */
export interface VmEvents {
  onFiberFault?: (payload: FiberFaultEvent) => void;
  onFiberDone?: (payload: FiberDoneEvent) => void;
  onFiberCancelled?: (payload: FiberCancelledEvent) => void;
  onFiberWaiting?: (payload: FiberWaitingEvent) => void;
}
