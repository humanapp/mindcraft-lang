import { RuleSide } from "@wendoo/core/brain";
import type { DiagCode, DiagParams } from "@wendoo/core/brain/compiler";
import type { RuleSideName } from "./tool-schemas.js";

/**
 * One diagnostic param value after serialization: a scalar, or the array a
 * core `ReadonlyList` param flattens to.
 */
export type DiagParamValue = string | number | readonly string[];

/** A diagnostic's structured params, in a JSON-serializable form. */
export type SerializedDiagParams = Readonly<Record<string, DiagParamValue>>;

/** A diagnostic as it reaches the model: a stable code plus its structured params. */
export interface ToolDiagnostic {
  /** Stable numeric diagnostic code. */
  readonly code: DiagCode;
  /** Machine-readable values the diagnostic reports; absent when it carries none. */
  readonly params?: SerializedDiagParams;
}

/**
 * The name a diagnostic reports a rule side by: `"when"`, `"do"`, or `"either"`
 * for a diagnostic that applies to both sides.
 */
export type DiagnosticRuleSideName = RuleSideName | "either";

/** Core `RuleSide` bitmask rendered as the name the model reads and writes. */
export function ruleSideName(side: RuleSide): DiagnosticRuleSideName {
  if (side === RuleSide.When) return "when";
  if (side === RuleSide.Do) return "do";
  return "either";
}

/** True when `value` carries the `toArray` method every core `ReadonlyList` has. */
function isListLike(value: unknown): value is { toArray: () => unknown[] } {
  return typeof value === "object" && value !== null && typeof (value as { toArray?: unknown }).toArray === "function";
}

/**
 * Flatten one core diagnostic param to a JSON-serializable value. List-valued
 * params become arrays of strings, the `side` param becomes its name, and every
 * other value passes through as a string or number.
 */
function serializeDiagParam(key: string, value: unknown): DiagParamValue | undefined {
  if (value === undefined) return undefined;
  if (isListLike(value)) return value.toArray().map((entry) => String(entry));
  if (key === "side" && typeof value === "number") return ruleSideName(value);
  if (typeof value === "number") return value;
  return String(value);
}

/**
 * Render a diagnostic's params in the JSON-serializable form the model reads.
 * The `rulePath` core reports is replaced by `ruleId`, the durable id
 * `ruleIds` holds for that path. A path `ruleIds` does not hold names a rule
 * the document no longer has, and reaches the model as no address at all.
 * Returns `undefined` when nothing is left to report.
 *
 * @param ruleIds - Durable rule id per rule path, for the document the
 *   diagnostic was reported against.
 */
export function serializeDiagParams(
  params: DiagParams | undefined,
  ruleIds: ReadonlyMap<string, string>
): SerializedDiagParams | undefined {
  if (!params) return undefined;
  const serialized: Record<string, DiagParamValue> = {};
  let count = 0;
  for (const [key, value] of Object.entries(params)) {
    if (key === "rulePath") {
      const ruleId = typeof value === "string" ? ruleIds.get(value) : undefined;
      if (ruleId === undefined) continue;
      serialized.ruleId = ruleId;
      count++;
      continue;
    }
    const entry = serializeDiagParam(key, value);
    if (entry === undefined) continue;
    serialized[key] = entry;
    count++;
  }
  return count === 0 ? undefined : serialized;
}

/**
 * Build the model-facing diagnostic for `code` and its raw core params, with
 * the rule it names addressed by the id every tool uses.
 *
 * @param ruleIds - Durable rule id per rule path, for the document the
 *   diagnostic was reported against.
 */
export function toToolDiagnostic(
  code: DiagCode,
  params: DiagParams | undefined,
  ruleIds: ReadonlyMap<string, string>
): ToolDiagnostic {
  const serialized = serializeDiagParams(params, ruleIds);
  return serialized ? { code, params: serialized } : { code };
}
