import { Dict } from "../../platform/dict";
import { Error } from "../../platform/error";
import { List } from "../../platform/list";
import { StringUtils as SU } from "../../platform/string";
import type {
  BrainActionCallDef,
  BrainAsyncFunctionEntry,
  BrainFunctionEntry,
  BrainSyncFunctionEntry,
  IFunctionRegistry,
} from "../interfaces/functions";
import type { HostAsyncFn, HostFn, HostSyncFn } from "../interfaces/vm";

/**
 * Registry for intrinsic functions available in the brain runtime, keyed to tile IDs.
 */
export class FunctionRegistry implements IFunctionRegistry {
  private fnDict = new Dict<string, BrainFunctionEntry>();
  private fnList = new List<BrainFunctionEntry>();

  register(name: string, isAsync: boolean, fn: HostFn, callDef: BrainActionCallDef): BrainFunctionEntry {
    if (!name || !SU.length(name)) {
      throw new Error("FunctionRegistry.registerFunction: name must be a non-empty string");
    }
    if (this.fnDict.has(name)) {
      throw new Error(`FunctionRegistry.registerFunction: function with name '${name}' is already registered`);
    }
    if (isAsync) {
      const entry: BrainAsyncFunctionEntry = {
        id: this.fnList.size(),
        name,
        isAsync: true,
        fn: fn as HostAsyncFn,
        callDef,
      };
      this.fnDict.set(name, entry);
      this.fnList.push(entry);
      return entry;
    } else {
      const entry: BrainSyncFunctionEntry = {
        id: this.fnList.size(),
        name,
        isAsync: false,
        fn: fn as HostSyncFn,
        callDef,
      };
      this.fnDict.set(name, entry);
      this.fnList.push(entry);
      return entry;
    }
  }
  get(name: string): BrainFunctionEntry | undefined {
    return this.fnDict.get(name);
  }
  getSyncById(id: number): BrainSyncFunctionEntry | undefined {
    const entry = this.fnList.get(id);
    if (entry && !entry.isAsync) {
      return entry;
    }
    return undefined;
  }
  getAsyncById(id: number): BrainAsyncFunctionEntry | undefined {
    const entry = this.fnList.get(id);
    if (entry?.isAsync) {
      return entry;
    }
    return undefined;
  }
  size(): number {
    return this.fnList.size();
  }
}
