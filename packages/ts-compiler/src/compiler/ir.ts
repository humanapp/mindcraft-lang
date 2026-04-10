import type { Value } from "@mindcraft-lang/core/brain";

export interface IrSourceSpan {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface IrNodeBase {
  span?: IrSourceSpan;
  isStatementBoundary?: boolean;
}

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
  | IrHostCallArgs
  | IrHostCallArgsAsync
  | IrAwait
  | IrGetField
  | IrGetFieldDynamic
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

export interface IrPushConst extends IrNodeBase {
  kind: "PushConst";
  value: Value;
}

export interface IrLoadLocal extends IrNodeBase {
  kind: "LoadLocal";
  index: number;
}

export interface IrStoreLocal extends IrNodeBase {
  kind: "StoreLocal";
  index: number;
}

export interface IrLoadCallsiteVar extends IrNodeBase {
  kind: "LoadCallsiteVar";
  index: number;
}

export interface IrStoreCallsiteVar extends IrNodeBase {
  kind: "StoreCallsiteVar";
  index: number;
}

export interface IrReturn extends IrNodeBase {
  kind: "Return";
}

export interface IrPop extends IrNodeBase {
  kind: "Pop";
}

export interface IrDup extends IrNodeBase {
  kind: "Dup";
}

export interface IrSwap extends IrNodeBase {
  kind: "Swap";
}

export interface IrCall extends IrNodeBase {
  kind: "Call";
  funcIndex: number;
  argc: number;
}

export interface IrHostCallArgs extends IrNodeBase {
  kind: "HostCallArgs";
  fnName: string;
  argc: number;
}

export interface IrHostCallArgsAsync extends IrNodeBase {
  kind: "HostCallArgsAsync";
  fnName: string;
  argc: number;
}

export interface IrAwait extends IrNodeBase {
  kind: "Await";
}

export interface IrMapGet extends IrNodeBase {
  kind: "MapGet";
}

export interface IrMapNew extends IrNodeBase {
  kind: "MapNew";
  typeId: string;
}

export interface IrMapSet extends IrNodeBase {
  kind: "MapSet";
}

export interface IrMapHas extends IrNodeBase {
  kind: "MapHas";
}

export interface IrMapDelete extends IrNodeBase {
  kind: "MapDelete";
}

export interface IrLabel extends IrNodeBase {
  kind: "Label";
  labelId: number;
}

export interface IrJump extends IrNodeBase {
  kind: "Jump";
  labelId: number;
}

export interface IrJumpIfFalse extends IrNodeBase {
  kind: "JumpIfFalse";
  labelId: number;
}

export interface IrJumpIfTrue extends IrNodeBase {
  kind: "JumpIfTrue";
  labelId: number;
}

export interface IrStructNew extends IrNodeBase {
  kind: "StructNew";
  typeId: string;
}

export interface IrStructSet extends IrNodeBase {
  kind: "StructSet";
}

export interface IrStructCopyExcept extends IrNodeBase {
  kind: "StructCopyExcept";
  numExclude: number;
  typeId: string;
}

export interface IrListNew extends IrNodeBase {
  kind: "ListNew";
  typeId: string;
}

export interface IrListPush extends IrNodeBase {
  kind: "ListPush";
}

export interface IrListGet extends IrNodeBase {
  kind: "ListGet";
}

export interface IrListSet extends IrNodeBase {
  kind: "ListSet";
}

export interface IrListLen extends IrNodeBase {
  kind: "ListLen";
}

export interface IrListPop extends IrNodeBase {
  kind: "ListPop";
}

export interface IrListShift extends IrNodeBase {
  kind: "ListShift";
}

export interface IrListRemove extends IrNodeBase {
  kind: "ListRemove";
}

export interface IrListInsert extends IrNodeBase {
  kind: "ListInsert";
}

export interface IrListSwap extends IrNodeBase {
  kind: "ListSwap";
}

export interface IrTypeCheck extends IrNodeBase {
  kind: "TypeCheck";
  nativeType: number;
}

export interface IrInstanceOf extends IrNodeBase {
  kind: "InstanceOf";
  typeId: string;
}

export interface IrCallIndirect extends IrNodeBase {
  kind: "CallIndirect";
  argc: number;
}

export interface IrCallIndirectArgs extends IrNodeBase {
  kind: "CallIndirectArgs";
  argc: number;
}

export interface IrPushFunctionRef extends IrNodeBase {
  kind: "PushFunctionRef";
  funcName: string;
}

export interface IrMakeClosure extends IrNodeBase {
  kind: "MakeClosure";
  funcName: string;
  captureCount: number;
}

export interface IrLoadCapture extends IrNodeBase {
  kind: "LoadCapture";
  index: number;
}

export interface IrGetField extends IrNodeBase {
  kind: "GetField";
  fieldName: string;
}

export interface IrGetFieldDynamic extends IrNodeBase {
  kind: "GetFieldDynamic";
}
