// Dict.rbx.ts (Roblox / roblox-ts implementation)
//
// Backed by a Luau table. We track size explicitly.

import { List } from "./list.rbx";

export class Dict<K extends defined, V extends defined> {
  private t: { [key: string]: V } & { [key: number]: V };
  private n: number;

  constructor(entries?: ReadonlyArray<readonly [K, V]>) {
    this.t = {} as never;
    this.n = 0;

    if (entries) {
      for (let i = 0; i < entries.size(); i++) {
        const [k, v] = entries[i];
        this.set(k, v);
      }
    }
  }

  static empty<K extends defined, V extends defined>(): Dict<K, V> {
    return new Dict<K, V>();
  }

  size(): number {
    return this.n;
  }

  isEmpty(): boolean {
    return this.n === 0;
  }

  get(key: K): V | undefined {
    return this.t[key as never];
  }

  has(key: K): boolean {
    return this.t[key as never] !== undefined;
  }

  set(key: K, value: V): void {
    const existed = this.t[key as never] !== undefined;
    this.t[key as never] = value;
    if (!existed) this.n++;
  }

  delete(key: K): boolean {
    const existed = this.t[key as never] !== undefined;
    if (existed) {
      this.t[key as never] = undefined as never; // clears key in Luau (nil)
      this.n--;
      return true;
    }
    return false;
  }

  clear(): void {
    this.t = {} as never;
    this.n = 0;
  }

  keys(): List<K> {
    const out: K[] = [];
    for (const [k] of pairs(this.t)) {
      out.push(k as K);
    }
    return List.from(out);
  }

  values(): List<V> {
    const out: V[] = [];
    for (const [, v] of pairs(this.t)) {
      out.push(v as V);
    }
    return List.from(out);
  }

  entries(): List<[K, V]> {
    const out: Array<[K, V]> = [];
    for (const [k, v] of pairs(this.t)) {
      out.push([k as K, v as V]);
    }
    return List.from(out);
  }

  forEach(fn: (value: V, key: K) => void): void {
    for (const [k, v] of pairs(this.t)) {
      fn(v as V, k as K);
    }
  }
}
