import type { IBrainTileDef, ITileCatalog, RuleSide } from "@mindcraft-lang/core/brain";
import { isVariableFactoryTileId, rootRulePath } from "@mindcraft-lang/core/brain";
import type { BrainCommand, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import {
  AddRuleCommand,
  AddTileCommand,
  InsertTileCommand,
  RemoveTileCommand,
  ReplaceTileCommand,
} from "@mindcraft-lang/core/brain/model";
import type { BrainTileFactoryDef } from "@mindcraft-lang/core/brain/tiles";
import { manufactureLiteralTile, manufactureVariableTile } from "@mindcraft-lang/core/brain/tiles";
import type { ToolDiagnostic } from "./diagnostics.js";
import { toToolDiagnostic } from "./diagnostics.js";
import type { ProjectRule } from "./read-project.js";
import { readRule } from "./read-project.js";
import { decideProposal } from "./rejection-policy.js";
import type { ProposeEditInput, TileRunEntry } from "./tool-schemas.js";
import { type AuthoringWorkspace, findPage, findRule, findTile, toRuleSide } from "./workspace.js";

/** An edit that landed in the document. */
export interface ProposalAccepted {
  readonly ok: true;
  /** The rule the edit produced, read back from the document. */
  readonly rule: ProjectRule;
  /** Command-history depth after the edit; every entry is undoable. */
  readonly historyDepth: number;
}

/** An edit the bridge refused, leaving the document untouched. */
export interface ProposalRejected {
  readonly ok: false;
  /** Stable diagnostic code that rejected the edit. */
  readonly code: number;
  /** Machine-readable values the diagnostic reports; absent when it carries none. */
  readonly params?: ToolDiagnostic["params"];
}

/** An edit that never reached validation because the request named something absent. */
export interface ProposalUnresolved {
  readonly ok: false;
  /**
   * `invalid_mint_input` reports a factory tile named without the input it
   * mints from, or with an input the factory makes no tile of.
   */
  readonly error: "unknown_rule" | "unknown_page" | "unknown_tile" | "position_out_of_range" | "invalid_mint_input";
  /** The rule id, page index, tile id, or position the request named. */
  readonly named: string;
}

/** Result of one `propose_edit` call. */
export type ProposalResult = ProposalAccepted | ProposalRejected | ProposalUnresolved;

/** The operation that places a run of tiles as one transaction. */
type PlaceTilesInput = Extract<ProposeEditInput, { op: "placeTiles" }>;

/** Every operation that runs a single editor command. */
type SingleCommandInput = Exclude<ProposeEditInput, PlaceTilesInput>;

/** The command an edit runs, and the rule whose validity it decides. */
interface ResolvedEdit {
  readonly command: BrainCommand;
  /** The rule the edit affects, resolved after the command has run. */
  readonly resolveRule: () => { ruleId: string; rule: BrainRuleDef };
}

/** The command that puts `tile` at `position` on `side` of `rule`, which currently holds `tileCount` tiles. */
function placementCommand(
  rule: BrainRuleDef,
  side: RuleSide,
  position: number,
  tileCount: number,
  tile: IBrainTileDef
): BrainCommand {
  return position === tileCount
    ? new AddTileCommand(rule, side, tile)
    : new InsertTileCommand(rule, side, position, tile);
}

/** Turn one proposed edit into an editor command, or report what it named that does not exist. */
function resolveEdit(workspace: AuthoringWorkspace, input: SingleCommandInput): ResolvedEdit | ProposalUnresolved {
  if (input.op === "addRule") {
    const page = findPage(workspace.brainDef, input.pageIndex);
    if (!page) return { ok: false, error: "unknown_page", named: String(input.pageIndex) };
    return {
      command: new AddRuleCommand(page),
      resolveRule: () => {
        const rules = page.children();
        const index = rules.size() - 1;
        return { ruleId: rootRulePath(input.pageIndex, index), rule: rules.get(index) as BrainRuleDef };
      },
    };
  }

  const located = findRule(workspace.brainDef, input.ruleId);
  if (!located) return { ok: false, error: "unknown_rule", named: input.ruleId };
  const side = toRuleSide(input.side);
  const tileCount = located.rule.side(side).tiles().size();
  const resolveRule = () => ({ ruleId: located.ruleId, rule: located.rule });

  if (input.op === "deleteTile") {
    if (input.position >= tileCount)
      return { ok: false, error: "position_out_of_range", named: String(input.position) };
    return { command: new RemoveTileCommand(located.rule, side, input.position), resolveRule };
  }

  const tile = resolveRunEntry(workspace, input.tileId);
  if ("ok" in tile) return tile;

  if (input.op === "replaceTile") {
    if (input.position >= tileCount)
      return { ok: false, error: "position_out_of_range", named: String(input.position) };
    return { command: new ReplaceTileCommand(located.rule, side, input.position, tile), resolveRule };
  }

  const position = input.position ?? tileCount;
  if (position > tileCount) return { ok: false, error: "position_out_of_range", named: String(position) };
  return { command: placementCommand(located.rule, side, position, tileCount, tile), resolveRule };
}

/** A run entry in its object form: the tile it names, plus any mint input. */
type TileMint = Exclude<TileRunEntry, string>;

/**
 * The tile one entry of a run names. An entry naming a factory tile mints the
 * tile its input describes and registers it in the document's catalog, reusing
 * an equivalent tile the catalog already holds. Returns `invalid_mint_input`
 * when the entry names a factory without the input that factory mints from.
 */
export function resolveRunEntry(
  workspace: AuthoringWorkspace,
  entry: TileRunEntry
): IBrainTileDef | ProposalUnresolved {
  const mint: TileMint = typeof entry === "string" ? { tileId: entry } : entry;
  const tile = findTile(workspace.catalogs, mint.tileId);
  if (!tile) return { ok: false, error: "unknown_tile", named: mint.tileId };
  if (tile.kind !== "factory") return tile;

  const factoryTileDef = tile as BrainTileFactoryDef;
  const catalog = workspace.brainDef.catalog();
  const minted = isVariableFactoryTileId(mint.tileId)
    ? manufactureVariableTile(factoryTileDef, catalog, mint.name ?? "")
    : mintLiteral(factoryTileDef, catalog, mint);
  if (!minted) return { ok: false, error: "invalid_mint_input", named: mint.tileId };
  return minted;
}

/** The literal `factoryTileDef` mints from `mint`, or undefined when the entry carries no value. */
function mintLiteral(
  factoryTileDef: BrainTileFactoryDef,
  catalog: ITileCatalog,
  mint: TileMint
): IBrainTileDef | undefined {
  if (mint.value === undefined) return undefined;
  return manufactureLiteralTile(factoryTileDef, catalog, mint.value, mint.displayFormat);
}

/** Tile ids `catalog` holds right now. */
function catalogTileIds(catalog: ITileCatalog): Set<string> {
  const tileIds = new Set<string>();
  catalog.getAll().forEach((tileDef) => {
    tileIds.add(tileDef.tileId);
  });
  return tileIds;
}

/** Drop every tile `catalog` has gained since it held exactly `before`. */
function dropTilesRegisteredSince(catalog: ITileCatalog, before: ReadonlySet<string>): void {
  for (const tileId of catalogTileIds(catalog)) {
    if (!before.has(tileId)) catalog.delete(tileId);
  }
}

/** Every diagnostic the rule's own typecheck reported, parse and type alike, across both sides. */
function ruleDiagnostics(rule: BrainRuleDef): ToolDiagnostic[] {
  const result = rule.when().typecheckResult();
  if (!result) return [];
  const diagnostics: ToolDiagnostic[] = [];
  result.parseResult.diags.forEach((diag) => {
    diagnostics.push(toToolDiagnostic(diag.code, diag.params));
  });
  result.typeInfo.diags.forEach((diag) => {
    diagnostics.push(toToolDiagnostic(diag.code, diag.params));
  });
  return diagnostics;
}

/**
 * Whole-brain build diagnostics that bear on this edit: every error, plus any
 * other diagnostic naming the edited rule.
 */
function buildDiagnostics(workspace: AuthoringWorkspace, ruleId: string): ToolDiagnostic[] {
  const build = workspace.environment.linkBrain(workspace.brainDef);
  const diagnostics: ToolDiagnostic[] = [];
  build.diagnostics.forEach((diag) => {
    if (diag.severity === "error" || diag.params?.rulePath === ruleId) {
      diagnostics.push(toToolDiagnostic(diag.code, diag.params));
    }
  });
  return diagnostics;
}

/** How an applied edit is kept or taken back once the policy has judged it. */
interface EditTransaction {
  /** Leave the applied commands in the document and in the history. */
  readonly keep: () => void;
  /** Take the applied commands back out, leaving no history entry. */
  readonly takeBack: () => void;
}

/**
 * Judge the edit now standing in the document against the proposal policy,
 * keeping it or taking it back through `transaction`. Validation reads the end
 * state, so a sequence of commands is judged once, by what it leaves behind.
 */
function decideApplied(
  workspace: AuthoringWorkspace,
  ruleId: string,
  rule: BrainRuleDef,
  transaction: EditTransaction
): ProposalResult {
  rule.typecheck();

  const decision = decideProposal([...ruleDiagnostics(rule), ...buildDiagnostics(workspace, ruleId)]);
  if (decision.verdict === "reject") {
    transaction.takeBack();
    const rejection = decision.rejectedBy!;
    return { ok: false, code: rejection.code, ...(rejection.params ? { params: rejection.params } : {}) };
  }

  transaction.keep();
  return {
    ok: true,
    rule: readRule(rule, ruleId, workspace.environment.appServices.localizer),
    historyDepth: workspace.history.undoDepth(),
  };
}

/**
 * Place a run of tiles as one transaction: the tiles go in from `position` in
 * the order given, the rule is judged once on the state they leave, and a
 * rejection takes every one of them back out. An accepted run is a single
 * undoable history entry, so one undo removes the whole expression. Tiles the
 * run minted are registered in the document's catalog as the run resolves and
 * are dropped again with the placement if the run does not land.
 */
function placeTileRun(workspace: AuthoringWorkspace, input: PlaceTilesInput): ProposalResult {
  const located = findRule(workspace.brainDef, input.ruleId);
  if (!located) return { ok: false, error: "unknown_rule", named: input.ruleId };

  const side = toRuleSide(input.side);
  const tileCount = located.rule.side(side).tiles().size();
  const position = input.position ?? tileCount;
  if (position > tileCount) return { ok: false, error: "position_out_of_range", named: String(position) };

  const catalog = workspace.brainDef.catalog();
  const registeredBefore = catalogTileIds(catalog);
  const tiles: IBrainTileDef[] = [];
  for (const entry of input.tileIds) {
    const tile = resolveRunEntry(workspace, entry);
    if ("ok" in tile) {
      dropTilesRegisteredSince(catalog, registeredBefore);
      return tile;
    }
    tiles.push(tile);
  }

  workspace.history.beginBatch(tiles.length === 1 ? "Place tile" : `Place ${tiles.length} tiles`);
  tiles.forEach((tile, index) => {
    const count = located.rule.side(side).tiles().size();
    workspace.history.executeCommand(placementCommand(located.rule, side, position + index, count, tile));
  });

  return decideApplied(workspace, located.ruleId, located.rule, {
    keep: () => workspace.history.endBatch(),
    takeBack: () => {
      workspace.history.abortBatch();
      dropTilesRegisteredSince(catalog, registeredBefore);
    },
  });
}

/**
 * Run one proposed edit through the editor's own command and validation path.
 * An accepted edit stays in the document as an undoable history entry; a
 * rejected edit is undone before returning, so the document rests exactly as it
 * did before the call. `placeTiles` applies its whole run as one transaction
 * and one history entry.
 */
export function proposeEdit(workspace: AuthoringWorkspace, input: ProposeEditInput): ProposalResult {
  if (input.op === "placeTiles") return placeTileRun(workspace, input);

  const resolved = resolveEdit(workspace, input);
  if ("ok" in resolved) return resolved;

  workspace.history.executeCommand(resolved.command);
  const { ruleId, rule } = resolved.resolveRule();

  return decideApplied(workspace, ruleId, rule, {
    keep: () => {},
    takeBack: () => workspace.history.undo(),
  });
}
