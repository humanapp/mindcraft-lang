import { StringUtils as SU } from "../../platform/string";
import type { IBrainTileDef, ITileCatalog, LiteralDisplayFormat } from "../interfaces";
import type { BrainTileFactoryDef } from "./factories";
import type { BrainTileLiteralDef } from "./literals";
import type { BrainTileVariableDef } from "./variables";

/**
 * Manufacture the literal tile a literal factory produces for `value` and
 * resolve it against `catalog`: a literal already registered under the
 * manufactured tile's id is reused, otherwise the new tile is registered.
 * Returns undefined when the factory manufactures nothing.
 *
 * `displayName` is the word the resolved literal reads by, and reaches the
 * factory as a `displayName` manufacture option. A name that is blank or all
 * blanks names nothing, and a name given for a tile id already registered
 * renames that literal in place.
 *
 * A factory minting a fresh identity per manufacture resolves against nothing,
 * so each call registers a tile of its own.
 */
export function manufactureLiteralTile(
  factoryTileDef: BrainTileFactoryDef,
  catalog: ITileCatalog | undefined,
  value: unknown,
  displayFormat?: LiteralDisplayFormat,
  displayName?: string
): BrainTileLiteralDef | undefined {
  const trimmedName = displayName === undefined ? "" : SU.trim(displayName);
  const name = trimmedName === "" ? undefined : trimmedName;
  const newTileDef = factoryTileDef.manufacture(factoryTileDef, { value, displayFormat, displayName: name }) as
    | BrainTileLiteralDef
    | undefined;
  if (!newTileDef) return undefined;
  const existingDef = catalog ? (catalog.get(newTileDef.tileId) as BrainTileLiteralDef | undefined) : undefined;
  const tileDef = existingDef ?? newTileDef;
  if (name !== undefined && tileDef.displayName !== name) tileDef.setDisplayName(name);
  if (catalog && !existingDef) catalog.registerTileDef(tileDef);
  return tileDef;
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
