export interface ReadonlyList<T> {
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
  subview(start: number, count: number): ReadonlyList<T>;
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
  swap(i: number, j: number): void {
    const tmp = this.xs[i]!;
    this.xs[i] = this.xs[j]!;
    this.xs[j] = tmp;
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

  toJSON(): T[] {
    return this.xs;
  }

  raw(): Array<T> {
    return this.xs;
  }

  subview(start: number, count: number): ReadonlyList<T> {
    if (start < 0 || count < 0 || start + count > this.xs.length) {
      throw new Error(`subview out of range: start=${start}, count=${count}, size=${this.xs.length}`);
    }
    return new Sublist<T>(this, start, count);
  }
}

class Sublist<T> implements ReadonlyList<T> {
  private readonly _list: List<T>;
  private readonly _start: number;
  private readonly _count: number;

  constructor(list: List<T>, start: number, count: number) {
    this._list = list;
    this._start = start;
    this._count = count;
  }

  size(): number {
    return this._count;
  }

  isEmpty(): boolean {
    return this._count === 0;
  }

  get(i: number): T {
    if (i < 0 || i >= this._count) {
      throw new Error(`Sublist index out of range: ${i}`);
    }
    return this._list.get(this._start + i);
  }

  forEach(fn: (v: T, i: number) => void): void {
    for (let i = 0; i < this._count; i++) {
      fn(this._list.get(this._start + i), i);
    }
  }

  map<U>(fn: (v: T, i: number) => U): ReadonlyList<U> {
    const out = new List<U>();
    for (let i = 0; i < this._count; i++) {
      out.push(fn(this._list.get(this._start + i), i));
    }
    return out;
  }

  filter(fn: (v: T, i: number) => boolean): ReadonlyList<T> {
    const out = new List<T>();
    for (let i = 0; i < this._count; i++) {
      const v = this._list.get(this._start + i);
      if (fn(v, i)) out.push(v);
    }
    return out;
  }

  find(fn: (v: T, i: number) => boolean): T | undefined {
    for (let i = 0; i < this._count; i++) {
      const v = this._list.get(this._start + i);
      if (fn(v, i)) return v;
    }
    return undefined;
  }

  findIndex(fn: (v: T, i: number) => boolean): number {
    for (let i = 0; i < this._count; i++) {
      if (fn(this._list.get(this._start + i), i)) return i;
    }
    return -1;
  }

  indexOf(v: T): number {
    for (let i = 0; i < this._count; i++) {
      if (this._list.get(this._start + i) === v) return i;
    }
    return -1;
  }

  contains(v: T): boolean {
    return this.indexOf(v) !== -1;
  }

  reduce(fn: (acc: T, v: T, i: number) => T): T;
  reduce<U>(fn: (acc: U, v: T, i: number) => U, initial?: U): U {
    if (arguments.length < 2) {
      if (this._count === 0) {
        throw new Error("Reduce of empty list with no initial value");
      }
      let acc = this._list.get(this._start) as unknown as U;
      for (let i = 1; i < this._count; i++) {
        acc = fn(acc, this._list.get(this._start + i), i);
      }
      return acc;
    }
    let acc = initial as U;
    for (let i = 0; i < this._count; i++) {
      acc = fn(acc, this._list.get(this._start + i), i);
    }
    return acc;
  }

  slice(start?: number, end?: number): ReadonlyList<T> {
    const len = this._count;
    const s = start === undefined ? 0 : start < 0 ? Math.max(len + start, 0) : Math.min(start, len);
    const e = end === undefined ? len : end < 0 ? Math.max(len + end, 0) : Math.min(end, len);
    const out = new List<T>();
    for (let i = s; i < e; i++) {
      out.push(this._list.get(this._start + i));
    }
    return out;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this._count; i++) {
      out.push(this._list.get(this._start + i));
    }
    return out;
  }

  subview(start: number, count: number): ReadonlyList<T> {
    if (start < 0 || count < 0 || start + count > this._count) {
      throw new Error(`subview out of range: start=${start}, count=${count}, size=${this._count}`);
    }
    return new Sublist<T>(this._list, this._start + start, count);
  }
}
