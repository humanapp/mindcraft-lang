import type { BitSet, HostActuatorDefinition, HostSensorDefinition } from "@mindcraft-lang/core";
import type { ActionDescriptor, BrainActionCallDef, HostAsyncFn, HostSyncFn, TypeId } from "@mindcraft-lang/core/brain";
import { BrainTileActuatorDef, BrainTileSensorDef } from "@mindcraft-lang/core/brain/tiles";
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

export function toHostSensorDef(def: ActionDef): HostSensorDefinition {
  const descriptor: ActionDescriptor = {
    key: def.tileId,
    kind: "sensor",
    callDef: def.callDef,
    isAsync: def.isAsync,
    outputType: def.returnType,
  };
  return {
    descriptor,
    function: { name: def.tileId, isAsync: def.isAsync, fn: def.fn, callDef: def.callDef },
    tile: new BrainTileSensorDef(def.tileId, descriptor, {
      visual: def.visual,
      capabilities: def.capabilities,
    }),
  };
}

export function toHostActuatorDef(def: ActionDef): HostActuatorDefinition {
  const descriptor: ActionDescriptor = {
    key: def.tileId,
    kind: "actuator",
    callDef: def.callDef,
    isAsync: def.isAsync,
  };
  return {
    descriptor,
    function: { name: def.tileId, isAsync: def.isAsync, fn: def.fn, callDef: def.callDef },
    tile: new BrainTileActuatorDef(def.tileId, descriptor, {
      visual: def.visual,
      capabilities: def.capabilities,
    }),
  };
}
