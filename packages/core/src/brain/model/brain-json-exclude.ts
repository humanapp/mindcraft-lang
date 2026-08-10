import { List, type ReadonlyList } from "../../platform/list";
import type { BrainJson } from "./braindef";
import type { PageJson } from "./pagedef";
import type { RuleJson } from "./ruledef";

/** True when `ruleId` is one of `excluded`. */
function isExcluded(ruleId: string | undefined, excluded: ReadonlyList<string>): boolean {
  if (ruleId === undefined) {
    return false;
  }
  for (let i = 0; i < excluded.size(); i++) {
    if (ruleId === excluded.get(i)) {
      return true;
    }
  }
  return false;
}

/** `rule` holding no tiles on either side, with every rule beneath it emptied the same way. */
function emptiedRule(rule: RuleJson): RuleJson {
  const children = List.empty<RuleJson>();
  for (let i = 0; i < rule.children.size(); i++) {
    children.push(emptiedRule(rule.children.get(i)));
  }
  return { ...rule, when: List.empty<string>(), do: List.empty<string>(), children };
}

/** `rule` with the excluded rules among it and its descendants emptied. */
function excludeInRule(rule: RuleJson, excluded: ReadonlyList<string>): RuleJson {
  if (isExcluded(rule.ruleId, excluded)) {
    return emptiedRule(rule);
  }
  const children = List.empty<RuleJson>();
  let changed = false;
  for (let i = 0; i < rule.children.size(); i++) {
    const child = rule.children.get(i);
    const excludedChild = excludeInRule(child, excluded);
    if (excludedChild !== child) {
      changed = true;
    }
    children.push(excludedChild);
  }
  return changed ? { ...rule, children } : rule;
}

/** `page` with the excluded rules among its rule trees emptied. */
function excludeInPage(page: PageJson, excluded: ReadonlyList<string>): PageJson {
  const rules = List.empty<RuleJson>();
  let changed = false;
  for (let i = 0; i < page.rules.size(); i++) {
    const rule = page.rules.get(i);
    const excludedRule = excludeInRule(rule, excluded);
    if (excludedRule !== rule) {
      changed = true;
    }
    rules.push(excludedRule);
  }
  return changed ? { ...page, rules } : page;
}

/**
 * `json` with every rule `excludedRuleIds` names emptied of its tiles, and
 * every rule beneath one emptied the same way. Each entry is a rule's stable
 * `ruleId`; an id naming no rule empties nothing, as does an id carried by a
 * rule of a document that was saved before rules carried ids.
 *
 * An emptied rule keeps its id and its place, so every other rule keeps the
 * path and the function id it has in `json`, and diagnostics and run
 * observations read the same against either document. An emptied rule builds,
 * reaches no WHEN gate, and runs nothing, so a brain whose every build error
 * falls in an emptied rule builds and runs.
 *
 * The result is ordinary brain JSON: it serializes, deserializes, and copies
 * like any other document, and what it excludes travels with it.
 *
 * Returns `json` itself when it empties nothing.
 */
export function brainJsonWithRulesEmptied(json: BrainJson, excludedRuleIds: readonly string[]): BrainJson {
  const excluded = List.from(excludedRuleIds);
  if (excluded.isEmpty()) {
    return json;
  }

  const pages = List.empty<PageJson>();
  let changed = false;
  for (let i = 0; i < json.pages.size(); i++) {
    const page = json.pages.get(i);
    const excludedPage = excludeInPage(page, excluded);
    if (excludedPage !== page) {
      changed = true;
    }
    pages.push(excludedPage);
  }
  return changed ? { ...json, pages } : json;
}
