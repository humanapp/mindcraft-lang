import type { BitSet } from "@mindcraft-lang/core";
import type {
  ActionDescriptor,
  ActionKind,
  BrainActionCallDef,
  HostActionBinding,
  HostAsyncFn,
  HostSyncFn,
  TypeId,
} from "@mindcraft-lang/core/brain";
import type { TileVisual } from "@/brain/tiles/types";

type ActionDefBase = {
  tileId: string;
  callDef: BrainActionCallDef;
  returnType: TypeId;
  visual: TileVisual;
  capabilities?: BitSet;
};

type SyncActionDef = ActionDefBase & {
  fn: HostSyncFn;
  isAsync: false;
};

type AsyncActionDef = ActionDefBase & {
  fn: HostAsyncFn;
  isAsync: true;
};

export type ActionDef = SyncActionDef | AsyncActionDef;

export function buildActionDescriptor(kind: ActionKind, actionDef: ActionDef): ActionDescriptor {
  return {
    key: actionDef.tileId,
    kind,
    callDef: actionDef.callDef,
    isAsync: actionDef.isAsync,
    outputType: kind === "sensor" ? actionDef.returnType : undefined,
  };
}

export function buildHostActionBinding(kind: ActionKind, actionDef: ActionDef): HostActionBinding {
  const descriptor = buildActionDescriptor(kind, actionDef);

  if (actionDef.isAsync) {
    return {
      binding: "host",
      descriptor,
      onPageEntered: actionDef.fn.onPageEntered,
      execAsync: actionDef.fn.exec,
    };
  }

  return {
    binding: "host",
    descriptor,
    onPageEntered: actionDef.fn.onPageEntered,
    execSync: actionDef.fn.exec,
  };
}
