import type { BitSet } from "@mindcraft-lang/core";
import type { BrainActionCallDef, HostFn, TypeId } from "@mindcraft-lang/core/brain";
import type { TileVisual } from "@/brain/tiles/types";

export type ActionDef = {
  tileId: string;
  callDef: BrainActionCallDef;
  fn: HostFn;
  isAsync: boolean;
  returnType: TypeId;
  visual: TileVisual;
  capabilities?: BitSet;
};
