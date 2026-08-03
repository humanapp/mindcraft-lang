import { Dict } from "../platform/dict";
import type { ReadonlyList } from "../platform/list";
import type { PageMetadata } from "./host-bindings";
import type { Program } from "./program";
import type { IProgramServices, IRuleFiringServices, IRuleVariableServices } from "./services";
import { NIL_VALUE, type Value } from "./value";

/**
 * Per-rule variable storage keyed by rule funcId, then by variable name.
 * Allocated lazily on first write to a given rule. Reads walk the
 * ancestor chain declared by `Program.ruleAncestors`.
 */
export type RuleVariableStores = Dict<number, Dict<string, Value>>;

/**
 * Outcome of a rule's most recent WHEN evaluation, recorded by the VM at the
 * WHEN boundary opcodes.
 */
export enum RuleFiringState {
  /** The rule began its WHEN check and has not yet reached a gate. */
  EVALUATING = "EVALUATING",
  /** The rule's most recent completed WHEN evaluation passed its gate. */
  DID_FIRE = "DID_FIRE",
  /** The rule's most recent completed WHEN evaluation failed its gate. */
  DID_NOT_FIRE = "DID_NOT_FIRE",
}

/**
 * Per-rule firing records keyed by rule funcId. A rule with no entry reads as
 * {@link RuleFiringState.DID_FIRE}: a rule with no WHEN condition emits no WHEN
 * boundary opcodes, never writes a record, and fires unconditionally.
 */
export type RuleFiringStates = Dict<number, RuleFiringState>;

/**
 * Build the {@link IRuleFiringServices} accessor backed by `states`.
 *
 * Read semantics: `get(ruleFuncId)` returns the rule's recorded outcome, or
 * {@link RuleFiringState.DID_FIRE} when the rule has never written one.
 *
 * Write semantics: `set(ruleFuncId, state)` overwrites the rule's record.
 * `ruleFuncId === undefined` is a no-op.
 */
export function createRuleFiringServices(states: RuleFiringStates): IRuleFiringServices {
  return {
    get(ruleFuncId: number): RuleFiringState {
      return states.get(ruleFuncId) ?? RuleFiringState.DID_FIRE;
    },
    set(ruleFuncId: number | undefined, state: RuleFiringState): void {
      if (ruleFuncId === undefined) return;
      states.set(ruleFuncId, state);
    },
  };
}

/**
 * Build the {@link IProgramServices} accessor backed by the loaded program and
 * its per-page metadata. Rule resolution reads `ruleFuncIds`: it returns
 * `funcId` for any function id that is a rule entry, `undefined` otherwise (the
 * only "no rule" sentinel; numeric `0` is a valid rule funcId). Enum symbol
 * values resolve through the program's type table. Preceding-sibling resolution
 * reads `program.ruleAncestors` for child rules and `pages`' root-rule runs for
 * root rules.
 *
 * @param program - The loaded program.
 * @param pages - Per-page metadata produced by the linker, in page order.
 */
export function createProgramServices(program: Program, pages: ReadonlyList<PageMetadata>): IProgramServices {
  const ruleFuncIds = program.ruleFuncIds;
  const ancestors = program.ruleAncestors;
  const types = program.types;

  /**
   * The child rule directly above `ruleFuncId` under `parentFuncId`: the
   * largest sibling funcId below `ruleFuncId`. Rule funcIds are assigned in a
   * pre-order document-order walk, so a rule's whole subtree sits above it and
   * only true siblings share `parentFuncId`.
   */
  function precedingChildSibling(ruleFuncId: number, parentFuncId: number): number | undefined {
    if (ancestors === undefined) return undefined;
    let best: number | undefined;
    const siblings = ancestors.keys();
    for (let i = 0; i < siblings.size(); i++) {
      const candidate = siblings.get(i)!;
      if (candidate >= ruleFuncId) continue;
      if (ancestors.get(candidate) !== parentFuncId) continue;
      if (best === undefined || candidate > best) {
        best = candidate;
      }
    }
    return best;
  }

  /** The root rule directly above `ruleFuncId` within its own page's root-rule run. */
  function precedingRootSibling(ruleFuncId: number): number | undefined {
    for (let p = 0; p < pages.size(); p++) {
      const roots = pages.get(p)!.rootRuleFuncIds;
      for (let r = 0; r < roots.size(); r++) {
        if (roots.get(r) !== ruleFuncId) continue;
        return r === 0 ? undefined : roots.get(r - 1);
      }
    }
    return undefined;
  }

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
    getPrecedingSiblingRuleFuncId(ruleFuncId: number): number | undefined {
      const parentFuncId = ancestors !== undefined ? ancestors.get(ruleFuncId) : undefined;
      if (parentFuncId !== undefined) {
        return precedingChildSibling(ruleFuncId, parentFuncId);
      }
      return precedingRootSibling(ruleFuncId);
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
