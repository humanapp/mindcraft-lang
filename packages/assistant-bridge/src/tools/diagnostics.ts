import { RuleSide } from "@mindcraft-lang/core/brain";
import type { DiagCode, DiagParams } from "@mindcraft-lang/core/brain/compiler";
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
 * Render a diagnostic's params in a JSON-serializable form. Returns `undefined`
 * when the diagnostic carries no params at all.
 */
export function serializeDiagParams(params: DiagParams | undefined): SerializedDiagParams | undefined {
  if (!params) return undefined;
  const serialized: Record<string, DiagParamValue> = {};
  let count = 0;
  for (const [key, value] of Object.entries(params)) {
    const entry = serializeDiagParam(key, value);
    if (entry === undefined) continue;
    serialized[key] = entry;
    count++;
  }
  return count === 0 ? undefined : serialized;
}

/** Build the model-facing diagnostic for `code` and its raw core params. */
export function toToolDiagnostic(code: DiagCode, params: DiagParams | undefined): ToolDiagnostic {
  const serialized = serializeDiagParams(params);
  return serialized ? { code, params: serialized } : { code };
}
