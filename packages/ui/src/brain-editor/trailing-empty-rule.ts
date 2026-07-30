/** The top-level rules of a page, as {@link decideTrailingEmptyRule} reads them. */
export interface TrailingRuleFacts {
  /** Whether each top-level rule of the page is empty, children included, in page order. */
  readonly isEmpty: readonly boolean[];
  /** Whether the page editor appended that rule itself, indexed as {@link isEmpty} is. */
  readonly isAppended: readonly boolean[];
}

/**
 * What the page editor does to keep one empty rule at the end of the page:
 *
 * - `append` -- add an empty rule, because the page ends with tiles or holds no rule
 * - `remove` -- drop the rule at `index`, one of a trailing run of empty rules
 * - `none` -- the page already ends with exactly one empty rule
 */
export type TrailingRuleAction =
  | { readonly kind: "append" }
  | { readonly kind: "remove"; readonly index: number }
  | { readonly kind: "none" };

const noAction: TrailingRuleAction = { kind: "none" };

/**
 * The one step to take toward the page ending with exactly one empty rule.
 *
 * A page whose last rule carries tiles gets an empty one appended. A page
 * ending in several empty rules gives up the last rule of that run the page
 * editor appended itself, keeping the earliest -- so the rule composition is
 * armed on stays, and an empty rule the user authored is never taken away. Apply
 * the action and ask again: each step changes the page, and the page settles on
 * `none`.
 */
export function decideTrailingEmptyRule(facts: TrailingRuleFacts): TrailingRuleAction {
  const count = facts.isEmpty.length;
  if (count === 0 || !facts.isEmpty[count - 1]) return { kind: "append" };
  let runStart = count - 1;
  while (runStart > 0 && facts.isEmpty[runStart - 1]) runStart -= 1;
  for (let index = count - 1; index > runStart; index -= 1) {
    if (facts.isAppended[index]) return { kind: "remove", index };
  }
  return noAction;
}
