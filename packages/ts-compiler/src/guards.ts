import type { BrainActionCallSpec } from "@mindcraft-lang/core/brain";
import type { ExtractedParam } from "./compiler/types.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

export function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

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

export function isExtractedParam(value: unknown): value is ExtractedParam {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.required === "boolean" &&
    typeof value.anonymous === "boolean" &&
    isDefaultValue(value.defaultValue)
  );
}

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
