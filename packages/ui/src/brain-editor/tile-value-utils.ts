import { CoreTypeIds } from "@mindcraft-lang/core/brain";

/**
 * Formats a value according to its type for display.
 * Checks core types first, then delegates to custom literal types from the host app.
 */
export function formatValue(
  value: unknown,
  valueType: string,
  customLiteralTypes: ReadonlyArray<{ typeId: string; formatValue: (value: unknown) => string }>
): string {
  if (valueType === CoreTypeIds.Number) {
    return typeof value === "number" ? value.toLocaleString() : String(value);
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
