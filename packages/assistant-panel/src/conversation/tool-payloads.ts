import type { EditOutcome, ProjectPageRef, ProjectRule, ProjectTile } from "@wendoo/assistant-bridge";
import type { ConversationToolCall } from "@wendoo/assistant-relay";

/**
 * A rejected proposal as the transcript reads it: the stable diagnostic code
 * that refused the edit and the machine-readable values placing it.
 */
export interface RefusedProposal {
  readonly code: number;
  /** Values the rejecting diagnostic reported, keyed as the bridge serialized them. */
  readonly params: Readonly<Record<string, string | number | readonly string[]>>;
}

/** Every editor command one accepted `propose_edit` call landed, in the order they ran. */
export type LandedCommands = readonly EditOutcome[];

/** `value` as a plain object, or `undefined` for anything else. */
function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** `value` as a page reference, or `undefined` when it does not carry one. */
function asPageRef(value: unknown): ProjectPageRef | undefined {
  const page = asObject(value);
  if (!page) return undefined;
  const { pageId, pageIndex, name } = page;
  if (typeof pageId !== "string" || typeof pageIndex !== "number" || typeof name !== "string") return undefined;
  return { pageId, pageIndex, name };
}

/** `value` as a run of tiles on one rule side, empty for anything that is not one. */
function asTiles(value: unknown): ProjectTile[] {
  if (!Array.isArray(value)) return [];
  const tiles: ProjectTile[] = [];
  for (const entry of value) {
    const tile = asObject(entry);
    if (tile && typeof tile.tileId === "string" && typeof tile.label === "string") {
      tiles.push({ tileId: tile.tileId, label: tile.label });
    }
  }
  return tiles;
}

/** `value` as a rule of the document, or `undefined` when it does not carry one. */
export function asProjectRule(value: unknown): ProjectRule | undefined {
  const rule = asObject(value);
  if (!rule || typeof rule.ruleId !== "string") return undefined;
  const children: ProjectRule[] = [];
  if (Array.isArray(rule.children)) {
    for (const entry of rule.children) {
      const child = asProjectRule(entry);
      if (child) children.push(child);
    }
  }
  return { ruleId: rule.ruleId, when: asTiles(rule.when), do: asTiles(rule.do), children };
}

/** `value` as what one editor command left behind, or `undefined` when it is not one. */
function asEditOutcome(value: unknown): EditOutcome | undefined {
  const outcome = asObject(value);
  if (!outcome) return undefined;
  const rule = asProjectRule(outcome.rule);
  const page = asPageRef(outcome.page);
  const onPage = asPageRef(outcome.onPage);
  const removed = outcome.removed === "rule" || outcome.removed === "page" ? outcome.removed : undefined;
  return {
    ...(rule ? { rule } : {}),
    ...(page ? { page } : {}),
    ...(onPage ? { onPage } : {}),
    ...(removed ? { removed } : {}),
  };
}

/**
 * What one `propose_edit` call left in the document, one entry per editor
 * command it ran, or `undefined` when the call was not an accepted proposal. A
 * single-command call reports one entry; a batch reports one per command, in
 * the order they ran.
 */
export function landedCommands(call: ConversationToolCall): LandedCommands | undefined {
  if (call.name !== "propose_edit") return undefined;
  const { outcome } = call;
  if (outcome.kind !== "ok" || outcome.isError === true) return undefined;
  const payload = asObject(outcome.payload);
  if (!payload || payload.ok !== true) return undefined;
  if (!Array.isArray(payload.results)) {
    const single = asEditOutcome(payload);
    return single ? [single] : undefined;
  }
  const results: EditOutcome[] = [];
  for (const entry of payload.results) {
    const landed = asEditOutcome(entry);
    if (landed) results.push(landed);
  }
  return results;
}

/**
 * Why a `propose_edit` call was refused, or `undefined` when the call was not a
 * refusal the policy made. A call that named something the document does not
 * hold never reached validation and carries no diagnostic, so it is not one.
 */
export function refusedProposal(call: ConversationToolCall): RefusedProposal | undefined {
  if (call.name !== "propose_edit") return undefined;
  const { outcome } = call;
  if (outcome.kind !== "ok" || outcome.isError === true) return undefined;
  const payload = asObject(outcome.payload);
  if (!payload || payload.ok !== false || typeof payload.code !== "number") return undefined;
  const params = asObject(payload.params) ?? {};
  return { code: payload.code, params: params as RefusedProposal["params"] };
}

/** Whether `call` is a `compile` that reported a brain building all the way through. */
export function compiledClean(call: ConversationToolCall): boolean {
  if (call.name !== "compile") return false;
  const { outcome } = call;
  if (outcome.kind !== "ok" || outcome.isError === true) return false;
  return asObject(outcome.payload)?.ok === true;
}

/** One thing the builder reported about a brain that does not build. */
export interface BuildDiagnostic {
  /** Stable diagnostic code, as the builder reported it. */
  readonly code: number;
  /** How much the diagnostic stops, as the builder graded it. */
  readonly severity: string;
  /** Durable id of the rule the diagnostic falls in; absent when it names none. */
  readonly ruleId?: string;
}

/** `value` as one thing the builder reported, or `undefined` when it is not one. */
function asBuildDiagnostic(value: unknown): BuildDiagnostic | undefined {
  const diagnostic = asObject(value);
  if (!diagnostic || typeof diagnostic.code !== "number") return undefined;
  const severity = typeof diagnostic.severity === "string" ? diagnostic.severity : "";
  const ruleId = diagnostic.ruleId;
  return { code: diagnostic.code, severity, ...(typeof ruleId === "string" ? { ruleId } : {}) };
}

/**
 * What a `compile` reported about a brain that does not build, in report order,
 * or `undefined` when the call was not a build that came back dirty. A build
 * that came back clean, and any call of another tool, is not one.
 */
export function dirtyBuild(call: ConversationToolCall): readonly BuildDiagnostic[] | undefined {
  if (call.name !== "compile") return undefined;
  const { outcome } = call;
  if (outcome.kind !== "ok" || outcome.isError === true) return undefined;
  const payload = asObject(outcome.payload);
  if (!payload || payload.ok !== false) return undefined;
  const reported = Array.isArray(payload.diagnostics) ? payload.diagnostics : [];
  const diagnostics: BuildDiagnostic[] = [];
  for (const entry of reported) {
    const diagnostic = asBuildDiagnostic(entry);
    if (diagnostic) diagnostics.push(diagnostic);
  }
  return diagnostics;
}

/** One stretch of a rehearsal the account reports as a single run of alike thinks. */
export interface RehearsalSpan {
  /** Index of the stretch's first think. */
  readonly from: number;
  /** Thinks the stretch covers. */
  readonly thinks: number;
  /** Durable ids of the rules whose gate passed. */
  readonly fired: readonly string[];
  /** Every rule that reached its gate and what it produced, as `ruleId=value`. */
  readonly when: readonly string[];
  /** Host action calls made, as `action(args)[notes]=count@ruleId`. */
  readonly dispatched: readonly string[];
  /** Durable ids of the rules parked on an asynchronous call. */
  readonly waiting: readonly string[];
  /** The page change the stretch began with, as `from->to` page indices; absent when the page held. */
  readonly page?: string;
}

/** What the staged world looked like around the brain under study. */
export interface RehearsalWorld {
  readonly initialPopulation: number;
  readonly finalPopulation: number;
  readonly brainsExecuted: number;
}

/** The account one rehearsal that ran came back with. */
export interface RehearsalAccount {
  /** Id the rehearsal is addressed by, as the target that ran it numbered it. */
  readonly runId: string;
  /** Thinks the run executed. */
  readonly thinks: number;
  readonly spans: readonly RehearsalSpan[];
  /** `true` when {@link spans} was cut at its budget and does not cover the whole run. */
  readonly spansTruncated: boolean;
  /**
   * Subject state changes over the run, as `think channel=value` entries in
   * think order, empty for a run whose target declares no channel.
   */
  readonly state: readonly string[];
  /** The state the run stood in, as `think hash` entries in think order. */
  readonly identity: readonly string[];
  /** `true` when {@link identity} was cut at its budget and does not cover the whole run. */
  readonly identityTruncated: boolean;
  /** Host action calls over the whole run, as `action(args)=count` entries. */
  readonly dispatchTotals: readonly string[];
  /** What the staged world looked like; absent when the account reported none. */
  readonly world?: RehearsalWorld;
  /** Durable ids of the rules the run was staged without. */
  readonly excludedRules: readonly string[];
}

/** One rehearsal a turn asked for: the account it came back with, or why it never ran. */
export type RehearsalOutcome =
  | { readonly kind: "ran"; readonly account: RehearsalAccount }
  | { readonly kind: "blocked"; readonly code: string };

/** What a rehearsal that never ran reports when nothing said why. */
const unstatedBlock = "blocked";

/** `value` as a run of strings, keeping only the entries that are ones. */
function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/** `value` as one stretch of a rehearsal, or `undefined` when it is not one. */
function asRehearsalSpan(value: unknown): RehearsalSpan | undefined {
  const span = asObject(value);
  if (!span || typeof span.from !== "number" || typeof span.thinks !== "number") return undefined;
  const think = asObject(span.think) ?? {};
  const page = think.page;
  return {
    from: span.from,
    thinks: span.thinks,
    fired: asStrings(think.fired),
    when: asStrings(think.when),
    dispatched: asStrings(think.dispatched),
    waiting: asStrings(think.waiting),
    ...(typeof page === "string" ? { page } : {}),
  };
}

/** `value` as what the staged world looked like, or `undefined` when it does not carry it. */
function asRehearsalWorld(value: unknown): RehearsalWorld | undefined {
  const world = asObject(value);
  if (!world) return undefined;
  const { initialPopulation, finalPopulation, brainsExecuted } = world;
  if (typeof initialPopulation !== "number" || typeof finalPopulation !== "number") return undefined;
  if (typeof brainsExecuted !== "number") return undefined;
  return { initialPopulation, finalPopulation, brainsExecuted };
}

/** `value` as the account a rehearsal came back with, or `undefined` when it is not one. */
function asRehearsalAccount(value: unknown): RehearsalAccount | undefined {
  const summary = asObject(value);
  if (!summary || typeof summary.thinks !== "number") return undefined;
  const spans: RehearsalSpan[] = [];
  for (const entry of Array.isArray(summary.spans) ? summary.spans : []) {
    const span = asRehearsalSpan(entry);
    if (span) spans.push(span);
  }
  const world = asRehearsalWorld(summary.world);
  const excluded = Array.isArray(summary.excludedRules) ? summary.excludedRules : [];
  return {
    runId: typeof summary.runId === "string" ? summary.runId : "",
    thinks: summary.thinks,
    spans,
    spansTruncated: summary.spansTruncated === true,
    state: asStrings(summary.state),
    identity: asStrings(summary.identity),
    identityTruncated: summary.identityTruncated === true,
    dispatchTotals: asStrings(summary.dispatchTotals),
    ...(world ? { world } : {}),
    excludedRules: excluded
      .map((entry) => asObject(entry)?.ruleId)
      .filter((ruleId): ruleId is string => typeof ruleId === "string"),
  };
}

/**
 * What one `simulate` call came to, or `undefined` when the call was not one. A
 * call the bridge could not serve, one the person's mediation answered, and one
 * the target refused all come back blocked, under the code that stopped them.
 */
export function rehearsalOutcome(call: ConversationToolCall): RehearsalOutcome | undefined {
  if (call.name !== "simulate") return undefined;
  const { outcome } = call;
  if (outcome.kind !== "ok") return { kind: "blocked", code: outcome.code };
  const payload = asObject(outcome.payload);
  if (outcome.isError === true || payload?.ok === false) {
    const code = payload?.error;
    return { kind: "blocked", code: typeof code === "string" ? code : unstatedBlock };
  }
  const account = asRehearsalAccount(payload?.summary);
  return account ? { kind: "ran", account } : { kind: "blocked", code: unstatedBlock };
}

/** Add every `{tileId, label}` pair `value` holds, however deeply, to `into`. */
function collectLabels(value: unknown, into: Map<string, string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectLabels(entry, into);
    return;
  }
  const held = asObject(value);
  if (!held) return;
  if (typeof held.tileId === "string" && typeof held.label === "string" && !into.has(held.tileId)) {
    into.set(held.tileId, held.label);
  }
  for (const entry of Object.values(held)) collectLabels(entry, into);
}

/**
 * The word each tile reads by, keyed by tile id, gathered from every payload
 * the conversation has already carried -- the catalog, the tiles offered for a
 * position, and the rules edits report back. A tile no payload has named yet is
 * absent.
 */
export function tileLabels(calls: Iterable<ConversationToolCall>): ReadonlyMap<string, string> {
  const labels = new Map<string, string>();
  for (const call of calls) {
    if (call.outcome.kind === "ok" && call.outcome.isError !== true) collectLabels(call.outcome.payload, labels);
  }
  return labels;
}
