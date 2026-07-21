import { Dict } from "../platform/dict";
import { List, type ReadonlyList } from "../platform/list";

/**
 * Converts JSON array payloads into a core {@link List}.
 *
 * @param items - JSON array payload.
 * @param convert - Item hydration function.
 */
export function listFromJson<TJson, TValue>(items: readonly TJson[], convert: (item: TJson) => TValue): List<TValue> {
  const source = List.from(items);
  const result = List.empty<TValue>();
  for (let i = 0; i < source.size(); i++) {
    result.push(convert(source.get(i)!));
  }
  return result;
}

/**
 * Converts a core {@link List} into a JSON array payload.
 *
 * @param list - List to serialize.
 * @param convert - Element serialization function.
 */
export function listToJson<TValue, TJson>(list: ReadonlyList<TValue>, convert: (value: TValue) => TJson): TJson[] {
  return list.map(convert).toArray();
}

/**
 * Converts a core {@link Dict} into a JSON entries array.
 *
 * @param dict - Dict to serialize.
 * @param convert - Entry serialization function mapping a key/value pair to one JSON entry.
 */
export function dictToJsonEntries<TKey, TValue, TJson>(
  dict: Dict<TKey, TValue>,
  convert: (key: TKey, value: TValue) => TJson
): TJson[] {
  return dict
    .entries()
    .map((entry) => convert(entry[0], entry[1]))
    .toArray();
}

/**
 * Converts JSON array payloads into a core {@link Dict}.
 *
 * @param entries - JSON array payload.
 * @param convert - Entry hydration function returning a key/value tuple.
 */
export function dictFromJsonEntries<TJson, TKey, TValue>(
  entries: readonly TJson[],
  convert: (entry: TJson) => readonly [TKey, TValue]
): Dict<TKey, TValue> {
  const source = List.from(entries);
  const result = new Dict<TKey, TValue>();
  for (let i = 0; i < source.size(); i++) {
    const [key, value] = convert(source.get(i)!);
    result.set(key, value);
  }
  return result;
}
