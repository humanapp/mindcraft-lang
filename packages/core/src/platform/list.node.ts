export interface ReadonlyList<T> {
  size(): number;
  isEmpty(): boolean;
  get(i: number): T;
  forEach(fn: (v: T, i: number) => void): void;
  map<U>(fn: (v: T, i: number) => U): ReadonlyList<U>;
  filter(fn: (v: T, i: number) => boolean): ReadonlyList<T>;
  find(fn: (v: T, i: number) => boolean): T | undefined;
  findIndex(fn: (v: T, i: number) => boolean): number;
  contains(v: T): boolean;
  reduce(fn: (acc: T, v: T, i: number) => T): T;
  reduce<U>(fn: (acc: U, v: T, i: number) => U, initial: U): U;
  toArray(): T[];
}

export class List<T> implements ReadonlyList<T> {
  private xs: T[];

  constructor(xs: T[] = []) {
    this.xs = xs;
  }

  static from<T>(xs: readonly T[]) {
    return new List<T>([...xs]);
  }

  static empty<T>(): List<T> {
    return new List<T>([]);
  }

  size() {
    return this.xs.length;
  }
  isEmpty() {
    return this.xs.length === 0;
  }
  get(i: number) {
    return this.xs[i]!;
  }
  set(i: number, v: T) {
    this.xs[i] = v;
  }
  push(...v: T[]) {
    this.xs.push(...v);
  }
  pop() {
    return this.xs.pop();
  }
  shift(): T | undefined {
    if (this.xs.length === 0) return undefined;
    return this.xs.shift();
  }
  unshift(...v: T[]): void {
    this.xs.unshift(...v);
  }
  insert(i: number, v: T) {
    this.xs.splice(i, 0, v);
  }
  remove(i: number) {
    return this.xs.splice(i, 1)[0];
  }
  clear() {
    this.xs.length = 0;
  }
  toArray() {
    return [...this.xs];
  }
  forEach(fn: (v: T, i: number) => void) {
    this.xs.forEach(fn);
  }
  map<U>(fn: (v: T, i: number) => U) {
    return new List(this.xs.map(fn));
  }
  filter(fn: (v: T, i: number) => boolean) {
    return new List(this.xs.filter(fn));
  }
  find(fn: (v: T, i: number) => boolean) {
    return this.xs.find(fn);
  }
  findIndex(fn: (v: T, i: number) => boolean) {
    return this.xs.findIndex(fn);
  }
  indexOf(v: T) {
    return this.xs.indexOf(v);
  }
  contains(v: T) {
    return this.xs.indexOf(v) !== -1;
  }
  reduce(fn: (acc: T, v: T, i: number) => T): T;
  reduce<U>(fn: (acc: U, v: T, i: number) => U, initial?: U): U {
    if (arguments.length < 2) {
      return this.xs.reduce(fn as unknown as (acc: T, v: T, i: number) => T) as unknown as U;
    }
    return this.xs.reduce(fn, initial as U);
  }
  slice(start?: number, end?: number): List<T> {
    return new List(this.xs.slice(start, end));
  }
  sort(fn?: (a: T, b: T) => number): this {
    this.xs.sort(fn);
    return this;
  }
  concat(other: List<T>): List<T> {
    return new List<T>(this.xs.concat(other.xs));
  }
  some(fn: (v: T, i: number) => boolean): boolean {
    return this.xs.some(fn);
  }
  asReadonly(): ReadonlyList<T> {
    return this;
  }

  raw(): Array<T> {
    return this.xs;
  }
}
