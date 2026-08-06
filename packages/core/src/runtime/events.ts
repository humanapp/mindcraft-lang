import type { ReadonlyList } from "../platform/list";
import type { ActionDescriptor } from "./function-defs";
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

/** Payload emitted when a rule's WHEN evaluation reaches its gate. */
export interface RuleWhenGateEvent {
  /** funcId of the rule the gate belongs to, or `undefined` when the frame resolves to no rule. */
  ruleFuncId: number | undefined;
  /** Value the rule's WHEN section evaluated to. */
  result: Value;
  /** `true` when the gate passed and the rule's DO section runs this think. */
  fired: boolean;
}

/** Payload emitted when the runtime dispatches a host action. */
export interface HostActionDispatchEvent {
  /** Static metadata of the dispatched action: its key, kind, call grammar, and async flag. */
  descriptor: ActionDescriptor;
  /**
   * Positional argument values, indexed by `descriptor.callDef.argSlots` slot
   * id, with an unsupplied slot filled by `NIL_VALUE`. Read it during the
   * notification: a synchronous dispatch passes a view over the live operand
   * stack, which the call consumes as soon as the notification returns.
   */
  args: ReadonlyList<Value>;
  /** funcId of the rule the dispatch is attributed to, or `undefined` when the frame resolves to no rule. */
  ruleFuncId: number | undefined;
}

/** Optional passive observer hooks for VM runtime lifecycle events. */
export interface VmEvents {
  onFiberFault?: (payload: FiberFaultEvent) => void;
  onFiberDone?: (payload: FiberDoneEvent) => void;
  onFiberCancelled?: (payload: FiberCancelledEvent) => void;
  onFiberWaiting?: (payload: FiberWaitingEvent) => void;
  /**
   * Called once per rule per think, at the moment the rule's WHEN gate decides
   * whether its DO section runs. Rules whose WHEN section is empty emit no gate
   * and are never reported.
   */
  onRuleWhenGate?: (payload: RuleWhenGateEvent) => void;
  /**
   * Called once per host-action call, at the moment the runtime hands the call
   * to the action's body and before that body runs. Synchronous and
   * asynchronous actions both report; an asynchronous call reports when it
   * starts, not when its handle settles.
   */
  onHostActionDispatch?: (payload: HostActionDispatchEvent) => void;
}
