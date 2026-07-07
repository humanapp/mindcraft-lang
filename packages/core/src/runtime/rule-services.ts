import { Dict } from "../platform/dict";
import type { Program } from "./program";
import type { IProgramServices, IRuleVariableServices } from "./services";
import { NIL_VALUE, type Value } from "./value";

/**
 * Per-rule variable storage keyed by rule funcId, then by variable name.
 * Allocated lazily on first write to a given rule. Reads walk the
 * ancestor chain declared by `Program.ruleAncestors`.
 */
export type RuleVariableStores = Dict<number, Dict<string, Value>>;

/**
 * Build the {@link IProgramServices} accessor backed by the loaded program.
 * Rule resolution reads `ruleFuncIds`: it returns `funcId` for any function
 * id that is a rule entry, `undefined` otherwise (the only "no rule"
 * sentinel; numeric `0` is a valid rule funcId). Enum symbol values resolve
 * through the program's type table.
 */
export function createProgramServices(program: Program): IProgramServices {
  const ruleFuncIds = program.ruleFuncIds;
  const types = program.types;
  return {
    getRuleFuncIdForFunc(funcId: number): number | undefined {
      if (ruleFuncIds === undefined) return undefined;
      return ruleFuncIds.has(funcId) ? funcId : undefined;
    },
    getEnumSymbolValue(typeId: string, key: string): string | number | undefined {
      if (types === undefined) return undefined;
      for (let i = 0; i < types.size(); i++) {
        const entry = types.get(i)!;
        if (entry.tag !== "enum" || entry.typeId !== typeId) {
          continue;
        }
        const symbol = entry.symbols.find((s) => s.key === key);
        return symbol?.value;
      }
      return undefined;
    },
  };
}

/**
 * Build the {@link IRuleVariableServices} accessor backed by `stores` and
 * the ancestor chain declared by `program.ruleAncestors`.
 *
 * Read semantics: `getByName(funcId, name)` returns the value stored on
 * `funcId` if present; otherwise walks the ancestor chain
 * (`program.ruleAncestors`) until a store with `name` is found, or returns
 * `NIL_VALUE` when the chain ends.
 *
 * Write semantics: `setByName(funcId, name, value)` writes only to
 * `funcId`'s own store, allocating it on first write. `clearByName(funcId,
 * name)` deletes only from `funcId`'s own store; ancestors are unaffected.
 *
 * `ruleFuncId === undefined` is a no-op for both writes; reads return
 * `NIL_VALUE`.
 */
export function createRuleVariableServices(program: Program, stores: RuleVariableStores): IRuleVariableServices {
  const ancestors = program.ruleAncestors;

  function ensureStore(ruleFuncId: number): Dict<string, Value> {
    let s = stores.get(ruleFuncId);
    if (!s) {
      s = new Dict<string, Value>();
      stores.set(ruleFuncId, s);
    }
    return s;
  }

  return {
    getByName(ruleFuncId: number | undefined, name: string): Value {
      if (ruleFuncId === undefined) return NIL_VALUE;
      let cur: number | undefined = ruleFuncId;
      while (cur !== undefined) {
        const store = stores.get(cur);
        if (store?.has(name)) {
          return store.get(name)!;
        }
        cur = ancestors !== undefined ? ancestors.get(cur) : undefined;
      }
      return NIL_VALUE;
    },
    setByName(ruleFuncId: number | undefined, name: string, value: Value): void {
      if (ruleFuncId === undefined) return;
      ensureStore(ruleFuncId).set(name, value);
    },
    clearByName(ruleFuncId: number | undefined, name: string): void {
      if (ruleFuncId === undefined) return;
      const store = stores.get(ruleFuncId);
      if (store) {
        store.delete(name);
      }
    },
  };
}
