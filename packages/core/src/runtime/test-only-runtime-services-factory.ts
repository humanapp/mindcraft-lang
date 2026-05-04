import { Dict } from "../platform/dict";
import type { IFunctionRegistry } from "./function-defs";
import { FunctionRegistry } from "./functions";
import type {
  IActionServices,
  IBrainPageServices,
  IBrainVariableServices,
  ICallSiteServices,
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
  /** Override the call-site services. */
  callSite?: ICallSiteServices;
  /** Override the action services. */
  action?: IActionServices;
}

interface __test__ActionState {
  hostState?: unknown;
  slots: Dict<number, Value>;
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

function __test__defaultActionAndCallSite(): { action: IActionServices; callSite: ICallSiteServices } {
  const states: Dict<number, __test__ActionState> = new Dict();
  function ensure(callSiteId: number): __test__ActionState {
    let s = states.get(callSiteId);
    if (!s) {
      s = { slots: new Dict() };
      states.set(callSiteId, s);
    }
    return s;
  }
  return {
    callSite: {
      getHostState(callSiteId: number): unknown {
        return states.get(callSiteId)?.hostState;
      },
      setHostState(callSiteId: number, state: unknown): void {
        ensure(callSiteId).hostState = state;
      },
      clearHostState(callSiteId: number): void {
        const s = states.get(callSiteId);
        if (s) {
          s.hostState = undefined;
        }
      },
    },
    action: {
      ensureCallsite(callSiteId: number): boolean {
        if (states.has(callSiteId)) {
          return false;
        }
        ensure(callSiteId);
        return true;
      },
      getStateSlot(callSiteId: number, slotIdx: number): Value {
        return states.get(callSiteId)?.slots.get(slotIdx) ?? NIL_VALUE;
      },
      setStateSlot(callSiteId: number, slotIdx: number, value: Value): void {
        ensure(callSiteId).slots.set(slotIdx, value);
      },
      resetCallsite(callSiteId: number): void {
        states.delete(callSiteId);
      },
    },
  };
}

/**
 * TEST-ONLY. Creates a {@link PlatformServices} backed by runtime-only registries.
 * Pass an {@link __test__PlatformServicesOptions} to override individual providers
 * without rebuilding the whole aggregate.
 */
export function __test__createPlatformServices(options?: __test__PlatformServicesOptions): PlatformServices {
  const defaults = __test__defaultActionAndCallSite();
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
    callSite: options?.callSite ?? defaults.callSite,
    action: options?.action ?? defaults.action,
  };
}
