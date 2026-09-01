/**
 * A rule as {@link ruleRevisions} reads it: its trigger mode, the tile ids
 * standing on each of its sides, and the rules nested under it in the order they
 * stand.
 */
export interface RevisionRuleNode {
  /** The rule's trigger mode, as `IBrainRuleDef.trigger()` reads it. */
  readonly trigger: string;
  /** The ids of the tiles on the rule's WHEN side, in order. */
  readonly whenTileIds: readonly string[];
  /** The ids of the tiles on the rule's DO side, in order. */
  readonly doTileIds: readonly string[];
  /** The rules nested directly under this one, in the order they stand. */
  readonly children: readonly RevisionRuleNode[];
}

/** `ids` written so no two different lists can spell the same text. */
function spellIds(ids: readonly string[]): string {
  let out = "";
  for (const id of ids) out += `${id.length}:${id}`;
  return out;
}

/**
 * Reads every rule of `rules` and of the trees under them, appending one
 * revision per rule to `out` in depth-first pre-order.
 */
function readRevisions(rules: readonly RevisionRuleNode[], ancestorRevision: string, out: string[]): void {
  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index];
    const precedes = index > 0 ? "1" : "0";
    const revision = `${ancestorRevision}|${precedes}${rule.trigger}:${spellIds(rule.whenTileIds)}>${spellIds(rule.doTileIds)}`;
    out.push(revision);
    readRevisions(rule.children, revision, out);
  }
}

/**
 * The revision of every rule in `rules` and of every rule nested under them, in
 * depth-first pre-order: a rule's own revision comes first, then its children's,
 * then the next rule at its own level.
 *
 * A rule's revision stands for everything the editor derives about that rule
 * from the document: the sentence it reads, the capabilities and output keys in
 * scope at it, the tiles the suggestion oracle offers on either side, and
 * whether a tile that consumes the preceding rule may stand in it. It therefore
 * changes exactly when
 *
 * - the rule's own WHEN or DO tiles change,
 * - the rule's own trigger mode changes,
 * - the WHEN or DO tiles of any rule it is nested under change, or
 * - the rule gains or loses a rule above it at its own level, which a move, an
 *   insertion or a deletion among its siblings does.
 *
 * It does NOT change when a sibling's tiles change, nor when a rule nested under
 * it changes, because nothing the editor derives about a rule reads either.
 *
 * Revisions are comparable by value and carry no meaning of their own; two runs
 * over equal trees spell equal revisions, and no two different trees spell the
 * same one.
 */
export function ruleRevisions(rules: readonly RevisionRuleNode[]): string[] {
  const out: string[] = [];
  readRevisions(rules, "", out);
  return out;
}
