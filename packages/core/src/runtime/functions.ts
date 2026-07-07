import { Dict } from "../platform/dict";
import { Error } from "../platform/error";
import { MathOps } from "../platform/math";
import { StringUtils as SU } from "../platform/string";
import { type StableIdOwner, TARGET_FUNC_ID_BASE } from "./abi-ids";
import type {
  BrainActionCallDef,
  BrainAsyncFunctionEntry,
  BrainFunctionEntry,
  BrainSyncFunctionEntry,
  IFunctionRegistry,
} from "./function-defs";
import type { HostAsyncFn, HostFn, HostSyncFn } from "./vm-types";

/**
 * Registry for intrinsic functions available in the brain runtime, keyed to
 * tile IDs and to the author-assigned stable funcId.
 */
export class FunctionRegistry implements IFunctionRegistry {
  private fnDict = new Dict<string, BrainFunctionEntry>();
  private fnById = new Dict<number, BrainFunctionEntry>();
  private owner: StableIdOwner = "target";

  withOwner<T>(owner: StableIdOwner, body: () => T): T {
    const previous = this.owner;
    this.owner = owner;
    try {
      return body();
    } finally {
      this.owner = previous;
    }
  }

  register(id: number, name: string, isAsync: boolean, fn: HostFn, callDef: BrainActionCallDef): BrainFunctionEntry {
    if (!name || !SU.length(name)) {
      throw new Error("FunctionRegistry.register: name must be a non-empty string");
    }
    if (this.fnDict.has(name)) {
      throw new Error(`FunctionRegistry.register: function with name '${name}' is already registered`);
    }
    this.validateId(id, name);
    if (isAsync) {
      const entry: BrainAsyncFunctionEntry = {
        id,
        name,
        isAsync: true,
        fn: fn as HostAsyncFn,
        callDef,
      };
      this.fnDict.set(name, entry);
      this.fnById.set(id, entry);
      return entry;
    } else {
      const entry: BrainSyncFunctionEntry = {
        id,
        name,
        isAsync: false,
        fn: fn as HostSyncFn,
        callDef,
      };
      this.fnDict.set(name, entry);
      this.fnById.set(id, entry);
      return entry;
    }
  }

  private validateId(id: number, name: string): void {
    if (id < 0 || MathOps.floor(id) !== id) {
      throw new Error(
        `FunctionRegistry.register: function '${name}' has invalid id ${id}: must be a non-negative integer`
      );
    }
    const existing = this.fnById.get(id);
    if (existing) {
      throw new Error(
        `FunctionRegistry.register: function '${name}' reuses id ${id} already assigned to '${existing.name}'`
      );
    }
    if (this.owner === "core" && id >= TARGET_FUNC_ID_BASE) {
      throw new Error(
        `FunctionRegistry.register: core function '${name}' has id ${id} outside the core range [0, ${TARGET_FUNC_ID_BASE})`
      );
    }
    if (this.owner === "target" && id < TARGET_FUNC_ID_BASE) {
      throw new Error(
        `FunctionRegistry.register: target function '${name}' has id ${id} below the target range base ${TARGET_FUNC_ID_BASE}`
      );
    }
  }

  unregister(name: string): boolean {
    const entry = this.fnDict.get(name);
    if (!entry) {
      return false;
    }
    this.fnDict.delete(name);
    this.fnById.delete(entry.id);
    return true;
  }
  get(name: string): BrainFunctionEntry | undefined {
    return this.fnDict.get(name);
  }
  getSyncById(id: number): BrainSyncFunctionEntry | undefined {
    const entry = this.fnById.get(id);
    if (entry && !entry.isAsync) {
      return entry;
    }
    return undefined;
  }
  getAsyncById(id: number): BrainAsyncFunctionEntry | undefined {
    const entry = this.fnById.get(id);
    if (entry?.isAsync) {
      return entry;
    }
    return undefined;
  }
  size(): number {
    return this.fnDict.size();
  }
}
