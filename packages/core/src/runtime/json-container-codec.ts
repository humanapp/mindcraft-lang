import { Dict } from "../platform/dict";
import { List } from "../platform/list";

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
