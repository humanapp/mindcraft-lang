import type { List } from "../../platform/list";
import type { BrainActionCallDef } from "./functions";
import type { TypeId } from "./type-system";
import type { HostSyncFn } from "./vm";

/** A registered value-conversion overload. `cost` is used to break ties when chaining conversions. */
export type Conversion = {
  id: number;
  fromType: TypeId;
  toType: TypeId;
  cost: number;
  fn: HostSyncFn;
  callDef?: BrainActionCallDef;
};

/** Registry of value-conversion overloads keyed by `(fromType, toType)`. */
export interface IConversionRegistry {
  register(conv: Omit<Conversion, "id">): Conversion;
  remove(fromType: TypeId, toType: TypeId): boolean;
  get(fromType: TypeId, toType: TypeId): Conversion | undefined;
  findBestPath(fromType: TypeId, toType: TypeId, maxDepth?: number): List<Conversion> | undefined;
}
