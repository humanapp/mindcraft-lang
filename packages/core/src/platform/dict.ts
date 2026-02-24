import type { List } from "./list";

export declare class Dict<K, V> {
  constructor(entries?: ReadonlyArray<readonly [K, V]>);
  static empty<K, V>(): Dict<K, V>;

  size(): number;
  isEmpty(): boolean;
  get(key: K): V | undefined;
  has(key: K): boolean;
  set(key: K, value: V): void;
  delete(key: K): boolean;
  clear(): void;
  keys(): List<K>;
  values(): List<V>;
  entries(): List<[K, V]>;
  forEach(fn: (value: V, key: K) => void): void;
}
