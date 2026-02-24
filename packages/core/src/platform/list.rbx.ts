export interface ReadonlyList<T extends defined> {
  size(): number;
  isEmpty(): boolean;
  get(i: number): T;
  forEach(fn: (v: T, i: number) => void): void;
  map<U extends defined>(fn: (v: T, i: number) => U): ReadonlyList<U>;
  filter(fn: (v: T, i: number) => boolean): ReadonlyList<T>;
  find(fn: (v: T, i: number) => boolean): T | undefined;
  findIndex(fn: (v: T, i: number) => boolean): number;
  contains(v: T): boolean;
  reduce(fn: (acc: T, v: T, i: number) => T): T;
  reduce<U extends defined>(fn: (acc: U, v: T, i: number) => U, initial: U): U;
  toArray(): Array<T>;
}

export class List<T extends defined> implements ReadonlyList<T> {
  private xs: Array<T>;

  constructor(xs: Array<T> = []) {
    this.xs = xs;
  }

  static from<T extends defined>(xs: readonly T[]) {
    const out = new List<T>();
    for (let i = 0; i < xs.size(); i++) {
      out.push(xs[i]);
    }
    return out;
  }

  static empty<T extends defined>(): List<T> {
    return new List<T>([]);
  }

  size() {
    return this.xs.size();
  }
  isEmpty() {
    return this.size() === 0;
  }
  get(i: number) {
    return this.xs[i];
  }
  set(i: number, v: T) {
    this.xs[i] = v;
  }
  push(...v: T[]) {
    for (const item of v) {
      this.xs.push(item);
    }
  }
  pop(): T | undefined {
    const n = this.size();
    if (n === 0) return undefined;
    const v = this.xs[n - 1];
    this.xs.remove(n - 1);
    return v;
  }
  shift(): T | undefined {
    if (this.size() === 0) return undefined;
    const v = this.xs[0];
    this.xs.remove(0);
    return v;
  }
  unshift(...v: T[]): void {
    for (let i = v.size() - 1; i >= 0; i--) {
      this.xs.insert(0, v[i]);
    }
  }
  insert(i: number, v: T): void {
    this.xs.insert(i, v);
  }
  remove(i: number): T | undefined {
    const v = this.xs[i];
    this.xs.remove(i);
    return v;
  }
  clear() {
    while (this.size() > 0) this.pop();
  }
  toArray(): Array<T> {
    const out: Array<T> = [];
    for (let i = 0; i < this.xs.size(); i++) {
      out.push(this.xs[i]);
    }
    return out;
  }
  forEach(fn: (v: T, i: number) => void) {
    for (let i = 0; i < this.xs.size(); i++) {
      fn(this.xs[i], i);
    }
  }
  map<U extends defined>(fn: (v: T, i: number) => U) {
    const out = new List<U>();
    for (let i = 0; i < this.xs.size(); i++) {
      out.push(fn(this.xs[i], i));
    }
    return out;
  }
  filter(fn: (v: T, i: number) => boolean) {
    const out = new List<T>();
    for (let i = 0; i < this.xs.size(); i++) {
      const v = this.xs[i];
      if (fn(v, i)) out.push(v);
    }
    return out;
  }
  find(fn: (v: T, i: number) => boolean): T | undefined {
    for (let i = 0; i < this.xs.size(); i++) {
      const v = this.xs[i];
      if (fn(v, i)) return v;
    }
    return undefined;
  }
  findIndex(fn: (v: T, i: number) => boolean): number {
    for (let i = 0; i < this.xs.size(); i++) {
      const v = this.xs[i];
      if (fn(v, i)) return i;
    }
    return -1;
  }
  indexOf(v: T): number {
    for (let i = 0; i < this.xs.size(); i++) {
      if (this.xs[i] === v) return i;
    }
    return -1;
  }
  contains(v: T): boolean {
    for (let i = 0; i < this.xs.size(); i++) {
      if (this.xs[i] === v) return true;
    }
    return false;
  }
  reduce(fn: (acc: T, v: T, i: number) => T): T;
  reduce<U extends defined>(fn: (acc: U, v: T, i: number) => U, initial?: U): U {
    const len = this.size();
    if (len === 0 && initial === undefined) {
      error("Reduce of empty list with no initial value");
    }

    let acc: U;
    let startIndex: number;

    if (initial === undefined) {
      acc = this.xs[0] as unknown as U;
      startIndex = 1;
    } else {
      acc = initial;
      startIndex = 0;
    }

    for (let i = startIndex; i < len; i++) {
      acc = fn(acc, this.xs[i], i);
    }

    return acc;
  }
  slice(start?: number, end_?: number): List<T> {
    const out = new List<T>();
    const len = this.size();
    const s = start === undefined ? 0 : start < 0 ? math.max(len + start, 0) : math.min(start, len);
    const e = end_ === undefined ? len : end_ < 0 ? math.max(len + end_, 0) : math.min(end_, len);
    for (let i = s; i < e; i++) {
      out.push(this.xs[i]);
    }
    return out;
  }
  sort(compareFn?: (a: T, b: T) => number): this {
    type CompareFn<T> = (a: T, b: T) => number;
    type Item<T> = { v: T | undefined; i: number };
    function defaultCompare(a: unknown, b: unknown): number {
      // Put undefined at the end (like JS sort behavior for undefined)
      const aU = a === undefined;
      const bU = b === undefined;
      if (aU && bU) return 0;
      if (aU) return 1;
      if (bU) return -1;

      const sa = tostring(a);
      const sb = tostring(b);

      // Lexicographic compare
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      return 0;
    }

    function makeCompare<T>(compareFn?: CompareFn<T>) {
      return (a: T | undefined, b: T | undefined): number => {
        const aU = a === undefined;
        const bU = b === undefined;
        if (aU && bU) return 0;
        if (aU) return 1;
        if (bU) return -1;

        if (compareFn) {
          // In Luau, NaN compares oddly; normalize: NaN => 0
          const r = compareFn(a as T, b as T);
          if (r !== r) return 0; // NaN check
          if (r < 0) return -1;
          if (r > 0) return 1;
          return 0;
        }

        return defaultCompare(a, b);
      };
    }

    const len = this.size();

    const cmp = makeCompare(compareFn);

    // Capture values + original indices (stable)
    const items = new Array<Item<T>>(len);
    for (let i = 1; i <= len; i++) {
      // In roblox-ts, arrays are dense; but we still treat "missing" as undefined
      items[i - 1] = { v: this.xs[i - 1], i };
    }

    const aux = new Array<Item<T>>(len);

    const stableCmp = (x: Item<T>, y: Item<T>) => {
      const c = cmp(x.v, y.v);
      if (c !== 0) return c;
      // Tie-break by original position to ensure stability
      return x.i - y.i;
    };

    const mergeSort = (lo: number, hi: number) => {
      if (hi - lo <= 1) return;
      const mid = math.floor((lo + hi) / 2);
      mergeSort(lo, mid);
      mergeSort(mid, hi);

      let i = lo;
      let j = mid;
      let k = lo;

      while (i < mid && j < hi) {
        if (stableCmp(items[i], items[j]) <= 0) {
          aux[k] = items[i];
          i += 1;
        } else {
          aux[k] = items[j];
          j += 1;
        }
        k += 1;
      }

      while (i < mid) {
        aux[k] = items[i];
        i += 1;
        k += 1;
      }

      while (j < hi) {
        aux[k] = items[j];
        j += 1;
        k += 1;
      }

      for (let p = lo; p < hi; p++) {
        items[p] = aux[p];
      }
    };

    // 0-based indices for our temp arrays
    mergeSort(0, len);

    // Write back in place
    for (let idx = 0; idx < len; idx++) {
      this.xs[idx] = items[idx].v as T;
    }

    return this;
  }

  concat(other: List<T>): List<T> {
    const out = new List<T>();
    for (let i = 0; i < this.size(); i++) {
      out.push(this.get(i));
    }
    for (let j = 0; j < other.size(); j++) {
      out.push(other.get(j));
    }
    return out;
  }

  some(fn: (v: T, i: number) => boolean): boolean {
    for (let i = 0; i < this.size(); i++) {
      if (fn(this.get(i), i)) {
        return true;
      }
    }
    return false;
  }

  asReadonly(): ReadonlyList<T> {
    return this;
  }

  raw(): Array<T> {
    return this.xs;
  }
}
