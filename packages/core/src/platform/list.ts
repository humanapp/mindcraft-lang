export declare interface ReadonlyList<T> {
  size(): number;
  isEmpty(): boolean;
  get(i: number): T;
  forEach(fn: (v: T, i: number) => void): void;
  map<U>(fn: (v: T, i: number) => U): ReadonlyList<U>;
  filter(fn: (v: T, i: number) => boolean): ReadonlyList<T>;
  find(fn: (v: T, i: number) => boolean): T | undefined;
  findIndex(fn: (v: T, i: number) => boolean): number;
  indexOf(v: T): number;
  contains(v: T): boolean;
  reduce(fn: (acc: T, v: T, i: number) => T): T;
  reduce<U>(fn: (acc: U, v: T, i: number) => U, initial: U): U;
  slice(start?: number, end?: number): ReadonlyList<T>;
  toArray(): T[];
}

export declare class List<T> implements ReadonlyList<T> {
  static from<T>(xs: readonly T[]): List<T>;
  static empty<T>(): List<T>;

  size(): number;
  isEmpty(): boolean;
  get(i: number): T;
  set(i: number, v: T): void;
  push(...v: T[]): void;
  pop(): T | undefined;
  shift(): T | undefined;
  unshift(...v: T[]): void;
  insert(i: number, v: T): void;
  remove(i: number): T | undefined;
  clear(): void;
  toArray(): T[];
  forEach(fn: (v: T, i: number) => void): void;
  map<U>(fn: (v: T, i: number) => U): List<U>;
  filter(fn: (v: T, i: number) => boolean): List<T>;
  find(fn: (v: T, i: number) => boolean): T | undefined;
  findIndex(fn: (v: T, i: number) => boolean): number;
  indexOf(v: T): number;
  contains(v: T): boolean;
  reduce(fn: (acc: T, v: T, i: number) => T): T;
  reduce<U>(fn: (acc: U, v: T, i: number) => U, initial: U): U;
  slice(start?: number, end?: number): List<T>;
  sort(fn?: (a: T, b: T) => number): this;
  concat(other: List<T>): List<T>;
  some(fn: (v: T, i: number) => boolean): boolean;
  asReadonly(): ReadonlyList<T>;
}
