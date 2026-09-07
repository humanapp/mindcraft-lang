import { assertUnreachable } from "@wendoo/core";
import type { IBrainTileDef } from "@wendoo/core/brain";
import type {
  BrainTileAccessorDef,
  BrainTileLiteralDef,
  BrainTileOutputDef,
  BrainTileVariableDef,
} from "@wendoo/core/brain/tiles";
import type { ReactNode } from "react";
import { type CustomLiteralType, useBrainEditorConfig } from "./BrainEditorContext";
import { formatValue } from "./tile-value-utils";

/**
 * The node a placed literal of `tileDef` draws in its value box, from the
 * `renderValue` of the `customLiteralTypes` entry matching its value type.
 * Undefined for every tile whose value box draws text.
 */
export function customLiteralValueNode(
  tileDef: IBrainTileDef,
  customLiteralTypes: ReadonlyArray<CustomLiteralType>
): ReactNode | undefined {
  if (tileDef.kind !== "literal") return undefined;
  const literalDef = tileDef as BrainTileLiteralDef;
  return customLiteralTypes
    .find((customType) => customType.typeId === literalDef.valueType)
    ?.renderValue?.(literalDef.value);
}

interface TileValueProps {
  tileDef: IBrainTileDef;
}

/**
 * Renders the actual value for literal and variable tiles
 * according to their datatype. A literal whose value type has a
 * `customLiteralTypes` entry supplying `renderValue` renders the node that hook
 * returns for the literal's value.
 */
export function TileValue({ tileDef }: TileValueProps) {
  const { customLiteralTypes } = useBrainEditorConfig();
  const textColor = "#1a1a1a";

  switch (tileDef.kind) {
    case "literal": {
      const literalDef = tileDef as BrainTileLiteralDef;
      const customNode = customLiteralValueNode(tileDef, customLiteralTypes);
      if (customNode !== undefined) return customNode;

      const value =
        literalDef.displayFormat && literalDef.displayFormat !== "default"
          ? literalDef.value
          : literalDef.valueLabel || literalDef.value;
      const valueType = literalDef.valueType;
      const fontClass = "font-math";
      const textSizeClass = "text-2xl";

      return (
        <span className={`${fontClass} ${textSizeClass}`} style={{ color: textColor }}>
          {formatValue(value, valueType, customLiteralTypes, literalDef.displayFormat)}
        </span>
      );
    }
    case "variable": {
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
    case "accessor": {
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
    case "output": {
      const outputDef = tileDef as BrainTileOutputDef;
      const label = outputDef.metadata?.label ?? outputDef.outputName;
      const fontClass = "font-math";
      const textSizeClass = "text-2xl";

      return (
        <span className={`${fontClass} ${textSizeClass}`} style={{ color: textColor }}>
          {label}
        </span>
      );
    }
    case "undefined":
    case "sensor":
    case "actuator":
    case "parameter":
    case "operator":
    case "factory":
    case "controlFlow":
    case "modifier":
    case "page":
    case "missing":
      return null;
    default:
      return assertUnreachable(tileDef.kind);
  }
}
