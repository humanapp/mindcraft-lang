// UniqueSet.node.ts (Node implementation)

export class UniqueSet<T extends string | number> {
  private xs: Set<T>;

  constructor(values?: readonly T[]) {
    this.xs = new Set<T>();
    if (values) {
      for (let i = 0; i < values.length; i++) {
        this.xs.add(values[i]);
      }
    }
  }

  size(): number {
    return this.xs.size;
  }

  isEmpty(): boolean {
    return this.xs.size === 0;
  }

  has(value: T): boolean {
    return this.xs.has(value);
  }

  add(value: T): void {
    this.xs.add(value);
  }

  delete(value: T): boolean {
    return this.xs.delete(value);
  }

  clear(): void {
    this.xs.clear();
  }

  forEach(fn: (value: T) => void): void {
    this.xs.forEach(fn);
  }

  toArray(): T[] {
    return Array.from(this.xs);
  }
}
