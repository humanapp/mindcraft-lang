import type { MindcraftEnvironment, ReadonlyList } from "@mindcraft-lang/core";
import { coreModule, createMindcraftEnvironment, List } from "@mindcraft-lang/core/app";
import type { IBrainTileDef, ITileCatalog } from "@mindcraft-lang/core/brain";
import { childRulePath, RuleSide, rootRulePath } from "@mindcraft-lang/core/brain";
import type { BrainJson, BrainPageDef, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import { BrainCommandHistory, BrainDef } from "@mindcraft-lang/core/brain/model";
import type { TargetAdapter } from "../target/adapter.js";
import { sessionTileDescriptions } from "./tile-descriptions.js";
import type { RuleSideName } from "./tool-schemas.js";

/**
 * The live objects one authoring session edits: a real environment, the brain
 * document under authoring, the command history every edit runs through, the
 * catalogs the oracle and parser resolve tiles against, the author descriptions
 * that reach the model, and the target the session authors for.
 */
export interface AuthoringWorkspace {
  readonly environment: MindcraftEnvironment;
  readonly brainDef: BrainDef;
  readonly history: BrainCommandHistory;
  readonly catalogs: ReadonlyList<ITileCatalog>;
  /** Author description text keyed by tile id; a tile with no documented description is absent. */
  readonly descriptions: ReadonlyMap<string, string>;
  readonly adapter: TargetAdapter;
}

/** What a session workspace opens with, when it does not open empty. */
export interface AuthoringWorkspaceOptions {
  /**
   * The document to open, as the brain JSON `IBrainDef.toJson` produces. The
   * session edits this project.
   */
  readonly brainJson?: BrainJson;
}

/**
 * Build a session workspace over a fresh environment carrying core's modules
 * and the target's, with the environment's catalogs and the descriptions core
 * and the target document their tiles with. The document is
 * `options.brainJson` when one is given, and an empty brain named `brainName`
 * otherwise.
 */
export function createAuthoringWorkspace(
  adapter: TargetAdapter,
  brainName: string,
  options?: AuthoringWorkspaceOptions
): AuthoringWorkspace {
  const environment = createMindcraftEnvironment({ modules: [coreModule(), ...adapter.modules()] });
  const brainDef = options?.brainJson
    ? (environment.deserializeBrainJson(options.brainJson) as BrainDef)
    : BrainDef.emptyBrainDef(environment.brainServices, brainName);
  return {
    environment,
    brainDef,
    history: new BrainCommandHistory(),
    catalogs: List.from<ITileCatalog>([...environment.tileCatalogs(), brainDef.catalog()]),
    descriptions: sessionTileDescriptions(adapter.tileDocs()),
    adapter,
  };
}

/** One rule in the document, with the id the model addresses it by. */
export interface LocatedRule {
  /** `pageIndex/ruleIndex[/childIndex...]`, the same path core's diagnostics report. */
  readonly ruleId: string;
  readonly rule: BrainRuleDef;
}

/** Core's numeric rule side for the name the model uses. */
export function toRuleSide(side: RuleSideName): RuleSide {
  return side === "when" ? RuleSide.When : RuleSide.Do;
}

/** Walk `rule` and its descendants in document order, appending to `into`. */
function walkRule(rule: BrainRuleDef, ruleId: string, into: LocatedRule[]): void {
  into.push({ ruleId, rule });
  const children = rule.children();
  for (let i = 0; i < children.size(); i++) {
    walkRule(children.get(i) as BrainRuleDef, childRulePath(ruleId, i), into);
  }
}

/** Every rule in `brainDef`, in document order, each carrying its path id. */
export function locateRules(brainDef: BrainDef): LocatedRule[] {
  const located: LocatedRule[] = [];
  const pages = brainDef.pages();
  for (let p = 0; p < pages.size(); p++) {
    const page = pages.get(p) as BrainPageDef;
    const rules = page.children();
    for (let r = 0; r < rules.size(); r++) {
      walkRule(rules.get(r) as BrainRuleDef, rootRulePath(p, r), located);
    }
  }
  return located;
}

/** The rule `ruleId` names, or `undefined` when the document holds no such rule. */
export function findRule(brainDef: BrainDef, ruleId: string): LocatedRule | undefined {
  return locateRules(brainDef).find((located) => located.ruleId === ruleId);
}

/** The page at `pageIndex`, or `undefined` when the document has no such page. */
export function findPage(brainDef: BrainDef, pageIndex: number): BrainPageDef | undefined {
  const pages = brainDef.pages();
  if (pageIndex < 0 || pageIndex >= pages.size()) return undefined;
  return pages.get(pageIndex) as BrainPageDef;
}

/** The tile `tileId` names in any of `catalogs`, or `undefined` when none holds it. */
export function findTile(catalogs: ReadonlyList<ITileCatalog>, tileId: string): IBrainTileDef | undefined {
  for (let i = 0; i < catalogs.size(); i++) {
    const tile = catalogs.get(i)!.get(tileId);
    if (tile) return tile;
  }
  return undefined;
}

/** Every tile in `catalogs`, deduplicated by tile id and sorted by it. */
export function allTiles(catalogs: ReadonlyList<ITileCatalog>): IBrainTileDef[] {
  const byId = new Map<string, IBrainTileDef>();
  for (let i = 0; i < catalogs.size(); i++) {
    catalogs
      .get(i)!
      .getAll()
      .forEach((tile) => {
        if (!byId.has(tile.tileId)) byId.set(tile.tileId, tile);
      });
  }
  return [...byId.values()].sort((a, b) => (a.tileId < b.tileId ? -1 : a.tileId > b.tileId ? 1 : 0));
}
