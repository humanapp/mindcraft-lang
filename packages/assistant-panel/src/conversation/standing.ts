import type { ProjectPageRef, ProjectRule } from "@wendoo/assistant-bridge";
import type { ConversationRecord, ConversationToolCall, ConversationTurnEnding } from "@wendoo/assistant-relay";
import { RelayTurnEndCode } from "@wendoo/assistant-relay";
import type { ReceiptRule, TranscriptContext } from "./blocks";
import { receiptRules, recordToolCalls } from "./blocks";
import { callIdentity } from "./call-identity";
import type { RunEvidence } from "./run";
import { runEvidence } from "./run";
import { compiledClean, dirtyBuild, landedCommands, refusedProposal } from "./tool-payloads";

/** The rules standing on one page when the conversation stopped. */
export interface StandingPage {
  /** The page these rules stand on; absent for rules whose edits reported no page. */
  readonly page?: ProjectPageRef;
  /** The rules standing, in the order the conversation first touched them. */
  readonly rules: readonly ReceiptRule[];
}

/** Where a conversation got to: everything its turns left standing, whoever stopped them. */
export interface StandingState {
  /** The pages carrying rules, in the order the conversation first touched them. */
  readonly pages: readonly StandingPage[];
  /** Rules standing across every page. */
  readonly rules: number;
  /** Ways a proposal was refused that nothing since has taken back. */
  readonly snags: number;
  /** Whether the last build the conversation ran came back clean; absent when it ran none. */
  readonly builds?: boolean;
  /** The last rehearsal the conversation ran; absent when it ran none. */
  readonly lastRun?: RunEvidence;
}

/** Whether `state` holds anything at all worth showing the person. */
export function standingHolds(state: StandingState): boolean {
  return state.rules > 0 || state.snags > 0 || state.builds !== undefined || state.lastRun !== undefined;
}

/**
 * Whether `ending` left the person without an answer, so the conversation owes
 * them an account of where it got to. Only a turn the service ended as complete
 * does not.
 */
export function answerless(ending: ConversationTurnEnding): boolean {
  return ending.kind === "failure" || ending.code !== RelayTurnEndCode.Complete;
}

/** The key a page's rules gather under, and `""` for rules whose edits named no page. */
function pageKey(page: ProjectPageRef | undefined): string {
  return page?.pageId ?? "";
}

/** A page's rules while they are still being gathered. */
interface StandingDraft {
  page?: ProjectPageRef;
  readonly rules: Map<string, ProjectRule>;
}

/** Take every rule `call` landed into the page it landed on, and every rule it removed back out. */
function applyEdits(call: ConversationToolCall, pages: Map<string, StandingDraft>): void {
  const landed = landedCommands(call);
  if (!landed) return;
  for (const outcome of landed) {
    const key = pageKey(outcome.onPage);
    let draft = pages.get(key);
    if (!draft) {
      draft = { ...(outcome.onPage ? { page: outcome.onPage } : {}), rules: new Map() };
      pages.set(key, draft);
    }
    if (!outcome.rule) continue;
    if (outcome.removed === "rule") draft.rules.delete(outcome.rule.ruleId);
    else draft.rules.set(outcome.rule.ruleId, outcome.rule);
  }
}

/**
 * Read `record` for where the whole conversation got to: the rules standing on
 * each page after every edit any of its turns landed, how many ways a proposal
 * was refused, whether the last build came back clean, and the last rehearsal
 * that ran. Spans every turn in the record.
 */
export function standingState(record: ConversationRecord | undefined, context: TranscriptContext): StandingState {
  const pages = new Map<string, StandingDraft>();
  const snags = new Set<string>();
  let builds: boolean | undefined;
  let lastRun: RunEvidence | undefined;

  for (const call of recordToolCalls(record)) {
    applyEdits(call, pages);
    if (refusedProposal(call)) snags.add(callIdentity(call.name, call.input));
    if (compiledClean(call)) builds = true;
    else if (dirtyBuild(call)) builds = false;
    const run = runEvidence(call);
    if (run) lastRun = run;
  }

  const standing: StandingPage[] = [];
  let rules = 0;
  for (const draft of pages.values()) {
    if (draft.rules.size === 0) continue;
    rules += draft.rules.size;
    standing.push({
      ...(draft.page ? { page: draft.page } : {}),
      rules: receiptRules(draft.rules, context.parentOf),
    });
  }

  return {
    pages: standing,
    rules,
    snags: snags.size,
    ...(builds === undefined ? {} : { builds }),
    ...(lastRun ? { lastRun } : {}),
  };
}
