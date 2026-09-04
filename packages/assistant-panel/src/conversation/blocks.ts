import type { ProjectPageRef, ProjectRule, ProjectTile } from "@wendoo/assistant-bridge";
import type {
  ConversationRecord,
  ConversationToolCall,
  ConversationTurnStep,
  NarrationJudgment,
  NarrationRole,
} from "@wendoo/assistant-relay";
import { NarrationRole as RoleCode } from "@wendoo/assistant-relay";
import { RuleTriggerMode } from "@wendoo/core/brain";
import { callIdentity } from "./call-identity";
import type { EditStoryRow } from "./edit-story";
import { editCommands, editStoryRow } from "./edit-story";
import type { RunEvidence } from "./run";
import { runEvidence } from "./run";
import type { BuildDiagnostic, RefusedProposal } from "./tool-payloads";
import {
  asProjectRule,
  compiledClean,
  dirtyBuild,
  landedCommands,
  offeredLibraries,
  refusedProposal,
  tileLabels,
} from "./tool-payloads";

/** What one block of a turn stands for. */
export const ConversationBlockKind = {
  /** A run of the assistant's own words. */
  Narration: "narration",
  /** The edits that landed on one page, and the story of how they got there. */
  Receipt: "receipt",
  /** A proposal the editor refused, and what it was refused for. */
  Snag: "snag",
  /** One rehearsal the turn asked for, and what it did think by think. */
  Run: "run",
  /** A build that came back dirty, and everything it reported. */
  Build: "build",
  /** The libraries the turn offered, as the cards they are added from. */
  Offer: "offer",
} as const;

/** What one block of a turn stands for. */
export type ConversationBlockKind = (typeof ConversationBlockKind)[keyof typeof ConversationBlockKind];

/** One rule a receipt shows, at the depth it stands in the document. */
export interface ReceiptRule {
  readonly ruleId: string;
  /** Rules it is nested under; `0` for a rule standing on the page itself. */
  readonly depth: number;
  /** What arms the rule, `when` for a rule no payload gave a mode. */
  readonly trigger: RuleTriggerMode;
  readonly when: readonly ProjectTile[];
  readonly do: readonly ProjectTile[];
}

/** A run of the assistant's own words, exactly as it narrated them. */
export interface NarrationBlock {
  readonly kind: typeof ConversationBlockKind.Narration;
  /** The headline the run opens with, which the transcript always shows. */
  readonly text: string;
  /** The longer form standing under {@link NarrationBlock.text}; absent when the run had none. */
  readonly body?: string;
  /** What this run is doing; absent where the service could not tell. */
  readonly role?: NarrationRole;
  /** How the rehearsal went; present only when {@link NarrationBlock.role} is `verdict`. */
  readonly judgment?: NarrationJudgment;
  /** `true` when a later plan in the same turn stands in this one's place. */
  readonly superseded: boolean;
  /** `true` when this note took the place of the diagnosis that went looking for it. */
  readonly converted?: true;
  /**
   * What a question to the person said in the plain lines under it, standing
   * open on its card above the answers. Present only on a run whose role is
   * `ask`, and absent where the question carried the answers alone.
   */
  readonly said?: string;
  /**
   * The answers a question to the person offers, one per list-marked line that
   * stood under it. Present only on a run whose role is `ask`, and absent where
   * the question offered none.
   */
  readonly answers?: readonly string[];
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
  /** What the assistant said the refusal was; absent while it has said nothing about it. */
  readonly caption?: string;
  /** The longer form standing under {@link SnagBlock.caption}; absent when it had none. */
  readonly captionBody?: string;
}

/** One rehearsal a turn asked for, and what the run did. */
export interface RunBlock {
  readonly kind: typeof ConversationBlockKind.Run;
  readonly run: RunEvidence;
  /** `true` when a later rehearsal in the same turn stands in this one's place. */
  readonly superseded: boolean;
  /**
   * How the assistant judged this rehearsal, taken from the verdict it narrated
   * next. Absent until it has judged one.
   */
  readonly judgment?: NarrationJudgment;
}

/** One way a build came back dirty, and every later build that came back the very same way. */
export interface BuildBlock {
  readonly kind: typeof ConversationBlockKind.Build;
  /** Everything the build reported, in report order. */
  readonly diagnostics: readonly BuildDiagnostic[];
  /** How many of {@link BuildBlock.diagnostics} are what stops the brain building. */
  readonly errors: number;
  /** Builds that came back reporting the very same things. */
  readonly repeats: number;
}

/** Every library one turn offered, in the order it offered them. */
export interface OfferBlock {
  readonly kind: typeof ConversationBlockKind.Offer;
  /** The `<owner>/<repo>` coordinate of each library offered, each named once. */
  readonly coordinates: readonly string[];
}

/** One block of a turn, as the transcript lays it out. */
export type ConversationBlock = NarrationBlock | ReceiptBlock | SnagBlock | RunBlock | BuildBlock | OfferBlock;

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
  /**
   * The name each page reads by, keyed by the position it stands at. A run
   * names the pages it moved between by position, so a page renamed or moved
   * since is read under the last name the conversation saw at that position.
   */
  readonly pageNames: ReadonlyMap<number, string>;
  /** Each page the conversation has seen, keyed by its durable id. */
  readonly pages: ReadonlyMap<string, ProjectPageRef>;
  /**
   * The position each rule stands at on its page, counting the rules nested
   * under others in the same sequence. A rule the conversation has only ever
   * seen through an edit, never in a document read back, is absent.
   */
  readonly ruleLines: ReadonlyMap<string, number>;
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
export function recordToolCalls(record: ConversationRecord | undefined): ConversationToolCall[] {
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
  const calls = recordToolCalls(record);
  const parentOf = new Map<string, string>();
  const pageNames = new Map<number, string>();
  const pages = new Map<string, ProjectPageRef>();
  const ruleLines = new Map<string, number>();
  for (const call of calls) {
    if (call.outcome.kind === "ok" && call.outcome.isError !== true) {
      for (const read of asPages(call.outcome.payload)) {
        for (const rule of read.rules) collectNesting(rule, parentOf);
        collectRuleLines(read.rules, ruleLines);
        if (read.page) pages.set(read.page.pageId, read.page);
      }
      collectPageNames(call.outcome.payload, pageNames);
    }
    const landed = landedCommands(call);
    if (!landed) continue;
    const commands = editCommands(call.input);
    for (const [at, outcome] of landed.entries()) {
      if (outcome.rule) collectNesting(outcome.rule, parentOf);
      if (outcome.onPage) pages.set(outcome.onPage.pageId, outcome.onPage);
      if (outcome.page) pages.set(outcome.page.pageId, outcome.page);
      const parentRuleId = (commands[at] as { op?: unknown; parentRuleId?: unknown } | undefined)?.parentRuleId;
      // A batch may name its parent as "#N", which no durable id answers to.
      if (outcome.rule && typeof parentRuleId === "string" && !parentRuleId.startsWith("#")) {
        parentOf.set(outcome.rule.ruleId, parentRuleId);
      }
    }
  }
  return { labels: tileLabels(calls), parentOf, pageNames, pages, ruleLines };
}

/** Record the position each of `rules` stands at on its page in `into`, counting the rules nested under others. */
function collectRuleLines(rules: readonly ProjectRule[], into: Map<string, number>): void {
  let line = 1;
  const walk = (rule: ProjectRule): void => {
    into.set(rule.ruleId, line++);
    for (const child of rule.children) walk(child);
  };
  for (const rule of rules) walk(rule);
}

/** Record the name of every page `value` names, however deeply, in `into`, latest naming winning. */
function collectPageNames(value: unknown, into: Map<number, string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectPageNames(entry, into);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const held = value as { pageIndex?: unknown; name?: unknown };
  if (typeof held.pageIndex === "number" && typeof held.name === "string") into.set(held.pageIndex, held.name);
  for (const entry of Object.values(value)) collectPageNames(entry, into);
}

/** One page of a document read back: the page itself, and the rules standing on it. */
interface ReadPage {
  /** The page these rules stand on; absent when the read named none. */
  readonly page?: ProjectPageRef;
  readonly rules: readonly ProjectRule[];
}

/** The pages `payload` holds as a document read back, each with the rules on it. */
function asPages(payload: unknown): ReadPage[] {
  if (typeof payload !== "object" || payload === null) return [];
  const pages = (payload as { pages?: unknown }).pages;
  if (!Array.isArray(pages)) return [];
  const read: ReadPage[] = [];
  for (const page of pages) {
    const held = page as { rules?: unknown; pageId?: unknown; pageIndex?: unknown; name?: unknown } | null;
    if (!Array.isArray(held?.rules)) continue;
    const named =
      typeof held.pageId === "string" && typeof held.pageIndex === "number" && typeof held.name === "string"
        ? { pageId: held.pageId, pageIndex: held.pageIndex, name: held.name }
        : undefined;
    read.push({
      ...(named ? { page: named } : {}),
      rules: held.rules.map((rule) => asProjectRule(rule)).filter((rule): rule is ProjectRule => rule !== undefined),
    });
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
  caption?: string;
  captionBody?: string;
}

/** A run card being gathered, before it knows whether a later run stands in its place. */
interface RunDraft {
  readonly kind: typeof ConversationBlockKind.Run;
  readonly run: RunEvidence;
  superseded: boolean;
  judgment?: NarrationJudgment;
}

/** A run of the assistant's words being gathered, before what it said next has been read. */
interface NarrationDraft {
  readonly kind: typeof ConversationBlockKind.Narration;
  text: string;
  body?: string;
  role?: NarrationRole;
  judgment?: NarrationJudgment;
  superseded: boolean;
  converted?: true;
  said?: string;
  answers?: readonly string[];
}

/** A dirty build being gathered, before it knows how many builds it stands for. */
interface BuildDraft {
  readonly kind: typeof ConversationBlockKind.Build;
  readonly diagnostics: readonly BuildDiagnostic[];
  readonly errors: number;
  repeats: number;
}

/** One block while a turn is still being read. */
type BlockDraft = NarrationDraft | ReceiptDraft | SnagDraft | RunDraft | BuildDraft | OfferBlock;

/**
 * Turn `diagnosis` into the note `resolution` states: the lesson becomes the
 * headline the card shows, and the finding the diagnosis opened with joins the
 * investigation under it as the long story.
 */
function convertToNote(diagnosis: NarrationDraft, resolution: NarrationDraft): void {
  const story = [diagnosis.text, diagnosis.body, resolution.body].filter(
    (part): part is string => part !== undefined && part.length > 0
  );
  diagnosis.role = RoleCode.Note;
  diagnosis.judgment = undefined;
  diagnosis.text = resolution.text;
  diagnosis.body = story.length > 0 ? story.join("\n\n") : undefined;
  diagnosis.converted = true;
}

/** Matches the list marker a line may open with, which is no part of the answer it carries. */
const listMarker = /^\s*(?:[-*]|\d{1,9}\.)\s+/;

/** Every line of `text` that carries anything, each trimmed of the space around it. */
function spokenLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** A question to the person as it is put to them: what is asked, said, and offered under it. */
export interface AskOffer {
  /** The question itself, which is the first line the run carries. */
  readonly asked: string;
  /** What the run said in plain lines under the question, kept as its own paragraphs; absent when it said nothing. */
  readonly said?: string;
  /** The answers offered under it, one per list-marked line, each read without its marker. */
  readonly answers: readonly string[];
}

/**
 * The question a run of words carrying `text` and `body` puts to the person: its
 * first line is asked, every list-marked line under it is one of the answers it
 * offers, and every plain line under it is something it said on the way. The
 * lines are read from the whole of the run, headline and body alike; a blank
 * line between the question and its answers means nothing here. A run carrying
 * no line with anything on it asks nothing, and comes back `undefined`.
 */
export function askOffer(text: string, body: string | undefined): AskOffer | undefined {
  const [asked, ...offered] = spokenLines(body === undefined ? text : `${text}\n${body}`);
  if (asked === undefined) return undefined;
  const answers: string[] = [];
  const plain: string[] = [];
  for (const line of offered) {
    if (listMarker.test(line)) answers.push(line.replace(listMarker, "").trim());
    else plain.push(line);
  }
  return { asked, ...(plain.length > 0 ? { said: plain.join("\n\n") } : {}), answers };
}

/**
 * Turn `question` into the card that puts it to the person: it stands as the
 * question {@link askOffer} reads out of it, saying what stood in its plain
 * lines and offering its list-marked lines as the answers, and it keeps no
 * folded body of its own.
 */
function offerAnswers(question: NarrationDraft): void {
  const offer = askOffer(question.text, question.body);
  question.body = undefined;
  if (offer === undefined) return;
  question.text = offer.asked;
  question.said = offer.said;
  if (offer.answers.length > 0) question.answers = offer.answers;
}

/** How much a diagnostic is graded at when it is what stops a brain building. */
const stoppingSeverity = "error";

/**
 * The identity two dirty builds share when they came back reporting the very
 * same things: every diagnostic's code and the rule it falls in, sorted so the
 * order they were reported in never changes the identity.
 */
function buildIdentity(diagnostics: readonly BuildDiagnostic[]): string {
  return diagnostics
    .map((diagnostic) => `${diagnostic.code}@${diagnostic.ruleId ?? ""}`)
    .sort((a, b) => (a < b ? -1 : 1))
    .join(",");
}

/** The key a receipt gathers under: the page its edits landed on, and `""` for edits that named none. */
function receiptKey(page: ProjectPageRef | undefined): string {
  return page?.pageId ?? "";
}

/**
 * `rules` laid out for a receipt to show, each at the depth it stands in the
 * document, in the order they were gathered.
 */
export function receiptRules(
  rules: ReadonlyMap<string, ProjectRule>,
  parentOf: ReadonlyMap<string, string>
): ReceiptRule[] {
  return [...rules.values()].map((rule) => ({
    ruleId: rule.ruleId,
    depth: ruleDepth(rule.ruleId, parentOf),
    trigger: rule.trigger ?? RuleTriggerMode.When,
    when: rule.when,
    do: rule.do,
  }));
}

/** `draft` as the block the transcript renders, everything it gathered now settled. */
function laidOutBlock(draft: BlockDraft, parentOf: ReadonlyMap<string, string>): ConversationBlock {
  switch (draft.kind) {
    case ConversationBlockKind.Receipt:
      return laidOutReceipt(draft, parentOf);
    case ConversationBlockKind.Snag:
      return {
        kind: ConversationBlockKind.Snag,
        code: draft.code,
        ...(draft.ruleId === undefined ? {} : { ruleId: draft.ruleId }),
        ...(draft.tileId === undefined ? {} : { tileId: draft.tileId }),
        ...(draft.tileLabel === undefined ? {} : { tileLabel: draft.tileLabel }),
        params: draft.params,
        repeats: draft.repeats,
        ...(draft.caption === undefined ? {} : { caption: draft.caption }),
        ...(draft.captionBody === undefined ? {} : { captionBody: draft.captionBody }),
      };
    case ConversationBlockKind.Run:
      return {
        kind: ConversationBlockKind.Run,
        run: draft.run,
        superseded: draft.superseded,
        ...(draft.judgment === undefined ? {} : { judgment: draft.judgment }),
      };
    case ConversationBlockKind.Build:
      return {
        kind: ConversationBlockKind.Build,
        diagnostics: draft.diagnostics,
        errors: draft.errors,
        repeats: draft.repeats,
      };
    case ConversationBlockKind.Offer:
      return draft;
    case ConversationBlockKind.Narration:
      return {
        kind: ConversationBlockKind.Narration,
        text: draft.text,
        ...(draft.body === undefined ? {} : { body: draft.body }),
        ...(draft.role === undefined ? {} : { role: draft.role }),
        ...(draft.judgment === undefined ? {} : { judgment: draft.judgment }),
        superseded: draft.superseded,
        ...(draft.converted === undefined ? {} : { converted: draft.converted }),
        ...(draft.said === undefined ? {} : { said: draft.said }),
        ...(draft.answers === undefined ? {} : { answers: draft.answers }),
      };
  }
}

/** `draft` as the receipt the transcript renders, with its rules laid out at the depth each stands. */
function laidOutReceipt(draft: ReceiptDraft, parentOf: ReadonlyMap<string, string>): ReceiptBlock {
  const rules = receiptRules(draft.rules, parentOf);
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
 * per way a proposal was refused, one card per rehearsal it asked for, one card
 * per way a build came back dirty, and the libraries it offered as one block of
 * cards at the end of the turn, each library named once and in the order it
 * offered them. A call that only looked draws nothing.
 *
 * A receipt stands where the turn first touched its page and gathers every later
 * edit to that page. A snag stands where the turn was first refused that way and
 * counts every later proposal asking for the very same thing, however much
 * narration falls between them. A dirty build counts the same way, on the things
 * the build reported. Every rehearsal but the turn's last is marked superseded.
 * A clean build marks every receipt the turn has opened by then.
 *
 * Four kinds of narration are read against the block standing before them, so
 * what the assistant said lands on the thing it was about: every plan but the
 * turn's last is marked superseded, a verdict gives its judgment to the
 * rehearsal it followed, a note takes the place of the diagnosis that went
 * looking for it, and a snag gives its words to the refusal it followed. A
 * verdict standing before any rehearsal, and a note or snag standing before
 * what it would join, are left as the plain runs of words they are.
 *
 * A question to the person keeps no long form: its first line is the question,
 * and every line standing under it, wherever in the run they landed, becomes one
 * of the answers it offers.
 */
export function conversationBlocks(
  steps: readonly ConversationTurnStep[],
  context: TranscriptContext
): readonly ConversationBlock[] {
  const drafts: BlockDraft[] = [];
  const receipts = new Map<string, ReceiptDraft>();
  const snags = new Map<string, SnagDraft>();
  const builds = new Map<string, BuildDraft>();
  const runs: RunDraft[] = [];
  const plans: NarrationDraft[] = [];
  const offered: string[] = [];
  let openDiagnosis: NarrationDraft | undefined;
  let lastSnag: SnagDraft | undefined;

  const gather = (call: ConversationToolCall): void => {
    const presented = offeredLibraries(call);
    if (presented) {
      for (const coordinate of presented) {
        if (!offered.includes(coordinate)) offered.push(coordinate);
      }
      return;
    }

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
        lastSnag = seen;
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
      lastSnag = snag;
      return;
    }

    const run = runEvidence(call);
    if (run) {
      const draft: RunDraft = { kind: ConversationBlockKind.Run, run, superseded: false };
      for (const earlier of runs) earlier.superseded = true;
      runs.push(draft);
      drafts.push(draft);
      return;
    }

    if (compiledClean(call)) {
      for (const receipt of receipts.values()) receipt.compiles = true;
      return;
    }

    const dirty = dirtyBuild(call);
    if (dirty) {
      const identity = buildIdentity(dirty);
      const seen = builds.get(identity);
      if (seen) {
        seen.repeats++;
        return;
      }
      const build: BuildDraft = {
        kind: ConversationBlockKind.Build,
        diagnostics: dirty,
        errors: dirty.filter((diagnostic) => diagnostic.severity === stoppingSeverity).length,
        repeats: 1,
      };
      builds.set(identity, build);
      drafts.push(build);
    }
  };

  for (const step of steps) {
    if (step.kind !== "narration") {
      gather(step.call);
      continue;
    }

    const said: NarrationDraft = {
      kind: ConversationBlockKind.Narration,
      text: step.text,
      ...(step.body === undefined ? {} : { body: step.body }),
      ...(step.role === undefined ? {} : { role: step.role }),
      ...(step.judgment === undefined ? {} : { judgment: step.judgment }),
      superseded: false,
    };

    if (said.role === RoleCode.Ask) offerAnswers(said);
    if (said.role === RoleCode.Snag && lastSnag) {
      lastSnag.caption = said.text;
      lastSnag.captionBody = said.body;
      continue;
    }
    if (said.role === RoleCode.Note && openDiagnosis) {
      convertToNote(openDiagnosis, said);
      openDiagnosis = undefined;
      continue;
    }
    if (said.role === RoleCode.Verdict && said.judgment !== undefined) {
      const rehearsal = runs[runs.length - 1];
      if (rehearsal) rehearsal.judgment = said.judgment;
    }
    if (said.role === RoleCode.Plan || said.role === RoleCode.Pivot) {
      for (const earlier of plans) earlier.superseded = true;
      plans.push(said);
    }
    if (said.role === RoleCode.Diagnosis) openDiagnosis = said;
    drafts.push(said);
  }

  if (offered.length > 0) drafts.push({ kind: ConversationBlockKind.Offer, coordinates: offered });

  return drafts.map((draft) => laidOutBlock(draft, context.parentOf));
}
