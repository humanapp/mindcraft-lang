import type { DiagCode } from "@wendoo/core/brain/compiler";
import type { DispatchObservation, SimulationRun, SubjectStateChannel, ThinkObservation } from "../target/adapter.js";

/** Spans a summary keeps before it stops and reports itself truncated. */
const maxSpans = 80;

/** State changes a summary keeps before it stops and reports itself truncated. */
const maxStateChanges = 80;

/** States a summary keeps before it stops and reports itself truncated. */
const maxStateIdentities = 80;

/** One think of the brain under study, in the form the summary compresses. */
export interface ThinkSummary {
  /** Rules whose gate passed, in the order the runtime reached them. */
  readonly fired: readonly string[];
  /** WHEN result of every rule that reached its gate, as `ruleId=value` entries. */
  readonly when: readonly string[];
  /**
   * Host action calls dispatched, as `action(args)[notes]=count@ruleId` entries
   * sorted by call, with the notes and the rule id omitted where there are
   * none. See {@link dispatchCall} for the notes a call carries.
   */
  readonly dispatched: readonly string[];
  /** Rules parked on an asynchronous call at the end of the think; absent when none was. */
  readonly waiting?: readonly string[];
  /** Root rules a rule below them held from re-firing this think; absent when none was. */
  readonly quiesced?: readonly string[];
  /** The page change this think began with, as `from->to` page indices; absent when the page held. */
  readonly page?: string;
}

/** A run of consecutive thinks whose summaries are identical. */
export interface TraceSpan {
  /** Index of the span's first think. */
  readonly from: number;
  /** Number of consecutive thinks the span covers. */
  readonly thinks: number;
  readonly think: ThinkSummary;
}

/**
 * Totals for one rule over the whole run. A rule with no WHEN condition reaches
 * no gate, so it carries no gate totals: `evaluated`, `fired`, and
 * `whenResults` are all absent for it, and what it did is in
 * {@link RuleTotals.dispatched}.
 */
export interface RuleTotals {
  readonly ruleId: string;
  /** Thinks on which the rule reached its WHEN gate. */
  readonly evaluated?: number;
  /** Thinks on which the gate passed. */
  readonly fired?: number;
  /** Distinct WHEN results the rule produced, at most eight, in first-seen order. */
  readonly whenResults?: readonly string[];
  /** Host action calls this rule made over the run, as `action(args)=count` entries, sorted by call. */
  readonly dispatched: readonly string[];
}

/** One rule the run was staged without, and why. */
export interface ExcludedRule {
  /** Durable id of the rule left out. */
  readonly ruleId: string;
  /** Stable codes of the build errors the rule carries, in report order. */
  readonly codes: readonly DiagCode[];
}

/** The bounded account of one rehearsal that `simulate` returns. */
export interface TraceSummary {
  /** Id the rehearsal this account is of is addressed by. */
  readonly runId: string;
  /** Thinks the run executed. */
  readonly thinks: number;
  /** Per-rule totals, in document order of first appearance. */
  readonly rules: readonly RuleTotals[];
  /** Dispatch totals over the run, as `action(args)=count` entries, sorted by call. */
  readonly dispatchTotals: readonly string[];
  /** Run-length compressed per-think detail. */
  readonly spans: readonly TraceSpan[];
  /** `true` when {@link spans} was cut at the span budget and does not cover the whole run. */
  readonly spansTruncated: boolean;
  /**
   * Subject state changes over the run, as `think channel=value`, in think
   * order. A channel appears only on the thinks its value changed on, and its
   * first entry is the value it started the run at. Absent when the target
   * declares no channel.
   */
  readonly state?: readonly string[];
  /** `true` when {@link state} was cut at its budget and does not cover the whole run. */
  readonly stateTruncated?: boolean;
  /**
   * The state the run stood in, as `think hash` entries in think order: one for
   * the run's first think, and one for every think the state changed on. The
   * hash covers the page the brain is on and what every reported state channel
   * contributes, so two thinks carry the same hash exactly when the run stood
   * in the same state on both, and a run that never leaves its state carries a
   * single entry.
   */
  readonly identity: readonly string[];
  /** `true` when {@link identity} was cut at its budget and does not cover the whole run. */
  readonly identityTruncated?: boolean;
  readonly world: SimulationRun["world"];
  /**
   * Rules the run was staged without, sorted by id. Every claim the account
   * makes holds only of the document with these rules disabled. Absent when the
   * run covered the whole document.
   */
  readonly excludedRules?: readonly ExcludedRule[];
}

/** Distinct WHEN results recorded per rule. */
const maxWhenResultsPerRule = 8;

/**
 * One dispatch as the summary counts it: the action key with the arguments the
 * call carried, so calls of one action that differ in their arguments are
 * counted apart, followed by a bracketed, comma-separated note list when the
 * call has anything further to report. The notes, in order:
 *
 * - `output=value`, what the call reported back, for an action declaring one;
 * - the call's outcome, for a call that did not simply end where it was made;
 * - `+n`, the thinks between the call and its ending, for one that ended later.
 *
 * A synchronous call of an action that declares no output carries no notes at
 * all.
 */
function dispatchCall(dispatch: DispatchObservation): string {
  const notes: string[] = [];
  if (dispatch.output !== undefined) notes.push(dispatch.output);
  if (dispatch.outcome !== undefined) notes.push(dispatch.outcome);
  if (dispatch.settledAfter !== undefined) notes.push(`+${dispatch.settledAfter}`);
  return `${dispatch.action}(${dispatch.args.join(",")})${notes.length > 0 ? `[${notes.join(",")}]` : ""}`;
}

/** Count dispatches by call, as `action(args)[notes]=count` entries sorted by call. */
function countDispatches(dispatches: Iterable<DispatchObservation>): string[] {
  const counts = new Map<string, number>();
  for (const dispatch of dispatches) {
    const call = dispatchCall(dispatch);
    counts.set(call, (counts.get(call) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([call, count]) => `${call}=${count}`);
}

/**
 * Count dispatches by call and by the rule that made them, as
 * `action(args)[notes]=count@ruleId` entries sorted by call, so one think's
 * detail names which rule dispatched what. A call the runtime could not
 * attribute carries no `@ruleId`.
 */
function countAttributedDispatches(dispatches: Iterable<DispatchObservation>): string[] {
  const counts = new Map<string, { call: string; ruleId: string | undefined; count: number }>();
  for (const dispatch of dispatches) {
    const call = dispatchCall(dispatch);
    const seen = counts.get(`${call}@${dispatch.ruleId ?? ""}`);
    if (seen) seen.count++;
    else counts.set(`${call}@${dispatch.ruleId ?? ""}`, { call, ruleId: dispatch.ruleId, count: 1 });
  }
  return [...counts.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, entry]) => `${entry.call}=${entry.count}${entry.ruleId === undefined ? "" : `@${entry.ruleId}`}`);
}

/** The page change a think began with, as `from->to` page indices. */
function pageSwitchText(observation: ThinkObservation): string | undefined {
  const change = observation.pageSwitch;
  if (!change) return undefined;
  return `${change.from === undefined ? "" : change.from}->${change.to}`;
}

/** Reduce one think's observations to the form spans compare and compress. */
function summarizeThink(observation: ThinkObservation): ThinkSummary {
  const fired: string[] = [];
  const when: string[] = [];
  for (const gate of observation.gates) {
    if (gate.fired) fired.push(gate.ruleId);
    when.push(`${gate.ruleId}=${gate.result}`);
  }
  const page = pageSwitchText(observation);

  return {
    fired,
    when,
    dispatched: countAttributedDispatches(observation.dispatches),
    ...(observation.waiting && observation.waiting.length > 0 ? { waiting: observation.waiting } : {}),
    ...(observation.quiesced && observation.quiesced.length > 0 ? { quiesced: observation.quiesced } : {}),
    ...(page ? { page } : {}),
  };
}

/**
 * How each field of a {@link ThinkSummary} reads as text for comparison, one
 * entry per field. The key set is the summary's own, so a field added to
 * {@link ThinkSummary} without an entry here does not compile.
 */
const thinkFieldText: { readonly [K in keyof Required<ThinkSummary>]: (think: ThinkSummary) => string } = {
  fired: (think) => think.fired.join(","),
  when: (think) => think.when.join(","),
  dispatched: (think) => think.dispatched.join(","),
  waiting: (think) => (think.waiting ?? []).join(","),
  quiesced: (think) => (think.quiesced ?? []).join(","),
  page: (think) => think.page ?? "",
};

/** Every field of a think summary, read as text. */
const thinkFields = Object.values(thinkFieldText);

/** True when two think summaries carry identical content. */
function sameThink(a: ThinkSummary, b: ThinkSummary): boolean {
  return thinkFields.every((read) => read(a) === read(b));
}

/** Compress consecutive identical thinks into spans, stopping at the span budget. */
function compress(observations: readonly ThinkObservation[]): { spans: TraceSpan[]; truncated: boolean } {
  const spans: TraceSpan[] = [];
  let index = 0;
  while (index < observations.length) {
    const think = summarizeThink(observations[index]!);
    let length = 1;
    while (index + length < observations.length && sameThink(think, summarizeThink(observations[index + length]!))) {
      length++;
    }
    if (spans.length === maxSpans) {
      return { spans, truncated: true };
    }
    spans.push({ from: index, thinks: length, think });
    index += length;
  }
  return { spans, truncated: false };
}

/**
 * Accumulate per-rule totals across the run, in first-seen order. A rule appears
 * once it reaches a gate or dispatches an action, so a rule with no WHEN
 * condition -- a child that runs on every fire of its parent -- is accounted for
 * by what it dispatched.
 */
function ruleTotals(observations: readonly ThinkObservation[]): RuleTotals[] {
  const order: string[] = [];
  const evaluated = new Map<string, number>();
  const fired = new Map<string, number>();
  const results = new Map<string, string[]>();
  const dispatches = new Map<string, DispatchObservation[]>();

  const see = (ruleId: string) => {
    if (!order.includes(ruleId)) order.push(ruleId);
  };

  for (const observation of observations) {
    for (const gate of observation.gates) {
      see(gate.ruleId);
      if (!evaluated.has(gate.ruleId)) {
        evaluated.set(gate.ruleId, 0);
        fired.set(gate.ruleId, 0);
        results.set(gate.ruleId, []);
      }
      evaluated.set(gate.ruleId, evaluated.get(gate.ruleId)! + 1);
      if (gate.fired) fired.set(gate.ruleId, fired.get(gate.ruleId)! + 1);
      const seen = results.get(gate.ruleId)!;
      if (seen.length < maxWhenResultsPerRule && !seen.includes(gate.result)) seen.push(gate.result);
    }
    for (const dispatch of observation.dispatches) {
      if (dispatch.ruleId === undefined) continue;
      see(dispatch.ruleId);
      const made = dispatches.get(dispatch.ruleId);
      if (made) made.push(dispatch);
      else dispatches.set(dispatch.ruleId, [dispatch]);
    }
  }

  return order.map((ruleId) => ({
    ruleId,
    ...(evaluated.has(ruleId)
      ? { evaluated: evaluated.get(ruleId)!, fired: fired.get(ruleId)!, whenResults: results.get(ruleId)! }
      : {}),
    dispatched: countDispatches(dispatches.get(ruleId) ?? []),
  }));
}

/** Accumulate host action dispatch totals across the run. */
function dispatchTotals(observations: readonly ThinkObservation[]): string[] {
  return countDispatches(observations.flatMap((observation) => observation.dispatches));
}

/**
 * The run's state changes as `think channel=value` entries in think order,
 * stopping at the change budget.
 */
function stateChanges(observations: readonly ThinkObservation[]): { changes: string[]; truncated: boolean } {
  const changes: string[] = [];
  for (let think = 0; think < observations.length; think++) {
    for (const change of observations[think]!.state ?? []) {
      if (changes.length === maxStateChanges) return { changes, truncated: true };
      changes.push(`${think} ${change}`);
    }
  }
  return { changes, truncated: false };
}

/** Offset the 32-bit FNV-1a hash starts from. */
const hashOffsetBasis = 0x811c9dc5;

/** Prime the 32-bit FNV-1a hash multiplies by. */
const hashPrime = 0x01000193;

/** `text` as a stable 32-bit FNV-1a hash, in eight hex digits. */
function hashOf(text: string): string {
  let hash = hashOffsetBasis;
  for (let at = 0; at < text.length; at++) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, hashPrime);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The page the run stood on before it changed page for the first time, and
 * `undefined` for a run that never named a page at all.
 */
function openingPage(observations: readonly ThinkObservation[]): number | undefined {
  for (const observation of observations) {
    const change = observation.pageSwitch;
    if (change) return change.from ?? change.to;
  }
  return undefined;
}

/** What each channel contributes to a state, keyed by channel name, for the channels deriving one. */
function identityDerivations(
  channels: readonly SubjectStateChannel[]
): ReadonlyMap<string, (reported: string) => string> {
  const derivations = new Map<string, (reported: string) => string>();
  for (const channel of channels) {
    if (channel.identityValue) derivations.set(channel.name, channel.identityValue);
  }
  return derivations;
}

/**
 * The state the run stood in as `think hash` entries in think order, stopping
 * at the state budget. The page and every reported channel take part; a channel
 * `channels` gives a derivation for contributes what that derivation makes of
 * its value, and every other channel contributes the value it reported.
 */
function stateIdentities(
  observations: readonly ThinkObservation[],
  channels: readonly SubjectStateChannel[]
): { identities: string[]; truncated: boolean } {
  const derivations = identityDerivations(channels);
  const contributions = new Map<string, string>();
  const identities: string[] = [];
  let page = openingPage(observations);
  let standing: string | undefined;

  for (let think = 0; think < observations.length; think++) {
    const observation = observations[think]!;
    if (observation.pageSwitch) page = observation.pageSwitch.to;
    for (const change of observation.state ?? []) {
      const split = change.indexOf("=");
      if (split === -1) continue;
      const name = change.slice(0, split);
      const reported = change.slice(split + 1);
      contributions.set(name, derivations.get(name)?.(reported) ?? reported);
    }
    const material = [...contributions.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([name, contribution]) => `${name}=${contribution}`);
    const hash = hashOf([`page=${page ?? ""}`, ...material].join("|"));
    if (hash === standing) continue;
    if (identities.length === maxStateIdentities) return { identities, truncated: true };
    identities.push(`${think} ${hash}`);
    standing = hash;
  }
  return { identities, truncated: false };
}

/** What a run is summarized against, beyond the run itself. */
export interface RunSummaryContext {
  /**
   * Rules the run was staged without, so the account states what its claims are
   * scoped to. Absent for a run that covered the whole document.
   */
  readonly excludedRules?: readonly ExcludedRule[];
  /**
   * The state channels the target reporting this run declares, read for what
   * each contributes to {@link TraceSummary.identity}. Absent leaves every
   * reported channel contributing the value it reported.
   */
  readonly stateChannels?: readonly SubjectStateChannel[];
}

/**
 * Reduce one rehearsal to the bounded account `simulate` returns: per-rule
 * totals, dispatch totals, run-length compressed per-think detail, the
 * subject's state changes over the run, and the state the run stood in think by
 * think.
 */
export function summarizeRun(run: SimulationRun, context: RunSummaryContext = {}): TraceSummary {
  const { excludedRules, stateChannels } = context;
  const { spans, truncated } = compress(run.observations);
  const state = stateChanges(run.observations);
  const identity = stateIdentities(run.observations, stateChannels ?? []);
  return {
    runId: run.runId,
    thinks: run.thinks,
    rules: ruleTotals(run.observations),
    dispatchTotals: dispatchTotals(run.observations),
    spans,
    spansTruncated: truncated,
    ...(state.changes.length > 0 ? { state: state.changes } : {}),
    ...(state.truncated ? { stateTruncated: true } : {}),
    identity: identity.identities,
    ...(identity.truncated ? { identityTruncated: true } : {}),
    world: run.world,
    ...(excludedRules && excludedRules.length > 0 ? { excludedRules } : {}),
  };
}
