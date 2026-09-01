import type { ReadonlyList } from "@wendoo/core";
import type { IBrainTileDef } from "@wendoo/core/brain";
import { RuleSide, RuleTriggerMode } from "@wendoo/core/brain";
import { tileSentenceWord } from "@wendoo/core/brain/language-service";
import type { BrainPageDef, BrainRuleDef } from "@wendoo/core/brain/model";
import type { Localizer } from "@wendoo/core/localization";
import type { AuthoringWorkspace } from "./workspace.js";

/** One tile as it appears on a rule side. */
export interface ProjectTile {
  readonly tileId: string;
  /** The word the tile reads by in the document's locale. */
  readonly label: string;
}

/** One rule of the document, with its children nested beneath it. */
export interface ProjectRule {
  /**
   * The rule's durable id, which every other tool addresses it by. It is the
   * rule's for as long as the rule exists: adding, moving, or removing rules
   * around it does not change it.
   */
  readonly ruleId: string;
  /** The author's note on the rule, absent when it has none. */
  readonly comment?: string;
  /**
   * What arms the rule, absent for a rule in the default `when` mode. An
   * `otherwise` rule fires on the thinks no earlier rule of its flat
   * otherwise-run fired; a `then` rule runs once the rule above it completes.
   */
  readonly trigger?: RuleTriggerMode;
  readonly when: readonly ProjectTile[];
  readonly do: readonly ProjectTile[];
  readonly children: readonly ProjectRule[];
}

/** One page of the document. */
export interface ProjectPage {
  /**
   * The page's durable id, which `deletePage` addresses it by and which adding
   * or removing pages around it does not change.
   */
  readonly pageId: string;
  /** The page's position in the document right now, which pages coming and going do change. */
  readonly pageIndex: number;
  readonly name: string;
  readonly rules: readonly ProjectRule[];
}

/** One page of the document as an accepted edit reports it. */
export interface ProjectPageRef {
  readonly pageId: string;
  /** The page's position at the moment the edit reported it. */
  readonly pageIndex: number;
  readonly name: string;
}

/** The whole brain document as `read_project` returns it. */
export interface ProjectView {
  readonly brainName: string;
  readonly pages: readonly ProjectPage[];
}

function tileRefs(tiles: ReadonlyList<IBrainTileDef>, localizer: Localizer): ProjectTile[] {
  const refs: ProjectTile[] = [];
  for (let i = 0; i < tiles.size(); i++) {
    const tile = tiles.get(i)!;
    refs.push({ tileId: tile.tileId, label: tileSentenceWord(tile, localizer) });
  }
  return refs;
}

/**
 * Read one rule and its descendants, each under its own durable id. Each tile's
 * label is the word it reads by in the locale `localizer` renders.
 */
export function readRule(rule: BrainRuleDef, localizer: Localizer): ProjectRule {
  const children: ProjectRule[] = [];
  const childRules = rule.children();
  for (let i = 0; i < childRules.size(); i++) {
    children.push(readRule(childRules.get(i) as BrainRuleDef, localizer));
  }
  const comment = rule.comment();
  const trigger = rule.trigger();
  return {
    ruleId: rule.ruleId(),
    ...(comment ? { comment } : {}),
    ...(trigger === RuleTriggerMode.When ? {} : { trigger }),
    when: tileRefs(rule.side(RuleSide.When).tiles(), localizer),
    do: tileRefs(rule.side(RuleSide.Do).tiles(), localizer),
    children,
  };
}

/** Read the whole brain document: pages, rules, and the tiles on each rule side. */
export function readProject(workspace: AuthoringWorkspace): ProjectView {
  const localizer = workspace.environment.appServices.localizer;
  const pages: ProjectPage[] = [];
  const pageDefs = workspace.brainDef.pages();
  for (let p = 0; p < pageDefs.size(); p++) {
    const page = pageDefs.get(p) as BrainPageDef;
    const rules: ProjectRule[] = [];
    const ruleDefs = page.children();
    for (let r = 0; r < ruleDefs.size(); r++) {
      rules.push(readRule(ruleDefs.get(r) as BrainRuleDef, localizer));
    }
    pages.push({ pageId: page.pageId(), pageIndex: p, name: page.name(), rules });
  }
  return { brainName: workspace.brainDef.name(), pages };
}
