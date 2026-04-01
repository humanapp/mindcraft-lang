import type { Value } from "@mindcraft-lang/core/brain";

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
  | IrMapGet
  | IrMapNew
  | IrMapSet
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
  | IrLabel
  | IrJump
  | IrJumpIfFalse
  | IrJumpIfTrue;

export interface IrPushConst {
  kind: "PushConst";
  value: Value;
}

export interface IrLoadLocal {
  kind: "LoadLocal";
  index: number;
}

export interface IrStoreLocal {
  kind: "StoreLocal";
  index: number;
}

export interface IrLoadCallsiteVar {
  kind: "LoadCallsiteVar";
  index: number;
}

export interface IrStoreCallsiteVar {
  kind: "StoreCallsiteVar";
  index: number;
}

export interface IrReturn {
  kind: "Return";
}

export interface IrPop {
  kind: "Pop";
}

export interface IrDup {
  kind: "Dup";
}

export interface IrSwap {
  kind: "Swap";
}

export interface IrCall {
  kind: "Call";
  funcIndex: number;
  argc: number;
}

export interface IrHostCallArgs {
  kind: "HostCallArgs";
  fnName: string;
  argc: number;
}

export interface IrHostCallArgsAsync {
  kind: "HostCallArgsAsync";
  fnName: string;
  argc: number;
}

export interface IrAwait {
  kind: "Await";
}

export interface IrMapGet {
  kind: "MapGet";
}

export interface IrMapNew {
  kind: "MapNew";
  typeId: string;
}

export interface IrMapSet {
  kind: "MapSet";
}

export interface IrLabel {
  kind: "Label";
  labelId: number;
}

export interface IrJump {
  kind: "Jump";
  labelId: number;
}

export interface IrJumpIfFalse {
  kind: "JumpIfFalse";
  labelId: number;
}

export interface IrJumpIfTrue {
  kind: "JumpIfTrue";
  labelId: number;
}

export interface IrStructNew {
  kind: "StructNew";
  typeId: string;
}

export interface IrStructSet {
  kind: "StructSet";
}

export interface IrStructCopyExcept {
  kind: "StructCopyExcept";
  numExclude: number;
  typeId: string;
}

export interface IrListNew {
  kind: "ListNew";
  typeId: string;
}

export interface IrListPush {
  kind: "ListPush";
}

export interface IrListGet {
  kind: "ListGet";
}

export interface IrListSet {
  kind: "ListSet";
}

export interface IrListLen {
  kind: "ListLen";
}

export interface IrListPop {
  kind: "ListPop";
}

export interface IrListShift {
  kind: "ListShift";
}

export interface IrListRemove {
  kind: "ListRemove";
}

export interface IrListInsert {
  kind: "ListInsert";
}

export interface IrListSwap {
  kind: "ListSwap";
}

export interface IrTypeCheck {
  kind: "TypeCheck";
  nativeType: number;
}

export interface IrCallIndirect {
  kind: "CallIndirect";
  argc: number;
}

export interface IrCallIndirectArgs {
  kind: "CallIndirectArgs";
  argc: number;
}

export interface IrPushFunctionRef {
  kind: "PushFunctionRef";
  funcName: string;
}

export interface IrMakeClosure {
  kind: "MakeClosure";
  funcName: string;
  captureCount: number;
}

export interface IrLoadCapture {
  kind: "LoadCapture";
  index: number;
}

export interface IrGetField {
  kind: "GetField";
  fieldName: string;
}
