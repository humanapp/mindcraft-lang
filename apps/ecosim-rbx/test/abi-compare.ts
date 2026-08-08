import assert from "node:assert/strict";
import type { JsonValue, SnapshotMap } from "./abi-snapshot";

/** Label used for the ecosim webapp side of a comparison. */
export const WEB_SIDE = "ecosim";

/** Label used for the Roblox mirror side of a comparison. */
export const RBX_SIDE = "ecosim-rbx";

function render(value: JsonValue | undefined): string {
  return value === undefined ? "<absent>" : JSON.stringify(value);
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Locates the first structural difference between two snapshots.
 *
 * @param web - The value produced by the ecosim registration.
 * @param rbx - The value produced by the ecosim-rbx registration.
 * @param path - Dotted path prefix used when naming the difference.
 * @returns A description naming the diverging path and both values, or
 *   `undefined` when the two are equal.
 */
export function firstDifference(web: JsonValue, rbx: JsonValue, path: string): string | undefined {
  if (Array.isArray(web) || Array.isArray(rbx)) {
    if (!Array.isArray(web) || !Array.isArray(rbx)) {
      return `${path}: ${WEB_SIDE}=${render(web)} ${RBX_SIDE}=${render(rbx)}`;
    }
    if (web.length !== rbx.length) {
      return `${path}.length: ${WEB_SIDE}=${web.length} ${RBX_SIDE}=${rbx.length}`;
    }
    for (let i = 0; i < web.length; i++) {
      const diff = firstDifference(web[i], rbx[i], `${path}[${i}]`);
      if (diff !== undefined) return diff;
    }
    return undefined;
  }

  if (isRecord(web) || isRecord(rbx)) {
    if (!isRecord(web) || !isRecord(rbx)) {
      return `${path}: ${WEB_SIDE}=${render(web)} ${RBX_SIDE}=${render(rbx)}`;
    }
    const keys = Array.from(new Set([...Object.keys(web), ...Object.keys(rbx)])).sort();
    for (const key of keys) {
      const diff = firstDifference(web[key] ?? null, rbx[key] ?? null, `${path}.${key}`);
      if (diff !== undefined) return diff;
    }
    return undefined;
  }

  if (web !== rbx) {
    return `${path}: ${WEB_SIDE}=${render(web)} ${RBX_SIDE}=${render(rbx)}`;
  }
  return undefined;
}

/**
 * Asserts that two snapshots are equal, failing with the exact diverging path.
 *
 * @param web - The value produced by the ecosim registration.
 * @param rbx - The value produced by the ecosim-rbx registration.
 * @param label - Machine identifier of the artifact under comparison.
 */
export function assertSnapshotsEqual(web: JsonValue, rbx: JsonValue, label: string): void {
  const diff = firstDifference(web, rbx, label);
  assert.equal(diff, undefined, diff);
}

/**
 * Asserts that two snapshot maps hold the same keys and the same value for
 * every key. Missing and extra keys are reported by id before any per-entry
 * comparison runs.
 *
 * @param web - Snapshots taken from the ecosim environment.
 * @param rbx - Snapshots taken from the ecosim-rbx environment.
 * @param what - Name of the registry, used in failure messages.
 */
export function assertSnapshotMapsEqual(web: SnapshotMap, rbx: SnapshotMap, what: string): void {
  const webKeys = Array.from(web.keys()).sort();
  const rbxKeys = Array.from(rbx.keys()).sort();

  const missing = webKeys.filter((key) => !rbx.has(key));
  const extra = rbxKeys.filter((key) => !web.has(key));
  assert.equal(
    missing.length,
    0,
    `${what}: ${RBX_SIDE} is missing ${missing.length} entry/entries registered by ${WEB_SIDE}: ${missing.join(", ")}`
  );
  assert.equal(
    extra.length,
    0,
    `${what}: ${RBX_SIDE} registers ${extra.length} entry/entries ${WEB_SIDE} does not: ${extra.join(", ")}`
  );

  for (const key of webKeys) {
    assertSnapshotsEqual(web.get(key) as JsonValue, rbx.get(key) as JsonValue, `${what}[${key}]`);
  }
}
