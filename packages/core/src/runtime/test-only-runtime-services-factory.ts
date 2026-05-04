import { Dict } from "../platform/dict";
import { createCallsiteStore } from "./callsite-store";
import type { IFunctionRegistry } from "./function-defs";
import { FunctionRegistry } from "./functions";
import type {
  IBrainPageServices,
  IBrainVariableServices,
  ICallsiteServices,
  IProgramServices,
  IRngServices,
  IRuleVariableServices,
  PlatformServices,
} from "./services";
import type { ITypeRegistry } from "./type-defs";
import { TypeRegistry } from "./type-system";
import { NIL_VALUE, type Value } from "./value";

/**
 * TEST-ONLY. Per-provider overrides for {@link __test__createPlatformServices}.
 * Each field is optional; omitted fields fall back to empty runtime-only defaults.
 */
export interface __test__PlatformServicesOptions {
  /** Override the function registry. */
  functions?: IFunctionRegistry;
  /** Override the type registry. */
  types?: ITypeRegistry;
  /** Override the program services (rule funcId resolution). */
  program?: IProgramServices;
  /** Override the brain-variable services. */
  brainVars?: IBrainVariableServices;
  /** Override the rule-variable services. */
  ruleVars?: IRuleVariableServices;
  /** Override the brain-page lifecycle services. */
  brainPages?: IBrainPageServices;
  /** Override the RNG services. */
  rng?: IRngServices;
  /** Override the per-callsite services (slots and host-owned state). */
  callsite?: ICallsiteServices;
}

function __test__defaultBrainVars(): IBrainVariableServices {
  const store: Dict<string, Value> = new Dict();
  return {
    getByName(name: string): Value {
      return store.get(name) ?? NIL_VALUE;
    },
    setByName(name: string, value: Value): void {
      store.set(name, value);
    },
    clearByName(name: string): void {
      store.delete(name);
    },
  };
}

function __test__defaultRuleVars(): IRuleVariableServices {
  const stores: Dict<number, Dict<string, Value>> = new Dict();
  function ensure(ruleFuncId: number): Dict<string, Value> {
    let s = stores.get(ruleFuncId);
    if (!s) {
      s = new Dict();
      stores.set(ruleFuncId, s);
    }
    return s;
  }
  return {
    getByName(ruleFuncId: number | undefined, name: string): Value {
      if (ruleFuncId === undefined) return NIL_VALUE;
      return ensure(ruleFuncId).get(name) ?? NIL_VALUE;
    },
    setByName(ruleFuncId: number | undefined, name: string, value: Value): void {
      if (ruleFuncId === undefined) return;
      ensure(ruleFuncId).set(name, value);
    },
    clearByName(ruleFuncId: number | undefined, name: string): void {
      if (ruleFuncId === undefined) return;
      ensure(ruleFuncId).delete(name);
    },
  };
}

function __test__defaultBrainPages(): IBrainPageServices {
  return {
    getCurrentPageId(): string {
      return "";
    },
    getPreviousPageId(): string {
      return "";
    },
    requestPageChange(_pageIndex: number): void {},
    requestPageChangeByPageId(_pageId: string): void {},
    requestPageRestart(): void {},
  };
}

/**
 * TEST-ONLY. Creates a {@link PlatformServices} backed by runtime-only registries.
 * Pass an {@link __test__PlatformServicesOptions} to override individual providers
 * without rebuilding the whole aggregate.
 */
export function __test__createPlatformServices(options?: __test__PlatformServicesOptions): PlatformServices {
  return {
    functions: options?.functions ?? new FunctionRegistry(),
    types: options?.types ?? new TypeRegistry(),
    program: options?.program ?? {
      getRuleFuncIdForFunc(_funcId: number): number | undefined {
        return undefined;
      },
    },
    brainVars: options?.brainVars ?? __test__defaultBrainVars(),
    ruleVars: options?.ruleVars ?? __test__defaultRuleVars(),
    brainPages: options?.brainPages ?? __test__defaultBrainPages(),
    rng: options?.rng ?? {
      next(): number {
        return 0;
      },
    },
    callsite: options?.callsite ?? createCallsiteStore(),
  };
}
