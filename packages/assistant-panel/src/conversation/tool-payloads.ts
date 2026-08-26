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
