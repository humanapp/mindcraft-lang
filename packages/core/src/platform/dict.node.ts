// Dict.node.ts (Node implementation)

import { List } from "./list.node";

export class Dict<K, V> {
  private xm: Map<K, V>;

  constructor(entries?: ReadonlyArray<readonly [K, V]>) {
    this.xm = new Map<K, V>();
    if (entries) {
      for (let i = 0; i < entries.length; i++) {
        const [k, v] = entries[i];
        this.xm.set(k, v);
      }
    }
  }

  static empty<K, V>(): Dict<K, V> {
    return new Dict<K, V>();
  }

  size(): number {
    return this.xm.size;
  }

  isEmpty(): boolean {
    return this.xm.size === 0;
  }

  get(key: K): V | undefined {
    return this.xm.get(key);
  }

  has(key: K): boolean {
    return this.xm.has(key);
  }

  set(key: K, value: V): void {
    this.xm.set(key, value);
  }

  delete(key: K): boolean {
    return this.xm.delete(key);
  }

  clear(): void {
    this.xm.clear();
  }

  keys(): List<K> {
    return List.from(Array.from(this.xm.keys()));
  }

  values(): List<V> {
    return List.from(Array.from(this.xm.values()));
  }

  entries(): List<[K, V]> {
    return List.from(Array.from(this.xm.entries()));
  }

  forEach(fn: (value: V, key: K) => void): void {
    this.xm.forEach((v, k) => {
      fn(v, k);
    });
  }
}
