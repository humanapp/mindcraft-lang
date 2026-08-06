import type { DispatchObservation, SimulationRun, ThinkObservation } from "../target/adapter.js";

/** Spans a summary keeps before it stops and reports itself truncated. */
const maxSpans = 80;

/** One think of the brain under study, in the form the summary compresses. */
export interface ThinkSummary {
  /** Rules whose gate passed, in the order the runtime reached them. */
  readonly fired: readonly string[];
  /** WHEN result of every rule that reached its gate, as `ruleId=value` entries. */
  readonly when: readonly string[];
  /** Host action calls dispatched, as `action(args)=count` entries. */
  readonly dispatched: readonly string[];
}

/** A run of consecutive thinks whose summaries are identical. */
export interface TraceSpan {
  /** Index of the span's first think. */
  readonly from: number;
  /** Number of consecutive thinks the span covers. */
  readonly thinks: number;
  readonly think: ThinkSummary;
}

/** Totals for one rule over the whole run. */
export interface RuleTotals {
  readonly ruleId: string;
  /** Thinks on which the rule reached its WHEN gate. */
  readonly evaluated: number;
  /** Thinks on which the gate passed. */
  readonly fired: number;
  /** Distinct WHEN results the rule produced, at most eight, in first-seen order. */
  readonly whenResults: readonly string[];
}

/** The bounded account of one rehearsal that `simulate` returns. */
export interface TraceSummary {
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
  readonly world: SimulationRun["world"];
}

/** Distinct WHEN results recorded per rule. */
const maxWhenResultsPerRule = 8;

/**
 * One dispatch as the summary counts it: the action key with the arguments the
 * call carried, so calls of one action that differ in their arguments are
 * counted apart.
 */
function dispatchCall(dispatch: DispatchObservation): string {
  return `${dispatch.action}(${dispatch.args.join(",")})`;
}

/** Count dispatches by call, as `action(args)=count` entries sorted by call. */
function countDispatches(dispatches: Iterable<DispatchObservation>): string[] {
  const counts = new Map<string, number>();
  for (const dispatch of dispatches) {
    const call = dispatchCall(dispatch);
    counts.set(call, (counts.get(call) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([call, count]) => `${call}=${count}`);
}

/** Reduce one think's observations to the form spans compare and compress. */
function summarizeThink(observation: ThinkObservation): ThinkSummary {
  const fired: string[] = [];
  const when: string[] = [];
  for (const gate of observation.gates) {
    if (gate.fired) fired.push(gate.ruleId);
    when.push(`${gate.ruleId}=${gate.result}`);
  }

  return { fired, when, dispatched: countDispatches(observation.dispatches) };
}

/** True when two think summaries carry identical content. */
function sameThink(a: ThinkSummary, b: ThinkSummary): boolean {
  return (
    a.fired.join(",") === b.fired.join(",") &&
    a.when.join(",") === b.when.join(",") &&
    a.dispatched.join(",") === b.dispatched.join(",")
  );
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

/** Accumulate per-rule totals across the run, in first-seen order. */
function ruleTotals(observations: readonly ThinkObservation[]): RuleTotals[] {
  const order: string[] = [];
  const evaluated = new Map<string, number>();
  const fired = new Map<string, number>();
  const results = new Map<string, string[]>();

  for (const observation of observations) {
    for (const gate of observation.gates) {
      if (!evaluated.has(gate.ruleId)) {
        order.push(gate.ruleId);
        evaluated.set(gate.ruleId, 0);
        fired.set(gate.ruleId, 0);
        results.set(gate.ruleId, []);
      }
      evaluated.set(gate.ruleId, evaluated.get(gate.ruleId)! + 1);
      if (gate.fired) fired.set(gate.ruleId, fired.get(gate.ruleId)! + 1);
      const seen = results.get(gate.ruleId)!;
      if (seen.length < maxWhenResultsPerRule && !seen.includes(gate.result)) seen.push(gate.result);
    }
  }

  return order.map((ruleId) => ({
    ruleId,
    evaluated: evaluated.get(ruleId)!,
    fired: fired.get(ruleId)!,
    whenResults: results.get(ruleId)!,
  }));
}

/** Accumulate host action dispatch totals across the run. */
function dispatchTotals(observations: readonly ThinkObservation[]): string[] {
  return countDispatches(observations.flatMap((observation) => observation.dispatches));
}

/**
 * Reduce one rehearsal to the bounded account `simulate` returns: per-rule
 * totals, dispatch totals, and run-length compressed per-think detail.
 */
export function summarizeRun(run: SimulationRun): TraceSummary {
  const { spans, truncated } = compress(run.observations);
  return {
    thinks: run.thinks,
    rules: ruleTotals(run.observations),
    dispatchTotals: dispatchTotals(run.observations),
    spans,
    spansTruncated: truncated,
    world: run.world,
  };
}
