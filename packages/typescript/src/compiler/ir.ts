import type { Value } from "@mindcraft-lang/core/brain";

export type IrNode = IrPushConst | IrLoadLocal | IrStoreLocal | IrReturn | IrPop | IrHostCallArgs | IrMapGet;

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

export interface IrReturn {
  kind: "Return";
}

export interface IrPop {
  kind: "Pop";
}

export interface IrHostCallArgs {
  kind: "HostCallArgs";
  fnName: string;
  argc: number;
}

export interface IrMapGet {
  kind: "MapGet";
}
