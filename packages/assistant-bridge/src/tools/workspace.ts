import type { ReadonlyList, WendooEnvironment } from "@wendoo/core";
import type { IBrainDef } from "@wendoo/core/app";
import { coreModule, createEntropySeededRng, createWendooEnvironment, List } from "@wendoo/core/app";
import type { IBrainTileDef, ITileCatalog } from "@wendoo/core/brain";
import { childRulePath, RuleSide, rootRulePath } from "@wendoo/core/brain";
import type { BrainCommand, BrainEditOrigin, BrainJson, BrainPageDef, BrainRuleDef } from "@wendoo/core/brain/model";
import { BrainCommandHistory, BrainDef } from "@wendoo/core/brain/model";
import type { TargetAdapter } from "../target/adapter.js";
import { sessionTileDescriptions } from "./tile-descriptions.js";
import type { RuleSideName } from "./tool-schemas.js";

/**
 * The editing surface a tool call reaches the document's command history
 * through: the commands it runs, the batches it groups them into, the steps it
 * takes back, and the depth and changes it reads. `BrainCommandHistory`
 * satisfies it.
 */
export interface BrainEditHistory {
  /** Run `command` and put it on the undo stack, or into the open batch. */
  executeCommand(command: BrainCommand): void;
  /** Open a batch: every command run until the batch closes takes one entry, described by `description`. */
  beginBatch(description: string): void;
  /** Close the open batch, adding its commands as one entry. Does nothing when no batch is open. */
  endBatch(): void;
  /** Close the open batch, undoing every command it gathered and adding no entry. */
  abortBatch(): void;
  /** Take the newest entry back. Does nothing while a batch is open or the undo stack is empty. */
  undo(): void;
  /** Reapply the entry most recently taken back. Does nothing while a batch is open or nothing was taken back. */
  redo(): void;
  /** Number of entries on the undo stack; commands gathered by an open batch are not counted. */
  undoDepth(): number;
  /** Drop every entry, leaving nothing to take back or reapply. */
  clear(): void;
  /** How the entry `undo` would take back describes itself, or undefined while the undo stack is empty. */
  getUndoDescription(): string | undefined;
  /** Call `callback` with the origin of each change to the history. Returns the unsubscribe. */
  onChange(callback: (origin: BrainEditOrigin) => void): () => void;
}

/** Where one accepted edit came to rest in the document. */
export interface LandedEdit {
  /**
   * Durable id of the page to show. It is the page holding the rule the edit
   * touched, and for an edit that removed a page, a page the document still
   * holds.
   */
  readonly pageId: string;
  /**
   * Durable id of the rule the edit touched. Absent for an edit that removed a
   * page, which leaves no rule to show. An edit that removed a rule still names
   * it, so the editor can show the place it stood.
   */
  readonly ruleId?: string;
}

/**
 * The live objects one authoring session edits: a real environment, the brain
 * document under authoring, the command history every edit runs through, the
 * catalogs the oracle and parser resolve tiles against, the author descriptions
 * that reach the model, and the target the session authors for.
 */
export interface AuthoringWorkspace {
  readonly environment: WendooEnvironment;
  readonly brainDef: BrainDef;
  readonly history: BrainEditHistory;
  readonly catalogs: ReadonlyList<ITileCatalog>;
  /** Author description text keyed by tile id; a tile with no documented description is absent. */
  readonly descriptions: ReadonlyMap<string, string>;
  readonly adapter: TargetAdapter;
  /**
   * Called as each accepted edit lands in the document, once per editor command
   * a proposal runs, in the order they run. Absent for a workspace nobody
   * watches.
   */
  readonly onEditLanded?: (edit: LandedEdit) => void;
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
  const environment = createWendooEnvironment({
    modules: [coreModule(), ...adapter.modules()],
    rng: createEntropySeededRng(),
  });
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
  /** The rule's durable id, which every tool addresses it by and which no edit around it changes. */
  readonly ruleId: string;
  /**
   * `pageIndex/ruleIndex[/childIndex...]`, the rule's position in the document
   * right now, and the form core's diagnostics report rules under.
   */
  readonly rulePath: string;
  readonly rule: BrainRuleDef;
}

/** Core's numeric rule side for the name the model uses. */
export function toRuleSide(side: RuleSideName): RuleSide {
  return side === "when" ? RuleSide.When : RuleSide.Do;
}

/** Walk `rule` and its descendants in document order, appending to `into`. */
function walkRule(rule: BrainRuleDef, rulePath: string, into: LocatedRule[]): void {
  into.push({ ruleId: rule.ruleId(), rulePath, rule });
  const children = rule.children();
  for (let i = 0; i < children.size(); i++) {
    walkRule(children.get(i) as BrainRuleDef, childRulePath(rulePath, i), into);
  }
}

/** Every rule in `brainDef`, in document order, each carrying its id and its current path. */
export function locateRules(brainDef: IBrainDef): LocatedRule[] {
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

/** True when `rulePath` names a rule nested under another rule. */
export function isNestedRulePath(rulePath: string): boolean {
  return rulePath.split("/").length > 2;
}

/**
 * The durable id of every rule in `brainDef`, keyed by the path core's
 * diagnostics report it under. Build it fresh for each read: a path names a
 * position, and an edit that moves a rule gives the path to another one.
 */
export function ruleIdsByPath(brainDef: IBrainDef): Map<string, string> {
  const byPath = new Map<string, string>();
  for (const located of locateRules(brainDef)) byPath.set(located.rulePath, located.ruleId);
  return byPath;
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

/** One page in the document, with the id the model addresses it by and where it stands now. */
export interface LocatedPage {
  readonly pageId: string;
  readonly pageIndex: number;
  readonly page: BrainPageDef;
}

/** The page `pageId` names, or `undefined` when the document holds no such page. */
export function findPageById(brainDef: BrainDef, pageId: string): LocatedPage | undefined {
  const pages = brainDef.pages();
  for (let i = 0; i < pages.size(); i++) {
    const page = pages.get(i) as BrainPageDef;
    if (page.pageId() === pageId) return { pageId, pageIndex: i, page };
  }
  return undefined;
}

/**
 * Durable ids of the rules in `brainDef` that name `tileId` anywhere on either
 * of their sides, in document order.
 */
export function rulesNamingTile(brainDef: BrainDef, tileId: string): string[] {
  const naming: string[] = [];
  for (const located of locateRules(brainDef)) {
    const sides = [located.rule.side(RuleSide.When).tiles(), located.rule.side(RuleSide.Do).tiles()];
    const names = sides.some((tiles) => {
      for (let i = 0; i < tiles.size(); i++) {
        if (tiles.get(i)!.tileId === tileId) return true;
      }
      return false;
    });
    if (names) naming.push(located.ruleId);
  }
  return naming;
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
