import { CoreTypeIds, type IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { BrainTileAccessorDef, BrainTileLiteralDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import { MyTypeIds } from "@/brain/type-system";

interface TileValueProps {
  tileDef: IBrainTileDef;
}

/**
 * Renders the actual value for literal and variable tiles
 * according to their datatype.
 */
export function TileValue({ tileDef }: TileValueProps) {
  const textColor = "#363535";

  if (tileDef.kind === "literal") {
    const literalDef = tileDef as BrainTileLiteralDef;
    const value = literalDef.valueLabel || literalDef.value;
    const valueType = literalDef.valueType;
    const textSizeClass = valueType === CoreTypeIds.Number ? "text-2xl" : "text-md";

    return (
      <span className={`font-mono ${textSizeClass}`} style={{ color: textColor }}>
        {formatValue(value, valueType)}
      </span>
    );
  }

  if (tileDef.kind === "variable") {
    const variableDef = tileDef as BrainTileVariableDef;
    const varName = variableDef.varName;
    const varType = variableDef.varType;
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
        {formatValue(value, valueType)}
      </span>
    );
  }

  return null;
}

/**
 * Formats a value according to its type for display.
 * Add new type handlers here as more datatypes are supported.
 */
function formatValue(value: unknown, valueType: string): string {
  // Handle number type
  if (valueType === CoreTypeIds.Number) {
    return typeof value === "number" ? value.toLocaleString() : String(value);
  }

  // Handle string type
  if (valueType === CoreTypeIds.String) {
    return `"${String(value)}"`;
  }

  // Handle vector2 type
  if (valueType === MyTypeIds.Vector2) {
    if (value && typeof value === "object" && "X" in value && "Y" in value) {
      const v = value as { X: number; Y: number };
      return `(${v.X}, ${v.Y})`;
    }
    return String(value);
  }

  // TODO: Add actor type (show the archetype icon)

  // Fallback for unknown types
  return String(value);
}
