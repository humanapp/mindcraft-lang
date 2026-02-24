import type { List } from "../../platform/list";
import type { BrainActionCallDef } from "./functions";
import type { TypeId } from "./type-system";
import type { HostSyncFn } from "./vm";

export type Conversion = {
  id: number;
  fromType: TypeId;
  toType: TypeId;
  cost: number;
  fn: HostSyncFn;
  callDef: BrainActionCallDef;
};

export interface IConversionRegistry {
  register(conv: Omit<Conversion, "id">): Conversion;
  get(fromType: TypeId, toType: TypeId): Conversion | undefined;
  findBestPath(fromType: TypeId, toType: TypeId, maxDepth?: number): List<Conversion> | undefined;
}
