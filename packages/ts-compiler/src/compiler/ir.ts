import type { Value } from "@mindcraft-lang/core/brain";

/** 1-based source-position range carried on {@link IrNode} for debug span emission. */
export interface IrSourceSpan {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

/** Common fields shared by every {@link IrNode}: optional source span and statement-boundary marker. */
export interface IrNodeBase {
  span?: IrSourceSpan;
  isStatementBoundary?: boolean;
}

/** Tagged-union of every IR node the lowering phase emits and the emit phase consumes. */
export type IrNode =
  | IrPushConst
  | IrLoadLocal
  | IrStoreLocal
  | IrLoadCallsiteVar
  | IrStoreCallsiteVar
  | IrReturn
  | IrPop
  | IrDup
  | IrSwap
  | IrCall
  | IrCallIndirect
  | IrCallIndirectArgs
  | IrPushFunctionRef
  | IrMakeClosure
  | IrLoadCapture
  | IrHostCall
  | IrHostCallAsync
  | IrStackSetRel
  | IrAwait
  | IrGetField
  | IrGetFieldDynamic
  | IrSetField
  | IrMapGet
  | IrMapNew
  | IrMapSet
  | IrMapHas
  | IrMapDelete
  | IrStructNew
  | IrStructSet
  | IrStructCopyExcept
  | IrListNew
  | IrListPush
  | IrListGet
  | IrListSet
  | IrListLen
  | IrListPop
  | IrListShift
  | IrListRemove
  | IrListInsert
  | IrListSwap
  | IrTypeCheck
  | IrInstanceOf
  | IrLabel
  | IrJump
  | IrJumpIfFalse
  | IrJumpIfTrue;

/** Push a constant value onto the operand stack. */
export interface IrPushConst extends IrNodeBase {
  kind: "PushConst";
  value: Value;
}

/** Load the local at slot `index` onto the stack. */
export interface IrLoadLocal extends IrNodeBase {
  kind: "LoadLocal";
  index: number;
}

/** Pop the top of stack and store it into the local at slot `index`. */
export interface IrStoreLocal extends IrNodeBase {
  kind: "StoreLocal";
  index: number;
}

/** Load a brain-scoped variable at index `index` onto the stack. */
export interface IrLoadCallsiteVar extends IrNodeBase {
  kind: "LoadCallsiteVar";
  index: number;
}

/** Pop the top of stack and store it into the brain-scoped variable at index `index`. */
export interface IrStoreCallsiteVar extends IrNodeBase {
  kind: "StoreCallsiteVar";
  index: number;
}

/** Return from the current function. */
export interface IrReturn extends IrNodeBase {
  kind: "Return";
}

/** Pop and discard the top of the operand stack. */
export interface IrPop extends IrNodeBase {
  kind: "Pop";
}

/** Duplicate the top of the operand stack. */
export interface IrDup extends IrNodeBase {
  kind: "Dup";
}

/** Swap the top two values on the operand stack. */
export interface IrSwap extends IrNodeBase {
  kind: "Swap";
}

/** Call the function at table index `funcIndex` with `argc` arguments already on the stack. */
export interface IrCall extends IrNodeBase {
  kind: "Call";
  funcIndex: number;
  argc: number;
}

/**
 * Synchronous call to a host-registered function `fnName` with an `argc`
 * fixed-width positional argument buffer consumed by HOST_CALL.
 */
export interface IrHostCall extends IrNodeBase {
  kind: "HostCall";
  fnName: string;
  /** Fixed arg-buffer width consumed by HOST_CALL. */
  argc: number;
  /**
   * Optional supplied-slot ids for raw values produced immediately before
   * this call. The emit normalizer moves those values into a fixed-width
   * NIL + STACK_SET_REL arg buffer without allocating hidden spill locals.
   * Omitted means the raw values already form a dense in-order positional
   * buffer for slots `0..argc-1`.
   */
  argSlotIds?: readonly number[];
}

/**
 * Asynchronous host call. Uses the same stack-only arg-buffer contract
 * as {@link IrHostCall}, then emits HOST_CALL_ASYNC.
 */
export interface IrHostCallAsync extends IrNodeBase {
  kind: "HostCallAsync";
  fnName: string;
  /** Fixed arg-buffer width consumed by HOST_CALL_ASYNC. */
  argc: number;
  /** Optional supplied-slot ids; omitted means dense in-order slots `0..argc-1`. */
  argSlotIds?: readonly number[];
}

/**
 * Pop the top of the operand stack and write it to `vstack[top - d]`,
 * where `top` is the index of the topmost element after the pop.
 * Used to populate fixed-width arg buffers at host/action call sites.
 */
export interface IrStackSetRel extends IrNodeBase {
  kind: "StackSetRel";
  d: number;
}

/** Suspend the current fiber until the awaited host call resolves. */
export interface IrAwait extends IrNodeBase {
  kind: "Await";
}

/** Map.get: pop key and map, push value or nil. */
export interface IrMapGet extends IrNodeBase {
  kind: "MapGet";
}

/** Construct a new map of type `typeId` and push it. */
export interface IrMapNew extends IrNodeBase {
  kind: "MapNew";
  typeId: string;
}

/** Map.set: pop value, key, and map. */
export interface IrMapSet extends IrNodeBase {
  kind: "MapSet";
}

/** Map.has: pop key and map, push boolean. */
export interface IrMapHas extends IrNodeBase {
  kind: "MapHas";
}

/** Map.delete: pop key and map. */
export interface IrMapDelete extends IrNodeBase {
  kind: "MapDelete";
}

/** Branch target. Resolved to a PC by the emitter. */
export interface IrLabel extends IrNodeBase {
  kind: "Label";
  labelId: number;
}

/** Unconditional jump to `labelId`. */
export interface IrJump extends IrNodeBase {
  kind: "Jump";
  labelId: number;
}

/** Pop top of stack and jump to `labelId` if it is falsy. */
export interface IrJumpIfFalse extends IrNodeBase {
  kind: "JumpIfFalse";
  labelId: number;
}

/** Pop top of stack and jump to `labelId` if it is truthy. */
export interface IrJumpIfTrue extends IrNodeBase {
  kind: "JumpIfTrue";
  labelId: number;
}

/** Construct a new struct of type `typeId` and push it. */
export interface IrStructNew extends IrNodeBase {
  kind: "StructNew";
  typeId: string;
}

/** Set a field on a struct: pop value, field name, and struct. */
export interface IrStructSet extends IrNodeBase {
  kind: "StructSet";
  fieldIndex?: number;
}

/** Copy a struct of type `typeId` while excluding the top `numExclude` field names from the stack. */
export interface IrStructCopyExcept extends IrNodeBase {
  kind: "StructCopyExcept";
  numExclude: number;
  typeId: string;
}

/** Construct a new list of element type `typeId` and push it. */
export interface IrListNew extends IrNodeBase {
  kind: "ListNew";
  typeId: string;
}

/** List.push: pop element and list. */
export interface IrListPush extends IrNodeBase {
  kind: "ListPush";
}

/** List index read: pop index and list, push element. */
export interface IrListGet extends IrNodeBase {
  kind: "ListGet";
}

/** List index write: pop value, index, and list. */
export interface IrListSet extends IrNodeBase {
  kind: "ListSet";
}

/** Push the length of the list on top of the stack. */
export interface IrListLen extends IrNodeBase {
  kind: "ListLen";
}

/** Pop the last element of the list and push it. */
export interface IrListPop extends IrNodeBase {
  kind: "ListPop";
}

/** Remove and push the first element of the list. */
export interface IrListShift extends IrNodeBase {
  kind: "ListShift";
}

/** List.remove(index): pop index and list. */
export interface IrListRemove extends IrNodeBase {
  kind: "ListRemove";
}

/** List.insert(index, value): pop value, index, and list. */
export interface IrListInsert extends IrNodeBase {
  kind: "ListInsert";
}

/** List.swap(i, j): pop j, i, and list. */
export interface IrListSwap extends IrNodeBase {
  kind: "ListSwap";
}

/** Replace top of stack with a boolean: whether its native type matches `nativeType`. */
export interface IrTypeCheck extends IrNodeBase {
  kind: "TypeCheck";
  nativeType: number;
}

/** Replace top of stack with a boolean: whether it is an instance of `typeId`. */
export interface IrInstanceOf extends IrNodeBase {
  kind: "InstanceOf";
  typeId: string;
}

/** Indirect call: pop a function value and `argc` arguments, then invoke. */
export interface IrCallIndirect extends IrNodeBase {
  kind: "CallIndirect";
  argc: number;
}

/** Indirect call with named-argument convention: pop function value and `argc` named-arg pairs. */
export interface IrCallIndirectArgs extends IrNodeBase {
  kind: "CallIndirectArgs";
  argc: number;
}

/** Push a reference to the named user function as a value. */
export interface IrPushFunctionRef extends IrNodeBase {
  kind: "PushFunctionRef";
  funcName: string;
}

/** Build a closure over `funcName` capturing the top `captureCount` values from the stack. */
export interface IrMakeClosure extends IrNodeBase {
  kind: "MakeClosure";
  funcName: string;
  captureCount: number;
}

/** Push the captured value at index `index` from the current closure. */
export interface IrLoadCapture extends IrNodeBase {
  kind: "LoadCapture";
  index: number;
}

/** Pop a struct, push the value of its statically-named field. */
export interface IrGetField extends IrNodeBase {
  kind: "GetField";
  fieldName: string;
  fieldIndex?: number;
}

/** Pop a field-name string and a struct, push the field's value. */
export interface IrGetFieldDynamic extends IrNodeBase {
  kind: "GetFieldDynamic";
}

/** Pop a value, a field-name string, and a struct, then store the value. */
export interface IrSetField extends IrNodeBase {
  kind: "SetField";
  fieldIndex?: number;
}
