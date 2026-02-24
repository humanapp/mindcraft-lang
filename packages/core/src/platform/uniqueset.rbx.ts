// UniqueSet.rbx.ts (Roblox / roblox-ts implementation)
//
// Backed by a Luau table with keys as set members and values as `true`.

export class UniqueSet<T extends string | number> {
  private t: { [key: string]: true } & { [key: number]: true };
  private n: number;

  constructor(values?: readonly T[]) {
    this.t = {} as never;
    this.n = 0;

    if (values) {
      for (let i = 0; i < values.size(); i++) {
        this.add(values[i]);
      }
    }
  }

  size(): number {
    return this.n;
  }

  isEmpty(): boolean {
    return this.n === 0;
  }

  has(value: T): boolean {
    return this.t[value as never] === true;
  }

  add(value: T): void {
    const existed = this.t[value as never] === true;
    if (!existed) {
      this.t[value as never] = true;
      this.n++;
    }
  }

  delete(value: T): boolean {
    const existed = this.t[value as never] === true;
    if (existed) {
      this.t[value as never] = undefined as never; // clears key in Luau (nil)
      this.n--;
    }
    return existed;
  }

  clear(): void {
    this.t = {} as never;
    this.n = 0;
  }

  forEach(fn: (value: T) => void): void {
    for (const [k] of pairs(this.t)) {
      fn(k as T);
    }
  }

  toArray(): T[] {
    const arr: T[] = [];
    for (const [k] of pairs(this.t)) {
      arr.push(k as T);
    }
    return arr;
  }
}
