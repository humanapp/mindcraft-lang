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
  | IrCall
  | IrHostCallArgs
  | IrMapGet
  | IrStructNew
  | IrStructSet
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

export interface IrMapGet {
  kind: "MapGet";
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
