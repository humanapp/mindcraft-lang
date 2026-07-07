import type { List } from "../platform/list";
import type { ActionDescriptor, BrainActionCallDef } from "./function-defs";
import type { TypeId } from "./type-defs";
import type { HostSyncFn } from "./vm-types";

/** A value conversion implemented by a registered host function. `cost` is used to break ties when chaining conversions. */
export type HostFnConversion = {
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

/**
 * A value conversion implemented by a compiled user function. Call sites
 * dispatch through the bytecode-action path: the compiler records an action
 * ref under `descriptor.key` and the linker binds it to the registered
 * artifact's entry function.
 */
export type BytecodeConversion = {
  binding: "bytecode";
  fromType: TypeId;
  toType: TypeId;
  cost: number;
  /** Descriptor of the registered bytecode action implementing the conversion. */
  descriptor: ActionDescriptor;
};

/**
 * A value conversion dispatching to a host function that is registered
 * independently of any single `(fromType, toType)` pair and serves every
 * conversion entry that references it. `id` must be the stable funcId of an
 * already-registered sync host function; registering or removing the
 * conversion entry leaves that function registered.
 */
export type SharedHostFnConversion = {
  binding: "sharedHostFn";
  /** Stable funcId of the shared host function implementing the conversion. */
  id: number;
  fromType: TypeId;
  toType: TypeId;
  cost: number;
};

/** A registered value-conversion overload: host-function, shared-host-function, or compiled-user-function backed. */
export type Conversion = HostFnConversion | SharedHostFnConversion | BytecodeConversion;

/** True when `conv` is a {@link BytecodeConversion}. */
export function isBytecodeConversion(conv: Conversion): conv is BytecodeConversion {
  return (conv as BytecodeConversion).binding === "bytecode";
}

/** True when `conv` is a {@link SharedHostFnConversion}. */
export function isSharedHostFnConversion(conv: Conversion): conv is SharedHostFnConversion {
  return (conv as SharedHostFnConversion).binding === "sharedHostFn";
}

/** Registry of value-conversion overloads keyed by `(fromType, toType)`. */
export interface IConversionRegistry {
  register(conv: Conversion): Conversion;
  remove(fromType: TypeId, toType: TypeId): boolean;
  get(fromType: TypeId, toType: TypeId): Conversion | undefined;
  findBestPath(fromType: TypeId, toType: TypeId, maxDepth?: number): List<Conversion> | undefined;
  /** Invoke `callback` once for every registered conversion. */
  forEach(callback: (conv: Conversion) => void): void;
}
