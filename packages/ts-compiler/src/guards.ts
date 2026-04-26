import type { BrainActionCallSpec } from "@mindcraft-lang/core/brain";
import type { ExtractedParam } from "./compiler/types.js";

/** Type guard: narrow `value` to a non-null object record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Type guard for `string | undefined`. */
export function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

/** Type guard for `string[] | undefined` (every element is a string). */
export function isOptionalStringArray(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((v) => typeof v === "string"));
}

/** Type guard for `boolean | undefined`. */
export function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

/** Type guard for `number | undefined`. */
export function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === "number";
}

function isDefaultValue(value: unknown): value is ExtractedParam["defaultValue"] {
  return (
    value === undefined ||
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  );
}

/** Type guard: narrow `value` to an {@link ExtractedParam}. */
export function isExtractedParam(value: unknown): value is ExtractedParam {
  return (
    isRecord(value) &&
    value.kind === "param" &&
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.anonymous === "boolean" &&
    isDefaultValue(value.defaultValue)
  );
}

/** Type guard: narrow `value` to a {@link BrainActionCallSpec}. */
export function isCallSpec(value: unknown): value is BrainActionCallSpec {
  if (!isRecord(value) || typeof value.type !== "string" || !isOptionalString(value.name)) {
    return false;
  }

  switch (value.type) {
    case "arg":
      return (
        typeof value.tileId === "string" && isOptionalBoolean(value.required) && isOptionalBoolean(value.anonymous)
      );
    case "seq":
    case "bag":
      return Array.isArray(value.items) && value.items.every(isCallSpec);
    case "choice":
      return Array.isArray(value.options) && value.options.every(isCallSpec);
    case "optional":
      return isCallSpec(value.item);
    case "repeat":
      return isCallSpec(value.item) && isOptionalNumber(value.min) && isOptionalNumber(value.max);
    case "conditional":
      return (
        typeof value.condition === "string" &&
        isCallSpec(value.then) &&
        (value.else === undefined || isCallSpec(value.else))
      );
    default:
      return false;
  }
}
