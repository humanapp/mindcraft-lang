import { CoreTypeIds, type IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { BrainTileAccessorDef, BrainTileLiteralDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import { useBrainEditorConfig } from "./BrainEditorContext";

interface TileValueProps {
  tileDef: IBrainTileDef;
}

/**
 * Renders the actual value for literal and variable tiles
 * according to their datatype.
 */
export function TileValue({ tileDef }: TileValueProps) {
  const { customLiteralTypes } = useBrainEditorConfig();
  const textColor = "#363535";

  if (tileDef.kind === "literal") {
    const literalDef = tileDef as BrainTileLiteralDef;
    const value = literalDef.valueLabel || literalDef.value;
    const valueType = literalDef.valueType;
    const textSizeClass = valueType === CoreTypeIds.Number ? "text-2xl" : "text-md";

    return (
      <span className={`font-mono ${textSizeClass}`} style={{ color: textColor }}>
        {formatValue(value, valueType, customLiteralTypes)}
      </span>
    );
  }

  if (tileDef.kind === "variable") {
    const variableDef = tileDef as BrainTileVariableDef;
    const varName = variableDef.varName;
    const textSizeClass = "text-md";

    return (
      <span className={`font-mono italic ${textSizeClass}`} style={{ color: textColor }}>
        {varName}
      </span>
    );
  }

  if (tileDef.kind === "accessor") {
    const accessorDef = tileDef as BrainTileAccessorDef;
    const value = accessorDef.fieldName;
    const valueType = accessorDef.fieldTypeId;
    const textSizeClass = "text-md";

    return (
      <span className={`font-mono ${textSizeClass}`} style={{ color: textColor }}>
        {formatValue(value, valueType, customLiteralTypes)}
      </span>
    );
  }

  return null;
}

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
