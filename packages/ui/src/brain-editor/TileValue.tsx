import type { IBrainTileDef } from "@mindcraft-lang/core/brain";
import type { BrainTileAccessorDef, BrainTileLiteralDef, BrainTileVariableDef } from "@mindcraft-lang/core/brain/tiles";
import { useBrainEditorConfig } from "./BrainEditorContext";
import { formatValue } from "./tile-value-utils";

interface TileValueProps {
  tileDef: IBrainTileDef;
}

/**
 * Renders the actual value for literal and variable tiles
 * according to their datatype.
 */
export function TileValue({ tileDef }: TileValueProps) {
  const { customLiteralTypes } = useBrainEditorConfig();
  const textColor = "#1a1a1a";

  if (tileDef.kind === "literal") {
    const literalDef = tileDef as BrainTileLiteralDef;
    const value = literalDef.valueLabel || literalDef.value;
    const valueType = literalDef.valueType;
    const fontClass = "font-math";
    const textSizeClass = "text-2xl";

    return (
      <span className={`${fontClass} ${textSizeClass}`} style={{ color: textColor }}>
        {formatValue(value, valueType, customLiteralTypes)}
      </span>
    );
  }

  if (tileDef.kind === "variable") {
    const variableDef = tileDef as BrainTileVariableDef;
    const varName = variableDef.varName;
    const fontClass = "font-math";
    const textSizeClass = "text-2xl";

    return (
      <span className={`${fontClass} italic ${textSizeClass}`} style={{ color: textColor }}>
        {varName}
      </span>
    );
  }

  if (tileDef.kind === "accessor") {
    const accessorDef = tileDef as BrainTileAccessorDef;
    const value = accessorDef.fieldName;
    const valueType = accessorDef.fieldTypeId;
    const fontClass = "font-math";
    const textSizeClass = "text-2xl";

    return (
      <span className={`${fontClass} ${textSizeClass}`} style={{ color: textColor }}>
        {formatValue(value, valueType, customLiteralTypes)}
      </span>
    );
  }

  return null;
}
