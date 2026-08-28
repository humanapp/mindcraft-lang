import type { ConversationToolCall } from "@wendoo/assistant-relay";
import type { RehearsalAccount, RehearsalSpan, RehearsalWorld } from "./tool-payloads";
import { rehearsalOutcome } from "./tool-payloads";

/** What the brain under study was doing over one stretch of a rehearsal. */
export const RunActivity = {
  /** Nothing reached a gate and nothing ran. */
  Quiet: "quiet",
  /** Rules reached their gate and none of them passed. */
  Watching: "watching",
  /** A rule passed its gate, or something ran that no gate asked for. */
  Acting: "acting",
  /** Nothing ran, and a rule stood parked on a call it was waiting out. */
  Waiting: "waiting",
} as const;

/** What the brain under study was doing over one stretch of a rehearsal. */
export type RunActivity = (typeof RunActivity)[keyof typeof RunActivity];

/** One host call a stretch of a run made, counted over the whole stretch. */
export interface RunCellCall {
  /** Stable action key the run named the call by, for example `actuator.move`. */
  readonly action: string;
  /**
   * The arguments the call filled that the run spelled in plain words, in the
   * order it filled them. An argument carrying a value of its own -- a literal,
   * a tile id, a number -- is absent.
   */
  readonly args: readonly string[];
  /** Times the call was made over the cell's stretch. */
  readonly count: number;
}

/** One cell of a run's timeline: a stretch of thinks doing one thing in one state. */
export interface RunCell {
  /** Index of the cell's first think. */
  readonly from: number;
  /** Thinks the cell covers. */
  readonly thinks: number;
  readonly activity: RunActivity;
  /** The state the run stood in over the cell; absent when the account logged none. */
  readonly identity?: string;
  /** Durable ids of the rules whose gate passed on each think of the stretch. */
  readonly fired: readonly string[];
  /** Durable ids of the rules that reached their gate on each think of the stretch and did not pass. */
  readonly held: readonly string[];
  /** Durable ids of the rules parked on an asynchronous call over the stretch. */
  readonly waiting: readonly string[];
  /** The host calls the stretch made, merged by call, in the order the account reported them. */
  readonly calls: readonly RunCellCall[];
  /**
   * The channels that reported a change on the think the cell opens at, named
   * and never valued. Absent for a cell the run did not change state at, and
   * empty for one it changed state at with no channel of its own to name.
   */
  readonly changed?: readonly string[];
}

/** What a marker on a run's timeline stands for. */
export const RunMarkerKind = {
  /** The brain moved to another page. */
  Page: "page",
  /** The scenario delivered something into the staged world. */
  Input: "input",
} as const;

/** What a marker on a run's timeline stands for. */
export type RunMarkerKind = (typeof RunMarkerKind)[keyof typeof RunMarkerKind];

/** One thing that happened at a nameable think of a run. */
export interface RunMarker {
  readonly kind: RunMarkerKind;
  /** Zero-based think the marker falls on. */
  readonly at: number;
  /** Page the brain moved to, for a page marker; absent for every other kind. */
  readonly toPage?: number;
  /** Page the brain came from, for a page marker that left one. */
  readonly fromPage?: number;
  /** Percept kind the scenario delivered, for an input marker. */
  readonly inputKind?: string;
  /** What the percept was set to, rendered for the reader. */
  readonly inputValue?: string;
}

/** One rehearsal a turn asked for, as the transcript draws it. */
export interface RunEvidence {
  /** Id the rehearsal is addressed by; empty for a rehearsal that never ran. */
  readonly runId: string;
  /** Why the rehearsal never ran; absent for one that did. */
  readonly blocked?: string;
  /** Thinks the turn asked for; absent when the call named none. */
  readonly asked?: number;
  /** Thinks the run executed. */
  readonly thinks: number;
  /** Thinks {@link cells} covers, which is short of {@link thinks} for a cut account. */
  readonly covered: number;
  readonly cells: readonly RunCell[];
  /** Markers in think order, with the scenario's own before the run's own on one think. */
  readonly markers: readonly RunMarker[];
  /** Host action calls over the whole run, as `action(args)=count` entries. */
  readonly dispatchTotals: readonly string[];
  /** What the staged world looked like; absent when the account reported none. */
  readonly world?: RehearsalWorld;
  /** Durable ids of the rules the run was staged without. */
  readonly excludedRules: readonly string[];
  /** `true` when the state log was cut and the later cells stand at the last state it logged. */
  readonly identityTruncated: boolean;
}

/** The rule a `ruleId=value` gate entry is about. */
function gatedRule(entry: string): string {
  const split = entry.indexOf("=");
  return split === -1 ? entry : entry.slice(0, split);
}

/** The rule an `action(args)=count@ruleId` dispatch entry was attributed to, absent when it names none. */
function dispatchingRule(entry: string): string | undefined {
  const mark = entry.lastIndexOf("@");
  return mark === -1 ? undefined : entry.slice(mark + 1);
}

/**
 * What the brain was doing over `span`. A gate reading a sensor dispatches
 * under the rule it gates, so a dispatch counts as the brain acting only where
 * a gate passed or where the dispatching rule reached no gate at all.
 */
export function spanActivity(span: RehearsalSpan): RunActivity {
  const gated = new Set(span.when.map(gatedRule));
  const ranUngated = span.dispatched.some((entry) => {
    const ruleId = dispatchingRule(entry);
    return ruleId === undefined || !gated.has(ruleId);
  });
  if (span.fired.length > 0 || ranUngated) return RunActivity.Acting;
  if (span.waiting.length > 0) return RunActivity.Waiting;
  if (gated.size > 0) return RunActivity.Watching;
  return RunActivity.Quiet;
}

/** The rules `span` reached the gate of and did not pass, in the order it reported them. */
function heldRules(span: RehearsalSpan): string[] {
  const fired = new Set(span.fired);
  const held: string[] = [];
  for (const entry of span.when) {
    const ruleId = gatedRule(entry);
    if (!fired.has(ruleId) && !held.includes(ruleId)) held.push(ruleId);
  }
  return held;
}

/** An argument the run spelled in plain words, which is one naming no value of its own. */
const wordedArgument = /^[A-Za-z][A-Za-z0-9 -]*$/;

/** The words `args` reads by, keeping only the arguments spelled as words. */
function argumentWords(args: string): string[] {
  const words: string[] = [];
  for (const entry of args.split(",")) {
    const valued = entry.indexOf("=");
    const word = (valued === -1 ? entry : entry.slice(0, valued)).trim();
    if (wordedArgument.test(word)) words.push(word);
  }
  return words;
}

/**
 * One `action(args)[notes]=count@ruleId` dispatch entry of a span read apart,
 * with the count it carries, which a span reports per think. `undefined` for an
 * entry that is not one.
 */
function dispatchedCall(entry: string): { action: string; args: readonly string[]; perThink: number } | undefined {
  const attributed = entry.lastIndexOf("@");
  const made = attributed === -1 ? entry : entry.slice(0, attributed);
  const counted = made.lastIndexOf("=");
  if (counted === -1) return undefined;
  const perThink = Number(made.slice(counted + 1));
  if (!Number.isInteger(perThink)) return undefined;
  const call = made.slice(0, counted);
  const opened = call.indexOf("(");
  const closed = call.lastIndexOf(")");
  const named = call.search(/[([]/);
  return {
    action: (named === -1 ? call : call.slice(0, named)).trim(),
    args: opened === -1 || closed < opened ? [] : argumentWords(call.slice(opened + 1, closed)),
    perThink,
  };
}

/**
 * What `dispatched` comes to over a stretch of `thinks` alike thinks: each call
 * the stretch made, counted over the whole stretch, calls that read the same way
 * merged into one entry.
 */
function cellCalls(dispatched: readonly string[], thinks: number): RunCellCall[] {
  const calls = new Map<string, RunCellCall>();
  for (const entry of dispatched) {
    const made = dispatchedCall(entry);
    if (made === undefined) continue;
    const key = `${made.action}(${made.args.join(",")})`;
    const standing = calls.get(key);
    const count = made.perThink * thinks;
    calls.set(
      key,
      standing === undefined
        ? { action: made.action, args: made.args, count }
        : { ...standing, count: standing.count + count }
    );
  }
  return [...calls.values()];
}

/**
 * The names of the channels each think of a state log reported a change on,
 * keyed by think, holding no part of what any of them reported.
 */
function stateChanges(state: readonly string[]): ReadonlyMap<number, readonly string[]> {
  const changes = new Map<number, string[]>();
  for (const entry of state) {
    const split = entry.indexOf(" ");
    if (split === -1) continue;
    const at = Number(entry.slice(0, split));
    if (!Number.isInteger(at)) continue;
    const reported = entry.slice(split + 1);
    const valued = reported.indexOf("=");
    if (valued === -1) continue;
    const channel = reported.slice(0, valued);
    const standing = changes.get(at) ?? [];
    if (!standing.includes(channel)) standing.push(channel);
    changes.set(at, standing);
  }
  return changes;
}

/** One `think hash` entry of a state log, read apart. */
interface StateEntry {
  readonly at: number;
  readonly hash: string;
}

/** The state log read as entries in think order, dropping anything not shaped like one. */
function stateEntries(identity: readonly string[]): StateEntry[] {
  const entries: StateEntry[] = [];
  for (const entry of identity) {
    const split = entry.indexOf(" ");
    if (split === -1) continue;
    const at = Number(entry.slice(0, split));
    if (!Number.isInteger(at)) continue;
    entries.push({ at, hash: entry.slice(split + 1) });
  }
  return entries;
}

/**
 * Cut `span` where the run changed state inside it, so every cell stands in one
 * state throughout. Each piece carries the state standing at its first think,
 * what the span reported about its rules and calls, and the channels behind the
 * state change it opens at, for a piece that opens at one.
 */
function cellsOf(
  span: RehearsalSpan,
  states: readonly StateEntry[],
  changes: ReadonlyMap<number, readonly string[]>
): RunCell[] {
  const activity = spanActivity(span);
  const held = heldRules(span);
  const end = span.from + span.thinks;
  const cuts = states.filter((state) => state.at > span.from && state.at < end).map((state) => state.at);
  const bounds = [span.from, ...cuts, end];
  const cells: RunCell[] = [];
  for (let at = 0; at < bounds.length - 1; at++) {
    const from = bounds[at]!;
    const thinks = bounds[at + 1]! - from;
    const standing = [...states].reverse().find((state) => state.at <= from);
    const changedAt = states.findIndex((state) => state.at === from);
    cells.push({
      from,
      thinks,
      activity,
      ...(standing ? { identity: standing.hash } : {}),
      fired: span.fired,
      held,
      waiting: span.waiting,
      calls: cellCalls(span.dispatched, thinks),
      // The log's first entry is the state the run opened in, which nothing changed to.
      ...(changedAt > 0 ? { changed: changes.get(from) ?? [] } : {}),
    });
  }
  return cells;
}

/** The page markers `spans` carries, one per stretch that began on a page change. */
function pageMarkers(spans: readonly RehearsalSpan[]): RunMarker[] {
  const markers: RunMarker[] = [];
  for (const span of spans) {
    if (span.page === undefined) continue;
    const [left, entered] = span.page.split("->");
    const toPage = Number(entered);
    if (!Number.isInteger(toPage)) continue;
    const fromPage = Number(left);
    markers.push({
      kind: RunMarkerKind.Page,
      at: span.from,
      toPage,
      ...(left !== undefined && left.length > 0 && Number.isInteger(fromPage) ? { fromPage } : {}),
    });
  }
  return markers;
}

/** The percepts one `simulate` call scripted, as markers on the run it asked for. */
function inputMarkers(input: unknown): RunMarker[] {
  if (typeof input !== "object" || input === null) return [];
  const scenario = (input as { scenario?: unknown }).scenario;
  if (typeof scenario !== "object" || scenario === null) return [];
  const scripted = (scenario as { inputs?: unknown }).inputs;
  if (!Array.isArray(scripted)) return [];
  const markers: RunMarker[] = [];
  for (const entry of scripted) {
    if (typeof entry !== "object" || entry === null) continue;
    const { kind, at, value } = entry as { kind?: unknown; at?: unknown; value?: unknown };
    if (typeof kind !== "string" || typeof at !== "number") continue;
    markers.push({ kind: RunMarkerKind.Input, at, inputKind: kind, inputValue: String(value) });
  }
  return markers;
}

/** Thinks one `simulate` call asked for, or `undefined` when it named none. */
function askedThinks(input: unknown): number | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const thinks = (input as { thinks?: unknown }).thinks;
  return typeof thinks === "number" ? thinks : undefined;
}

/** `account` laid out as the timeline and markers the transcript draws. */
function evidenceOf(account: RehearsalAccount, input: unknown): RunEvidence {
  const states = stateEntries(account.identity);
  const changes = stateChanges(account.state);
  const cells = account.spans.flatMap((span) => cellsOf(span, states, changes));
  const last = account.spans[account.spans.length - 1];
  const covered = last ? last.from + last.thinks : 0;
  const asked = askedThinks(input);
  const markers = [...inputMarkers(input), ...pageMarkers(account.spans)].sort((a, b) => a.at - b.at);
  return {
    runId: account.runId,
    ...(asked === undefined ? {} : { asked }),
    thinks: account.thinks,
    covered,
    cells,
    markers,
    dispatchTotals: account.dispatchTotals,
    ...(account.world ? { world: account.world } : {}),
    excludedRules: account.excludedRules,
    identityTruncated: account.identityTruncated,
  };
}

/**
 * The rehearsal `call` asked for, as the transcript draws it, or `undefined`
 * when the call asked for none. A rehearsal that never ran comes back carrying
 * the code that stopped it and an empty timeline.
 */
export function runEvidence(call: ConversationToolCall): RunEvidence | undefined {
  const outcome = rehearsalOutcome(call);
  if (!outcome) return undefined;
  if (outcome.kind === "ran") return evidenceOf(outcome.account, call.input);
  const asked = askedThinks(call.input);
  return {
    runId: "",
    blocked: outcome.code,
    ...(asked === undefined ? {} : { asked }),
    thinks: 0,
    covered: 0,
    cells: [],
    markers: inputMarkers(call.input),
    dispatchTotals: [],
    excludedRules: [],
    identityTruncated: false,
  };
}
