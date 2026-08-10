import type { IBrainTileDef, ITileCatalog, RuleSide } from "@mindcraft-lang/core/brain";
import { isVariableFactoryTileId } from "@mindcraft-lang/core/brain";
import type { BrainCommand, BrainRuleDef } from "@mindcraft-lang/core/brain/model";
import {
  AddRuleCommand,
  AddTileCommand,
  IndentRuleCommand,
  InsertRuleCommand,
  InsertTileCommand,
  RemoveTileCommand,
  ReplaceTileCommand,
} from "@mindcraft-lang/core/brain/model";
import type { BrainTileFactoryDef } from "@mindcraft-lang/core/brain/tiles";
import { manufactureLiteralTile, manufactureVariableTile } from "@mindcraft-lang/core/brain/tiles";
import type { SerializedDiagParams, ToolDiagnostic } from "./diagnostics.js";
import { toToolDiagnostic } from "./diagnostics.js";
import type { ProjectRule } from "./read-project.js";
import { readRule } from "./read-project.js";
import { decideProposal, rejectionParams } from "./rejection-policy.js";
import type { ProposeEditBatchInput, ProposeEditInput, TileRunEntry } from "./tool-schemas.js";
import { batchRuleIndex } from "./tool-schemas.js";
import { type AuthoringWorkspace, findPage, findRule, findTile, ruleIdsByPath, toRuleSide } from "./workspace.js";

/** An edit that landed in the document. */
export interface ProposalAccepted {
  readonly ok: true;
  /** The rule the edit produced, read back from the document. */
  readonly rule: ProjectRule;
  /** Command-history depth after the edit; every entry is undoable. */
  readonly historyDepth: number;
}

/** A batch of edits that landed in the document together. */
export interface BatchAccepted {
  readonly ok: true;
  /**
   * The rules the batch's commands affected, one per command and in that order,
   * read back from the document once the whole batch stands in it.
   */
  readonly rules: readonly ProjectRule[];
  /** Command-history depth after the batch, which the batch raised by one. */
  readonly historyDepth: number;
}

/** An edit the bridge refused, leaving the document untouched. */
export interface ProposalRejected {
  readonly ok: false;
  /** Stable diagnostic code that rejected the edit. */
  readonly code: number;
  /**
   * Machine-readable values that place and describe the refusal: what the
   * rejecting diagnostic reports, the durable id of the rule under `ruleId`,
   * and the `side` and `tileId` a companion diagnostic pins for the same
   * failure when one does.
   */
  readonly params: SerializedDiagParams;
}

/** An edit that never reached validation because the request named something absent. */
export interface ProposalUnresolved {
  readonly ok: false;
  /**
   * `invalid_mint_input` reports a factory tile named without the input it
   * mints from, or with an input the factory makes no tile of.
   * `rule_nesting_too_deep` reports a parent rule the document cannot nest
   * another rule under. `unknown_batch_reference` reports a `#N` naming no
   * command of the batch that creates a rule before this one runs.
   */
  readonly error:
    | "unknown_rule"
    | "unknown_page"
    | "unknown_tile"
    | "position_out_of_range"
    | "invalid_mint_input"
    | "rule_nesting_too_deep"
    | "unknown_batch_reference";
  /** The rule id, page index, tile id, or position the request named. */
  readonly named: string;
  /** Index in the batch of the command that named it; absent outside a batch. */
  readonly commandIndex?: number;
}

/** Result of one `propose_edit` call carrying a single command. */
export type ProposalResult = ProposalAccepted | ProposalRejected | ProposalUnresolved;

/** Result of one `propose_edit` call carrying a batch of commands. */
export type BatchResult = BatchAccepted | ProposalRejected | ProposalUnresolved;

/** Milliseconds an accepted batch waits between replaying one command and the next. */
export const batchReplayStepMs = 120;

/** The operation that places a run of tiles as one transaction. */
type PlaceTilesInput = Extract<ProposeEditInput, { op: "placeTiles" }>;

/** The operation that nests a new rule under an existing one. */
type AddChildRuleInput = Extract<ProposeEditInput, { op: "addChildRule" }>;

/** A rule under the id every tool addresses it by. */
interface RuleRef {
  readonly ruleId: string;
  readonly rule: BrainRuleDef;
}

/**
 * Nests a new empty rule under `parent` as its last child. The first execute
 * makes the rule and names it through {@link NestRuleCommand.nestedRule}; every
 * later execute nests that same rule again, so its id survives an undo/redo
 * round trip. A document that cannot hold another level under `parent` leaves
 * nothing behind and names no rule. Undoing takes the rule back out.
 */
class NestRuleCommand implements BrainCommand {
  private insert_?: InsertRuleCommand;
  private indent_?: IndentRuleCommand;
  private nested_?: BrainRuleDef;

  constructor(private readonly parent: BrainRuleDef) {}

  execute(): void {
    if (this.insert_ && this.indent_) {
      this.insert_.execute();
      this.indent_.execute();
      return;
    }

    const insert = new InsertRuleCommand(this.parent, "after");
    insert.execute();
    const inserted = insert.insertedRule();
    if (!inserted) return;

    const indent = new IndentRuleCommand(inserted);
    indent.execute();
    if (inserted.ancestor() !== this.parent) {
      indent.undo();
      insert.undo();
      return;
    }

    this.insert_ = insert;
    this.indent_ = indent;
    this.nested_ = inserted;
  }

  undo(): void {
    this.indent_?.undo();
    this.insert_?.undo();
  }

  /** The rule this command nests, or undefined when the document cannot hold it. */
  nestedRule(): BrainRuleDef | undefined {
    return this.nested_;
  }

  getDescription(): string {
    return "Add child rule";
  }
}

/** The editor commands one proposed edit runs, and the rule its verdict is judged on. */
interface BuiltEdit {
  /** Commands to execute in the order given. */
  readonly commands: readonly BrainCommand[];
  /** The rule the edit affects, read after its commands have run. */
  readonly resolveRule: () => RuleRef | undefined;
  /** What to report when the commands ran but left no rule to judge. */
  readonly absent?: ProposalUnresolved;
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

/** The rule an edit runs against, or `undefined` for an edit that makes its own. */
function editTarget(workspace: AuthoringWorkspace, input: ProposeEditInput): RuleRef | ProposalUnresolved | undefined {
  if (input.op === "addRule") return undefined;
  const named = input.op === "addChildRule" ? input.parentRuleId : input.ruleId;
  const located = findRule(workspace.brainDef, named);
  return located ?? { ok: false, error: "unknown_rule", named };
}

/**
 * Turn one proposed edit into the editor commands that apply it, resolving
 * every tile it names and minting the tiles a factory entry describes. `target`
 * is the rule the edit runs against, absent for an edit that makes its own.
 * Reports what the edit named that the document cannot supply.
 */
function buildEdit(
  workspace: AuthoringWorkspace,
  input: ProposeEditInput,
  target: RuleRef | undefined
): BuiltEdit | ProposalUnresolved {
  if (input.op === "addRule") {
    const page = findPage(workspace.brainDef, input.pageIndex);
    if (!page) return { ok: false, error: "unknown_page", named: String(input.pageIndex) };
    return {
      commands: [new AddRuleCommand(page)],
      resolveRule: () => {
        const rules = page.children();
        const rule = rules.get(rules.size() - 1) as BrainRuleDef;
        return { ruleId: rule.ruleId(), rule };
      },
    };
  }

  const located = target as RuleRef;
  if (input.op === "addChildRule") return nestedEdit(located, input);

  const side = toRuleSide(input.side);
  const tileCount = located.rule.side(side).tiles().size();
  const resolveRule = () => located;

  if (input.op === "deleteTile") {
    if (input.position >= tileCount)
      return { ok: false, error: "position_out_of_range", named: String(input.position) };
    return { commands: [new RemoveTileCommand(located.rule, side, input.position)], resolveRule };
  }

  if (input.op === "placeTiles") return tileRunEdit(workspace, input, located, side, tileCount);

  const tile = resolveRunEntry(workspace, input.tileId);
  if ("ok" in tile) return tile;

  if (input.op === "replaceTile") {
    if (input.position >= tileCount)
      return { ok: false, error: "position_out_of_range", named: String(input.position) };
    return { commands: [new ReplaceTileCommand(located.rule, side, input.position, tile)], resolveRule };
  }

  const position = input.position ?? tileCount;
  if (position > tileCount) return { ok: false, error: "position_out_of_range", named: String(position) };
  return { commands: [placementCommand(located.rule, side, position, tileCount, tile)], resolveRule };
}

/** The edit that nests a new rule under `parent`. */
function nestedEdit(parent: RuleRef, input: AddChildRuleInput): BuiltEdit {
  const command = new NestRuleCommand(parent.rule);
  return {
    commands: [command],
    resolveRule: () => {
      const nested = command.nestedRule();
      return nested ? { ruleId: nested.ruleId(), rule: nested } : undefined;
    },
    absent: { ok: false, error: "rule_nesting_too_deep", named: input.parentRuleId },
  };
}

/**
 * The edit that places a run of tiles from `position` in the order given. Every
 * entry resolves before any command is built, so a run naming a tile the
 * document cannot supply builds nothing.
 */
function tileRunEdit(
  workspace: AuthoringWorkspace,
  input: PlaceTilesInput,
  located: RuleRef,
  side: RuleSide,
  tileCount: number
): BuiltEdit | ProposalUnresolved {
  const position = input.position ?? tileCount;
  if (position > tileCount) return { ok: false, error: "position_out_of_range", named: String(position) };

  const tiles: IBrainTileDef[] = [];
  for (const entry of input.tileIds) {
    const tile = resolveRunEntry(workspace, entry);
    if ("ok" in tile) return tile;
    tiles.push(tile);
  }

  // Each tile lands past the ones before it, so the run reads in the order given.
  const commands = tiles.map((tile, index) =>
    placementCommand(located.rule, side, position + index, tileCount + index, tile)
  );
  return { commands, resolveRule: () => located };
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

/**
 * Every parse and type diagnostic `rule`'s own typecheck reported, for the whole
 * rule, each addressed to the rule that reported it.
 */
function ruleDiagnostics(rule: BrainRuleDef): ToolDiagnostic[] {
  // Both sides hold the same whole-rule typecheck result.
  const result = rule.when().typecheckResult();
  if (!result) return [];
  const noRuleIds = new Map<string, string>();
  const ruleId = rule.ruleId();
  const diagnostics: ToolDiagnostic[] = [];
  const addressed = (diagnostic: ToolDiagnostic): ToolDiagnostic => ({
    code: diagnostic.code,
    params: { ...diagnostic.params, ruleId },
  });
  result.parseResult.diags.forEach((diag) => {
    diagnostics.push(addressed(toToolDiagnostic(diag.code, diag.params, noRuleIds)));
  });
  result.typeInfo.diags.forEach((diag) => {
    diagnostics.push(addressed(toToolDiagnostic(diag.code, diag.params, noRuleIds)));
  });
  return diagnostics;
}

/**
 * Whole-brain build diagnostics that bear on an edit: every error, plus any
 * other diagnostic naming one of the rules in `ruleIds`. Pass an empty set for
 * an edit whose rule the document does not hold yet.
 */
function buildDiagnostics(workspace: AuthoringWorkspace, ruleIds: ReadonlySet<string>): ToolDiagnostic[] {
  const build = workspace.environment.linkBrain(workspace.brainDef);
  const byPath = ruleIdsByPath(workspace.brainDef);
  const diagnostics: ToolDiagnostic[] = [];
  build.diagnostics.forEach((diag) => {
    const diagnostic = toToolDiagnostic(diag.code, diag.params, byPath);
    const named = diagnostic.params?.ruleId;
    if (diag.severity === "error" || (typeof named === "string" && ruleIds.has(named))) {
      diagnostics.push(diagnostic);
    }
  });
  return diagnostics;
}

/**
 * Every diagnostic the document reports that bears on an edit to `rules`: each
 * of those rules' own typecheck, and the whole-brain build.
 */
function proposalDiagnostics(workspace: AuthoringWorkspace, rules: readonly RuleRef[]): ToolDiagnostic[] {
  const diagnostics: ToolDiagnostic[] = [];
  const ruleIds = new Set<string>();
  for (const { ruleId, rule } of rules) {
    rule.typecheck();
    ruleIds.add(ruleId);
    diagnostics.push(...ruleDiagnostics(rule));
  }
  return [...diagnostics, ...buildDiagnostics(workspace, ruleIds)];
}

/** The key a diagnostic is counted under: its code, and the durable id of the rule it names. */
function diagnosticKey(diagnostic: ToolDiagnostic): string {
  const ruleId = diagnostic.params?.ruleId;
  return `${diagnostic.code}@${typeof ruleId === "string" ? ruleId : ""}`;
}

/** How many diagnostics of each key `diagnostics` holds. */
function countByKey(diagnostics: readonly ToolDiagnostic[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const diagnostic of diagnostics) {
    const key = diagnosticKey(diagnostic);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * The rejection-relevant diagnostics an edit introduced: those whose
 * `(code, ruleId)` key the document reports more often after the edit than
 * before it. A diagnostic already standing in the document, in any rule and at
 * any severity, is not one of these, so an edit that leaves the document no
 * worse carries none. An edit that removes diagnostics without adding any
 * carries none either.
 */
function newDiagnostics(before: readonly ToolDiagnostic[], after: readonly ToolDiagnostic[]): ToolDiagnostic[] {
  const beforeCounts = countByKey(before);
  const seen = new Map<string, number>();
  const introduced: ToolDiagnostic[] = [];
  for (const diagnostic of after) {
    const key = diagnosticKey(diagnostic);
    const index = (seen.get(key) ?? 0) + 1;
    seen.set(key, index);
    if (index > (beforeCounts.get(key) ?? 0)) introduced.push(diagnostic);
  }
  return introduced;
}

/** The refusal the proposal policy produces for `rules` as they stand, or undefined when it accepts them. */
function refusalFor(
  workspace: AuthoringWorkspace,
  rules: readonly RuleRef[],
  before: readonly ToolDiagnostic[]
): ProposalRejected | undefined {
  const introduced = newDiagnostics(before, proposalDiagnostics(workspace, rules));
  const decision = decideProposal(introduced);
  if (decision.verdict === "accept") return undefined;
  const rejection = decision.rejectedBy!;
  return {
    ok: false,
    code: rejection.code,
    params: rejectionParams(rejection, introduced, rules[0]?.ruleId ?? ""),
  };
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
 * state, so a sequence of commands is judged once, by what it leaves behind,
 * and only against the diagnostics the edit introduced over `before`.
 */
function decideApplied(
  workspace: AuthoringWorkspace,
  located: RuleRef,
  before: readonly ToolDiagnostic[],
  transaction: EditTransaction
): ProposalResult {
  const refusal = refusalFor(workspace, [located], before);
  if (refusal) {
    transaction.takeBack();
    return refusal;
  }

  transaction.keep();
  return {
    ok: true,
    rule: readRule(located.rule, workspace.environment.appServices.localizer),
    historyDepth: workspace.history.undoDepth(),
  };
}

/**
 * Run one proposed edit through the editor's own command and validation path.
 * An accepted edit stays in the document as an undoable history entry; a
 * rejected edit is undone before returning, so the document rests exactly as it
 * did before the call. A tile the edit minted is registered in the document's
 * catalog as it resolves and is dropped again if the edit does not land.
 * `placeTiles` applies its whole run as one transaction and one history entry.
 */
export function proposeEdit(workspace: AuthoringWorkspace, input: ProposeEditInput): ProposalResult {
  const target = editTarget(workspace, input);
  if (target && "ok" in target) return target;

  // A rule the edit has yet to make cannot be named by any diagnostic.
  const before = target ? proposalDiagnostics(workspace, [target]) : buildDiagnostics(workspace, new Set<string>());

  const catalog = workspace.brainDef.catalog();
  const registeredBefore = catalogTileIds(catalog);
  const built = buildEdit(workspace, input, target);
  if ("ok" in built) {
    dropTilesRegisteredSince(catalog, registeredBefore);
    return built;
  }

  const runs = input.op === "placeTiles";
  if (runs)
    workspace.history.beginBatch(built.commands.length === 1 ? "Place tile" : `Place ${built.commands.length} tiles`);
  for (const command of built.commands) workspace.history.executeCommand(command);

  const takeBack = () => {
    if (runs) workspace.history.abortBatch();
    else workspace.history.undo();
    dropTilesRegisteredSince(catalog, registeredBefore);
  };

  const located = built.resolveRule();
  if (!located) {
    takeBack();
    return built.absent as ProposalUnresolved;
  }

  return decideApplied(workspace, located, before, {
    keep: () => {
      if (runs) workspace.history.endBatch();
    },
    takeBack,
  });
}

/** Resolve once `ms` milliseconds have passed. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The rule a batch command names: the document's own rule under a durable id,
 * or the rule the batch's earlier command at `#N` made. Reports
 * `unknown_batch_reference` for an index no earlier command of the batch
 * created a rule at.
 */
function batchTarget(
  workspace: AuthoringWorkspace,
  input: ProposeEditInput,
  made: ReadonlyMap<number, RuleRef>
): RuleRef | ProposalUnresolved | undefined {
  if (input.op === "addRule") return undefined;
  const named = input.op === "addChildRule" ? input.parentRuleId : input.ruleId;
  const index = batchRuleIndex(named);
  if (index === undefined) return editTarget(workspace, input);
  return made.get(index) ?? { ok: false, error: "unknown_batch_reference", named };
}

/** Every rule the batch's commands name that the document already holds. */
function standingRules(workspace: AuthoringWorkspace, input: ProposeEditBatchInput): RuleRef[] {
  const rules: RuleRef[] = [];
  const seen = new Set<string>();
  for (const command of input.commands) {
    if (command.op === "addRule") continue;
    const named = command.op === "addChildRule" ? command.parentRuleId : command.ruleId;
    if (batchRuleIndex(named) !== undefined || seen.has(named)) continue;
    seen.add(named);
    const located = findRule(workspace.brainDef, named);
    if (located) rules.push(located);
  }
  return rules;
}

/** The rules a batch is judged on: those it named and those it made, each once. */
function judgedRules(standing: readonly RuleRef[], touched: readonly RuleRef[]): RuleRef[] {
  const judged: RuleRef[] = [...standing];
  const seen = new Set(standing.map((located) => located.ruleId));
  for (const located of touched) {
    if (seen.has(located.ruleId)) continue;
    seen.add(located.ruleId);
    judged.push(located);
  }
  return judged;
}

/**
 * Apply a batch of proposed edits as one thing. The commands run in the order
 * given, states in the middle are not judged, and the policy reads only the
 * state the whole run leaves. A batch that is refused leaves the document, the
 * history, and the catalog exactly as they stood; a batch that is accepted
 * replays its commands into the document one at a time, {@link batchReplayStepMs}
 * apart, and closes as a single undoable history entry, so the call returns once
 * the document holds the state that was judged.
 *
 * Reports the index of the command that named something the document cannot
 * supply.
 */
export async function proposeEditBatch(
  workspace: AuthoringWorkspace,
  input: ProposeEditBatchInput
): Promise<BatchResult> {
  const catalog = workspace.brainDef.catalog();
  const registeredBefore = catalogTileIds(catalog);
  const standing = standingRules(workspace, input);
  const before = proposalDiagnostics(workspace, standing);

  const applied: BrainCommand[] = [];
  const touched: RuleRef[] = [];
  const made = new Map<number, RuleRef>();
  const undoApplied = () => {
    for (let i = applied.length - 1; i >= 0; i--) applied[i]?.undo();
  };
  const rollBack = () => {
    undoApplied();
    dropTilesRegisteredSince(catalog, registeredBefore);
  };

  for (const [index, command] of input.commands.entries()) {
    const target = batchTarget(workspace, command, made);
    if (target && "ok" in target) {
      rollBack();
      return { ...target, commandIndex: index };
    }

    const built = buildEdit(workspace, command, target);
    if ("ok" in built) {
      rollBack();
      return { ...built, commandIndex: index };
    }

    for (const editorCommand of built.commands) {
      editorCommand.execute();
      applied.push(editorCommand);
    }

    const located = built.resolveRule();
    if (!located) {
      rollBack();
      return { ...(built.absent as ProposalUnresolved), commandIndex: index };
    }
    if (command.op === "addRule" || command.op === "addChildRule") made.set(index, located);
    touched.push(located);
  }

  const refusal = refusalFor(workspace, judgedRules(standing, touched), before);
  // Every command comes back out either way: a refused batch leaves nothing
  // behind, and an accepted one is replayed a command at a time.
  undoApplied();
  if (refusal) {
    dropTilesRegisteredSince(catalog, registeredBefore);
    return refusal;
  }

  workspace.history.beginBatch(`Apply ${input.commands.length} edits`);
  for (const [index, command] of applied.entries()) {
    if (index > 0) await pause(batchReplayStepMs);
    workspace.history.executeCommand(command);
  }
  workspace.history.endBatch();

  const localizer = workspace.environment.appServices.localizer;
  return {
    ok: true,
    rules: touched.map((located) => readRule(located.rule, localizer)),
    historyDepth: workspace.history.undoDepth(),
  };
}
