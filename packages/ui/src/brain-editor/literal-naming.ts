import type { ITileCatalog } from "@wendoo/core/brain";
import type { BrainTileLiteralDef } from "@wendoo/core/brain/tiles";
import type { CustomLiteralType } from "./BrainEditorContext";
import { resolveTileVisualFrom } from "./tile-visual-utils";

/** The base word a literal type supplying none and named by no type entry is numbered from. */
export const kDefaultLiteralNameBase = "value";

/**
 * The base word the names of `typeId`'s literals are built from: the type's own
 * {@link CustomLiteralType.nameBase}, the word `dataTypeNames` calls the type
 * by, or {@link kDefaultLiteralNameBase}.
 *
 * @param typeId the value type the literal being named holds
 * @param customType the host's entry for that type, and undefined where it supplies none
 * @param dataTypeNames the type words the host config carries
 */
export function literalNameBase(
  typeId: string,
  customType: CustomLiteralType | undefined,
  dataTypeNames: ReadonlyMap<string, string>
): string {
  return customType?.nameBase ?? dataTypeNames.get(typeId) ?? kDefaultLiteralNameBase;
}

/** The word `literalDef` reads by on the editor's surfaces. */
export function literalWord(literalDef: BrainTileLiteralDef): string {
  return resolveTileVisualFrom(undefined, literalDef).label;
}

/**
 * The words the literals of `valueType` in `catalogs` already read by. Pass
 * every catalog a name has to be free of: the host's environment catalogs and
 * the brain's own. A catalog of `undefined` contributes nothing.
 */
export function takenLiteralNames(catalogs: ReadonlyArray<ITileCatalog | undefined>, valueType: string): Set<string> {
  const names = new Set<string>();
  for (const catalog of catalogs) {
    if (!catalog) continue;
    for (const tileDef of catalog.getAll().toArray()) {
      if (tileDef.kind !== "literal") continue;
      const literalDef = tileDef as BrainTileLiteralDef;
      if (literalDef.valueType !== valueType) continue;
      names.add(literalWord(literalDef));
    }
  }
  return names;
}

/**
 * The words the literals of `valueType` read by across every catalog a new name
 * has to be free of: the host config's environment catalogs and the brain's
 * own. Either may be `undefined`, contributing nothing.
 *
 * @param hostCatalogs the environment catalogs the host config carries
 * @param brainCatalog the catalog of the brain being edited
 * @param valueType the value type the literal being named holds
 */
export function takenLiteralNamesAround(
  hostCatalogs: ReadonlyArray<ITileCatalog> | undefined,
  brainCatalog: ITileCatalog | undefined,
  valueType: string
): Set<string> {
  return takenLiteralNames([...(hostCatalogs ?? []), brainCatalog], valueType);
}

/**
 * The word `sourceWord` is numbered from: `sourceWord` itself, less a single
 * trailing space-separated run of digits ("image 1" -> "image"). A word ending
 * in anything else stems as itself ("rock v2" -> "rock v2"; "42" -> "42").
 */
function nameStem(sourceWord: string): string {
  const numbered = /^(.+) \d+$/.exec(sourceWord);
  return numbered === null ? sourceWord : numbered[1];
}

/**
 * The name a literal derived from `sourceWord` is offered: the stem of that
 * word (see above) followed by the smallest number `taken` leaves free, counted
 * from 2 where the bare stem is itself taken and from 1 where it is not. Freed
 * numbers are reused, so `taken` holding "image 1" and "image 3" yields
 * "image 2".
 *
 * One rule serves both a literal created from nothing, whose `sourceWord` is
 * the type's base word ("image" -> "image 1"), and a literal forked from
 * another, whose `sourceWord` is the word that one reads by ("image 1" ->
 * "image 2", never "image 1 2").
 *
 * @param sourceWord the word the new name is derived from
 * @param taken every name the literals of that type already read by
 */
export function unusedNumberedName(sourceWord: string, taken: ReadonlySet<string>): string {
  const stem = nameStem(sourceWord);
  let index = taken.has(stem) ? 2 : 1;
  while (taken.has(`${stem} ${index}`)) index += 1;
  return `${stem} ${index}`;
}
