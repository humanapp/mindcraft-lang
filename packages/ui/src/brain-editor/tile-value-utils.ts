import type { LiteralDisplayFormat } from "@mindcraft-lang/core/brain";
import { CoreTypeIds } from "@mindcraft-lang/core/brain";
import { applyDisplayFormat } from "@mindcraft-lang/core/brain/tiles";

/**
 * Formats a value according to its type for display.
 * When a displayFormat is provided for numeric types, it takes precedence
 * over the default formatting.
 */
export function formatValue(
  value: unknown,
  valueType: string,
  customLiteralTypes: ReadonlyArray<{ typeId: string; formatValue: (value: unknown) => string }>,
  displayFormat?: LiteralDisplayFormat
): string {
  if (valueType === CoreTypeIds.Number) {
    if (typeof value === "number") {
      if (displayFormat && displayFormat !== "default") {
        return applyDisplayFormat(value, displayFormat);
      }
      return value.toLocaleString();
    }
    return String(value);
  }

  if (valueType === CoreTypeIds.String) {
    return `"${String(value)}"`;
  }

  // Check custom literal types from the host app
  for (const customType of customLiteralTypes) {
    if (valueType === customType.typeId) {
      return customType.formatValue(value);
    }
  }

  return String(value);
}
