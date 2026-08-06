/**
 * The path of the rule at `ruleIndex` among the rules of the page at
 * `pageIndex`: the first segment of a rule's `pageIndex/ruleIndex[/childIndex...]`
 * address, which keys `UnlinkedBrainProgram.ruleIndex` and which diagnostics
 * report as `rulePath`.
 */
export function rootRulePath(pageIndex: number, ruleIndex: number): string {
  return `${pageIndex}/${ruleIndex}`;
}

/**
 * The path of the child at `childIndex` of the rule addressed by `parentPath`,
 * which must itself be a path {@link rootRulePath} or this function produced.
 */
export function childRulePath(parentPath: string, childIndex: number): string {
  return `${parentPath}/${childIndex}`;
}
