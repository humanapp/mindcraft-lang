import { createDefaultLocalizer } from "../localization/localizer";
import { Dict } from "../platform/dict";
import { MathOps } from "../platform/math";
import { BrainActionRegistry } from "./action-registry";
import { createCallsiteStore } from "./callsite-store";
import { ConversionRegistry } from "./conversions";
import { FunctionRegistry } from "./functions";
import { OperatorOverloads, OperatorTable } from "./operators";
import { createF64ProfileNumerics } from "./profile-numerics";
import { createRuleFiringServices, type RuleFiringState } from "./rule-services";
import type {
  AppServices,
  IBrainPageServices,
  IBrainVariableServices,
  ICallsiteServices,
  IProgramServices,
  IRuleFiringServices,
  IRuleVariableServices,
  PlatformServices,
  RuntimeLangServices,
  SharedLangServices,
} from "./services";
import { TypeRegistry } from "./type-system";
import { NIL_VALUE, type Value } from "./value";

/**
 * TEST-ONLY. Per-tier overrides for {@link __test__createPlatformServices}.
 * Each field is optional; omitted fields fall back to runtime-only defaults.
 */
export interface __test__PlatformServicesOptions {
  /** Override individual fields of the {@link RuntimeLangServices} tier (types, functions, operatorTable, actions). */
  runtime?: Partial<RuntimeLangServices>;
  /** Override individual fields of the {@link SharedLangServices} tier (conversions). */
  shared?: Partial<SharedLangServices>;
  /** Override individual fields of the {@link AppServices} tier (rng, numerics, localizer). */
  app?: Partial<AppServices>;
  /** Override the program services (rule funcId resolution). */
  program?: IProgramServices;
  /** Override the brain-variable services. */
  brainVars?: IBrainVariableServices;
  /** Override the rule-variable services. */
  ruleVars?: IRuleVariableServices;
  /** Override the per-rule WHEN-evaluation outcome records. */
  ruleFiring?: IRuleFiringServices;
  /** Override the brain-page lifecycle services. */
  brainPages?: IBrainPageServices;
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
  const runtime = options?.runtime;
  const shared = options?.shared;
  const app = options?.app;
  const functions = runtime?.functions ?? new FunctionRegistry();
  return {
    runtime: {
      types: runtime?.types ?? new TypeRegistry(),
      functions,
      operatorTable: runtime?.operatorTable ?? new OperatorTable(),
      actions: runtime?.actions ?? new BrainActionRegistry(),
    },
    shared: {
      conversions: shared?.conversions ?? new ConversionRegistry(functions),
    },
    app: {
      rng: app?.rng ?? {
        next(): number {
          return MathOps.random();
        },
      },
      numerics: app?.numerics ?? createF64ProfileNumerics(),
      localizer: app?.localizer ?? createDefaultLocalizer(),
    },
    brain: {
      program: options?.program ?? {
        getRuleFuncIdForFunc(_funcId: number): number | undefined {
          return undefined;
        },
        getEnumSymbolValue(_typeId: string, _key: string): string | number | undefined {
          return undefined;
        },
        getPrecedingSiblingRuleFuncId(_ruleFuncId: number): number | undefined {
          return undefined;
        },
      },
      brainVars: options?.brainVars ?? __test__defaultBrainVars(),
      ruleVars: options?.ruleVars ?? __test__defaultRuleVars(),
      ruleFiring: options?.ruleFiring ?? createRuleFiringServices(new Dict<number, RuleFiringState>()),
      pages: options?.brainPages ?? __test__defaultBrainPages(),
      callsite: options?.callsite ?? createCallsiteStore(),
    },
  };
}
