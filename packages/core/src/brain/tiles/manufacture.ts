import { StringUtils as SU } from "../../platform/string";
import type { IBrainTileDef, ITileCatalog, LiteralDisplayFormat } from "../interfaces";
import type { BrainTileFactoryDef } from "./factories";
import type { BrainTileLiteralDef } from "./literals";
import type { BrainTileVariableDef } from "./variables";

/**
 * Manufacture the literal tile a literal factory produces for `value` and
 * resolve it against `catalog`: an equivalent registered literal is reused,
 * otherwise the new tile is registered. Returns undefined when the factory
 * manufactures nothing.
 */
export function manufactureLiteralTile(
  factoryTileDef: BrainTileFactoryDef,
  catalog: ITileCatalog | undefined,
  value: unknown,
  displayFormat?: LiteralDisplayFormat
): BrainTileLiteralDef | undefined {
  const newTileDef = factoryTileDef.manufacture(factoryTileDef, { value, displayFormat }) as
    | BrainTileLiteralDef
    | undefined;
  if (!newTileDef) return undefined;
  if (!catalog) return newTileDef;
  const existingDef = catalog.find((td: IBrainTileDef) => {
    if (td.kind !== "literal") return false;
    const litTileDef = td as BrainTileLiteralDef;
    return (
      litTileDef.value === value &&
      litTileDef.valueType === newTileDef.valueType &&
      litTileDef.displayFormat === newTileDef.displayFormat
    );
  }) as BrainTileLiteralDef | undefined;
  if (existingDef) return existingDef;
  catalog.registerTileDef(newTileDef);
  return newTileDef;
}

/**
 * Manufacture the variable tile a variable factory produces for `varName` and
 * resolve it against `catalog`: a registered variable of the same name and type
 * is reused, otherwise the new tile is registered. Returns undefined when the
 * name is empty or the factory manufactures nothing.
 */
export function manufactureVariableTile(
  factoryTileDef: BrainTileFactoryDef,
  catalog: ITileCatalog | undefined,
  varName: string
): BrainTileVariableDef | undefined {
  const name = SU.trim(varName);
  if (!name) return undefined;
  const newTileDef = factoryTileDef.manufacture(factoryTileDef, { name }) as BrainTileVariableDef | undefined;
  if (!newTileDef) return undefined;
  if (!catalog) return newTileDef;
  const existingDef = catalog.find((td: IBrainTileDef) => {
    if (td.kind !== "variable") return false;
    const varTileDef = td as BrainTileVariableDef;
    return varTileDef.varName === name && varTileDef.varType === newTileDef.varType;
  }) as BrainTileVariableDef | undefined;
  if (existingDef) return existingDef;
  catalog.registerTileDef(newTileDef);
  return newTileDef;
}
