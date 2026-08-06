import type { ReadonlyList } from "@mindcraft-lang/core";
import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import { RuleSide } from "@mindcraft-lang/core/brain";
import type { BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { tileLabel } from "./tile-label.js";
import type { AuthoringWorkspace } from "./workspace.js";

/** One tile as it appears on a rule side. */
export interface ProjectTile {
  readonly tileId: string;
  /** Display label, the value text or variable name a manufactured tile carries, or the tile id when it has none. */
  readonly label: string;
}

/** One rule of the document, with its children nested beneath it. */
export interface ProjectRule {
  /** `pageIndex/ruleIndex[/childIndex...]`; the id every other tool addresses the rule by. */
  readonly ruleId: string;
  /** The author's note on the rule, absent when it has none. */
  readonly comment?: string;
  readonly when: readonly ProjectTile[];
  readonly do: readonly ProjectTile[];
  readonly children: readonly ProjectRule[];
}

/** One page of the document. */
export interface ProjectPage {
  readonly pageIndex: number;
  readonly name: string;
  readonly rules: readonly ProjectRule[];
}

/** The whole brain document as `read_project` returns it. */
export interface ProjectView {
  readonly brainName: string;
  readonly pages: readonly ProjectPage[];
}

function tileRefs(tiles: ReadonlyList<IBrainTileDef>): ProjectTile[] {
  const refs: ProjectTile[] = [];
  for (let i = 0; i < tiles.size(); i++) {
    const tile = tiles.get(i)!;
    refs.push({ tileId: tile.tileId, label: tileLabel(tile) });
  }
  return refs;
}

/** Read one rule and its descendants, addressed by `ruleId`. */
export function readRule(rule: BrainRuleDef, ruleId: string): ProjectRule {
  const children: ProjectRule[] = [];
  const childRules = rule.children();
  for (let i = 0; i < childRules.size(); i++) {
    children.push(readRule(childRules.get(i) as BrainRuleDef, `${ruleId}/${i}`));
  }
  const comment = rule.comment();
  return {
    ruleId,
    ...(comment ? { comment } : {}),
    when: tileRefs(rule.side(RuleSide.When).tiles()),
    do: tileRefs(rule.side(RuleSide.Do).tiles()),
    children,
  };
}

/** Read the whole brain document: pages, rules, and the tiles on each rule side. */
export function readProject(workspace: AuthoringWorkspace): ProjectView {
  const pages: ProjectPage[] = [];
  const pageDefs = workspace.brainDef.pages();
  for (let p = 0; p < pageDefs.size(); p++) {
    const page = pageDefs.get(p) as BrainPageDef;
    const rules: ProjectRule[] = [];
    const ruleDefs = page.children();
    for (let r = 0; r < ruleDefs.size(); r++) {
      rules.push(readRule(ruleDefs.get(r) as BrainRuleDef, `${p}/${r}`));
    }
    pages.push({ pageIndex: p, name: page.name(), rules });
  }
  return { brainName: workspace.brainDef.name(), pages };
}
