import type { ProjectPageRef, ProjectRule, ProjectTile } from "@wendoo/assistant-bridge";
import type { ConversationRecord, ConversationToolCall, ConversationTurnStep } from "@wendoo/assistant-relay";
import type { ToolActivity } from "./activity";
import { toolActivity } from "./activity";
import { callIdentity } from "./call-identity";
import type { EditStoryRow } from "./edit-story";
import { editCommands, editStoryRow } from "./edit-story";
import type { RefusedProposal } from "./tool-payloads";
import { asProjectRule, compiledClean, landedCommands, refusedProposal, tileLabels } from "./tool-payloads";

/** What one block of a turn stands for. */
export const ConversationBlockKind = {
  /** A run of the entity's own words. */
  Narration: "narration",
  /** The edits that landed on one page, and the story of how they got there. */
  Receipt: "receipt",
  /** A proposal the editor refused, and what it was refused for. */
  Snag: "snag",
  /** Everything the turn looked at without changing, gathered under one fold. */
  Lookups: "lookups",
} as const;

/** What one block of a turn stands for. */
export type ConversationBlockKind = (typeof ConversationBlockKind)[keyof typeof ConversationBlockKind];

/** One rule a receipt shows, at the depth it stands in the document. */
export interface ReceiptRule {
  readonly ruleId: string;
  /** Rules it is nested under; `0` for a rule standing on the page itself. */
  readonly depth: number;
  readonly when: readonly ProjectTile[];
  readonly do: readonly ProjectTile[];
}

/** A run of the entity's own words, exactly as it narrated them. */
export interface NarrationBlock {
  readonly kind: typeof ConversationBlockKind.Narration;
  readonly text: string;
}

/** Every edit of a turn that landed on one page, with the rules they left standing. */
export interface ReceiptBlock {
  readonly kind: typeof ConversationBlockKind.Receipt;
  /** The page these edits landed on; absent for edits that reported none. */
  readonly page?: ProjectPageRef;
  /** The rules the edits left standing, in the order the turn first touched them. */
  readonly rules: readonly ReceiptRule[];
  /** One row per editor command, in the order the commands ran. */
  readonly story: readonly EditStoryRow[];
  /** Whether a clean build has since verified the brain these edits are part of. */
  readonly compiles: boolean;
}

/** One proposal the editor refused, and every later proposal that asked for the very same thing. */
export interface SnagBlock {
  readonly kind: typeof ConversationBlockKind.Snag;
  /** Stable diagnostic code the edit was refused under. */
  readonly code: number;
  /** Durable id of the rule the refusal was about; absent when it named none. */
  readonly ruleId?: string;
  /** The tile the refusal was about; absent when neither the diagnostic nor the proposal named one. */
  readonly tileId?: string;
  /** The word {@link SnagBlock.tileId} reads by; absent while no payload has named that tile. */
  readonly tileLabel?: string;
  /** Everything the rejecting diagnostic reported, keyed as the bridge serialized it. */
  readonly params: RefusedProposal["params"];
  /** Proposals asking for the very same thing that were refused this same way. */
  readonly repeats: number;
}

/** One thing a turn looked at, or one call that never ran. */
export interface LookupStep {
  /** Bridge tool name, as the model produced it. */
  readonly name: string;
  /** What the call did, for the reader. */
  readonly text: string;
  /** Calls asking for the very same thing that this row stands for. */
  readonly repeats: number;
}

/** A lookup row being gathered, before it knows how many calls it stands for. */
interface LookupDraft {
  readonly name: string;
  readonly text: string;
  repeats: number;
}

/** Everything a turn did that changed nothing, gathered under one fold. */
export interface LookupsBlock {
  readonly kind: typeof ConversationBlockKind.Lookups;
  readonly steps: readonly LookupStep[];
}

/** One block of a turn, as the transcript lays it out. */
export type ConversationBlock = NarrationBlock | ReceiptBlock | SnagBlock | LookupsBlock;

/**
 * What a turn's blocks are read against: everything the conversation as a whole
 * has already said about the tiles and the shape of the document. It spans
 * every turn, so a turn reads tiles a much earlier turn looked up.
 */
export interface TranscriptContext {
  /** The word each tile reads by, keyed by tile id. */
  readonly labels: ReadonlyMap<string, string>;
  /** The rule each nested rule stands under, keyed by the nested rule's durable id. */
  readonly parentOf: ReadonlyMap<string, string>;
}

/** Rules a nesting walk follows before it calls the document circular. */
const maxRuleDepth = 32;

/** Record every rule nested under `rule`, however deep, in `parentOf`. */
function collectNesting(rule: ProjectRule, parentOf: Map<string, string>): void {
  for (const child of rule.children) {
    parentOf.set(child.ruleId, rule.ruleId);
    collectNesting(child, parentOf);
  }
}

/** Every tool call the conversation has carried, in the order they were made. */
function toolCalls(record: ConversationRecord | undefined): ConversationToolCall[] {
  const calls: ConversationToolCall[] = [];
  for (const entry of record?.entries ?? []) {
    if (entry.kind !== "assistant") continue;
    for (const step of entry.steps) {
      if (step.kind === "toolCall") calls.push(step.call);
    }
  }
  return calls;
}

/**
 * Read `record` for what every turn in it needs to lay its blocks out: the word
 * each tile reads by, and which rules stand under which. Build it once for a
 * record and hand the same context to each of its turns. A conversation the
 * host has not named a brain for yet has none, and comes back empty.
 */
export function transcriptContext(record: ConversationRecord | undefined): TranscriptContext {
  const calls = toolCalls(record);
  const parentOf = new Map<string, string>();
  for (const call of calls) {
    if (call.outcome.kind === "ok" && call.outcome.isError !== true) {
      for (const page of asPages(call.outcome.payload)) {
        for (const rule of page) collectNesting(rule, parentOf);
      }
    }
    const landed = landedCommands(call);
    if (!landed) continue;
    const commands = editCommands(call.input);
    for (const [at, outcome] of landed.entries()) {
      if (outcome.rule) collectNesting(outcome.rule, parentOf);
      const parentRuleId = (commands[at] as { op?: unknown; parentRuleId?: unknown } | undefined)?.parentRuleId;
      // A batch may name its parent as "#N", which no durable id answers to.
      if (outcome.rule && typeof parentRuleId === "string" && !parentRuleId.startsWith("#")) {
        parentOf.set(outcome.rule.ruleId, parentRuleId);
      }
    }
  }
  return { labels: tileLabels(calls), parentOf };
}

/** The rule runs `payload` holds as a document read back, page by page. */
function asPages(payload: unknown): ProjectRule[][] {
  if (typeof payload !== "object" || payload === null) return [];
  const pages = (payload as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return [];
  const read: ProjectRule[][] = [];
  for (const page of pages) {
    const rules = (page as { rules?: unknown } | null)?.rules;
    if (!Array.isArray(rules)) continue;
    read.push(rules.map((rule) => asProjectRule(rule)).filter((rule): rule is ProjectRule => rule !== undefined));
  }
  return read;
}

/** How many rules `ruleId` stands under, counted through `parentOf`. */
function ruleDepth(ruleId: string, parentOf: ReadonlyMap<string, string>): number {
  let depth = 0;
  let at = ruleId;
  const seen = new Set<string>([at]);
  while (depth < maxRuleDepth) {
    const parent = parentOf.get(at);
    if (parent === undefined || seen.has(parent)) return depth;
    seen.add(parent);
    at = parent;
    depth++;
  }
  return depth;
}

/** The tile id one editor command names, reading a factory entry as the tile it mints from. */
function namedTileId(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (typeof entry !== "object" || entry === null) return undefined;
  const tileId = (entry as { tileId?: unknown }).tileId;
  return typeof tileId === "string" ? tileId : undefined;
}

/**
 * The tile a refused proposal was about: the one its rejecting diagnostic
 * pinned, and otherwise the last tile the proposal itself named.
 */
function offendingTileId(refused: RefusedProposal, input: unknown): string | undefined {
  const pinned = refused.params.tileId;
  if (typeof pinned === "string") return pinned;
  const commands = editCommands(input);
  for (let at = commands.length - 1; at >= 0; at--) {
    const command = commands[at] as { tileId?: unknown; tileIds?: unknown };
    const run = Array.isArray(command.tileIds) ? command.tileIds : undefined;
    const named = namedTileId(run ? run[run.length - 1] : command.tileId);
    if (named !== undefined) return named;
  }
  return undefined;
}

/** A receipt being gathered, before its rules are laid out in order. */
interface ReceiptDraft {
  readonly kind: typeof ConversationBlockKind.Receipt;
  page?: ProjectPageRef;
  readonly rules: Map<string, ProjectRule>;
  readonly story: EditStoryRow[];
  compiles: boolean;
}

/** A snag being gathered, before it knows how many proposals it stands for. */
interface SnagDraft {
  readonly kind: typeof ConversationBlockKind.Snag;
  readonly code: number;
  readonly ruleId?: string;
  readonly tileId?: string;
  readonly tileLabel?: string;
  readonly params: RefusedProposal["params"];
  repeats: number;
}

/** One block while a turn is still being read. */
type BlockDraft = NarrationBlock | ReceiptDraft | SnagDraft;

/** The key a receipt gathers under: the page its edits landed on, and `""` for edits that named none. */
function receiptKey(page: ProjectPageRef | undefined): string {
  return page?.pageId ?? "";
}

/** `draft` as the receipt the transcript renders, with its rules laid out at the depth each stands. */
function laidOutReceipt(draft: ReceiptDraft, parentOf: ReadonlyMap<string, string>): ReceiptBlock {
  const rules: ReceiptRule[] = [...draft.rules.values()].map((rule) => ({
    ruleId: rule.ruleId,
    depth: ruleDepth(rule.ruleId, parentOf),
    when: rule.when,
    do: rule.do,
  }));
  return {
    kind: ConversationBlockKind.Receipt,
    ...(draft.page ? { page: draft.page } : {}),
    rules,
    story: draft.story,
    compiles: draft.compiles,
  };
}

/**
 * Lay one turn out as the blocks the transcript draws: its narration in the
 * order it arrived, one receipt per page its accepted edits landed on, one snag
 * per way a proposal was refused, and one fold gathering everything it looked at
 * without changing.
 *
 * A receipt stands where the turn first touched its page and gathers every later
 * edit to that page. A snag stands where the turn was first refused that way and
 * counts every later proposal asking for the very same thing, however much
 * narration falls between them. A clean build marks every receipt the turn has
 * opened by then.
 */
export function conversationBlocks(
  steps: readonly ConversationTurnStep[],
  context: TranscriptContext
): readonly ConversationBlock[] {
  const drafts: BlockDraft[] = [];
  const receipts = new Map<string, ReceiptDraft>();
  const snags = new Map<string, SnagDraft>();
  const lookups: LookupDraft[] = [];
  const lookupsById = new Map<string, LookupDraft>();

  const noteLookup = (call: ConversationToolCall, activity: ToolActivity): void => {
    const identity = callIdentity(call.name, call.input);
    const seen = lookupsById.get(identity);
    if (seen) {
      seen.repeats++;
      return;
    }
    const step: LookupDraft = { name: call.name, text: activity.text, repeats: 1 };
    lookupsById.set(identity, step);
    lookups.push(step);
  };

  const gather = (call: ConversationToolCall): void => {
    const landed = landedCommands(call);
    if (landed) {
      const commands = editCommands(call.input);
      for (const [at, outcome] of landed.entries()) {
        const key = receiptKey(outcome.onPage);
        let receipt = receipts.get(key);
        if (!receipt) {
          receipt = {
            kind: ConversationBlockKind.Receipt,
            ...(outcome.onPage ? { page: outcome.onPage } : {}),
            rules: new Map(),
            story: [],
            compiles: false,
          };
          receipts.set(key, receipt);
          drafts.push(receipt);
        }
        const row = editStoryRow(commands[at], outcome);
        if (row) receipt.story.push(row);
        if (!outcome.rule) continue;
        if (outcome.removed === "rule") receipt.rules.delete(outcome.rule.ruleId);
        else receipt.rules.set(outcome.rule.ruleId, outcome.rule);
      }
      return;
    }

    const refused = refusedProposal(call);
    if (refused) {
      const identity = callIdentity(call.name, call.input);
      const seen = snags.get(identity);
      if (seen) {
        seen.repeats++;
        return;
      }
      const ruleId = refused.params.ruleId;
      const tileId = offendingTileId(refused, call.input);
      const tileLabel = tileId === undefined ? undefined : context.labels.get(tileId);
      const snag: SnagDraft = {
        kind: ConversationBlockKind.Snag,
        code: refused.code,
        ...(typeof ruleId === "string" ? { ruleId } : {}),
        ...(tileId === undefined ? {} : { tileId }),
        ...(tileLabel === undefined ? {} : { tileLabel }),
        params: refused.params,
        repeats: 1,
      };
      snags.set(identity, snag);
      drafts.push(snag);
      return;
    }

    if (compiledClean(call)) {
      for (const receipt of receipts.values()) receipt.compiles = true;
      return;
    }

    noteLookup(call, toolActivity(call));
  };

  for (const step of steps) {
    if (step.kind === "narration") {
      drafts.push({ kind: ConversationBlockKind.Narration, text: step.text });
      continue;
    }
    gather(step.call);
  }

  const blocks: ConversationBlock[] = drafts.map((draft) =>
    draft.kind === ConversationBlockKind.Receipt
      ? laidOutReceipt(draft, context.parentOf)
      : draft.kind === ConversationBlockKind.Snag
        ? {
            kind: ConversationBlockKind.Snag,
            code: draft.code,
            ...(draft.ruleId === undefined ? {} : { ruleId: draft.ruleId }),
            ...(draft.tileId === undefined ? {} : { tileId: draft.tileId }),
            ...(draft.tileLabel === undefined ? {} : { tileLabel: draft.tileLabel }),
            params: draft.params,
            repeats: draft.repeats,
          }
        : draft
  );
  if (lookups.length > 0) blocks.push({ kind: ConversationBlockKind.Lookups, steps: lookups });
  return blocks;
}
