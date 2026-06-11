import type { List } from "../platform/list";
import type { BrainActionCallDef } from "./function-defs";
import type { TypeId } from "./type-defs";
import type { HostSyncFn } from "./vm-types";

/** A registered value-conversion overload. `cost` is used to break ties when chaining conversions. */
export type Conversion = {
  /**
   * Author-assigned stable funcId of the implementing host function. Once
   * assigned, never changed or reused.
   */
  id: number;
  fromType: TypeId;
  toType: TypeId;
  cost: number;
  fn: HostSyncFn;
  callDef?: BrainActionCallDef;
};

/** Registry of value-conversion overloads keyed by `(fromType, toType)`. */
export interface IConversionRegistry {
  register(conv: Conversion): Conversion;
  remove(fromType: TypeId, toType: TypeId): boolean;
  get(fromType: TypeId, toType: TypeId): Conversion | undefined;
  findBestPath(fromType: TypeId, toType: TypeId, maxDepth?: number): List<Conversion> | undefined;
}
